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

- **Every texture.** The planets' textures from your disc, and the HUD, font and effects the game saved while you played.
- **The game's style.** xBRZ rounds the PS2's hard pixel edges without blurring them; cut-outs keep their exact edges.
- **Your settings.** Engine, scale, edges, smoothing and sharpening, each shown on a picture before and after.
- **Presets.** Save, switch, export and import them.
- **On your device.** Windows, Linux, macOS and Android, no network. The same settings make the same pack everywhere.
- **Nothing from the disc in this repository.** The mod reads your textures where they are and writes the pack there.

Games: Ratchet & Clank (PAL, NTSC-U) and Ratchet & Clank: Going Commando (NTSC-U).

## Install

1. Get [OpenRAC](https://github.com/OpenRAC/OpenRAC) with mod pages (the launcher's **Open** button on a mod).
2. In the launcher, open the **Mods** tab.
3. Paste `https://github.com/mateuszklysz/nanotech-upscaler` and install.
4. Open **Nanotech Upscaler**, pick your settings and make the pack.
5. Add the pack in the **Texture packs** tab.

For the HUD, font and effects, turn on texture dumping in **Texture packs**, play a while, then make the pack again: only new textures are upscaled.

## How it works

The engine is C++ built to WebAssembly, run by the mod's page in the launcher:

1. It reads each texture's PNG with the same `stb_image` as the game, so it names the texture as the game does (FNV-1a over its size and texels).
2. It scales it with one of four engines: **xBRZ** (default), **Hybrid** (xBRZ on edges, a smooth curve between them), **Smooth** (Catmull-Rom) or **Nearest**.
3. It keeps what the PS2 textures need: the GS alpha scale (0 to 128) of the HUD and effects, edges that tile or stop, a cut-out's exact alpha values, the colour of transparent texels.
4. It writes the result into the pack's `.zip`, which the launcher adds like any other pack.

Integer maths, or doubles with no fused multiply-adds, and one texture per thread: CI checks that every system and the WebAssembly make the same bytes.

## Build

```sh
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build
```

The page's engine needs [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) 25 and Node for its tests:

```sh
cmake -S . -B build-wasm -G Ninja -DWASI_SDK_PREFIX=<wasi-sdk> \
  -DCMAKE_TOOLCHAIN_FILE=<wasi-sdk>/share/cmake/wasi-sdk.cmake
cmake --build build-wasm
ctest --test-dir build-wasm
python3 tools/package.py build-wasm/nanotech.wasm   # dist/nanotech-upscaler-<version>.zip
```

`build/nanotech <in.png> <out.png> [options...]` upscales one texture from the command line.

Push a tag `v<version>` and the build workflow publishes a release the launcher can install.

## Credits

- [xBRZ](https://sourceforge.net/projects/xbrz/) by Zenju, the edge scaler.
- [stb](https://github.com/nothings/stb) by Sean Barrett, PNG in and out.
- [OpenRAC](https://github.com/OpenRAC/OpenRAC) for the native Ratchet & Clank and its texture packs.

## Licence

GPL-3.0-or-later ([LICENSE](LICENSE)), as xBRZ is GPL-3. Third-party code: [THIRD_PARTY.md](THIRD_PARTY.md).
