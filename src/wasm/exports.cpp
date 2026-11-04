// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// What the mod's page calls in nanotech.wasm (ui/engine.js). The page copies a texture's PNG into
// memory from nt_alloc, asks for it upscaled, and reads the result back from the getters; one
// result is kept at a time, until the next call.
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <vector>

#include "engine/image.hpp"
#include "engine/upscale.hpp"

#define NT_EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace {
struct Result {
    std::uint64_t hash = 0;  // the source's name in a texture pack
    nanotech::Image image;
    std::vector<std::uint8_t> png;
};
Result result;
nanotech::Network network;  // the Neural engine's, from nt_load_network
}  // namespace

NT_EXPORT(nt_alloc) void* nt_alloc(std::uint32_t size) { return std::malloc(size == 0 ? 1 : size); }
NT_EXPORT(nt_free) void nt_free(void* p) { std::free(p); }

// Reads a PNG and upscales it with `count` option values (upscale.hpp, options_from). With `png`
// set the result is also written as a PNG. 0 when it worked; 1 for a PNG that cannot be read, 2
// for a result larger than the engine makes.
NT_EXPORT(nt_upscale) int nt_upscale(const std::uint8_t* data, std::uint32_t size, const std::int32_t* values,
                                     int count, int png) {
    result = Result{};
    nanotech::Image source;
    if (!nanotech::decode_png(data, size, source)) return 1;
    result.hash = nanotech::texture_hash(source);
    result.image = nanotech::upscale(source, nanotech::options_from(values, count), &network);
    if (result.image.empty()) return 2;
    if (png != 0) result.png = nanotech::encode_png(result.image);
    return 0;
}

// The same from RGBA texels in memory (`width` * `height` * 4 bytes): the page's own pictures
// that explain the options. 2 for a texture too large.
NT_EXPORT(nt_upscale_rgba) int nt_upscale_rgba(const std::uint8_t* rgba, int width, int height,
                                               const std::int32_t* values, int count, int png) {
    result = Result{};
    if (width <= 0 || height <= 0 || width > nanotech::kMaxSide || height > nanotech::kMaxSide) return 2;
    nanotech::Image source(width, height);
    std::copy_n(rgba, source.rgba.size(), source.rgba.data());
    result.hash = nanotech::texture_hash(source);
    result.image = nanotech::upscale(source, nanotech::options_from(values, count), &network);
    if (result.image.empty()) return 2;
    if (png != 0) result.png = nanotech::encode_png(result.image);
    return 0;
}

// The Neural engine's network (tools/convert_weights.py's file); 0 when it was read, 1 when not (the
// engine then has none).
NT_EXPORT(nt_load_network) int nt_load_network(const std::uint8_t* data, std::uint32_t size) {
    network = nanotech::load_network(data, size);
    return network.empty() ? 1 : 0;
}

namespace {
// A PNG's texture, or RGBA texels, into `source`; false when the PNG cannot be read.
bool source_of(const std::uint8_t* data, std::uint32_t size, int width, int height, nanotech::Image& source) {
    if (width == 0) return nanotech::decode_png(data, size, source);
    if (width < 0 || height <= 0 || width > nanotech::kMaxSide || height > nanotech::kMaxSide) return false;
    source = nanotech::Image(width, height);
    std::copy_n(data, source.rgba.size(), source.rgba.data());
    return true;
}
}  // namespace

// For the page's GPU: what the network is given for a texture (a PNG, or RGBA texels when `width`
// is not 0), as the result's texels. 0 when it worked, 1 when it cannot be read.
NT_EXPORT(nt_neural_input) int nt_neural_input(const std::uint8_t* data, std::uint32_t size, int width, int height,
                                               const std::int32_t* values, int count) {
    result = Result{};
    nanotech::Image source;
    if (!source_of(data, size, width, height, source)) return 1;
    result.hash = nanotech::texture_hash(source);
    result.image = nanotech::neural_input(source, nanotech::options_from(values, count));
    return 0;
}

// nt_upscale with the network's 4x colour from the page's GPU (`colour`: RGBA, 4x the texture's
// size); `width` 0 reads `data` as a PNG, else as RGBA texels.
NT_EXPORT(nt_upscale_colour) int nt_upscale_colour(const std::uint8_t* data, std::uint32_t size, int width, int height,
                                                   const std::int32_t* values, int count, int png,
                                                   const std::uint8_t* colour) {
    result = Result{};
    nanotech::Image source;
    if (!source_of(data, size, width, height, source)) return 1;
    result.hash = nanotech::texture_hash(source);
    nanotech::Image given(source.width * 4, source.height * 4);
    std::copy_n(colour, given.rgba.size(), given.rgba.data());
    result.image = nanotech::upscale(source, nanotech::options_from(values, count), nullptr, &given);
    if (result.image.empty()) return 2;
    if (png != 0) result.png = nanotech::encode_png(result.image);
    return 0;
}

// Only the name a PNG's texture has in a pack: 0 when it worked, 1 when it cannot be read.
NT_EXPORT(nt_hash) int nt_hash(const std::uint8_t* data, std::uint32_t size) {
    result = Result{};
    nanotech::Image source;
    if (!nanotech::decode_png(data, size, source)) return 1;
    result.hash = nanotech::texture_hash(source);
    return 0;
}

NT_EXPORT(nt_hash_lo) std::uint32_t nt_hash_lo() { return static_cast<std::uint32_t>(result.hash); }
NT_EXPORT(nt_hash_hi) std::uint32_t nt_hash_hi() { return static_cast<std::uint32_t>(result.hash >> 32); }
NT_EXPORT(nt_width) int nt_width() { return result.image.width; }
NT_EXPORT(nt_height) int nt_height() { return result.image.height; }
NT_EXPORT(nt_rgba) const std::uint8_t* nt_rgba() { return result.image.rgba.data(); }
NT_EXPORT(nt_png) const std::uint8_t* nt_png() { return result.png.data(); }
NT_EXPORT(nt_png_size) std::uint32_t nt_png_size() { return static_cast<std::uint32_t>(result.png.size()); }
