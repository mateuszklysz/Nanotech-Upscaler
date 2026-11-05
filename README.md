<h1 align="center">Nanotech Upscaler</h1>

<p align="center">
  Every Ratchet & Clank texture, from the planets to the HUD and font, upscaled on your own device
  into an OpenRAC texture pack, keeping the PS2 look.
</p>

<p align="center">
  <a href="https://github.com/mateuszklysz/nanotech-upscaler/releases/latest"><img src="https://img.shields.io/github/v/release/mateuszklysz/nanotech-upscaler?label=download&color=e8731f" alt="Download"></a>
  <a href="https://github.com/mateuszklysz/nanotech-upscaler/actions/workflows/build.yml"><img src="https://github.com/mateuszklysz/nanotech-upscaler/actions/workflows/build.yml/badge.svg" alt="Build"></a>
  <a href="https://github.com/OpenRAC/OpenRAC"><img src="https://img.shields.io/badge/needs-OpenRAC-e8a317" alt="Needs OpenRAC"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-GPL--3.0-blue" alt="GPL-3.0 licence"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#build">Build</a>
</p>

## What is it?

A page in OpenRAC's launcher that makes a texture pack from the game's own textures.

- **Every texture:** the levels' textures from your disc, plus the HUD, font and effects the game dumps while you play.
- **Neural upscaling:** three networks. **General** (Real-ESRGAN, the default), **Cartoon** (Real-ESRGAN anime) and **Detailed** (PLKSR-Rep from NTIRE 2026, slower). Cut-outs keep sharp edges.
- **Settings and presets:** model, scale, noise removal, strength, original colours, sharpening and more, each shown on a before and after picture. Built-in presets, or save your own.
- **On your device, offline:** Windows, Linux, macOS and Android. The graphics card runs the network (WebGL2). With it off, the processor gives the same bytes on every system.
- **No game data in this repository:** the mod reads your textures where they are and writes the pack there.

Games: Ratchet & Clank (PAL, NTSC-U) and Ratchet & Clank: Going Commando (NTSC-U).

## Install

You need an [OpenRAC](https://github.com/OpenRAC/OpenRAC) launcher with mod pages.

1. In the OpenRAC launcher, open the **Mods** tab.
2. Paste `https://github.com/mateuszklysz/nanotech-upscaler` and install.
3. Open **Nanotech Upscaler**, pick your settings and make the pack.
4. Turn the pack on in the **Texture packs** tab.

For the HUD, font and effects: turn on texture dumping in **Texture packs**, play a while, then make the pack again. Only new textures are upscaled.

## How it works

The engine is C++ built to WebAssembly and runs inside the mod's page.

1. It reads each PNG with the same `stb_image` as the game, so textures get the same names (FNV-1a of size and texels).
2. A network makes the colours 4x larger (2x is 4x scaled down). It runs on the graphics card (`ui/gpu.js`) or the processor (`src/engine/neural.cpp`). xBRZ shapes the alpha.
3. The options are applied: strength, original colours, sharpening, original pixels.
4. PS2 details are kept: the GS alpha range (0 to 128), tiling edges, exact cut-out alpha, the colour of transparent texels.
5. The result goes into the pack's `.zip`.

On the processor every sum runs in a fixed order with no fused multiply-adds, so CI can check that every system and the WebAssembly give the same bytes. The graphics card's result is close but not byte-exact.

## Build

```sh
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build
```

The page's engine needs [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) 25, and Node for its tests:

```sh
cmake -S . -B build-wasm -G Ninja -DWASI_SDK_PREFIX=<wasi-sdk> \
  -DCMAKE_TOOLCHAIN_FILE=<wasi-sdk>/share/cmake/wasi-sdk.cmake
cmake --build build-wasm
ctest --test-dir build-wasm
python3 tools/fetch_models.py                        # ui/models/*.bin
python3 tools/package.py build-wasm/nanotech.wasm   # dist/nanotech-upscaler-<version>.zip
```

`build/nanotech [--network ui/models/general.bin] <in.png> <out.png> [options...]` upscales one texture (engine 4 is the network).

A tag `v<version>` makes the build workflow publish a release the launcher can install.

## Credits

- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) by Xintao Wang et al., the General and Cartoon networks (BSD-3).
- PLKSR-Rep by team VIPSL, from the [NTIRE 2026 Mobile Real-World SR challenge](https://github.com/jiatongli2024/NTIRE2026_Mobile_RealWorld_ImageSR), the Detailed network. [PLKSR](https://github.com/dslisleedh/PLKSR) by Dongheon Lee.
- [xBRZ](https://sourceforge.net/projects/xbrz/) by Zenju, the cut-outs' edges.
- [stb](https://github.com/nothings/stb) by Sean Barrett, PNG in and out.
- [OpenRAC](https://github.com/OpenRAC/OpenRAC) for the native Ratchet & Clank and its texture packs.

## Licence

GPL-3.0-or-later ([LICENSE](LICENSE)), because xBRZ is GPL-3. Third-party code: [THIRD_PARTY.md](THIRD_PARTY.md).
