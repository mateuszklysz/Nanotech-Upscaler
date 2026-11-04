// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
#include "engine/neural.hpp"

#include <algorithm>
#include <cstring>

namespace nanotech {
namespace {

// Texels added around the texture before the network sees it (its view reaches 34 texels; the
// edge's few rows are what is left of that), cropped off after.
constexpr int kMargin = 8;

std::uint32_t u32(const std::uint8_t* p) {
    return std::uint32_t{p[0]} | (std::uint32_t{p[1]} << 8) | (std::uint32_t{p[2]} << 16) | (std::uint32_t{p[3]} << 24);
}

float f32(const std::uint8_t* p) {
    const std::uint32_t bits = u32(p);
    float f;
    std::memcpy(&f, &bits, 4);
    return f;
}

bool read_model(const std::uint8_t*& p, const std::uint8_t* end, std::vector<Layer>& out) {
    if (end - p < 12 || std::memcmp(p, "NTNN", 4) != 0 || u32(p + 4) != 1) return false;
    const std::uint32_t count = u32(p + 8);
    p += 12;
    for (std::uint32_t i = 0; i < count; ++i) {
        if (end - p < 12) return false;
        Layer l;
        l.conv = u32(p) == 0;
        l.out = static_cast<int>(u32(p + 4));
        l.in = static_cast<int>(u32(p + 8));
        p += 12;
        if (l.out <= 0 || l.in <= 0 || l.out > 256 || l.in > 256) return false;
        const std::size_t n = l.conv ? static_cast<std::size_t>(l.out) * l.in * 9 + l.out : l.out;
        if (static_cast<std::size_t>(end - p) < n * 4) return false;
        if (l.conv) {
            // [out][in][ky][kx] in the file, [ky][kx][in][out] here: the inner loop runs over the
            // outputs, each its own sum, so it vectorizes without reordering any sum.
            l.weights.resize(static_cast<std::size_t>(l.out) * l.in * 9);
            for (int o = 0; o < l.out; ++o)
                for (int c = 0; c < l.in; ++c)
                    for (int k = 0; k < 9; ++k)
                        l.weights[(static_cast<std::size_t>(k) * l.in + c) * l.out + o] =
                            f32(p + 4 * ((static_cast<std::size_t>(o) * l.in + c) * 9 + k));
            p += 4 * static_cast<std::size_t>(l.out) * l.in * 9;
            l.bias.resize(static_cast<std::size_t>(l.out));
            for (int o = 0; o < l.out; ++o) l.bias[static_cast<std::size_t>(o)] = f32(p + 4 * o);
            p += 4 * static_cast<std::size_t>(l.out);
        } else {
            l.weights.resize(static_cast<std::size_t>(l.out));
            for (int o = 0; o < l.out; ++o) l.weights[static_cast<std::size_t>(o)] = f32(p + 4 * o);
            p += 4 * static_cast<std::size_t>(l.out);
        }
        out.push_back(std::move(l));
    }
    return true;
}

// A 3x3 convolution over `in` (h x w x layer.in), zero outside, as PyTorch pads it.
void conv(const Layer& layer, const std::vector<float>& in, std::vector<float>& out, int w, int h) {
    const int ci = layer.in, co = layer.out;
    out.assign(static_cast<std::size_t>(w) * h * co, 0.0f);
    std::vector<float> acc(static_cast<std::size_t>(co));
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            std::copy(layer.bias.begin(), layer.bias.end(), acc.begin());
            for (int ky = 0; ky < 3; ++ky) {
                const int sy = y + ky - 1;
                if (sy < 0 || sy >= h) continue;
                for (int kx = 0; kx < 3; ++kx) {
                    const int sx = x + kx - 1;
                    if (sx < 0 || sx >= w) continue;
                    const float* src = &in[(static_cast<std::size_t>(sy) * w + sx) * ci];
                    const float* wk = &layer.weights[static_cast<std::size_t>(ky * 3 + kx) * ci * co];
                    for (int c = 0; c < ci; ++c) {
                        const float v = src[c];
                        const float* wr = wk + static_cast<std::size_t>(c) * co;
                        for (int o = 0; o < co; ++o) acc[static_cast<std::size_t>(o)] += v * wr[o];
                    }
                }
            }
            std::copy(acc.begin(), acc.end(), &out[(static_cast<std::size_t>(y) * w + x) * co]);
        }
    }
}

void prelu(const Layer& layer, std::vector<float>& data) {
    const std::size_t co = static_cast<std::size_t>(layer.out);
    for (std::size_t i = 0; i < data.size(); ++i) {
        const float a = layer.weights[i % co];
        if (data[i] < 0.0f) data[i] *= a;
    }
}

}  // namespace

Network load_network(const std::uint8_t* data, std::size_t size) {
    Network net;
    const std::uint8_t* p = data;
    const std::uint8_t* end = data + size;
    if (data == nullptr || !read_model(p, end, net.layers)) return {};
    if (p < end && !read_model(p, end, net.denoise)) return {};
    if (!net.denoise.empty() && net.denoise.size() != net.layers.size()) net.denoise.clear();
    if (net.layers.empty() || !net.layers.back().conv || net.layers.back().out != 48 || net.layers.front().in != 3) return {};
    return net;
}

Image neural_x4(const Network& net, const Image& rgb, int denoise, bool wrap_x, bool wrap_y) {
    if (net.empty() || rgb.empty()) return {};
    // The layers to run: the model's, or blended with the second, weakly denoising one (each weight
    // w*a + d*b, in one order), as Real-ESRGAN's denoise strength does.
    std::vector<Layer> blended;
    const std::vector<Layer>* layers = &net.layers;
    const int strength = std::clamp(denoise, 0, 100);
    if (!net.denoise.empty() && strength < 100) {
        blended = net.layers;
        const float a = static_cast<float>(strength) / 100.0f;
        const float b = static_cast<float>(100 - strength) / 100.0f;
        for (std::size_t i = 0; i < blended.size(); ++i) {
            for (std::size_t k = 0; k < blended[i].weights.size(); ++k)
                blended[i].weights[k] = net.layers[i].weights[k] * a + net.denoise[i].weights[k] * b;
            for (std::size_t k = 0; k < blended[i].bias.size(); ++k)
                blended[i].bias[k] = net.layers[i].bias[k] * a + net.denoise[i].bias[k] * b;
        }
        layers = &blended;
    }

    const int w = rgb.width + 2 * kMargin, h = rgb.height + 2 * kMargin;
    const auto pick = [](int v, int n, bool wrap) { return wrap ? ((v % n) + n) % n : std::clamp(v, 0, n - 1); };
    std::vector<float> a(static_cast<std::size_t>(w) * h * 3), b;
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const std::uint8_t* p = rgb.at(pick(x - kMargin, rgb.width, wrap_x), pick(y - kMargin, rgb.height, wrap_y));
            for (int c = 0; c < 3; ++c) a[(static_cast<std::size_t>(y) * w + x) * 3 + c] = static_cast<float>(p[c]) / 255.0f;
        }
    }
    const std::vector<float> input = a;
    for (const Layer& layer : *layers) {
        if (layer.conv) {
            conv(layer, a, b, w, h);
            std::swap(a, b);
        } else {
            prelu(layer, a);
        }
    }
    // 48 channels: pixel shuffle (c * 16 + dy * 4 + dx) to 4x, plus the input's squares.
    Image out(rgb.width * 4, rgb.height * 4);
    for (int y = 0; y < out.height; ++y) {
        for (int x = 0; x < out.width; ++x) {
            const int sx = x / 4 + kMargin, sy = y / 4 + kMargin;
            const std::size_t at = static_cast<std::size_t>(sy) * w + sx;
            std::uint8_t* q = out.at(x, y);
            for (int c = 0; c < 3; ++c) {
                const float v = a[at * 48 + static_cast<std::size_t>(c * 16 + (y % 4) * 4 + (x % 4))] + input[at * 3 + c];
                q[c] = static_cast<std::uint8_t>(std::clamp(v * 255.0f + 0.5f, 0.0f, 255.0f));
            }
            q[3] = 255;
        }
    }
    return out;
}

}  // namespace nanotech
