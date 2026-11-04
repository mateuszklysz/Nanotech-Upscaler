// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// nanotech.wasm for the page and its workers: one texture's PNG in, its pack name and the result
// out (src/wasm/exports.cpp). The module needs nothing from outside; its few WASI imports are
// answered with nothing, as it never writes to a file.

const ENOSYS = 52;

/** Loads the engine from `url` (ui/nanotech.wasm). */
export async function loadEngine(url) {
  const imports = { wasi_snapshot_preview1: new Proxy({}, { get: () => () => ENOSYS }) };
  const response = await fetch(url);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
  const nt = instance.exports;
  nt._initialize();

  const copyIn = (bytes) => {
    const at = nt.nt_alloc(bytes.length);
    new Uint8Array(nt.memory.buffer, at, bytes.length).set(bytes);
    return at;
  };
  const hash = () =>
    ((BigInt(nt.nt_hash_hi() >>> 0) << 32n) | BigInt(nt.nt_hash_lo() >>> 0)).toString(16).padStart(16, "0");

  return {
    /** The name a PNG's texture has in a pack (16 hex digits), or null when it cannot be read. */
    name(png) {
      const at = copyIn(png);
      const status = nt.nt_hash(at, png.length);
      nt.nt_free(at);
      return status === 0 ? hash() : null;
    },

    /** RGBA texels (`width` * `height` * 4) upscaled the same way: the page's own pictures. */
    upscaleRgba(rgba, width, height, values) {
      const rgbaAt = copyIn(rgba);
      const valuesAt = nt.nt_alloc(values.length * 4);
      new Int32Array(nt.memory.buffer, valuesAt, values.length).set(values);
      const status = nt.nt_upscale_rgba(rgbaAt, width, height, valuesAt, values.length, 0);
      nt.nt_free(rgbaAt);
      nt.nt_free(valuesAt);
      if (status !== 0) return { error: "too-large" };
      const w = nt.nt_width();
      const h = nt.nt_height();
      return {
        name: hash(),
        width: w,
        height: h,
        rgba: new Uint8ClampedArray(nt.memory.buffer.slice(nt.nt_rgba(), nt.nt_rgba() + w * h * 4)),
      };
    },

    /**
     * A PNG upscaled with option values in the engine's order (src/engine/upscale.hpp). `png`
     * true also writes the result as a PNG. {name, width, height, rgba, png} or {error}.
     */
    upscale(png, values, { asPng = true } = {}) {
      const pngAt = copyIn(png);
      const valuesAt = nt.nt_alloc(values.length * 4);
      new Int32Array(nt.memory.buffer, valuesAt, values.length).set(values);
      const status = nt.nt_upscale(pngAt, png.length, valuesAt, values.length, asPng ? 1 : 0);
      nt.nt_free(pngAt);
      nt.nt_free(valuesAt);
      if (status !== 0) return { error: status === 1 ? "unreadable" : "too-large" };
      const width = nt.nt_width();
      const height = nt.nt_height();
      return {
        name: hash(),
        width,
        height,
        rgba: new Uint8ClampedArray(nt.memory.buffer.slice(nt.nt_rgba(), nt.nt_rgba() + width * height * 4)),
        png: asPng ? new Uint8Array(nt.memory.buffer.slice(nt.nt_png(), nt.nt_png() + nt.nt_png_size())) : null,
      };
    },
  };
}
