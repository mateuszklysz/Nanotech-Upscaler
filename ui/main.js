// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The mod's page: the settings and their pictures, the presets, the preview, and the pack.
import { call, inLauncher } from "./bridge.js";
import { setupPad } from "./pad.js";
import { Pool, workerCount } from "./pool.js";
import { BUILT_IN, clean, DEFAULTS, engineValues, OPTIONS, shown } from "./options.js";
import { SAMPLES } from "./samples.js";
import { loadModel, RatchetView } from "./ratchet.js";
import { collect } from "./textures.js";
import { ZipWriter } from "./zip.js";

const $ = (id) => document.getElementById(id);
const GROUPS = [
  { key: "world", name: "Planets (levels, models, sky)" },
  { key: "interface", name: "HUD, menus and font" },
  { key: "effects", name: "Effects" },
];
const STRIP_SIZE = 14;

const state = {
  info: null,
  pool: null,
  values: { ...DEFAULTS },
  preset: "Faithful",
  presets: [], // the player's own: [{name, values}]
  textures: { world: [], interface: [], effects: [] },
  include: { world: true, interface: true, effects: true },
  group: "world",
  index: 0,
  mode: "texture", // the preview: "texture" or "ratchet"
  making: null,
};

// ---------------------------------------------------------------------------------------------
// Pictures

/** RGBA in a canvas; GS textures (alpha 0..128) shown at full strength. */
function paint(canvas, { width, height, rgba }, gs = false) {
  canvas.width = width;
  canvas.height = height;
  let texels = rgba;
  if (gs) {
    texels = new Uint8ClampedArray(rgba);
    for (let i = 3; i < texels.length; i += 4) texels[i] = Math.min(255, texels[i] * 2);
  }
  canvas.getContext("2d").putImageData(new ImageData(texels, width, height), 0, 0);
}

/** A PNG's texels as the browser decodes it (for showing only: the engine decodes its own). */
async function decodeForShow(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext("2d");
  g.drawImage(bitmap, 0, 0);
  const { data } = g.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, rgba: data };
}

/** A before-and-after box in `root`: { before, after, labels(left, right), busy(on) }. */
function compare(root, split = 50) {
  root.classList.add("compare");
  root.style.setProperty("--split", `${split}%`);
  root.innerHTML = "";
  const before = Object.assign(document.createElement("canvas"), { className: "before" });
  const after = Object.assign(document.createElement("canvas"), { className: "after" });
  const line = Object.assign(document.createElement("div"), { className: "line" });
  const range = Object.assign(document.createElement("input"), { type: "range", min: 0, max: 100, value: split });
  range.setAttribute("aria-label", "Before and after");
  range.addEventListener("input", () => root.style.setProperty("--split", `${range.value}%`));
  const left = Object.assign(document.createElement("span"), { className: "label left", textContent: "Original" });
  const right = Object.assign(document.createElement("span"), { className: "label right", textContent: "Upscaled" });
  const busy = Object.assign(document.createElement("span"), { className: "busy", textContent: "…", hidden: true });
  root.append(before, after, line, range, left, right, busy);
  return {
    before,
    after,
    labels(l, r) {
      left.textContent = l;
      right.textContent = r;
    },
    busy(on) {
      busy.hidden = !on;
    },
    aspect(width, height) {
      root.style.aspectRatio = `${width} / ${height}`;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The settings

const optionViews = new Map();

function buildOptions() {
  const list = $("options");
  list.innerHTML = "";
  for (const o of OPTIONS) {
    const card = document.createElement("div");
    card.className = "option";
    const head = document.createElement("div");
    head.className = "head";
    const name = document.createElement("span");
    name.textContent = o.name;
    const value = document.createElement("span");
    value.className = "value";
    head.append(name, value);

    const control = document.createElement("div");
    control.className = "control";
    let input;
    if (o.type === "range") {
      input = Object.assign(document.createElement("input"), { type: "range", min: o.min, max: o.max, step: o.step });
      input.addEventListener("input", () => setValue(o.key, Number(input.value)));
    } else if (o.type === "choice") {
      input = document.createElement("select");
      for (const c of o.choices) input.append(new Option(c.name, String(c.value)));
      input.addEventListener("change", () => setValue(o.key, Number(input.value)));
    } else {
      const label = document.createElement("label");
      input = Object.assign(document.createElement("input"), { type: "checkbox" });
      input.addEventListener("change", () => setValue(o.key, input.checked));
      label.append(input, document.createTextNode(o.name));
      control.append(label);
    }
    input.setAttribute("aria-label", o.name);
    if (o.type !== "bool") control.append(input);

    const about = document.createElement("p");
    about.className = "about";
    const picture = document.createElement("div");
    card.append(head, control, about, picture);
    list.append(card);
    optionViews.set(o.key, { card, input, value, about, view: compare(picture) });
  }
}

function showValues() {
  for (const o of OPTIONS) {
    const { card, input, value, about } = optionViews.get(o.key);
    const v = state.values[o.key];
    if (o.type === "bool") input.checked = v;
    else input.value = String(v);
    value.textContent = o.type === "bool" ? "" : shown(o, v);
    card.hidden = o.when ? !o.when(state.values) : false;
    const engineHint = o.type === "choice" ? ` ${o.choices.find((c) => c.value === v)?.hint ?? ""}` : "";
    about.textContent = o.hint + engineHint;
  }
}

function setValue(key, v) {
  state.values = clean({ ...state.values, [key]: v });
  // A preset changed by hand is no longer that preset.
  const preset = allPresets().find((p) => p.name === state.preset);
  if (preset && !same(preset.values, state.values)) state.preset = "";
  showValues();
  showPresets();
  settingsChanged();
}

const same = (a, b) => OPTIONS.every((o) => clean(a)[o.key] === clean(b)[o.key]);

let changeTimer = 0;
function settingsChanged() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    void call("storeSet", {
      key: "current",
      value: { preset: state.preset, values: state.values, include: state.include },
    });
    void drawOptionPictures();
    void drawPreview();
  }, 180);
}

// Each option's picture: its sample with the option at its contrast, and at its value.
let pictureRound = 0;
async function drawOptionPictures() {
  const round = ++pictureRound;
  for (const o of OPTIONS) {
    const { card, view } = optionViews.get(o.key);
    if (card.hidden) continue;
    const sample = SAMPLES[o.sample];
    const now = { ...state.values };
    if (o.engineFor) now.engine = o.engineFor(now);
    const other = { ...now, [o.key]: o.contrast(now) };
    const run = (v) =>
      state.pool.run(
        {
          kind: "rgba",
          rgba: new Uint8Array(sample.rgba),
          width: sample.width,
          height: sample.height,
          values: engineValues(v, sample.alpha, sample.edges),
        },
        [],
        true,
      );
    const [a, b] = await Promise.all([run(other), run(now)]);
    if (round !== pictureRound) return;
    if (a.rgba) paint(view.before, a, sample.alpha === 1);
    if (b.rgba) paint(view.after, b, sample.alpha === 1);
    view.labels(shown(o, other[o.key]), shown(o, now[o.key]));
  }
}

// ---------------------------------------------------------------------------------------------
// Presets

const allPresets = () => [...BUILT_IN, ...state.presets];

function showPresets() {
  const select = $("preset");
  select.innerHTML = "";
  if (!state.preset) select.append(new Option("Custom", ""));
  for (const p of BUILT_IN) select.append(new Option(p.name, p.name));
  for (const p of state.presets) select.append(new Option(`${p.name} (yours)`, p.name));
  select.value = state.preset;
  $("delete-preset").disabled = !state.presets.some((p) => p.name === state.preset);
}

function choosePreset(name) {
  const preset = allPresets().find((p) => p.name === name);
  if (!preset) return;
  state.preset = name;
  state.values = clean(preset.values);
  showValues();
  showPresets();
  settingsChanged();
}

async function savePresets() {
  await call("storeSet", { key: "presets", value: state.presets });
}

function askName() {
  const form = $("name-form");
  form.hidden = false;
  $("name-input").value = state.preset && !BUILT_IN.some((p) => p.name === state.preset) ? state.preset : "";
  $("name-input").focus();
}

async function savePresetAs(name) {
  name = name.trim().slice(0, 40);
  if (!name) return;
  if (BUILT_IN.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    status(`"${name}" is a preset of the mod's: pick another name.`, true);
    return;
  }
  state.presets = state.presets.filter((p) => p.name !== name);
  state.presets.push({ name, values: { ...state.values } });
  state.preset = name;
  await savePresets();
  showPresets();
  settingsChanged();
  status(`Saved the preset "${name}".`);
}

async function deletePreset() {
  const name = state.preset;
  state.presets = state.presets.filter((p) => p.name !== name);
  state.preset = "";
  await savePresets();
  showPresets();
  settingsChanged();
  status(`Deleted the preset "${name}".`);
}

async function exportPreset() {
  const name = state.preset || "Custom";
  const preset = {
    format: 1,
    mod: "nanotech-upscaler",
    version: state.info.mod.version,
    name,
    values: state.values,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(preset, null, 2)}\n`).buffer;
  const saved = await call("save", { name: `Nanotech preset ${name}`, extension: "json", bytes });
  if (saved) status(`Saved ${saved}.`);
}

async function importPreset() {
  const bytes = await call("open", { extension: "json" });
  if (!bytes) return;
  let preset;
  try {
    preset = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    status("That file is not a preset (it is not JSON).", true);
    return;
  }
  if (preset?.mod !== "nanotech-upscaler" || preset.format !== 1 || typeof preset.values !== "object") {
    status("That file is not a Nanotech Upscaler preset.", true);
    return;
  }
  let name =
    String(preset.name || "Imported")
      .trim()
      .slice(0, 40) || "Imported";
  if (BUILT_IN.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name} (imported)`;
  state.presets = state.presets.filter((p) => p.name !== name);
  state.presets.push({ name, values: clean(preset.values) });
  await savePresets();
  choosePreset(name);
  status(`Imported the preset "${name}".`);
}

// ---------------------------------------------------------------------------------------------
// The preview: one texture large, and a strip of others

const preview = { view: null, round: 0 };
// Ratchet: his model and view once loaded, his textures' originals, the frame loop.
const ratchet = { file: null, view: null, originals: null, round: 0, frame: 0, failed: false };

function currentList() {
  return state.textures[state.group] ?? [];
}

function showPicker() {
  const select = $("group");
  select.innerHTML = "";
  for (const g of GROUPS) {
    const n = state.textures[g.key].length;
    const o = new Option(`${g.name} (${n})`, g.key);
    o.disabled = n === 0;
    select.append(o);
  }
  select.value = state.group;
  const list = currentList();
  $("which").textContent = list.length ? `${state.index + 1} of ${list.length}` : "none";
  $("prev").disabled = $("next").disabled = list.length < 2;
}

function showMode() {
  const onRatchet = state.mode === "ratchet";
  $("preview").hidden = $("texture-bar").hidden = onRatchet;
  $("ratchet").hidden = $("ratchet-bar").hidden = !onRatchet;
  for (const b of $("strip").querySelectorAll("button")) {
    const pressed = b.dataset.ratchet
      ? onRatchet
      : !onRatchet && b.dataset.group === state.group && Number(b.dataset.index) === state.index;
    b.setAttribute("aria-pressed", String(pressed));
  }
  cancelAnimationFrame(ratchet.frame);
  if (onRatchet && ratchet.view) loop();
}

function loop() {
  ratchet.view.draw();
  ratchet.frame = requestAnimationFrame(loop);
}

function pickRatchet() {
  state.mode = "ratchet";
  showMode();
  void drawPreview();
}

function pick(group, index) {
  const list = state.textures[group];
  if (!list?.length) return;
  state.mode = "texture";
  state.group = group;
  state.index = ((index % list.length) + list.length) % list.length;
  showPicker();
  showMode();
  void drawPreview();
}

async function drawRatchet() {
  const round = ++ratchet.round;
  $("ratchet-busy").hidden = false;
  try {
    if (!ratchet.view) {
      const bytes = await call("read", { root: "levels", path: ratchet.file.path });
      const model = loadModel(bytes, ratchet.file.path);
      ratchet.view = new RatchetView($("ratchet-canvas"), model);
      ratchet.originals = new Map();
      for (const path of new Set(model.parts.map((p) => p.texture).filter(Boolean))) {
        const png = await call("read", { root: "levels", path });
        ratchet.originals.set(path, { png, shown: await decodeForShow(png.slice(0)) });
      }
      ratchet.view.textures(
        0,
        [...ratchet.originals].map(([path, t]) => [path, t.shown]),
      );
      if (state.mode === "ratchet") showMode();
    }
    const upscaled = [];
    for (const [path, t] of ratchet.originals) {
      const out = await state.pool.run(
        { kind: "png", png: t.png.slice(0), values: engineValues(state.values, 0, 1), asPng: false, keepRgba: true },
        [],
        true,
      );
      if (round !== ratchet.round) return;
      if (out.rgba) upscaled.push([path, out]);
    }
    ratchet.view.textures(1, upscaled);
  } catch (e) {
    ratchet.failed = true;
    status(`Ratchet could not be shown: ${e.message}`, true);
  } finally {
    if (round === ratchet.round) $("ratchet-busy").hidden = true;
  }
}

async function drawPreview() {
  if (state.mode === "ratchet") return drawRatchet();
  const texture = currentList()[state.index];
  if (!texture) return;
  const round = ++preview.round;
  const view = preview.view;
  view.busy(true);
  try {
    const bytes = await call("read", { root: texture.root, path: texture.path });
    const shown = await decodeForShow(bytes.slice(0));
    if (round !== preview.round) return;
    const gs = texture.alpha === 1;
    paint(view.before, shown, gs);
    view.aspect(shown.width, shown.height);
    const out = await state.pool.run(
      {
        kind: "png",
        png: bytes,
        values: engineValues(state.values, texture.alpha, texture.edges),
        asPng: false,
        keepRgba: true,
      },
      [bytes],
      true,
    );
    if (round !== preview.round) return;
    if (out.error) {
      view.labels("Original", out.error === "too-large" ? "Too large at this scale" : "Cannot be read");
      return;
    }
    paint(view.after, out, gs);
    view.labels(`Original ${shown.width}×${shown.height}`, `${state.values.scale}× ${out.width}×${out.height}`);
  } catch (e) {
    if (round === preview.round) status(`The preview failed: ${e.message}`, true);
  } finally {
    if (round === preview.round) view.busy(false);
  }
}

/** A few textures of every group, spread through each. */
async function buildStrip() {
  const strip = $("strip");
  strip.innerHTML = "";
  const groups = GROUPS.filter((g) => state.textures[g.key].length);
  const each = Math.max(1, Math.floor(STRIP_SIZE / Math.max(1, groups.length)));
  const items = [];
  if (ratchet.file) {
    const li = document.createElement("li");
    const button = Object.assign(document.createElement("button"), {
      className: "ratchet-pick",
      textContent: "Ratchet",
    });
    button.dataset.ratchet = "1";
    button.setAttribute("aria-label", "Ratchet, with his textures");
    button.addEventListener("click", pickRatchet);
    li.append(button);
    strip.append(li);
  }
  for (const g of groups) {
    const list = state.textures[g.key];
    const n = Math.min(each, list.length);
    for (let i = 0; i < n; i++) items.push({ group: g.key, index: Math.floor((i * list.length) / n) });
  }
  for (const item of items) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.dataset.group = item.group;
    button.dataset.index = String(item.index);
    button.setAttribute("aria-label", `${GROUPS.find((g) => g.key === item.group).name}, texture ${item.index + 1}`);
    button.addEventListener("click", () => pick(item.group, item.index));
    const canvas = document.createElement("canvas");
    button.append(canvas);
    li.append(button);
    strip.append(li);
  }
  showMode();
  // Their pictures, one after another, after the page is up.
  for (const item of items) {
    const texture = state.textures[item.group][item.index];
    try {
      const shown = await decodeForShow(await call("read", { root: texture.root, path: texture.path }));
      const canvas = strip.querySelector(`button[data-group="${item.group}"][data-index="${item.index}"] canvas`);
      if (canvas) paint(canvas, shown, texture.alpha === 1);
    } catch {
      // A picture that cannot be shown leaves its square empty.
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The pack

function showGroups() {
  const box = $("groups");
  box.innerHTML = "";
  for (const g of GROUPS) {
    const n = state.textures[g.key].length;
    const label = document.createElement("label");
    const input = Object.assign(document.createElement("input"), {
      type: "checkbox",
      checked: state.include[g.key] && n > 0,
      disabled: n === 0,
    });
    input.addEventListener("change", () => {
      state.include[g.key] = input.checked;
      settingsChanged();
    });
    const count = Object.assign(document.createElement("span"), { className: "count", textContent: `${n} textures` });
    label.append(input, document.createTextNode(g.name), count);
    box.append(label);
  }
}

function status(text, error = false) {
  const p = $("status");
  p.textContent = text;
  p.classList.toggle("error", error);
}

const settingsKey = () => JSON.stringify(engineValues(state.values, 0, 0));
const presetLabel = () => state.preset || "Custom";

function minutes(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

async function makePack(onlyNew) {
  if (state.making) return;
  const packId = state.info.packId;
  const chosen = GROUPS.filter((g) => state.include[g.key]).flatMap((g) => state.textures[g.key]);
  if (!chosen.length) {
    status("Choose what to put in the pack.", true);
    return;
  }
  const madeKey = `made-${packId}`;
  const before = onlyNew ? await call("storeGet", { key: madeKey }) : null;
  const known = new Set(before?.settings === settingsKey() ? before.names : []);
  if (onlyNew && !known.size) {
    status("No pack was made with these settings yet: making the whole pack.");
  }
  const name = `Nanotech ${presetLabel()} ${packId}${known.size ? " (new)" : ""}`;
  const token = await call("saveStart", { name, extension: "zip" });
  if (!token) return;

  const job = { cancelled: false, token };
  state.making = job;
  $("make").disabled = $("make-new").disabled = true;
  $("cancel").hidden = false;
  const progress = $("progress");
  progress.hidden = false;
  progress.value = 0;

  const zip = new ZipWriter((bytes) => call("saveWrite", { token, bytes: bytes.buffer }));
  let writing = Promise.resolve();
  const names = new Set(known);
  const added = [];
  let done = 0;
  let failed = 0;
  const started = performance.now();
  const total = chosen.length;
  const tick = () => {
    done++;
    progress.value = done / total;
    const left = ((performance.now() - started) / done) * (total - done);
    status(
      `${done} of ${total} textures, ${added.length} in the pack${done > 8 ? `, about ${minutes(left)} left` : ""}…`,
    );
  };

  try {
    await state.pool.everywhere({ kind: "skip", names: [...known] });
    // Effects in the dump that are a level's textures are scaled as the level's: their names first.
    const worldNames = new Set();
    if (state.include.effects && !state.include.world && state.textures.world.some((t) => t.root === "levels")) {
      for (const t of state.textures.world) {
        const bytes = await call("read", { root: t.root, path: t.path });
        const out = await state.pool.run({ kind: "name", png: bytes }, [bytes]);
        if (out.name) worldNames.add(out.name);
      }
    }
    const values = (t) => engineValues(state.values, t.alpha, t.edges);
    const one = async (t) => {
      if (job.cancelled) return;
      if (t.name && (names.has(t.name) || worldNames.has(t.name))) return tick();
      const bytes = await call("read", { root: t.root, path: t.path });
      const out = await state.pool.run(
        { kind: "png", png: bytes, values: values(t), asPng: true, skipKnown: !t.name },
        [bytes],
      );
      if (job.cancelled) return;
      // A dumped texture is named by its file; a level's by the engine, as the port names it.
      const named = t.name ?? out.name;
      if (out.error) failed++;
      else if (!out.skipped && !names.has(named) && !worldNames.has(named)) {
        names.add(named);
        added.push(named);
        writing = writing.then(() => zip.add(`${t.folder}/${named}.png`, out.png));
        await writing;
      }
      tick();
    };
    // As many in flight as there are engines, twice over (reading overlaps scaling).
    let next = 0;
    const lanes = Array.from({ length: state.pool.size * 2 }, async () => {
      while (next < chosen.length && !job.cancelled) await one(chosen[next++]);
    });
    await Promise.all(lanes);
    if (job.cancelled) throw new Error("cancelled");
    if (!added.length) {
      await call("saveEnd", { token, keep: false });
      status(
        known.size ? "Nothing new: every texture is in your last pack already." : "No texture could be made.",
        !known.size,
      );
      return;
    }
    const manifest = {
      format: 1,
      game: packId,
      name: `Nanotech Upscaler ${presetLabel()}`,
      textures: added.length,
      madeWith: `Nanotech Upscaler ${state.info.mod.version}`,
    };
    await writing;
    await zip.add("openrac-texture-pack.json", new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
    await zip.finish();
    const saved = await call("saveEnd", { token, keep: true });
    if (!saved) {
      status("Not saved.");
      return;
    }
    await call("storeSet", { key: madeKey, value: { settings: settingsKey(), names: [...names] } });
    status(
      `Saved ${saved}: ${added.length} textures in ${minutes(performance.now() - started)}${failed ? `, ${failed} could not be read` : ""}. Add it in Texture packs.`,
    );
  } catch (e) {
    state.pool.clear();
    await call("saveEnd", { token, keep: false }).catch(() => undefined);
    status(job.cancelled ? "Stopped: nothing was saved." : `The pack failed: ${e.message}`, !job.cancelled);
  } finally {
    state.making = null;
    $("make").disabled = $("make-new").disabled = false;
    $("cancel").hidden = true;
    progress.hidden = true;
  }
}

function stopMaking() {
  if (!state.making) return;
  state.making.cancelled = true;
  state.pool.clear();
}

// ---------------------------------------------------------------------------------------------

async function start() {
  buildOptions();
  preview.view = compare($("preview"));
  state.info = await call("info");
  state.pool = new Pool(workerCount(state.info.system));

  const [current, presets] = await Promise.all([
    call("storeGet", { key: "current" }).catch(() => null),
    call("storeGet", { key: "presets" }).catch(() => null),
  ]);
  if (Array.isArray(presets)) {
    state.presets = presets
      .filter((p) => typeof p?.name === "string" && p.name.trim())
      .map((p) => ({ name: p.name.trim().slice(0, 40), values: clean(p.values) }));
  }
  if (current?.values) {
    state.values = clean(current.values);
    state.preset = allPresets().some((p) => p.name === current.preset && same(p.values, state.values))
      ? current.preset
      : "";
    for (const g of GROUPS)
      if (typeof current.include?.[g.key] === "boolean") state.include[g.key] = current.include[g.key];
  }
  showValues();
  showPresets();
  void drawOptionPictures();

  const game = { rac1: "Ratchet & Clank", rac2: "Going Commando" }[state.info.game] ?? state.info.game;
  $("game").textContent =
    `${game} (${state.info.version.toUpperCase()})${inLauncher ? "" : " · the page on its own, with sample textures"}`;
  status("Reading the game's textures…");
  state.textures = await collect((done, total) => status(`Reading the levels' models: ${done} of ${total}…`));
  const total = GROUPS.reduce((n, g) => n + state.textures[g.key].length, 0);
  status(
    total ? `${total} textures found.` : "No textures found: play the game once so the launcher reads its levels.",
    !total,
  );
  if (!state.textures.levelsFound && !state.textures.world.length)
    status("The levels were not found: play the game once so the launcher reads them.", true);
  $("dump-hint").hidden = state.textures.interface.length > 0;
  showGroups();
  state.group = GROUPS.find((g) => state.textures[g.key].length)?.key ?? "world";
  ratchet.file = state.textures.ratchet;
  showPicker();
  if (ratchet.file) pickRatchet();
  else pick(state.group, 0);
  void buildStrip();
}

$("preset").addEventListener("change", () => choosePreset($("preset").value));
$("save-preset").addEventListener("click", askName);
$("name-form").addEventListener("submit", (e) => {
  e.preventDefault();
  $("name-form").hidden = true;
  void savePresetAs($("name-input").value);
});
$("name-cancel").addEventListener("click", () => ($("name-form").hidden = true));
$("delete-preset").addEventListener("click", () => void deletePreset());
$("export-preset").addEventListener("click", () => void exportPreset());
$("import-preset").addEventListener("click", () => void importPreset().catch((e) => status(e.message, true)));
$("group").addEventListener("change", () => pick($("group").value, 0));
$("prev").addEventListener("click", () => pick(state.group, state.index - 1));
$("next").addEventListener("click", () => pick(state.group, state.index + 1));
$("ratchet-split").addEventListener("input", () => {
  const v = Number($("ratchet-split").value);
  $("ratchet").style.setProperty("--split", `${v}%`);
  if (ratchet.view) ratchet.view.split = v / 100;
});
$("turn-left").addEventListener("click", () => ratchet.view && (ratchet.view.angle -= 0.5));
$("turn-right").addEventListener("click", () => ratchet.view && (ratchet.view.angle += 0.5));
$("close-up").addEventListener("click", () => {
  if (!ratchet.view) return;
  ratchet.view.close = !ratchet.view.close;
  $("close-up").setAttribute("aria-pressed", String(ratchet.view.close));
});
$("make").addEventListener("click", () => void makePack(false));
$("make-new").addEventListener("click", () => void makePack(true));
$("cancel").addEventListener("click", stopMaking);
setupPad(() => (state.making ? stopMaking() : void call("close")));

start().catch((e) => status(`The page did not start: ${e.message}`, true));
