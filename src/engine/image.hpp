// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// A texture as OpenRAC's port holds it: RGBA, 8 bits a channel, rows top to bottom. PNG in and out
// with the same stb_image the port reads its levels' textures with, and the name the port knows a
// texture by in a texture pack (port/renderer/texture_pack.cpp, image_hash).
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace nanotech {

struct Image {
    int width = 0;
    int height = 0;
    std::vector<std::uint8_t> rgba;  // width * height * 4 bytes: R, G, B, A

    Image() = default;
    Image(int w, int h) : width(w), height(h), rgba(static_cast<std::size_t>(w) * h * 4, 0) {}

    bool empty() const { return width <= 0 || height <= 0; }
    std::uint8_t* at(int x, int y) { return &rgba[(static_cast<std::size_t>(y) * width + x) * 4]; }
    const std::uint8_t* at(int x, int y) const { return &rgba[(static_cast<std::size_t>(y) * width + x) * 4]; }
};

// The largest side read or made: the games' textures are at most 1024, six times that is 6144.
constexpr int kMaxSide = 8192;

// A PNG's pixels as RGBA, as the port decodes them (stbi_load with 4 channels); false when it
// cannot be read or is larger than kMaxSide.
bool decode_png(const std::uint8_t* data, std::size_t size, Image& out);

// The PNG of an image, written the same way on every system.
std::vector<std::uint8_t> encode_png(const Image& image);

// The 64-bit name the port knows a texture by: FNV-1a over its width and height (4 bytes each,
// lowest first) and its RGBA bytes.
std::uint64_t texture_hash(const Image& image);

}  // namespace nanotech
