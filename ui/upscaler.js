// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// One texture upscaled with the page's settings, on the GPU or the CPU. On the GPU the engines
// (pool.js) prepare the texture, the GPU runs the network, and the engines finish it (alpha, the
// options after the network, the PNG); on the CPU the engines do everything, with the same bytes on
// every system.

/** The GPU's network in a worker of its own (an OffscreenCanvas); null when the browser has none. */
async function startGpu() {
  try {
    const worker = new Worker(new URL("gpu-worker.js", import.meta.url), { type: "module" });
    const ready = await new Promise((resolve) => {
      worker.onmessage = ({ data }) => resolve(data.ready === true);
      worker.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 10000);
    });
    if (ready) {
      const pending = new Map();
      let next = 1;
      worker.onmessage = ({ data }) => {
        const item = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) item?.reject(new Error(data.error));
        else item?.resolve(data.value);
      };
      return {
        where: "worker",
        run: (job) =>
          new Promise((resolve, reject) => {
            const id = next++;
            pending.set(id, { resolve, reject });
            worker.postMessage({ id, job }, [job.rgba.buffer]);
          }),
      };
    }
    worker.terminate();
  } catch {
    // No module workers.
  }
  // A GPU on the page itself would stop it while it draws (seconds on a phone): the CPU instead.
  return null;
}

const NEURAL = 4;

export class Upscaler {
  constructor(pool) {
    this.pool = pool;
    this.gpu = null;
    this.gpuFailed = null; // why the GPU stopped being used, if it did
    this.ready = startGpu().then((gpu) => {
      this.gpu = gpu;
      return gpu !== null;
    });
  }

  /**
   * A texture (`job.png`, or `job.rgba` with width and height) upscaled with `job.values` and the
   * network `job.model`. `useGpu`: the GPU when there is one; `transfer`: what the CPU's job may
   * take over. Returns what the engines return.
   */
  async run(job, { useGpu = true, urgent = false, transfer = [] } = {}) {
    const neural = job.values[1] === NEURAL && job.model;
    if (!neural || !useGpu || !this.gpu || this.gpuFailed) return this.pool.run(job, transfer, urgent);
    const data = job.png ?? job.rgba;
    const keepData = data.slice(0);
    const input = await this.pool.run({ ...job, kind: "input", [job.png ? "png" : "rgba"]: data }, [], urgent);
    if (input.error || input.skipped) return input;
    const edges = job.values[3];
    let colour;
    try {
      colour = await this.gpu.run({
        model: job.model,
        rgba: new Uint8Array(input.rgba.buffer),
        width: input.width,
        height: input.height,
        wrapX: edges === 1 || edges === 2,
        wrapY: edges === 1 || edges === 3,
        denoise: job.values[11] ?? 100,
      });
    } catch (e) {
      // A GPU that fails once is not asked again: the CPU makes this texture and the rest.
      this.gpuFailed = String(e?.message ?? e);
      return this.pool.run({ ...job, [job.png ? "png" : "rgba"]: keepData }, [], urgent);
    }
    return this.pool.run(
      { ...job, kind: "finish", [job.png ? "png" : "rgba"]: keepData, colour, skipKnown: false },
      [colour.buffer],
      urgent,
    );
  }
}
