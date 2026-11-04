// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
#include "engine/image.hpp"

#include <cstring>

// stb (third_party/stb, MIT or public domain): only PNG, from memory, no files.
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#define STBI_NO_THREAD_LOCALS
#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#if defined(__clang__) || defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#pragma GCC diagnostic ignored "-Wsign-compare"
#endif
#include "stb_image.h"
#include "stb_image_write.h"
#if defined(__clang__) || defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

namespace nanotech {

bool decode_png(const std::uint8_t* data, std::size_t size, Image& out) {
    if (data == nullptr || size == 0 || size > 0x7fffffff) {
        return false;
    }
    int w = 0, h = 0, channels = 0;
    if (!stbi_info_from_memory(data, static_cast<int>(size), &w, &h, &channels) || w <= 0 || h <= 0
        || w > kMaxSide || h > kMaxSide) {
        return false;
    }
    unsigned char* pixels = stbi_load_from_memory(data, static_cast<int>(size), &w, &h, &channels, 4);
    if (pixels == nullptr) {
        return false;
    }
    out = Image(w, h);
    std::memcpy(out.rgba.data(), pixels, out.rgba.size());
    stbi_image_free(pixels);
    return true;
}

namespace {
void append(void* context, void* data, int size) {
    auto* out = static_cast<std::vector<std::uint8_t>*>(context);
    const auto* bytes = static_cast<const std::uint8_t*>(data);
    out->insert(out->end(), bytes, bytes + size);
}
}  // namespace

std::vector<std::uint8_t> encode_png(const Image& image) {
    std::vector<std::uint8_t> out;
    if (image.empty()) {
        return out;
    }
    stbi_write_png_compression_level = 8;
    stbi_write_png_to_func(append, &out, image.width, image.height, 4, image.rgba.data(), image.width * 4);
    return out;
}

std::uint64_t texture_hash(const Image& image) {
    std::uint64_t h = 1469598103934665603ull;
    const auto mix = [&](std::uint8_t byte) {
        h ^= byte;
        h *= 1099511628211ull;
    };
    for (const int side : {image.width, image.height}) {
        for (int i = 0; i < 4; ++i) {
            mix(static_cast<std::uint8_t>(static_cast<std::uint32_t>(side) >> (8 * i)));
        }
    }
    for (const std::uint8_t byte : image.rgba) {
        mix(byte);
    }
    return h;
}

}  // namespace nanotech
