// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
#include "engine/upscale.hpp"

#include <algorithm>
#include <array>
#include <cstdlib>

#include "xbrz.h"

namespace nanotech {
namespace {

// Texels added on each side before scaling, so the scalers see the neighbours a texel has in the
// game (the other side for a tiling texture, the edge itself for one that stops): xBRZ looks two
// texels away, the bicubic curve two.
constexpr int kPad = 4;

int clamp(int v, int lo, int hi) { return std::min(std::max(v, lo), hi); }

// A coordinate inside a side of `n` texels, by the texture's edges on that axis.
bool repeats(Edges edges, bool vertical) {
    return edges == Edges::Repeat || edges == (vertical ? Edges::RepeatY : Edges::RepeatX);
}

int edge(int v, int n, Edges edges, bool vertical) {
    if (repeats(edges, vertical)) {
        return ((v % n) + n) % n;
    }
    return clamp(v, 0, n - 1);
}

int edge_x(int v, int n, Edges edges) { return edge(v, n, edges, false); }
int edge_y(int v, int n, Edges edges) { return edge(v, n, edges, true); }

// The 2D layer's alpha (0..128 is 0..1, the console's) to 0..255 and back; every value from 0 to
// 128 comes back as it was (tests/alpha_test.cpp).
std::uint8_t alpha_to_full(std::uint8_t a, AlphaScale scale) {
    if (scale == AlphaScale::Full) return a;
    return static_cast<std::uint8_t>(std::min(255, (a * 255 + 64) / 128));
}

std::uint8_t alpha_from_full(std::uint8_t a, AlphaScale scale) {
    if (scale == AlphaScale::Full) return a;
    return static_cast<std::uint8_t>((a * 128 + 127) / 255);
}

// Smooths a palette's small steps: a channel between two neighbours that are both near it moves
// towards them, along rows and then columns, `strength` times. Transparent texels are left alone.
void deposterize(Image& image, int strength, Edges edges) {
    const int threshold = 4 + 4 * strength;
    for (int pass = 0; pass < strength; ++pass) {
        for (int axis = 0; axis < 2; ++axis) {
            const Image before = image;
            for (int y = 0; y < image.height; ++y) {
                for (int x = 0; x < image.width; ++x) {
                    const int dx = axis == 0 ? 1 : 0, dy = axis == 0 ? 0 : 1;
                    const std::uint8_t* l =
                        before.at(edge_x(x - dx, image.width, edges), edge_y(y - dy, image.height, edges));
                    const std::uint8_t* c = before.at(x, y);
                    const std::uint8_t* r =
                        before.at(edge_x(x + dx, image.width, edges), edge_y(y + dy, image.height, edges));
                    if (l[3] == 0 || c[3] == 0 || r[3] == 0) continue;
                    std::uint8_t* out = image.at(x, y);
                    for (int ch = 0; ch < 3; ++ch) {
                        if (std::abs(c[ch] - l[ch]) <= threshold && std::abs(c[ch] - r[ch]) <= threshold) {
                            out[ch] = static_cast<std::uint8_t>((l[ch] + 2 * c[ch] + r[ch] + 2) / 4);
                        }
                    }
                }
            }
        }
    }
}

std::uint32_t argb(const std::uint8_t* p) {
    return (std::uint32_t{p[3]} << 24) | (std::uint32_t{p[0]} << 16) | (std::uint32_t{p[1]} << 8) | p[2];
}

void put_argb(std::uint8_t* p, std::uint32_t c) {
    p[0] = static_cast<std::uint8_t>(c >> 16);
    p[1] = static_cast<std::uint8_t>(c >> 8);
    p[2] = static_cast<std::uint8_t>(c);
    p[3] = static_cast<std::uint8_t>(c >> 24);
}

// xBRZ over the padded source; the result cropped back to the source's area.
Image scale_xbrz(const Image& padded, int scale, const Options& o, int width, int height) {
    std::vector<std::uint32_t> src(static_cast<std::size_t>(padded.width) * padded.height);
    for (int y = 0; y < padded.height; ++y) {
        for (int x = 0; x < padded.width; ++x) {
            src[static_cast<std::size_t>(y) * padded.width + x] = argb(padded.at(x, y));
        }
    }
    const int tw = padded.width * scale, th = padded.height * scale;
    std::vector<std::uint32_t> trg(static_cast<std::size_t>(tw) * th);
    xbrz::ScalerCfg cfg;
    cfg.luminanceWeight = o.luminance / 100.0;
    cfg.equalColorTolerance = o.tolerance;
    cfg.centerDirectionBias = o.direction_bias / 10.0;
    xbrz::scale(static_cast<std::size_t>(scale), src.data(), trg.data(), padded.width, padded.height,
                xbrz::ColorFormat::ARGB_UNBUFFERED, cfg);
    Image out(width * scale, height * scale);
    for (int y = 0; y < out.height; ++y) {
        for (int x = 0; x < out.width; ++x) {
            put_argb(out.at(x, y), trg[static_cast<std::size_t>(y + kPad * scale) * tw + x + kPad * scale]);
        }
    }
    return out;
}

// Catmull-Rom's weights for the four texels around a point `t` (0..1) past the second.
std::array<double, 4> catmull_rom(double t) {
    const double t2 = t * t, t3 = t2 * t;
    return {(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2};
}

// A bicubic curve through the padded source, over premultiplied colour (transparent texels lend no
// colour); the result in the source's area.
Image scale_smooth(const Image& padded, int scale, int width, int height) {
    Image out(width * scale, height * scale);
    for (int y = 0; y < out.height; ++y) {
        const double sy = (y + 0.5) / scale - 0.5 + kPad;
        const int y0 = static_cast<int>(sy >= 0 ? sy : sy - 1);
        const auto wy = catmull_rom(sy - y0);
        for (int x = 0; x < out.width; ++x) {
            const double sx = (x + 0.5) / scale - 0.5 + kPad;
            const int x0 = static_cast<int>(sx >= 0 ? sx : sx - 1);
            const auto wx = catmull_rom(sx - x0);
            double sum[4] = {0, 0, 0, 0};
            for (int j = 0; j < 4; ++j) {
                const int py = clamp(y0 - 1 + j, 0, padded.height - 1);
                for (int i = 0; i < 4; ++i) {
                    const int px = clamp(x0 - 1 + i, 0, padded.width - 1);
                    const std::uint8_t* p = padded.at(px, py);
                    const double w = wx[static_cast<std::size_t>(i)] * wy[static_cast<std::size_t>(j)];
                    const double a = p[3] / 255.0;
                    sum[0] += w * p[0] * a;
                    sum[1] += w * p[1] * a;
                    sum[2] += w * p[2] * a;
                    sum[3] += w * p[3];
                }
            }
            std::uint8_t* q = out.at(x, y);
            const double a = std::min(255.0, std::max(0.0, sum[3]));
            q[3] = static_cast<std::uint8_t>(a + 0.5);
            for (int ch = 0; ch < 3; ++ch) {
                const double c = a > 0 ? sum[ch] * 255.0 / a : 0;
                q[ch] = static_cast<std::uint8_t>(std::min(255.0, std::max(0.0, c)) + 0.5);
            }
        }
    }
    return out;
}

Image scale_nearest(const Image& source, int scale) {
    Image out(source.width * scale, source.height * scale);
    for (int y = 0; y < out.height; ++y) {
        for (int x = 0; x < out.width; ++x) {
            std::copy_n(source.at(x / scale, y / scale), 4, out.at(x, y));
        }
    }
    return out;
}

// xBRZ where it differs from the smooth curve (an edge), the curve where they agree (a gradient).
Image mix_hybrid(const Image& sharp, const Image& smooth) {
    Image out(sharp.width, sharp.height);
    for (std::size_t i = 0; i < out.rgba.size(); i += 4) {
        int d = 0;
        for (int ch = 0; ch < 4; ++ch) d = std::max(d, std::abs(sharp.rgba[i + ch] - smooth.rgba[i + ch]));
        const int w = clamp((d - 12) * 256 / 36, 0, 256);
        for (int ch = 0; ch < 4; ++ch) {
            out.rgba[i + ch] =
                static_cast<std::uint8_t>((smooth.rgba[i + ch] * (256 - w) + sharp.rgba[i + ch] * w + 128) >> 8);
        }
    }
    return out;
}

// An unsharp mask over the colour: each channel pushed away from its 3x3 blur by `amount` percent.
void sharpen(Image& image, int amount, Edges edges) {
    static constexpr int kKernel[3][3] = {{1, 2, 1}, {2, 4, 2}, {1, 2, 1}};
    const Image before = image;
    for (int y = 0; y < image.height; ++y) {
        for (int x = 0; x < image.width; ++x) {
            for (int ch = 0; ch < 3; ++ch) {
                int blur = 0;
                for (int j = -1; j <= 1; ++j) {
                    for (int i = -1; i <= 1; ++i) {
                        blur += kKernel[j + 1][i + 1]
                                * before.at(edge_x(x + i, image.width, edges), edge_y(y + j, image.height, edges))[ch];
                    }
                }
                const int c = before.at(x, y)[ch];
                image.at(x, y)[ch] = static_cast<std::uint8_t>(clamp(c + (c * 16 - blur) * amount / 1600, 0, 255));
            }
        }
    }
}

// The network's colour (4x, averaged down to 2x when asked) with xBRZ's alpha at the same scale:
// the network sees no alpha, and xBRZ keeps a cut-out's edges where the game has them.
Image scale_neural(const Network& network, const Image& work, const Image& padded, int scale, const Options& options) {
    const bool wrap_x = repeats(options.edges, false), wrap_y = repeats(options.edges, true);
    Image colour = neural_x4(network, work, options.denoise, wrap_x, wrap_y);
    if (scale == 2) {
        Image half(work.width * 2, work.height * 2);
        for (int y = 0; y < half.height; ++y) {
            for (int x = 0; x < half.width; ++x) {
                for (int c = 0; c < 3; ++c) {
                    const int sum = colour.at(2 * x, 2 * y)[c] + colour.at(2 * x + 1, 2 * y)[c] +
                                    colour.at(2 * x, 2 * y + 1)[c] + colour.at(2 * x + 1, 2 * y + 1)[c];
                    half.at(x, y)[c] = static_cast<std::uint8_t>((sum + 2) / 4);
                }
            }
        }
        colour = std::move(half);
    }
    const Image alpha = scale_xbrz(padded, scale, options, work.width, work.height);
    for (std::size_t i = 3; i < colour.rgba.size(); i += 4) colour.rgba[i] = alpha.rgba[i];
    return colour;
}

}  // namespace

Options options_from(const std::int32_t* values, int count) {
    Options o;
    const auto value = [&](int i, int fallback, int lo, int hi) {
        return i < count && values != nullptr ? clamp(values[i], lo, hi) : fallback;
    };
    o.scale = value(0, o.scale, 2, xbrz::SCALE_FACTOR_MAX);
    o.engine = static_cast<Engine>(value(1, static_cast<int>(o.engine), 0, 4));
    o.alpha_scale = static_cast<AlphaScale>(value(2, static_cast<int>(o.alpha_scale), 0, 1));
    o.edges = static_cast<Edges>(value(3, static_cast<int>(o.edges), 0, 3));
    o.deposterize = value(4, o.deposterize, 0, 3);
    o.exact_alpha = value(5, o.exact_alpha ? 1 : 0, 0, 1) != 0;
    o.tolerance = value(6, o.tolerance, 5, 60);
    o.luminance = value(7, o.luminance, 10, 300);
    o.direction_bias = value(8, o.direction_bias, 10, 80);
    o.sharpen = value(9, o.sharpen, 0, 100);
    o.original = value(10, o.original, 0, 100);
    o.denoise = value(11, o.denoise, 0, 100);
    return o;
}

Image upscale(const Image& source, const Options& options, const Network* network) {
    Engine engine = options.engine;
    if (engine == Engine::Neural && (network == nullptr || network->empty())) engine = Engine::Xbrz;
    int scale = clamp(options.scale, 2, xbrz::SCALE_FACTOR_MAX);
    if (engine == Engine::Neural) scale = scale < 4 ? 2 : 4;
    if (source.empty() || source.width * scale > kMaxSide || source.height * scale > kMaxSide) {
        return {};
    }
    // The alpha in 0..255, and the values the texture has. A GS texture with alpha past 128 (more
    // than opaque, which the console allows) is scaled as it is, so no value is lost.
    Image work = source;
    AlphaScale alpha_scale = options.alpha_scale;
    for (std::size_t i = 3; i < work.rgba.size(); i += 4) {
        if (work.rgba[i] > 128) alpha_scale = AlphaScale::Full;
    }
    std::array<bool, 256> has_alpha{};
    for (std::size_t i = 3; i < work.rgba.size(); i += 4) {
        work.rgba[i] = alpha_to_full(work.rgba[i], alpha_scale);
        has_alpha[work.rgba[i]] = true;
    }
    std::vector<int> alphas;
    for (int a = 0; a < 256; ++a) {
        if (has_alpha[static_cast<std::size_t>(a)]) alphas.push_back(a);
    }
    if (options.deposterize > 0) {
        deposterize(work, options.deposterize, options.edges);
    }

    // The source with its neighbours around it.
    Image padded(work.width + 2 * kPad, work.height + 2 * kPad);
    for (int y = 0; y < padded.height; ++y) {
        for (int x = 0; x < padded.width; ++x) {
            const int sx = edge_x(x - kPad, work.width, options.edges);
            const int sy = edge_y(y - kPad, work.height, options.edges);
            std::copy_n(work.at(sx, sy), 4, padded.at(x, y));
        }
    }

    Image out;
    switch (engine) {
    case Engine::Xbrz:
        out = scale_xbrz(padded, scale, options, work.width, work.height);
        break;
    case Engine::Hybrid:
        out = mix_hybrid(scale_xbrz(padded, scale, options, work.width, work.height),
                         scale_smooth(padded, scale, work.width, work.height));
        break;
    case Engine::Smooth:
        out = scale_smooth(padded, scale, work.width, work.height);
        break;
    case Engine::Nearest:
        out = scale_nearest(work, scale);
        break;
    case Engine::Neural:
        out = scale_neural(*network, work, padded, scale, options);
        break;
    }

    if (options.sharpen > 0) {
        sharpen(out, options.sharpen, options.edges);
    }
    if (options.original > 0) {
        const Image squares = scale_nearest(work, scale);
        for (std::size_t i = 0; i < out.rgba.size(); ++i) {
            out.rgba[i] = static_cast<std::uint8_t>(
                (out.rgba[i] * (100 - options.original) + squares.rgba[i] * options.original + 50) / 100);
        }
    }

    // No alpha past the source's own (the bicubic curve overshoots): a texture with none under
    // 250 stays opaque to the port.
    const int lowest = alphas.front(), highest = alphas.back();
    // A cut-out keeps its alpha values only: the port decides from them how the texture is drawn
    // (a level's texture with no alpha under 250 is opaque, scene/level.cpp).
    const bool exact = options.exact_alpha && alphas.size() <= 4;
    for (int y = 0; y < out.height; ++y) {
        for (int x = 0; x < out.width; ++x) {
            std::uint8_t* p = out.at(x, y);
            if (exact) {
                int best = alphas.front();
                for (const int a : alphas) {
                    if (std::abs(a - p[3]) <= std::abs(best - p[3])) best = a;
                }
                p[3] = static_cast<std::uint8_t>(best);
            } else {
                p[3] = static_cast<std::uint8_t>(clamp(p[3], lowest, highest));
            }
            // A transparent texel keeps the colour the game's filtering blends in at its edge.
            if (p[3] == 0) {
                std::copy_n(work.at(x / scale, y / scale), 3, p);
            }
            p[3] = alpha_from_full(p[3], alpha_scale);
        }
    }
    return out;
}

}  // namespace nanotech
