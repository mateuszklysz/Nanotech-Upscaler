// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// One engine in a worker (pool.js): one texture at a time, so its result does not depend on how
// many run beside it.
import { loadEngine } from "./engine.js";
import { handle } from "./jobs.js";

const engine = loadEngine(new URL("nanotech.wasm", import.meta.url));
const context = { skip: new Set() };

self.onmessage = async ({ data }) => {
  const { id, job } = data;
  try {
    const value = await handle(await engine, job, context);
    const transfer = [];
    if (value?.rgba) transfer.push(value.rgba.buffer);
    if (value?.png) transfer.push(value.png.buffer);
    self.postMessage({ id, value }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};
