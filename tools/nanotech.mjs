// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// nanotech.wasm from Node, the way the mod's page loads it (no WASI: its few imports answered with
// nothing), with the same arguments as the native `nanotech` command. CI runs both on the same
// textures and compares the PNGs byte for byte.
//   node tools/nanotech.mjs <nanotech.wasm> <in.png> <out.png> [option values...]
import { readFile, writeFile } from "node:fs/promises";

const [wasmPath, input, output, ...values] = process.argv.slice(2);
const module = await WebAssembly.compile(await readFile(wasmPath));
const nothing = () => 52; // ENOSYS: the engine never writes to a file
const imports = { wasi_snapshot_preview1: new Proxy({}, { get: () => nothing }) };
const { exports: nt } = await WebAssembly.instantiate(module, imports);
nt._initialize();

const png = await readFile(input);
const pngAt = nt.nt_alloc(png.length);
new Uint8Array(nt.memory.buffer, pngAt, png.length).set(png);
const valuesAt = nt.nt_alloc(values.length * 4);
new Int32Array(nt.memory.buffer, valuesAt, values.length).set(values.map(Number));
const status = nt.nt_upscale(pngAt, png.length, valuesAt, values.length, 1);
nt.nt_free(pngAt);
nt.nt_free(valuesAt);
if (status !== 0) {
  console.error(`nanotech: ${status === 1 ? "not a PNG it can read" : "the result is too large"}`);
  process.exit(1);
}
const hash = (BigInt(nt.nt_hash_hi() >>> 0) << 32n) | BigInt(nt.nt_hash_lo() >>> 0);
console.log(hash.toString(16).padStart(16, "0"));
await writeFile(output, new Uint8Array(nt.memory.buffer, nt.nt_png(), nt.nt_png_size()));
