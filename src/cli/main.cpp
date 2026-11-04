// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// nanotech: the engine from the command line, for the tests and for checking that every system
// makes the same bytes as the page's WebAssembly.
//
//   nanotech [--network <file>] <in.png> <out.png> [option values...]
//                                     upscales one texture, prints its pack name; the Neural engine
//                                     uses the network file (tools/convert_weights.py)
//   nanotech --hash <in.png>          prints the pack name only
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "engine/image.hpp"
#include "engine/upscale.hpp"

namespace {
bool read_file(const char* path, std::vector<std::uint8_t>& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    return true;
}

bool write_file(const char* path, const std::vector<std::uint8_t>& bytes) {
    std::ofstream out(path, std::ios::binary);
    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    return static_cast<bool>(out);
}

int usage() {
    std::fprintf(stderr, "usage: nanotech [--network <file>] <in.png> <out.png> [option values...]\n       nanotech --hash <in.png>\n");
    return 2;
}
}  // namespace

int main(int argc, char** argv) {
    nanotech::Network network;
    if (argc >= 3 && std::string(argv[1]) == "--network") {
        std::vector<std::uint8_t> weights;
        if (!read_file(argv[2], weights) || (network = nanotech::load_network(weights.data(), weights.size())).empty()) {
            std::fprintf(stderr, "nanotech: %s is not a network it can read\n", argv[2]);
            return 1;
        }
        argv += 2;
        argc -= 2;
    }
    if (argc < 3) return usage();
    const bool hash_only = std::string(argv[1]) == "--hash";
    std::vector<std::uint8_t> bytes;
    if (!read_file(argv[2 - (hash_only ? 0 : 1)], bytes)) {
        std::fprintf(stderr, "nanotech: cannot read %s\n", argv[hash_only ? 2 : 1]);
        return 1;
    }
    nanotech::Image source;
    if (!nanotech::decode_png(bytes.data(), bytes.size(), source)) {
        std::fprintf(stderr, "nanotech: not a PNG it can read\n");
        return 1;
    }
    std::printf("%016llx\n", static_cast<unsigned long long>(nanotech::texture_hash(source)));
    if (hash_only) return 0;
    std::vector<std::int32_t> values;
    for (int i = 3; i < argc; ++i) values.push_back(static_cast<std::int32_t>(std::strtol(argv[i], nullptr, 10)));
    const nanotech::Image out =
        nanotech::upscale(source, nanotech::options_from(values.data(), static_cast<int>(values.size())), &network);
    if (out.empty() || !write_file(argv[2], nanotech::encode_png(out))) {
        std::fprintf(stderr, "nanotech: cannot write %s\n", argv[2]);
        return 1;
    }
    return 0;
}
