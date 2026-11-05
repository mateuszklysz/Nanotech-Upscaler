// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The engines the page works with: one worker per core it may use (fewer on a phone, where each
// one's memory counts), or the page itself when workers cannot start.
import { loadEngine } from "./engine.js";
import { handle } from "./jobs.js";

export function workerCount(system) {
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(cores - 1, system === "android" ? 3 : 8));
}

export class Pool {
  constructor(size) {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.next = 1;
    try {
      for (let i = 0; i < size; i++) {
        const worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
        worker.onmessage = ({ data }) => this.#done(worker, data);
        worker.onerror = (e) => this.#failed(worker, e.message || "the engine stopped");
        this.workers.push(worker);
        this.idle.push(worker);
      }
    } catch {
      this.workers = [];
      this.idle = [];
    }
    // No workers: one engine on the page.
    this.local = this.workers.length ? null : loadEngine(new URL("nanotech.wasm", import.meta.url));
    this.size = Math.max(1, this.workers.length);
  }

  /** Runs `job` (worker.js) on the next free engine; urgent jobs (what is on screen) go first. */
  run(job, transfer = [], urgent = false) {
    if (this.local) return this.#runLocal(job);
    return new Promise((resolve, reject) => {
      const item = { id: this.next++, job, transfer, resolve, reject };
      if (urgent) this.queue.unshift(item);
      else this.queue.push(item);
      this.#pump();
    });
  }

  /** The same job on every engine (the names to skip). */
  everywhere(job) {
    if (this.local) return this.#runLocal(job);
    return Promise.all(
      this.workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            const id = this.next++;
            this.pending.set(id, { resolve, reject, worker, direct: true });
            worker.postMessage({ id, job });
          }),
      ),
    );
  }

  /** Drops what has not started. */
  clear() {
    for (const item of this.queue) item.reject(new Error("cancelled"));
    this.queue = [];
  }

  #pump() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop();
      const item = this.queue.shift();
      this.pending.set(item.id, { ...item, worker });
      worker.postMessage({ id: item.id, job: item.job }, item.transfer);
    }
  }

  #done(worker, { id, value, error }) {
    const item = this.pending.get(id);
    this.pending.delete(id);
    if (item && !item.direct) this.idle.push(worker);
    if (item) {
      if (error) item.reject(new Error(error));
      else item.resolve(value);
    }
    this.#pump();
  }

  // A worker that stops (its engine did not load, or it ran out of memory) is not given work
  // again; with none left, the page's own engine takes over what is waiting.
  #failed(worker, message) {
    worker.terminate();
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    for (const [id, item] of this.pending) {
      if (item.worker === worker) {
        this.pending.delete(id);
        item.reject(new Error(message));
      }
    }
    if (this.workers.length) return this.#pump();
    this.local = loadEngine(new URL("nanotech.wasm", import.meta.url));
    const waiting = this.queue;
    this.queue = [];
    for (const item of waiting) this.#runLocal(item.job).then(item.resolve, item.reject);
  }

  async #runLocal(job) {
    this.context ??= { skip: new Set() };
    return handle(await this.local, job, this.context);
  }
}
