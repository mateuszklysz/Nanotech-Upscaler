// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The GPU network (gpu.js) in a worker of its own, on an OffscreenCanvas, so the page stays smooth
// while it draws. It answers {ready} first: false when this browser has no WebGL2 for it here.
import { GpuNetwork } from "./gpu.js";

let gpu = null;
try {
  gpu = typeof OffscreenCanvas === "function" ? GpuNetwork.create(new OffscreenCanvas(1, 1)) : null;
} catch {
  gpu = null;
}
self.postMessage({ ready: gpu !== null });

const networks = new Map();
let loaded = null;

self.onmessage = async ({ data }) => {
  const { id, job } = data;
  try {
    if (!networks.has(job.model)) {
      const response = await fetch(new URL(`models/${job.model}.bin`, import.meta.url));
      if (!response.ok) throw new Error(`the ${job.model} model is missing`);
      networks.set(job.model, new Uint8Array(await response.arrayBuffer()));
    }
    if (loaded !== job.model) {
      gpu.load(networks.get(job.model));
      loaded = job.model;
    }
    const rgba = await gpu.run(new Uint8Array(job.rgba), job.width, job.height, job);
    self.postMessage({ id, value: rgba }, [rgba.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};
