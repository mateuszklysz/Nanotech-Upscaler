// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// What the page asks the launcher (docs/port/MODS.md, "A mod's page"), by messages to the frame's
// parent. Opened on its own (a browser, for working on the page), it answers itself with the
// samples, the browser's storage and downloads.
import { SAMPLES } from "./samples.js";

const PROTOCOL = 1;
export const inLauncher = window.parent !== window;

let next = 1;
const waiting = new Map();
const padListeners = [];
const themeListeners = [];

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const d = e.data;
  if (!d || d.openrac !== PROTOCOL) return;
  if (d.event === "pad") {
    for (const listen of padListeners) listen(d.button, d.down);
    return;
  }
  if (d.event === "theme") {
    for (const listen of themeListeners) listen(d.theme);
    return;
  }
  const w = waiting.get(d.id);
  if (!w) return;
  waiting.delete(d.id);
  if (d.ok) w.resolve(d.value);
  else w.reject(new Error(d.error));
});

/** The launcher's pad buttons (up, down, left, right, accept, back, prev, next, more). */
export function onPad(listen) {
  padListeners.push(listen);
}

/** The launcher's colours, when they change (theme.js). */
export function onTheme(listen) {
  themeListeners.push(listen);
}

/** One call: its answer. ArrayBuffers in `args` are handed over, not copied. */
export function call(name, args = {}) {
  if (!inLauncher) return demo(name, args);
  return new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    const transfer = Object.values(args).filter((v) => v instanceof ArrayBuffer);
    window.parent.postMessage({ openrac: PROTOCOL, id, call: name, args }, "*", transfer);
  });
}

// On its own: the samples as one level, nothing dumped, the browser's storage, downloads.
const pngs = new Map();
async function samplePng(key) {
  if (!pngs.has(key)) {
    const s = SAMPLES[key];
    const canvas = new OffscreenCanvas(s.width, s.height);
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(s.rgba), s.width, s.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    pngs.set(key, await blob.arrayBuffer());
  }
  return pngs.get(key).slice(0);
}

const saving = new Map();
function download(name, parts, type) {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function demo(name, args) {
  switch (name) {
    case "info":
      return {
        game: "rac1",
        version: "pal",
        packId: "rac1-pal",
        system: "desktop",
        mod: { id: "nanotech-upscaler", name: "Nanotech Upscaler", version: "dev" },
      };
    case "list":
      return args.root === "levels"
        ? Object.keys(SAMPLES).map((k) => ({ path: `level_00/textures/${k}.png`, size: 1 }))
        : [];
    case "read":
      return samplePng(args.path.replace(/^.*\//, "").replace(/\.png$/, ""));
    case "storeGet": {
      try {
        const v = localStorage.getItem(`nanotech-${args.key}`);
        return v === null ? null : JSON.parse(v);
      } catch {
        return null;
      }
    }
    case "storeSet":
      try {
        if (args.value === null) localStorage.removeItem(`nanotech-${args.key}`);
        else localStorage.setItem(`nanotech-${args.key}`, JSON.stringify(args.value));
      } catch {
        // No storage here: nothing kept.
      }
      return null;
    case "save":
      download(`${args.name}.${args.extension}`, [args.bytes], "application/octet-stream");
      return `${args.name}.${args.extension}`;
    case "saveStart": {
      const token = next++;
      saving.set(token, { name: `${args.name}.${args.extension}`, parts: [] });
      return token;
    }
    case "saveWrite":
      saving.get(args.token).parts.push(args.bytes);
      return null;
    case "saveEnd": {
      const s = saving.get(args.token);
      saving.delete(args.token);
      if (!args.keep) return "";
      download(s.name, s.parts, "application/zip");
      return s.name;
    }
    case "open":
      return new Promise((resolve) => {
        const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json" });
        input.onchange = async () => resolve(input.files[0] ? await input.files[0].arrayBuffer() : null);
        input.click();
      });
    case "close":
      return null;
    default:
      throw new Error(`no call ${name}`);
  }
}
