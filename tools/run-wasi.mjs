// SPDX-License-Identifier: GPL-3.0-or-later
// Runs a WASI test program (the engine's tests built with wasi-sdk) in Node, as CTest does natively.
//   node tools/run-wasi.mjs <program.wasm>
import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const wasi = new WASI({ version: "preview1", args: [process.argv[2]], env: {}, returnOnExit: true });
const module = await WebAssembly.compile(await readFile(process.argv[2]));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance);
