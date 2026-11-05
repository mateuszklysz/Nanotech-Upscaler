// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// Small textures in the PS2 games' style, drawn here (never taken from a disc): a palette's steps,
// a cut-out, a soft glow in the GS alpha scale, hard lines, a tiling brick wall.
#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "engine/image.hpp"
#include "engine/neural.hpp"

namespace nanotech::samples {

struct Sample {
    std::string name;
    Image image;
};

inline void put(Image& image, int x, int y, int r, int g, int b, int a) {
    std::uint8_t* p = image.at(x, y);
    p[0] = static_cast<std::uint8_t>(r);
    p[1] = static_cast<std::uint8_t>(g);
    p[2] = static_cast<std::uint8_t>(b);
    p[3] = static_cast<std::uint8_t>(a);
}

// A steel panel: a 16-step gradient with rivets, like a 4-bit palette.
inline Image panel() {
    Image image(32, 32);
    for (int y = 0; y < 32; ++y) {
        for (int x = 0; x < 32; ++x) {
            const int step = (x + y) / 4 * 8;
            const bool rivet = (x % 16 - 4) * (x % 16 - 4) + (y % 16 - 4) * (y % 16 - 4) <= 2;
            put(image, x, y, rivet ? 220 : 60 + step / 2, rivet ? 220 : 70 + step / 2, rivet ? 230 : 90 + step / 2, 255);
        }
    }
    return image;
}

// A leaf cut-out: alpha 0 or 255 only, with a dark outline.
inline Image leaf() {
    Image image(24, 24);
    for (int y = 0; y < 24; ++y) {
        for (int x = 0; x < 24; ++x) {
            const int dx = x - 12, dy = y - 12;
            const int d = dx * dx * 2 + dy * dy;
            if (d < 100) {
                put(image, x, y, 40 + y * 4, 140 + x * 3, 30, 255);
            } else if (d < 130) {
                put(image, x, y, 20, 50, 10, 255);
            } else {
                put(image, x, y, 255, 0, 255, 0);
            }
        }
    }
    return image;
}

// A glow in the GS alpha scale (0..128): bright in the middle, fading out.
inline Image glow() {
    Image image(16, 16);
    for (int y = 0; y < 16; ++y) {
        for (int x = 0; x < 16; ++x) {
            const int dx = 2 * x - 15, dy = 2 * y - 15;
            const int a = 128 - (dx * dx + dy * dy) * 128 / 450;
            put(image, x, y, 255, 200, 80, a < 0 ? 0 : a);
        }
    }
    return image;
}

// Letters' hard lines: one pixel strokes, diagonal and straight, on a transparent ground.
inline Image lines() {
    Image image(16, 16);
    for (int y = 0; y < 16; ++y) {
        for (int x = 0; x < 16; ++x) {
            const bool on = x == y || x == 15 - y || x == 3 || y == 12;
            put(image, x, y, on ? 250 : 0, on ? 250 : 0, on ? 250 : 0, on ? 128 : 0);
        }
    }
    return image;
}

// A brick wall that tiles: its rows of mortar meet across the edges.
inline Image bricks() {
    Image image(32, 16);
    for (int y = 0; y < 16; ++y) {
        for (int x = 0; x < 32; ++x) {
            const int row = y / 8, bx = (x + row * 8) % 16;
            const bool mortar = y % 8 == 0 || bx == 0;
            const int tone = ((x + row * 8) / 16 * 37 + row * 53) % 40;
            put(image, x, y, mortar ? 150 : 150 + tone, mortar ? 145 : 70 + tone / 2, mortar ? 135 : 50, 255);
        }
    }
    return image;
}

// A small network in tools/convert_weights.py's format, its weights from a fixed sequence: conv
// 3->8 PReLU, conv 8->8 GELU, a 5x5 on the first 4 channels (the rest passed), a gate, a 1x1 plus
// the skip, conv 8->48, the shuffle; then a second model of the same shape (the weakly denoising one).
// A small network's file with every kind of op (PReLU, GELU, a 5x5 pass, a gate, a skip), two
// models of the same shape.
inline std::vector<std::uint8_t> tiny_network_file() {
    std::vector<std::uint8_t> bytes;
    const auto u32 = [&](std::uint32_t v) {
        for (int i = 0; i < 4; ++i) bytes.push_back(static_cast<std::uint8_t>(v >> (8 * i)));
    };
    std::uint32_t seed = 1;
    const auto floats = [&](int n) {
        for (int i = 0; i < n; ++i) {
            seed = seed * 1103515245u + 12345u;
            const float f = static_cast<float>((seed >> 16) % 2001) / 10000.0f - 0.1f;
            std::uint32_t bits;
            std::memcpy(&bits, &f, 4);
            u32(bits);
        }
    };
    const auto conv = [&](int k, int in, int out, int src, int dst, int act, int aux, int pass) {
        for (const int v : {0, k, in, out, src, dst, act, aux, pass}) u32(static_cast<std::uint32_t>(v));
        floats(out * in * k * k + out + (act == 1 ? out : 0));
    };
    bytes.insert(bytes.end(), {'N', 'T', 'N', '2'});
    u32(2);
    u32(2);
    for (int model = 0; model < 2; ++model) {
        u32(7);
        conv(3, 3, 8, 0, 1, 1, 0, 0);
        conv(3, 8, 8, 1, 2, 2, 0, 0);
        conv(5, 4, 4, 2, 3, 0, 0, 1);
        conv(3, 8, 8, 3, 4, 3, 3, 0);
        conv(1, 8, 8, 4, 5, 4, 1, 0);
        conv(3, 8, 48, 5, 6, 0, 0, 0);
        for (const int v : {1, 6, 0}) u32(static_cast<std::uint32_t>(v));
    }
    return bytes;
}

inline Network tiny_network() {
    const std::vector<std::uint8_t> bytes = tiny_network_file();
    return load_network(bytes.data(), bytes.size());
}

inline std::vector<Sample> all() {
    return {{"panel", panel()}, {"leaf", leaf()}, {"glow", glow()}, {"lines", lines()}, {"bricks", bricks()}};
}

}  // namespace nanotech::samples
