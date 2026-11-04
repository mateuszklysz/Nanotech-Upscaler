// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The options the player sets, each explained by a picture (main.js draws it from a sample with
// the option at `contrast` and at its value), the presets that come with the mod, and the values
// the engine takes, in its order (src/engine/upscale.hpp, options_from).

export const ENGINES = [
  { value: 0, name: "xBRZ", hint: "Rounds the game's hard pixel edges and keeps them sharp. The PS2 look, larger." },
  {
    value: 1,
    name: "Hybrid",
    hint: "xBRZ on edges, a smooth curve between them: softer on photo-like textures (rock, sky).",
  },
  { value: 2, name: "Smooth", hint: "A smooth curve only (bicubic): soft, no new edges." },
  { value: 3, name: "Nearest", hint: "Every texel a square: the original as it is, larger." },
];

const XBRZ = (v) => v.engine <= 1;

export const OPTIONS = [
  {
    key: "scale",
    name: "Scale",
    type: "range",
    min: 2,
    max: 6,
    step: 1,
    default: 4,
    unit: "×",
    hint: "How many times larger each texture gets. 4× is enough for 4K; 6× makes big packs.",
    sample: "bolt",
    contrast: () => 2,
  },
  {
    key: "engine",
    name: "Engine",
    type: "choice",
    choices: ENGINES,
    default: 0,
    hint: "How the new pixels are made.",
    sample: "leaf",
    contrast: () => 3,
  },
  {
    key: "deposterize",
    name: "Smooth colour steps",
    type: "range",
    min: 0,
    max: 3,
    step: 1,
    default: 0,
    hint: "Blends a small palette's visible steps (banding) before scaling. Off keeps the texture's exact colours.",
    sample: "sky",
    contrast: (v) => (v.deposterize ? 0 : 3),
  },
  {
    key: "exactAlpha",
    name: "Keep cut-out edges exact",
    type: "bool",
    default: true,
    hint: "Leaves, fences and the font keep only the transparency values they had, so they stay crisp and the game draws them as before.",
    sample: "leaf",
    contrast: (v) => !v.exactAlpha,
    engineFor: () => 2,
  },
  {
    key: "tolerance",
    name: "Edge tolerance",
    type: "range",
    min: 5,
    max: 60,
    step: 1,
    default: 30,
    when: XBRZ,
    hint: "How different two colours must be to make an edge. Lower finds more edges; higher only the strong ones.",
    sample: "bricks",
    contrast: (v) => (v.tolerance > 30 ? 5 : 60),
  },
  {
    key: "luminance",
    name: "Brightness weight",
    type: "range",
    min: 10,
    max: 300,
    step: 10,
    default: 100,
    unit: "%",
    when: XBRZ,
    hint: "How much brightness counts against hue when looking for edges.",
    sample: "sky",
    contrast: (v) => (v.luminance > 100 ? 10 : 300),
  },
  {
    key: "directionBias",
    name: "Corner rounding",
    type: "range",
    min: 10,
    max: 80,
    step: 1,
    default: 40,
    when: XBRZ,
    hint: "How readily diagonal corners are rounded. Lower rounds more; higher keeps more square corners.",
    sample: "lines",
    contrast: (v) => (v.directionBias > 40 ? 10 : 80),
    format: (n) => (n / 10).toFixed(1),
  },
  {
    key: "sharpen",
    name: "Sharpen",
    type: "range",
    min: 0,
    max: 100,
    step: 5,
    default: 0,
    unit: "%",
    hint: "Crisps the result (an unsharp mask). A little helps Smooth and Hybrid.",
    sample: "bricks",
    contrast: (v) => (v.sharpen ? 0 : 60),
  },
  {
    key: "original",
    name: "Original pixels",
    type: "range",
    min: 0,
    max: 100,
    step: 5,
    default: 0,
    unit: "%",
    hint: "Mixes the original's square pixels back in, for a more retro look.",
    sample: "bolt",
    contrast: (v) => (v.original ? 0 : 50),
  },
];

export const DEFAULTS = Object.fromEntries(OPTIONS.map((o) => [o.key, o.default]));

/** The presets that come with the mod (the player's own are kept beside them). */
export const BUILT_IN = [
  { name: "Faithful", values: { ...DEFAULTS } },
  { name: "Sharp", values: { ...DEFAULTS, tolerance: 20, sharpen: 30 } },
  { name: "Soft", values: { ...DEFAULTS, engine: 1, deposterize: 1, sharpen: 15 } },
  { name: "Retro", values: { ...DEFAULTS, original: 35 } },
  { name: "Pixels", values: { ...DEFAULTS, engine: 3 } },
];

/** `values` with every option there and in its range; unknown keys left out. */
export function clean(values) {
  const out = {};
  for (const o of OPTIONS) {
    let v = values?.[o.key];
    if (o.type === "bool") v = typeof v === "boolean" ? v : o.default;
    else if (o.type === "choice") v = o.choices.some((c) => c.value === v) ? v : o.default;
    else v = Number.isFinite(v) ? Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step)) : o.default;
    out[o.key] = v;
  }
  return out;
}

/** The engine's values for one texture: its alpha scale (0 full, 1 GS) and edges (0 to 3). */
export function engineValues(v, alpha, edges) {
  return [
    v.scale,
    v.engine,
    alpha,
    edges,
    v.deposterize,
    v.exactAlpha ? 1 : 0,
    v.tolerance,
    v.luminance,
    v.directionBias,
    v.sharpen,
    v.original,
  ];
}

/** An option's value as the page shows it. */
export function shown(o, v) {
  if (o.type === "bool") return v ? "On" : "Off";
  if (o.type === "choice") return o.choices.find((c) => c.value === v)?.name ?? String(v);
  return `${o.format ? o.format(v) : v}${o.unit ?? ""}`;
}
