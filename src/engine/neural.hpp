// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// A super-resolution network as a list of convolutions (each with what follows it: PReLU, GELU, a
// sigmoid gate or a skip connection), the last one's 48 channels shuffled 4x larger and added to
// the input's squares. That covers Real-ESRGAN's compact network (SRVGGNetCompact) and PLKSR-Rep.
// It runs on the CPU in float32 with every sum in one fixed order and exp/erf of its own, so it
// gives the same bytes on every system and in WebAssembly. The weights are not in the engine: the
// page reads them from the mod's folder (tools/convert_weights.py makes them from a .pth).
//
// File: "NTN2", u32 version 2, u32 models (1, or 2 with a weakly denoising model of the same
// shape); per model u32 ops; per op u32 kind (0 conv, 1 shuffle), then
//   conv:    u32 k, in, out, src, dst, act, aux, pass; floats weights [out][in][k][k], bias [out],
//            PReLU slopes [out] when act is 1
//   shuffle: u32 src, input
// Buffers are numbered 0..15; 0 is the input (RGB in 0..1).
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "engine/image.hpp"

namespace nanotech {

enum class Act : std::uint32_t {
    None = 0,
    Prelu = 1,
    Gelu = 2,
    Gate = 3,  // aux * sigmoid(conv): an attention gate
    Add = 4,   // conv + aux: a skip connection
};

struct Op {
    bool shuffle = false;
    int k = 3, in = 0, out = 0;  // a convolution k x k over the source's first `in` channels
    int src = 0, dst = 0, aux = 0;
    Act act = Act::None;
    bool pass = false;               // the source's channels past `in` are copied after the result
    std::vector<float> weights;      // [ky][kx][in][out]: the inner loop runs over the outputs
    std::vector<float> bias, slopes;
};

struct Network {
    std::vector<Op> ops;
    std::vector<Op> denoise;  // the file's second, weakly denoising model, if there
    bool empty() const { return ops.empty(); }
};

// The network from tools/convert_weights.py's file; empty when it is not one.
Network load_network(const std::uint8_t* data, std::size_t size);

// `rgb` (RGBA, alpha ignored) 4x larger through the network. `denoise` is Real-ESRGAN's denoise
// strength in percent: 100 is the model alone, less blends in the second (weakly denoising) model.
// `wrap_x`/`wrap_y`: the texture tiles.
Image neural_x4(const Network& net, const Image& rgb, int denoise, bool wrap_x, bool wrap_y);

// exp and erf in plain double arithmetic (no libm: each system's rounds its own way).
double exact_exp(double x);
double exact_erf(double x);

}  // namespace nanotech
