// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// One engine in a worker (pool.js): one texture at a time, so its result does not depend on how
// many run beside it.
import { loadEngine } from "./engine.js";

const engine = loadEngine(new URL("nanotech.wasm", import.meta.url));
// Names already in the pack being updated: their textures are not made again.
let skip = new Set();

self.onmessage = async ({ data }) => {
  const { id, job } = data;
  try {
    const nt = await engine;
    if (job.kind === "skip") {
      skip = new Set(job.names);
      self.postMessage({ id, value: null });
      return;
    }
    if (job.kind === "rgba") {
      const out = nt.upscaleRgba(job.rgba, job.width, job.height, job.values);
      self.postMessage({ id, value: out }, out.rgba ? [out.rgba.buffer] : []);
      return;
    }
    const png = new Uint8Array(job.png);
    if (job.kind === "name") {
      self.postMessage({ id, value: { name: nt.name(png) } });
      return;
    }
    if (job.skipKnown) {
      const name = nt.name(png);
      if (name === null) {
        self.postMessage({ id, value: { error: "unreadable" } });
        return;
      }
      if (skip.has(name)) {
        self.postMessage({ id, value: { name, skipped: true } });
        return;
      }
    }
    const out = nt.upscale(png, job.values, { asPng: job.asPng });
    const transfer = [];
    if (out.rgba && job.keepRgba) transfer.push(out.rgba.buffer);
    else delete out.rgba;
    if (out.png) transfer.push(out.png.buffer);
    self.postMessage({ id, value: out }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  }
};
