// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
#include "engine/neural.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace nanotech {
namespace {

// Texels added around the texture (or a tile of it) before the network sees it, cropped off after:
// the texture's own neighbours, so its edges and the tiles' meet (the GPU's tiles have the same).
constexpr int kMargin = 16;
// The largest tile, margin included: a 256 texture is one tile, a 512 one a few. PLKSR-Rep's
// buffers for one are about 150 MB, which a phone's three workers can hold.
constexpr int kTileSide = 300;
constexpr int kBuffers = 16;

std::uint32_t u32(const std::uint8_t* p) {
    return std::uint32_t{p[0]} | (std::uint32_t{p[1]} << 8) | (std::uint32_t{p[2]} << 16) | (std::uint32_t{p[3]} << 24);
}

float f32(const std::uint8_t* p) {
    const std::uint32_t bits = u32(p);
    float f;
    std::memcpy(&f, &bits, 4);
    return f;
}

bool read_floats(const std::uint8_t*& p, const std::uint8_t* end, std::size_t n, std::vector<float>& out) {
    if (static_cast<std::size_t>(end - p) / 4 < n) return false;
    out.resize(n);
    for (std::size_t i = 0; i < n; ++i) out[i] = f32(p + 4 * i);
    p += 4 * n;
    return true;
}

bool read_model(const std::uint8_t*& p, const std::uint8_t* end, std::vector<Op>& out) {
    if (end - p < 4) return false;
    const std::uint32_t count = u32(p);
    p += 4;
    if (count == 0 || count > 4096) return false;
    for (std::uint32_t i = 0; i < count; ++i) {
        if (end - p < 4) return false;
        Op op;
        const std::uint32_t kind = u32(p);
        p += 4;
        if (kind == 1) {
            if (end - p < 8) return false;
            op.shuffle = true;
            op.src = static_cast<int>(u32(p));
            op.aux = static_cast<int>(u32(p + 4));
            p += 8;
            if (op.src >= kBuffers || op.aux >= kBuffers) return false;
            out.push_back(std::move(op));
            continue;
        }
        if (kind != 0 || end - p < 32) return false;
        op.k = static_cast<int>(u32(p));
        op.in = static_cast<int>(u32(p + 4));
        op.out = static_cast<int>(u32(p + 8));
        op.src = static_cast<int>(u32(p + 12));
        op.dst = static_cast<int>(u32(p + 16));
        const std::uint32_t act = u32(p + 20);
        op.aux = static_cast<int>(u32(p + 24));
        op.pass = u32(p + 28) != 0;
        p += 32;
        if (op.k < 1 || op.k > 31 || op.k % 2 == 0 || op.in < 1 || op.in > 512 || op.out < 1 || op.out > 512 ||
            op.src >= kBuffers || op.dst >= kBuffers || op.aux >= kBuffers || op.dst == op.src || act > 4) {
            return false;
        }
        op.act = static_cast<Act>(act);
        std::vector<float> file;
        const std::size_t taps = static_cast<std::size_t>(op.k) * op.k;
        if (!read_floats(p, end, static_cast<std::size_t>(op.out) * op.in * taps, file)) return false;
        // [out][in][ky][kx] in the file, [ky][kx][in][out] here.
        op.weights.resize(file.size());
        for (int o = 0; o < op.out; ++o)
            for (int c = 0; c < op.in; ++c)
                for (std::size_t t = 0; t < taps; ++t)
                    op.weights[(t * op.in + c) * op.out + o] = file[(static_cast<std::size_t>(o) * op.in + c) * taps + t];
        if (!read_floats(p, end, static_cast<std::size_t>(op.out), op.bias)) return false;
        if (op.act == Act::Prelu && !read_floats(p, end, static_cast<std::size_t>(op.out), op.slopes)) return false;
        out.push_back(std::move(op));
    }
    return out.back().shuffle;
}

struct Buffer {
    int channels = 0;
    std::vector<float> data;  // [y][x][channel]
};

// Outputs o0..o0+N of four pixels in a row (`row`: the first one's top-left tap in the padded
// source), their sums held in registers: bias, then each tap and channel in order.
template <int N>
void conv_block(const Op& op, const float* row, int pw, int ci, int co, int o0, float* acc) {
    float s[4][N];
    for (int j = 0; j < 4; ++j)
        for (int i = 0; i < N; ++i) s[j][i] = op.bias[static_cast<std::size_t>(o0 + i)];
    for (int ky = 0; ky < op.k; ++ky) {
        for (int kx = 0; kx < op.k; ++kx) {
            const float* in = row + (static_cast<std::size_t>(ky) * pw + kx) * ci;
            const float* wk = &op.weights[static_cast<std::size_t>(ky * op.k + kx) * ci * co + o0];
            for (int c = 0; c < ci; ++c) {
                const float* wr = wk + static_cast<std::size_t>(c) * co;
                for (int j = 0; j < 4; ++j) {
                    const float v = in[j * ci + c];
                    for (int i = 0; i < N; ++i) s[j][i] += v * wr[i];
                }
            }
        }
    }
    for (int j = 0; j < 4; ++j)
        for (int i = 0; i < N; ++i) acc[static_cast<std::size_t>(j) * co + o0 + i] = s[j][i];
}

// One convolution, zero outside the w x h area (as PyTorch pads it), and what follows it. Four
// pixels of a row at a time share each weight's load; every output's sum still runs bias, then
// taps and channels in one order (a zero outside adds nothing), so the bytes do not change.
void run_conv(const Op& op, const Buffer& src, const Buffer* aux, Buffer& dst, int w, int h) {
    const int ci = op.in, co = op.out, r = op.k / 2;
    const int extra = op.pass ? src.channels - ci : 0;
    // The source's first `ci` channels with `r` zeros around them.
    const int pw = w + 2 * r + 3, ph = h + 2 * r;
    std::vector<float> padded(static_cast<std::size_t>(pw) * ph * ci, 0.0f);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            std::copy_n(&src.data[(static_cast<std::size_t>(y) * w + x) * src.channels], ci,
                        &padded[(static_cast<std::size_t>(y + r) * pw + x + r) * ci]);
        }
    }
    dst.channels = co + extra;
    dst.data.assign(static_cast<std::size_t>(w) * h * dst.channels, 0.0f);
    constexpr int kRun = 4;
    std::vector<float> acc(static_cast<std::size_t>(co) * kRun);
    const int chunk = co % 8 == 0 ? 8 : co % 4 == 0 ? 4 : 1;
    for (int y = 0; y < h; ++y) {
        for (int x0 = 0; x0 < w; x0 += kRun) {
            const float* row = &padded[(static_cast<std::size_t>(y) * pw + x0) * ci];
            for (int o0 = 0; o0 < co; o0 += chunk) {
                if (chunk == 8) conv_block<8>(op, row, pw, ci, co, o0, acc.data());
                else if (chunk == 4) conv_block<4>(op, row, pw, ci, co, o0, acc.data());
                else conv_block<1>(op, row, pw, ci, co, o0, acc.data());
            }
            for (int j = 0; j < kRun && x0 + j < w; ++j) {
                const std::size_t at = static_cast<std::size_t>(y) * w + x0 + j;
                float* out = &dst.data[at * dst.channels];
                const float* side = aux ? &aux->data[at * aux->channels] : nullptr;
                const float* sum = acc.data() + static_cast<std::size_t>(j) * co;
                for (int o = 0; o < co; ++o) {
                    float v = sum[o];
                    switch (op.act) {
                    case Act::None:
                        break;
                    case Act::Prelu:
                        if (v < 0.0f) v *= op.slopes[static_cast<std::size_t>(o)];
                        break;
                    case Act::Gelu:
                        v = static_cast<float>(0.5 * v * (1.0 + exact_erf(v * 0.70710678118654752)));
                        break;
                    case Act::Gate:
                        v = side[o] * static_cast<float>(1.0 / (1.0 + exact_exp(-static_cast<double>(v))));
                        break;
                    case Act::Add:
                        v += side[o];
                        break;
                    }
                    out[o] = v;
                }
                if (extra > 0) std::copy_n(&src.data[at * src.channels + ci], extra, out + co);
            }
        }
    }
}

bool same_shape(const std::vector<Op>& a, const std::vector<Op>& b) {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (a[i].shuffle != b[i].shuffle || a[i].k != b[i].k || a[i].in != b[i].in || a[i].out != b[i].out ||
            a[i].src != b[i].src || a[i].dst != b[i].dst || a[i].aux != b[i].aux || a[i].act != b[i].act ||
            a[i].pass != b[i].pass) {
            return false;
        }
    }
    return true;
}

}  // namespace

double exact_exp(double x) {
    x = std::clamp(x, -700.0, 700.0);
    // x = n ln2 + r, |r| <= ln2 / 2; e^r from its series (13 terms reach double precision).
    const double n = std::floor(x * 1.4426950408889634 + 0.5);
    const double r = x - n * 0.6931471803691238 - n * 1.9082149292705877e-10;
    double term = 1.0, sum = 1.0;
    for (int i = 1; i <= 13; ++i) {
        term = term * r / i;
        sum = sum + term;
    }
    return std::ldexp(sum, static_cast<int>(n));
}

double exact_erf(double x) {
    // Abramowitz and Stegun 7.1.26 (error under 1.5e-7, far below float32's steps here).
    const double s = x < 0.0 ? -1.0 : 1.0;
    const double a = x < 0.0 ? -x : x;
    const double t = 1.0 / (1.0 + 0.3275911 * a);
    const double poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return s * (1.0 - poly * exact_exp(-a * a));
}

Network load_network(const std::uint8_t* data, std::size_t size) {
    Network net;
    if (data == nullptr || size < 12 || std::memcmp(data, "NTN2", 4) != 0 || u32(data + 4) != 2) return {};
    const std::uint32_t models = u32(data + 8);
    if (models < 1 || models > 2) return {};
    const std::uint8_t* p = data + 12;
    const std::uint8_t* end = data + size;
    if (!read_model(p, end, net.ops)) return {};
    if (models == 2 && (!read_model(p, end, net.denoise) || !same_shape(net.ops, net.denoise))) net.denoise.clear();
    for (const Op& op : net.ops) {
        if (!op.shuffle && op.src == 0 && op.in != 3) return {};
    }
    return net;
}

namespace {

// The ops over one tile of `rgb` (x, y, w, h) and its margin, its 4x result put into `out`.
bool run_tile(const std::vector<Op>& ops, const Image& rgb, int x0, int y0, int tw, int th, bool wrap_x, bool wrap_y,
              Image& out) {
    const int w = tw + 2 * kMargin, h = th + 2 * kMargin;
    const auto pick = [](int v, int n, bool wrap) { return wrap ? ((v % n) + n) % n : std::clamp(v, 0, n - 1); };
    std::vector<Buffer> buffers(kBuffers);
    Buffer& input = buffers[0];
    input.channels = 3;
    input.data.resize(static_cast<std::size_t>(w) * h * 3);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const std::uint8_t* p =
                rgb.at(pick(x0 + x - kMargin, rgb.width, wrap_x), pick(y0 + y - kMargin, rgb.height, wrap_y));
            for (int c = 0; c < 3; ++c) {
                input.data[(static_cast<std::size_t>(y) * w + x) * 3 + c] = static_cast<float>(p[c]) / 255.0f;
            }
        }
    }
    for (const Op& op : ops) {
        if (!op.shuffle) {
            const Buffer& src = buffers[static_cast<std::size_t>(op.src)];
            const bool has_aux = op.act == Act::Gate || op.act == Act::Add;
            const Buffer* aux = has_aux ? &buffers[static_cast<std::size_t>(op.aux)] : nullptr;
            if (src.channels < op.in || (aux && aux->channels < op.out)) return false;
            Buffer result;
            run_conv(op, src, aux, result, w, h);
            buffers[static_cast<std::size_t>(op.dst)] = std::move(result);
            continue;
        }
        // 48 channels: pixel shuffle (c * 16 + dy * 4 + dx) to 4x, plus the input's squares.
        const Buffer& a = buffers[static_cast<std::size_t>(op.src)];
        const Buffer& in = buffers[static_cast<std::size_t>(op.aux)];
        if (a.channels != 48 || in.channels != 3) return false;
        for (int y = 0; y < th * 4; ++y) {
            for (int x = 0; x < tw * 4; ++x) {
                const int sx = x / 4 + kMargin, sy = y / 4 + kMargin;
                const std::size_t at = static_cast<std::size_t>(sy) * w + sx;
                std::uint8_t* q = out.at(x0 * 4 + x, y0 * 4 + y);
                for (int c = 0; c < 3; ++c) {
                    const float v = a.data[at * 48 + static_cast<std::size_t>(c * 16 + (y % 4) * 4 + (x % 4))] +
                                    in.data[at * 3 + c];
                    q[c] = static_cast<std::uint8_t>(std::clamp(v * 255.0f + 0.5f, 0.0f, 255.0f));
                }
                q[3] = 255;
            }
        }
        return true;
    }
    return false;
}

}  // namespace

Image neural_x4(const Network& net, const Image& rgb, int denoise, bool wrap_x, bool wrap_y) {
    if (net.empty() || rgb.empty()) return {};
    // The ops to run: the model's, or blended with the second, weakly denoising one (each weight
    // w*a + d*b, in one order), as Real-ESRGAN's denoise strength does.
    std::vector<Op> blended;
    const std::vector<Op>* ops = &net.ops;
    const int strength = std::clamp(denoise, 0, 100);
    if (!net.denoise.empty() && strength < 100) {
        blended = net.ops;
        const float a = static_cast<float>(strength) / 100.0f;
        const float b = static_cast<float>(100 - strength) / 100.0f;
        const auto mix = [&](std::vector<float>& v, const std::vector<float>& d) {
            for (std::size_t k = 0; k < v.size(); ++k) v[k] = v[k] * a + d[k] * b;
        };
        for (std::size_t i = 0; i < blended.size(); ++i) {
            mix(blended[i].weights, net.denoise[i].weights);
            mix(blended[i].bias, net.denoise[i].bias);
            mix(blended[i].slopes, net.denoise[i].slopes);
        }
        ops = &blended;
    }

    // The texture in tiles (one, unless it is large) with kMargin of its own neighbours around
    // each, so a worker's memory stays small: every tile and op the same order, the same bytes.
    const int tw = rgb.width + 2 * kMargin <= kTileSide ? rgb.width : kTileSide - 2 * kMargin;
    const int th = rgb.height + 2 * kMargin <= kTileSide ? rgb.height : kTileSide - 2 * kMargin;
    Image out(rgb.width * 4, rgb.height * 4);
    for (int ty = 0; ty < rgb.height; ty += th) {
        for (int tx = 0; tx < rgb.width; tx += tw) {
            if (!run_tile(*ops, rgb, tx, ty, std::min(tw, rgb.width - tx), std::min(th, rgb.height - ty), wrap_x, wrap_y, out)) {
                return {};
            }
        }
    }
    return out;
}

}  // namespace nanotech
