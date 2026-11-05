// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The game's textures the pack is made from, and how each one is scaled:
// - the world: every level's textures, as the launcher read them from the disc
//   (level_NN/textures/*.png), named by the engine as the port names them; full alpha (0..255),
//   tiling as their models' materials say (glTF samplers: wrapS, wrapT);
// - the HUD, menus and font: the dump's Interface/ (the textures the game saved while it was
//   played, named by their file), in the GS alpha scale (0..128), clamped at their edges;
// - the effects: the rest of the dump (Shared/, Animated/) that is not a level's texture, in the
//   GS scale too.
import { call } from "./bridge.js";
import { findRatchet } from "./ratchet.js";

const REPEAT = 10497;
const HASH_NAME = /^([0-9a-f]{16})\.png$/;

/** One texture: where it is read from, what group it is in, its folder in the pack, how it scales. */
function texture(root, path, group, folder, alpha, edges, name = null) {
  return { root, path, group, folder, alpha, edges, name };
}

function dirname(path) {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at + 1);
}

function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

// A model's JSON: a .glb's first chunk (read alone, without the meshes after it), or a .gltf.
async function gltfJson(path) {
  if (!path.toLowerCase().endsWith(".glb")) {
    return JSON.parse(new TextDecoder().decode(await call("read", { root: "levels", path })));
  }
  const head = new DataView(await call("read", { root: "levels", path, start: 0, length: 20 }));
  if (head.byteLength < 20 || head.getUint32(0, true) !== 0x46546c67) return null;
  const length = head.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(await call("read", { root: "levels", path, start: 20, length })));
}

/** How the levels' models tile each texture: path → [repeats across, repeats down]. */
async function levelWraps(files, onProgress) {
  const wraps = new Map();
  const models = files.filter((f) => /\.(gltf|glb)$/i.test(f.path));
  let done = 0;
  let next = 0;
  const lane = async () => {
    while (next < models.length) await one(models[next++]);
  };
  const one = async (f) => {
    try {
      const doc = await gltfJson(f.path);
      const base = dirname(f.path);
      for (const t of doc?.textures ?? []) {
        const uri = doc.images?.[t.source]?.uri;
        if (!uri || uri.startsWith("data:")) continue;
        const sampler = doc.samplers?.[t.sampler] ?? {};
        const path = normalize(base + decodeURIComponent(uri));
        const [s, u] = wraps.get(path) ?? [false, false];
        wraps.set(path, [s || (sampler.wrapS ?? REPEAT) === REPEAT, u || (sampler.wrapT ?? REPEAT) === REPEAT]);
      }
    } catch {
      // A model that cannot be read: its textures tile, the default.
    }
    onProgress?.(++done, models.length);
  };
  await Promise.all(Array.from({ length: 8 }, lane));
  return wraps;
}

const edgesOf = ([s, t]) => (s && t ? 1 : s ? 2 : t ? 3 : 0);

/** Every texture there is to scale, by group (world, interface, effects). */
export async function collect(onProgress) {
  const [levels, dump] = await Promise.all([
    call("list", { root: "levels" }).catch(() => []),
    call("list", { root: "dump" }).catch(() => []),
  ]);
  const wraps = await levelWraps(levels, onProgress);
  const world = levels
    .filter((f) => /(^|\/)textures\/[^/]+\.png$/i.test(f.path))
    .map((f) => {
      const level = f.path.split("/")[0];
      const edges = wraps.has(f.path) ? edgesOf(wraps.get(f.path)) : 1;
      return texture("levels", f.path, "world", `World/${level}`, 0, edges);
    });
  const interfaceTextures = [];
  const effects = [];
  const dumpedWorld = [];
  for (const f of dump) {
    const file = f.path.split("/").pop();
    const hash = HASH_NAME.exec(file)?.[1];
    if (!hash) continue;
    const top = f.path.split("/")[0];
    if (top === "Interface") interfaceTextures.push(texture("dump", f.path, "interface", "Interface", 1, 0, hash));
    else if (top === "Planets") {
      dumpedWorld.push(texture("dump", f.path, "world", `World/${f.path.split("/")[1]}`, 0, 1, hash));
    } else effects.push(texture("dump", f.path, "effects", "Effects", 1, 0, hash));
  }
  // A planet's dumped texture is the level's own when the levels are there: those are scaled once.
  return {
    world: world.length ? world : dumpedWorld,
    interface: interfaceTextures,
    effects,
    levelsFound: world.length > 0,
    ratchet: findRatchet(levels),
    dumpFound: dump.length > 0,
  };
}
