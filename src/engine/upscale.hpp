// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// One texture made larger, the way its options say, with what PS2 textures need around the scaler:
// the alpha scale the port gives the texture, edges that tile or stop, a palette's steps smoothed,
// cut-outs that keep their exact alpha values (the port picks how it draws a level's texture from
// them), and transparent texels that keep the colour the game sampled them with.
//
// Everything here is integer arithmetic or doubles without fused multiply-adds (CMakeLists.txt), and
// one texture is worked on by one thread, so a texture and its options give the same bytes on every
// system and in WebAssembly.
#pragma once

#include <cstdint>

#include "engine/image.hpp"
#include "engine/neural.hpp"

namespace nanotech {

enum class Engine : int {
    Xbrz = 0,    // xBRZ: the game's own hard edges, made smooth; the default
    Hybrid = 1,  // xBRZ on the edges, a smooth curve between them (less "painted" on photo-like textures)
    Smooth = 2,  // a smooth curve only (Catmull-Rom bicubic)
    Nearest = 3, // every texel made a square: the original as it is, larger
    Neural = 4,  // a network (Real-ESRGAN's compact one) paints the colour 4x larger; xBRZ gives the alpha
};

enum class AlphaScale : int {
    Full = 0,  // 0..255: a level's textures (their PNGs)
    Gs = 1,    // 0..128 is 0..1: the 2D layer's and the effects' textures (the console's GS)
};

enum class Edges : int {
    Clamp = 0,   // the texture stops at its edge (the HUD, the font, the effects)
    Repeat = 1,  // the texture tiles (the world): its edges are scaled with the other side's texels
    RepeatX = 2, // it tiles across only (glTF wrapS repeat, wrapT clamp)
    RepeatY = 3, // it tiles down only
};

struct Options {
    int scale = 4;                     // 2 to 6
    Engine engine = Engine::Xbrz;
    AlphaScale alpha_scale = AlphaScale::Full;
    Edges edges = Edges::Repeat;
    int deposterize = 0;               // 0 to 3: smooths a palette's small colour steps before scaling
    bool exact_alpha = true;           // a texture with at most 4 alpha values keeps only those
    int tolerance = 30;                // xBRZ: how different two colours are before an edge (5 to 60)
    int luminance = 100;               // xBRZ: brightness against hue in that test, in percent (10 to 300)
    int direction_bias = 40;           // xBRZ: how readily a corner is rounded, in tenths (10 to 80)
    int sharpen = 0;                   // 0 to 100: an unsharp mask after scaling
    int original = 0;                  // 0 to 100: how much of the original (its texels as squares) is mixed in
    int denoise = 100;                 // Neural: denoise strength, 0 to 100 (under 100 keeps more of the grain)
    int strength = 100;                // Neural: the network's share against the smooth curve, 0 to 100
    int colour_lock = 0;               // Neural: how much of the source's own colours is put back, 0 to 100
};

// The options as they arrive from the page or the command line, in this order, each clamped to its
// range: scale, engine, alpha scale, edges, deposterize, exact alpha (0/1), tolerance, luminance,
// direction bias, sharpen, original, denoise, strength, colour lock. Fewer values leave the rest at their defaults.
Options options_from(const std::int32_t* values, int count);

// `source` scaled by `options.scale`; an empty image when the source is empty or the result would be
// larger than kMaxSide or the network fails. Neural makes 4x, or 2x (4x averaged down) when the
// scale is under 4, from `network`, or from `colour` (the network's 4x result of neural_input, made
// by the page's GPU); with neither it is xBRZ.
Image upscale(const Image& source, const Options& options, const Network* network = nullptr,
              const Image* colour = nullptr);

// What the network is given for `source` (its colours as the engine prepares them): the page's GPU
// runs the network on this and hands the result back to upscale as `colour`.
Image neural_input(const Image& source, const Options& options);

}  // namespace nanotech
