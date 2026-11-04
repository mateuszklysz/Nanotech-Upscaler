// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// Real-ESRGAN's compact network (SRVGGNetCompact: 3x3 convolutions with PReLU between them, the
// result shuffled 4x larger and added to the input's squares), run on the CPU in float32 with
// every sum in one fixed order, so it gives the same bytes on every system and in WebAssembly.
// Its weights are not in the engine: the page reads them from the mod's folder (tools/
// convert_weights.py makes them from the published .pth).
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "engine/image.hpp"

namespace nanotech {

struct Layer {
    bool conv = true;  // a 3x3 convolution, or a PReLU
    int out = 0;
    int in = 0;
    std::vector<float> weights;  // a convolution's as [ky][kx][in][out], or the PReLU's slopes
    std::vector<float> bias;
};

struct Network {
    std::vector<Layer> layers;
    std::vector<Layer> denoise;  // the file's second, weakly denoising model, if there
    bool empty() const { return layers.empty(); }
};

// The network from tools/convert_weights.py's file; empty when it is not one.
Network load_network(const std::uint8_t* data, std::size_t size);

// `rgb` (RGBA, alpha ignored) 4x larger through the network. `denoise` is Real-ESRGAN's denoise
// strength in percent: 100 is the model alone, less blends in the second (weakly denoising) model. `wrap_x`/`wrap_y`: the texture tiles.
Image neural_x4(const Network& net, const Image& rgb, int denoise, bool wrap_x, bool wrap_y);

}  // namespace nanotech
