// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The mod's page: one texture before and after, the settings and presets, and the pack.
import { call, inLauncher, onTheme } from "./bridge.js";
import { setupPad } from "./pad.js";
import { Pool, workerCount } from "./pool.js";
import { BUILT_IN, clean, DEFAULTS, engineValues, modelFile, OPTIONS, shown } from "./options.js";
import { Upscaler } from "./upscaler.js";
import { collect } from "./textures.js";
import { applyTheme } from "./theme.js";
import { ZipWriter } from "./zip.js";

const $ = (id) => document.getElementById(id);
const GROUPS = [
  { key: "world", name: "Planets (levels, models, sky)" },
  { key: "interface", name: "HUD, menus and font" },
  { key: "effects", name: "Effects" },
];

const state = {
  info: null,
  pool: null,
  upscaler: null,
  values: { ...DEFAULTS },
  preset: "Clean",
  useGpu: true, // the GPU when there is one; off: the CPU, the same bytes on every system
  more: false, // "More options" open
  presets: [], // the player's own: [{name, values}]
  textures: { world: [], interface: [], effects: [] },
  include: { world: true, interface: true, effects: true },
  group: "world",
  index: 0,
  ready: false, // the textures are listed
  making: null, // the pack being made: {cancelled, token}
};

// ---------------------------------------------------------------------------------------------
// Messages

function status(text, error = false) {
  const p = $("status");
  p.textContent = text;
  p.classList.toggle("error", error);
}

function minutes(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const message = (e) => String(e?.message ?? e);

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

async function decode(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext("2d");
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, rgba: data };
}

/** The before-and-after box: the original left of the line, the upscaled right; their captions
 *  under it. */
function compare(root) {
  const make = (tag, props) => Object.assign(document.createElement(tag), props);
  const before = make("canvas", { className: "before" });
  const after = make("canvas", { className: "after", hidden: true });
  const line = make("div", { className: "line" });
  const range = make("input", { type: "range", min: 0, max: 100, value: 50 });
  range.setAttribute("aria-label", "Move the line between the original and the upscaled");
  range.addEventListener("input", () => root.style.setProperty("--split", `${range.value}%`));
  root.append(before, after, line, range);
  return { before, after, left: $("before-label"), right: $("after-label") };
}

// ---------------------------------------------------------------------------------------------
// The settings

const optionViews = new Map();

function buildOptions() {
  for (const o of OPTIONS) {
    const card = Object.assign(document.createElement("div"), { className: "option" });
    const id = `option-${o.key}`;
    let input;
    let value = null;
    if (o.type === "bool") {
      const label = document.createElement("label");
      input = Object.assign(document.createElement("input"), { type: "checkbox", id });
      input.addEventListener("change", () => setValue(o.key, input.checked));
      label.append(input, document.createTextNode(o.name));
      card.append(label);
    } else {
      const head = Object.assign(document.createElement("div"), { className: "head" });
      const name = Object.assign(document.createElement("label"), { htmlFor: id, textContent: o.name });
      value = Object.assign(document.createElement("span"), { className: "value" });
      head.append(name, value);
      if (o.type === "range") {
        input = Object.assign(document.createElement("input"), { type: "range", min: o.min, max: o.max, step: o.step });
        input.addEventListener("input", () => setValue(o.key, Number(input.value)));
      } else {
        input = document.createElement("select");
        for (const c of o.choices) input.append(new Option(c.name, String(c.value)));
        input.addEventListener("change", () => setValue(o.key, Number(input.value)));
      }
      input.id = id;
      card.append(head, input);
    }
    const about = Object.assign(document.createElement("p"), { className: "about" });
    card.append(about);
    $(o.advanced ? "options-more" : "options").append(card);
    optionViews.set(o.key, { card, input, value, about });
  }
}

function showValues() {
  for (const o of OPTIONS) {
    const { card, input, value, about } = optionViews.get(o.key);
    const v = state.values[o.key];
    if (o.type === "bool") input.checked = v;
    else input.value = String(v);
    if (value) value.textContent = o.type === "choice" ? "" : shown(o, v);
    card.hidden = o.when ? !o.when(state.values) : false;
    const choiceHint = o.type === "choice" ? o.choices.find((c) => c.value === v)?.hint : "";
    about.textContent = choiceHint || o.hint;
  }
  $("more").open = state.more;
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
function settingsChanged({ redraw = true } = {}) {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    call("storeSet", {
      key: "current",
      value: {
        preset: state.preset,
        values: state.values,
        include: state.include,
        useGpu: state.useGpu,
        more: state.more,
      },
    }).catch(() => undefined); // not kept: the page starts from the defaults next time
    if (redraw) upscalePreview();
  }, 200);
}

/** One texture upscaled with `values`, on the GPU or the CPU. */
async function upscale(job, values, { useGpu = state.useGpu, urgent = false, transfer = [] } = {}) {
  const failedBefore = state.upscaler.gpuFailed;
  try {
    return await state.upscaler.run({ ...job, model: modelFile(values) }, { useGpu, urgent, transfer });
  } finally {
    if (state.upscaler.gpuFailed !== failedBefore) {
      showDevice();
      if (!state.making) status(`The graphics card stopped (${state.upscaler.gpuFailed}): the processor took over.`);
    }
  }
}

function showDevice() {
  const gpu = state.upscaler?.gpu;
  const failed = state.upscaler?.gpuFailed;
  $("use-gpu").checked = state.useGpu && !!gpu && !failed;
  $("use-gpu").disabled = !gpu || !!failed;
  $("device-note").textContent = !gpu
    ? "This device has no graphics card the page can use: the processor makes the textures (slower)."
    : failed
      ? `The graphics card stopped (${failed}): the processor makes the textures (slower).`
      : state.useGpu
        ? "Fast. Off: the processor, slower, with the same bytes on every device."
        : "Off: the processor makes the textures, slower, with the same bytes on every device.";
}

// ---------------------------------------------------------------------------------------------
// Presets

const allPresets = () => [...BUILT_IN, ...state.presets];
const isBuiltIn = (name) => BUILT_IN.some((p) => p.name.toLowerCase() === name.toLowerCase());

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

/** Keeps the player's presets; false (and says why) when the launcher could not. */
async function savePresets() {
  try {
    await call("storeSet", { key: "presets", value: state.presets });
    return true;
  } catch (e) {
    status(`The presets could not be kept: ${message(e)}`, true);
    return false;
  }
}

function askName() {
  $("name-form").hidden = false;
  $("name-input").value = state.preset && !isBuiltIn(state.preset) ? state.preset : "";
  $("name-input").focus();
}

async function savePresetAs(name) {
  name = name.trim().slice(0, 40);
  if (!name) return;
  if (isBuiltIn(name)) {
    status(`"${name}" is one of the mod's presets: pick another name.`, true);
    return;
  }
  state.presets = [...state.presets.filter((p) => p.name !== name), { name, values: { ...state.values } }];
  state.preset = name;
  showPresets();
  settingsChanged({ redraw: false });
  if (await savePresets()) status(`Saved the preset "${name}".`);
}

async function deletePreset() {
  const name = state.preset;
  state.presets = state.presets.filter((p) => p.name !== name);
  state.preset = "";
  showPresets();
  settingsChanged({ redraw: false });
  if (await savePresets()) status(`Deleted the preset "${name}".`);
}

async function exportPreset() {
  const name = state.preset || "Custom";
  const preset = { format: 1, mod: "nanotech-upscaler", version: state.info.mod.version, name, values: state.values };
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
    String(preset.name ?? "")
      .trim()
      .slice(0, 40) || "Imported";
  if (isBuiltIn(name)) name = `${name.slice(0, 29)} (imported)`;
  state.presets = [...state.presets.filter((p) => p.name !== name), { name, values: clean(preset.values) }];
  choosePreset(name);
  if (await savePresets()) status(`Imported the preset "${name}".`);
}

// ---------------------------------------------------------------------------------------------
// The preview: one texture, before and after

const preview = { view: null, round: 0, running: false, again: false };

const currentTexture = () => state.textures[state.group]?.[state.index] ?? null;

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
  const n = state.textures[state.group].length;
  $("which").textContent = n ? `${state.index + 1} / ${n}` : "none";
  $("group").disabled = !n;
  $("prev").disabled = $("next").disabled = n < 2;
}

function pick(group, index) {
  const list = state.textures[group];
  if (!list?.length) return;
  state.group = group;
  state.index = ((index % list.length) + list.length) % list.length;
  showPicker();
  void showOriginal();
  upscalePreview();
}

// The original at once; the upscaled one after it, when it is made.
async function showOriginal() {
  const texture = currentTexture();
  const { before, after, left, right } = preview.view;
  const round = ++preview.round;
  after.hidden = true;
  right.textContent = "";
  if (!texture) return;
  try {
    const shown = await decode(await call("read", { root: texture.root, path: texture.path }));
    if (round !== preview.round) return;
    paint(before, shown, texture.alpha === 1);
    $("preview").style.setProperty("--ratio", String(shown.width / shown.height));
    left.textContent = `Original ${shown.width}×${shown.height}`;
  } catch (e) {
    if (round === preview.round) left.textContent = `Cannot be read (${message(e)})`;
  }
}

// One upscale at a time: a change while one runs makes the latest again once it ends, so moving a
// slider quickly does not queue a texture for every step.
function upscalePreview() {
  if (preview.running) {
    preview.again = true;
    return;
  }
  preview.running = true;
  void (async () => {
    try {
      do {
        preview.again = false;
        await upscaleOnce();
      } while (preview.again);
    } finally {
      preview.running = false;
    }
  })();
}

async function upscaleOnce() {
  const texture = currentTexture();
  if (!texture) return;
  const round = preview.round;
  const values = { ...state.values };
  const { after, right } = preview.view;
  right.textContent = "Upscaling…";
  try {
    const bytes = await call("read", { root: texture.root, path: texture.path });
    const out = await upscale(
      {
        kind: "png",
        png: bytes,
        values: engineValues(values, texture.alpha, texture.edges),
        asPng: false,
        keepRgba: true,
      },
      values,
      { urgent: true, transfer: [bytes] },
    );
    if (round !== preview.round || preview.again) return;
    if (out.error) {
      right.textContent = out.error === "too-large" ? "Too large at this scale" : "Cannot be upscaled";
      return;
    }
    paint(after, out, texture.alpha === 1);
    after.hidden = false;
    right.textContent = `${values.scale}× ${out.width}×${out.height}`;
  } catch (e) {
    if (round === preview.round) right.textContent = "Failed";
    if (!state.making) status(`The preview failed: ${message(e)}`, true);
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
      disabled: n === 0 || !!state.making,
    });
    input.dataset.count = String(n);
    input.addEventListener("change", () => {
      state.include[g.key] = input.checked;
      settingsChanged({ redraw: false });
      showButtons();
    });
    const count = Object.assign(document.createElement("span"), { className: "count", textContent: String(n) });
    label.append(input, document.createTextNode(g.name), count);
    box.append(label);
  }
}

const chosenTextures = () => GROUPS.filter((g) => state.include[g.key]).flatMap((g) => state.textures[g.key]);

function showButtons() {
  const making = !!state.making;
  const can = state.ready && !making && chosenTextures().length > 0;
  $("make").disabled = $("make-new").disabled = !can;
  $("make").hidden = $("make-new").hidden = making;
  $("cancel").hidden = !making;
  for (const input of $("groups").querySelectorAll("input")) input.disabled = making || input.dataset.count === "0";
}

const settingsKey = (values) => JSON.stringify([modelFile(values), ...engineValues(values, 0, 0)]);

async function makePack(onlyNew) {
  if (state.making || !state.ready) return;
  const chosen = chosenTextures();
  if (!chosen.length) {
    status("Choose what goes in the pack.", true);
    return;
  }
  // The settings as they are now: changing them while the pack is made changes only the preview.
  const values = { ...state.values };
  const useGpu = state.useGpu;
  const presetName = state.preset || "Custom";
  const packId = state.info.packId;
  const job = { cancelled: false, token: null };
  state.making = job;
  showButtons();
  const progress = $("progress");
  progress.value = 0;
  progress.hidden = false;

  const total = chosen.length;
  const started = performance.now();
  let phase = "Starting…";
  let done = 0;
  let failed = 0;
  let firstError = "";
  const added = [];
  // Every second too, so a slow first texture still shows the page is working.
  const report = () => {
    if (job.cancelled) return;
    const took = performance.now() - started;
    if (!done) {
      status(`${phase} ${minutes(took)}`);
      return;
    }
    const left = (took / done) * (total - done);
    const cpu = useGpu && state.upscaler.gpuFailed ? " (on the processor: the graphics card stopped)" : "";
    status(
      `${done} of ${total} textures, ${added.length} in the pack${done >= 8 ? `, about ${minutes(left)} left` : ""}${cpu}`,
    );
  };
  const timer = setInterval(report, 1000);
  report();
  const tick = () => {
    done++;
    progress.value = done / total;
    report();
  };

  const madeKey = `made-${packId}`;
  try {
    const before = onlyNew ? await call("storeGet", { key: madeKey }).catch(() => null) : null;
    const known = new Set(before?.settings === settingsKey(values) && Array.isArray(before.names) ? before.names : []);
    const name = `Nanotech ${presetName} ${packId}${known.size ? " (new)" : ""}`;
    job.token = await call("saveStart", { name, extension: "zip" });
    if (!job.token || job.cancelled) throw new Error("cancelled");
    const token = job.token;
    const zip = new ZipWriter((bytes) => call("saveWrite", { token, bytes: bytes.buffer }));
    let writing = Promise.resolve();
    const names = new Set(known);

    await state.pool.everywhere({ kind: "skip", names: [...known] });
    // Effects in the dump that are a level's textures are scaled as the level's: their names first.
    const worldNames = new Set();
    if (state.include.effects && !state.include.world && state.textures.world.some((t) => t.root === "levels")) {
      let n = 0;
      for (const t of state.textures.world) {
        if (job.cancelled) throw new Error("cancelled");
        phase = `Checking the planets' textures (${++n} of ${state.textures.world.length})…`;
        try {
          const bytes = await call("read", { root: t.root, path: t.path });
          const out = await state.pool.run({ kind: "name", png: bytes }, [bytes]);
          if (out.name) worldNames.add(out.name);
        } catch {
          // Not readable: an effect with its name is then scaled as an effect.
        }
      }
    }
    phase =
      onlyNew && !known.size
        ? "No pack was made with these settings yet: making it whole…"
        : "Making the first texture…";

    const one = async (t) => {
      if (t.name && (names.has(t.name) || worldNames.has(t.name))) return tick();
      let out;
      try {
        const bytes = await call("read", { root: t.root, path: t.path });
        out = await upscale(
          { kind: "png", png: bytes, values: engineValues(values, t.alpha, t.edges), asPng: true, skipKnown: !t.name },
          values,
          { useGpu, transfer: [bytes] },
        );
      } catch (e) {
        if (job.cancelled) return;
        // Gone since the list was made (the game dumped over it), or the engine failed on it: the
        // rest of the pack goes on.
        failed++;
        firstError ||= message(e);
        return tick();
      }
      if (job.cancelled) return;
      // A dumped texture is named by its file; a level's by the engine, as the port names it.
      const named = t.name ?? out.name;
      if (out.error) {
        failed++;
        firstError ||= out.error;
      } else if (!out.skipped && !names.has(named) && !worldNames.has(named)) {
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
    await writing;
    if (!added.length) {
      await call("saveEnd", { token, keep: false });
      if (known.size && !failed) status("Nothing new: every texture is in your last pack already.");
      else status(`No texture could be made${firstError ? ` (${firstError})` : ""}.`, true);
      return;
    }
    const manifest = {
      format: 1,
      game: packId,
      name: `Nanotech Upscaler ${presetName}`,
      textures: added.length,
      madeWith: `Nanotech Upscaler ${state.info.mod.version}`,
    };
    await zip.add("openrac-texture-pack.json", new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
    await zip.finish();
    const saved = await call("saveEnd", { token, keep: true });
    if (!saved) {
      status("The pack was not saved.", true);
      return;
    }
    // Only for "Only new" next time: the pack is saved even if this cannot be kept.
    await call("storeSet", { key: madeKey, value: { settings: settingsKey(values), names: [...names] } }).catch(
      () => undefined,
    );
    const skipped = failed ? `; ${failed} could not be made (${firstError})` : "";
    status(
      `Saved ${saved}: ${added.length} textures in ${minutes(performance.now() - started)}${skipped}. Add it in Texture packs.`,
      failed > 0,
    );
  } catch (e) {
    const stopped = job.cancelled || message(e) === "cancelled";
    job.cancelled = true; // the other lanes stop too
    state.pool.clear();
    if (job.token) await call("saveEnd", { token: job.token, keep: false }).catch(() => undefined);
    status(stopped ? "Stopped: nothing was saved." : `The pack failed: ${message(e)}`, !stopped);
  } finally {
    clearInterval(timer);
    state.making = null;
    progress.hidden = true;
    showButtons();
  }
}

function stopMaking() {
  if (!state.making) return;
  state.making.cancelled = true;
  state.pool.clear();
  status("Stopping…");
}

// ---------------------------------------------------------------------------------------------

async function start() {
  status("Starting…");
  buildOptions();
  preview.view = compare($("preview"));
  state.info = await call("info");
  applyTheme(state.info.theme);
  state.pool = new Pool(workerCount(state.info.system));
  state.upscaler = new Upscaler(state.pool);

  const [current, presets] = await Promise.all([
    call("storeGet", { key: "current" }).catch(() => null),
    call("storeGet", { key: "presets" }).catch(() => null),
  ]);
  if (Array.isArray(presets)) {
    const seen = new Set();
    for (const p of presets) {
      const name = typeof p?.name === "string" ? p.name.trim().slice(0, 40) : "";
      if (!name || isBuiltIn(name) || seen.has(name)) continue;
      seen.add(name);
      state.presets.push({ name, values: clean(p.values) });
    }
  }
  if (current && typeof current === "object") {
    if (current.values) state.values = clean(current.values);
    const preset = allPresets().find((p) => p.name === current.preset);
    state.preset = preset && same(preset.values, state.values) ? preset.name : current.values ? "" : "Clean";
    for (const g of GROUPS)
      if (typeof current.include?.[g.key] === "boolean") state.include[g.key] = current.include[g.key];
    if (typeof current.useGpu === "boolean") state.useGpu = current.useGpu;
    if (typeof current.more === "boolean") state.more = current.more;
  }
  showValues();
  showPresets();

  const game = { rac1: "Ratchet & Clank", rac2: "Going Commando" }[state.info.game] ?? state.info.game;
  $("game").textContent =
    `${game} (${String(state.info.version).toUpperCase()})${inLauncher ? "" : ", the page on its own with sample textures"}`;
  status("Reading the game's textures…");
  const [textures] = await Promise.all([
    collect((done, total) => status(`Reading the levels: ${done} of ${total}…`)),
    state.upscaler.ready,
  ]);
  state.textures = textures;
  showDevice();
  showGroups();
  $("dump-hint").hidden = textures.interface.length > 0;
  const total = GROUPS.reduce((n, g) => n + textures[g.key].length, 0);
  if (!textures.levelsFound && !textures.world.length)
    status("The levels were not found: play the game once so the launcher reads them.", true);
  else status(`${total} textures found. Pick the settings, then make the pack.`);
  state.ready = total > 0;
  showButtons();
  state.group = GROUPS.find((g) => textures[g.key].length)?.key ?? "world";
  showPicker();
  pick(state.group, 0);
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
$("export-preset").addEventListener("click", () => exportPreset().catch((e) => status(message(e), true)));
$("import-preset").addEventListener("click", () => importPreset().catch((e) => status(message(e), true)));
$("group").addEventListener("change", () => pick($("group").value, 0));
$("prev").addEventListener("click", () => pick(state.group, state.index - 1));
$("next").addEventListener("click", () => pick(state.group, state.index + 1));
$("more").addEventListener("toggle", () => {
  if (state.more === $("more").open) return;
  state.more = $("more").open;
  settingsChanged({ redraw: false });
});
$("use-gpu").addEventListener("change", () => {
  state.useGpu = $("use-gpu").checked;
  showDevice();
  settingsChanged();
});
$("make").addEventListener("click", () => void makePack(false));
$("make-new").addEventListener("click", () => void makePack(true));
$("cancel").addEventListener("click", stopMaking);
onTheme(applyTheme);
setupPad(() => (state.making ? stopMaking() : void call("close")));

start().catch((e) => status(`The page did not start: ${message(e)}`, true));
