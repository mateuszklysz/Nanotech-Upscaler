// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// What the port needs from an upscaled texture, checked on the samples.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <set>
#include <vector>

#include "engine/image.hpp"
#include "engine/upscale.hpp"
#include "samples.hpp"

namespace {
int failures = 0;

void check(bool ok, const char* what) {
    if (!ok) {
        std::fprintf(stderr, "FAIL: %s\n", what);
        ++failures;
    }
}

nanotech::Image scaled(const nanotech::Image& image, std::vector<std::int32_t> values) {
    return nanotech::upscale(image, nanotech::options_from(values.data(), static_cast<int>(values.size())));
}

std::set<int> alphas(const nanotech::Image& image) {
    std::set<int> out;
    for (std::size_t i = 3; i < image.rgba.size(); i += 4) out.insert(image.rgba[i]);
    return out;
}

// The port's name for a texture (port/renderer/texture_pack.cpp, image_hash), worked out by hand
// for a 2x1 texture: FNV-1a over 02 00 00 00, 01 00 00 00 and the texels.
void hash_is_the_ports() {
    nanotech::Image image(2, 1);
    nanotech::samples::put(image, 0, 0, 255, 0, 0, 255);
    nanotech::samples::put(image, 1, 0, 0, 255, 0, 128);
    check(nanotech::texture_hash(image) == 0xc98c745e381d1807ull, "the hash is the port's");
}

// A PNG written and read again is the same texture.
void png_round_trip() {
    const nanotech::Image leaf = nanotech::samples::leaf();
    const std::vector<std::uint8_t> png = nanotech::encode_png(leaf);
    nanotech::Image back;
    check(nanotech::decode_png(png.data(), png.size(), back), "the PNG reads back");
    check(back.width == leaf.width && back.height == leaf.height && back.rgba == leaf.rgba, "the PNG is the same");
    check(!nanotech::decode_png(png.data(), 10, back), "a broken PNG is refused");
}

// Every GS alpha from 0 to 128 comes back as it was (Nearest: no scaler in the way).
void gs_alpha_round_trip() {
    nanotech::Image image(129, 1);
    for (int a = 0; a <= 128; ++a) nanotech::samples::put(image, a, 0, 100, 100, 100, a);
    const nanotech::Image out = scaled(image, {2, 3, 1, 0, 0, 0});
    bool same = true;
    for (int a = 0; a <= 128; ++a) same = same && out.at(a * 2, 0)[3] == a && out.at(a * 2 + 1, 1)[3] == a;
    check(same, "GS alpha 0..128 comes back as it was");
    // Past 128 (more than opaque) the alpha is not clamped.
    nanotech::Image bright(2, 2);
    for (int i = 0; i < 4; ++i) nanotech::samples::put(bright, i % 2, i / 2, 50, 50, 50, 200);
    check(alphas(scaled(bright, {2, 0, 1, 0})) == std::set<int>{200}, "GS alpha past 128 is kept");
}

// A cut-out keeps exactly its alpha values, with every engine.
void cut_outs_keep_alpha() {
    for (int engine = 0; engine < 4; ++engine) {
        check(alphas(scaled(nanotech::samples::leaf(), {4, engine})) == std::set<int>{0, 255},
              "a cut-out keeps 0 and 255");
        check(alphas(scaled(nanotech::samples::lines(), {4, engine, 1, 0})) == std::set<int>{0, 128},
              "a GS cut-out keeps 0 and 128");
    }
    // Without exact alpha the smooth engines make new values.
    check(alphas(scaled(nanotech::samples::leaf(), {4, 2, 0, 1, 0, 0})).size() > 2, "soft alpha can be chosen");
}

// An opaque texture stays opaque (the port draws a level's texture with any alpha under 250 as
// translucent, scene/level.cpp), even with sharpening and the smooth curve.
void opaque_stays_opaque() {
    for (int engine = 0; engine < 4; ++engine) {
        check(alphas(scaled(nanotech::samples::panel(), {4, engine, 0, 1, 2, 1, 30, 100, 40, 100, 50}))
                  == std::set<int>{255},
              "an opaque texture stays opaque");
    }
    // Nearly opaque with more than 4 values (no exact alpha): the curve's overshoot stays inside.
    nanotech::Image almost = nanotech::samples::panel();
    for (std::size_t i = 3; i < almost.rgba.size(); i += 4) almost.rgba[i] = static_cast<std::uint8_t>(250 + i / 4 % 6);
    const std::set<int> kept = alphas(scaled(almost, {4, 2}));
    check(*kept.begin() >= 250 && *kept.rbegin() <= 255, "alpha stays inside the source's");
}

// A transparent texel keeps the colour of the texel it came from, which the game's filtering
// blends in at the cut-out's edge.
void transparent_keeps_colour() {
    const nanotech::Image leaf = nanotech::samples::leaf();
    const nanotech::Image out = scaled(leaf, {4, 1});
    bool kept = true;
    for (int y = 0; y < out.height; ++y) {
        for (int x = 0; x < out.width; ++x) {
            const std::uint8_t* p = out.at(x, y);
            const std::uint8_t* s = leaf.at(x / 4, y / 4);
            if (p[3] == 0) kept = kept && p[0] == s[0] && p[1] == s[1] && p[2] == s[2];
        }
    }
    check(kept, "transparent texels keep their colour");
}

// A tiling texture's edges meet: the left column of the result follows on from the right one as
// its middle columns do. With Clamp they need not.
void tiling_edges_meet() {
    const nanotech::Image out = scaled(nanotech::samples::bricks(), {4, 2, 0, 1});
    long seam = 0, inside = 0;
    for (int y = 0; y < out.height; ++y) {
        for (int ch = 0; ch < 3; ++ch) {
            seam += std::abs(out.at(0, y)[ch] - out.at(out.width - 1, y)[ch]);
            inside += std::abs(out.at(out.width / 2 + 1, y)[ch] - out.at(out.width / 2, y)[ch]);
        }
    }
    check(seam <= inside * 3, "a tiling texture's edges meet");
}

void sizes_and_limits() {
    const nanotech::Image panel = nanotech::samples::panel();
    for (int s = 2; s <= 6; ++s) {
        const nanotech::Image out = scaled(panel, {s});
        check(out.width == 32 * s && out.height == 32 * s, "the result is scale times larger");
    }
    check(scaled(panel, {9}).width == 32 * 6, "the scale is clamped to 6");
    check(nanotech::upscale(nanotech::Image(3000, 1), nanotech::Options{}).empty(), "too large a result is refused");
    check(nanotech::upscale(nanotech::Image(), nanotech::Options{}).empty(), "an empty texture gives nothing");
}

void neural_engine() {
    const nanotech::Network net = nanotech::samples::tiny_network();
    check(!net.empty(), "the network's file is read");
    check(nanotech::load_network(nullptr, 0).empty(), "no file is no network");
    for (const auto& sample : nanotech::samples::all()) {
        const auto& image = sample.image;
        std::vector<std::int32_t> values = {4, 4, 0, 1};
        const auto opts = nanotech::options_from(values.data(), 4);
        const nanotech::Image x4 = nanotech::upscale(image, opts, &net);
        check(x4.width == image.width * 4 && x4.height == image.height * 4, "Neural makes 4x");
        check(x4.rgba == nanotech::upscale(image, opts, &net).rgba, "Neural gives the same bytes twice");
        check(alphas(x4) == alphas(scaled(image, {4, 0, 0, 1})), "Neural keeps xBRZ's alpha");
        values[0] = 3;
        const nanotech::Image x2 = nanotech::upscale(image, nanotech::options_from(values.data(), 4), &net);
        check(x2.width == image.width * 2, "Neural under 4x makes 2x");
        check(nanotech::upscale(image, opts).rgba == scaled(image, {4, 0, 0, 1}).rgba,
              "Neural without a network is xBRZ");
    }
}

void same_twice() {
    for (const auto& sample : nanotech::samples::all()) {
        check(scaled(sample.image, {4, 1, 0, 1, 2}).rgba == scaled(sample.image, {4, 1, 0, 1, 2}).rgba,
              "the same texture and options give the same bytes");
    }
}
}  // namespace

int main() {
    hash_is_the_ports();
    png_round_trip();
    gs_alpha_round_trip();
    cut_outs_keep_alpha();
    opaque_stays_opaque();
    transparent_keeps_colour();
    tiling_edges_meet();
    sizes_and_limits();
    same_twice();
    neural_engine();
    if (failures == 0) std::printf("all engine checks passed\n");
    return failures == 0 ? 0 : 1;
}
