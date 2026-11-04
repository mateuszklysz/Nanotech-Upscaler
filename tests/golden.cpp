// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// Prints the name of every sample upscaled with every engine and a few settings. CMake compares
// the lines with tests/golden.txt, natively and in WebAssembly, so a change that makes other bytes
// on any system shows up.
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "engine/image.hpp"
#include "engine/upscale.hpp"
#include "samples.hpp"

int main() {
    struct Setting {
        const char* name;
        std::vector<std::int32_t> values;  // in options_from's order
    };
    const std::vector<Setting> settings = {
        {"default", {}},
        {"x2-clamp", {2, 0, 0, 0}},
        {"x6", {6}},
        {"hybrid", {4, 1}},
        {"smooth", {4, 2}},
        {"nearest", {3, 3}},
        {"tuned", {4, 0, 0, 1, 2, 1, 15, 200, 20, 40, 25}},
        {"soft-alpha", {4, 1, 0, 1, 0, 0}},
        {"tile-across", {4, 0, 0, 2}},
        {"tile-down", {3, 2, 0, 3}},
        {"neural", {4, 4}},
        {"neural-x2", {2, 4, 0, 0}},
        {"neural-grain", {4, 4, 0, 1, 0, 1, 30, 100, 40, 0, 0, 40}},
    };
    const nanotech::Network network = nanotech::samples::tiny_network();
    // Every value, so a GS sample can be told its alpha scale and edges.
    const std::vector<std::int32_t> defaults = {4, 0, 0, 1, 0, 1, 30, 100, 40, 0, 0, 100};
    for (const auto& sample : nanotech::samples::all()) {
        const bool gs = sample.name == "glow" || sample.name == "lines";
        for (const auto& setting : settings) {
            std::vector<std::int32_t> values = defaults;
            std::copy(setting.values.begin(), setting.values.end(), values.begin());
            if (gs) {
                values[2] = 1;
                if (setting.values.size() < 4) values[3] = 0;
            }
            const nanotech::Image out = nanotech::upscale(
                sample.image, nanotech::options_from(values.data(), static_cast<int>(values.size())), &network);
            // The texels' hash, and the PNG's bytes' (FNV-1a), which the pack holds.
            std::uint64_t png = 1469598103934665603ull;
            for (const std::uint8_t byte : nanotech::encode_png(out)) png = (png ^ byte) * 1099511628211ull;
            std::printf("%s %s %dx%d %016llx %016llx\n", sample.name.c_str(), setting.name, out.width, out.height,
                        static_cast<unsigned long long>(nanotech::texture_hash(out)),
                        static_cast<unsigned long long>(png));
        }
    }
    return 0;
}
