// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The options the player sets, each explained by a picture (main.js draws it from a sample with
// the option at `contrast` and at its value), the presets that come with the mod, and the values
// the engine takes, in its order (src/engine/upscale.hpp, options_from). Every texture goes
// through a neural network (the Neural engine); xBRZ only shapes the edges of cut-outs.

export const NEURAL = 4;

/** The networks in ui/models (tools/fetch_models.py), by the name of their file. */
export const MODELS = [
  {
    value: 0,
    file: "general",
    name: "General",
    hint: "Real-ESRGAN's general model: clean, crisp edges that keep the painted look. The default.",
  },
  {
    value: 1,
    file: "anime",
    name: "Cartoon",
    hint: "Real-ESRGAN's anime model: flatter colours and bold outlines. Fast; good on the HUD and bright planets.",
  },
  {
    value: 2,
    file: "detailed",
    name: "Detailed",
    hint: "PLKSR-Rep (NTIRE 2026): adds fine grain and wear the original never had. About three times slower.",
  },
];

const GENERAL = (v) => v.model === 0;

export const OPTIONS = [
  {
    key: "model",
    name: "Model",
    type: "choice",
    choices: MODELS,
    default: 0,
    hint: "The network that paints the new pixels.",
    sample: "panel",
    contrast: (v) => (v.model === 0 ? 1 : 0),
  },
  {
    key: "scale",
    name: "Scale",
    type: "choice",
    choices: [
      { value: 2, name: "2×", hint: "Half the size and time of 4×: enough for 1080p." },
      { value: 4, name: "4×", hint: "Sharp at 1440p and 4K." },
    ],
    default: 4,
    hint: "How many times larger each texture gets.",
    sample: "bolt",
    contrast: (v) => (v.scale === 4 ? 2 : 4),
  },
  {
    key: "denoise",
    name: "Noise removal",
    type: "range",
    min: 0,
    max: 100,
    step: 5,
    default: 100,
    unit: "%",
    when: GENERAL,
    hint: "How much grain and dither the model cleans away. Lower keeps more of the PS2's grain.",
    sample: "sky",
    contrast: (v) => (v.denoise > 50 ? 0 : 100),
  },
  {
    key: "strength",
    name: "Model strength",
    type: "range",
    min: 0,
    max: 100,
    step: 5,
    default: 100,
    unit: "%",
    hint: "How much of the model's result is used; the rest is a plain smooth upscale. Lower is softer and closer to the original.",
    sample: "bricks",
    contrast: (v) => (v.strength > 50 ? 0 : 100),
  },
  {
    key: "colourLock",
    name: "Keep original colours",
    type: "range",
    min: 0,
    max: 100,
    step: 5,
    default: 0,
    unit: "%",
    hint: "Puts the texture's own colours back where the model drifted them. Keeps the artists' palette exact.",
    sample: "glow",
    contrast: (v) => (v.colourLock ? 0 : 100),
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
    hint: "Crisps the result (an unsharp mask).",
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
  {
    key: "deposterize",
    name: "Smooth colour steps",
    type: "range",
    min: 0,
    max: 3,
    step: 1,
    default: 0,
    advanced: true,
    hint: "Blends a small palette's visible steps (banding) before the model sees them. Off keeps the exact colours.",
    sample: "sky",
    contrast: (v) => (v.deposterize ? 0 : 3),
  },
  {
    key: "exactAlpha",
    name: "Keep cut-out edges exact",
    type: "bool",
    default: true,
    advanced: true,
    hint: "Leaves, fences and the font keep only the transparency values they had, so they stay crisp and the game draws them as before.",
    sample: "leaf",
    contrast: (v) => !v.exactAlpha,
  },
  {
    key: "tolerance",
    name: "Cut-out edge tolerance",
    type: "range",
    min: 5,
    max: 60,
    step: 1,
    default: 30,
    advanced: true,
    hint: "Cut-out edges are shaped by xBRZ: how different two texels must be to make an edge there.",
    sample: "leaf",
    contrast: (v) => (v.tolerance > 30 ? 5 : 60),
  },
  {
    key: "luminance",
    name: "Cut-out brightness weight",
    type: "range",
    min: 10,
    max: 300,
    step: 10,
    default: 100,
    unit: "%",
    advanced: true,
    hint: "How much brightness counts against hue when xBRZ looks for a cut-out's edges.",
    sample: "lines",
    contrast: (v) => (v.luminance > 100 ? 10 : 300),
  },
  {
    key: "directionBias",
    name: "Cut-out corner rounding",
    type: "range",
    min: 10,
    max: 80,
    step: 1,
    default: 40,
    advanced: true,
    hint: "How readily a cut-out's diagonal corners are rounded. Lower rounds more; higher keeps square corners.",
    sample: "lines",
    contrast: (v) => (v.directionBias > 40 ? 10 : 80),
    format: (n) => (n / 10).toFixed(1),
  },
];

export const DEFAULTS = Object.fromEntries(OPTIONS.map((o) => [o.key, o.default]));

/** The presets that come with the mod (the player's own are kept beside them). */
export const BUILT_IN = [
  { name: "Clean", values: { ...DEFAULTS } },
  { name: "Natural", values: { ...DEFAULTS, denoise: 60, strength: 85, colourLock: 50 } },
  { name: "Sharp", values: { ...DEFAULTS, sharpen: 25, colourLock: 30 } },
  { name: "Cartoon", values: { ...DEFAULTS, model: 1 } },
  { name: "Detailed", values: { ...DEFAULTS, model: 2, colourLock: 40 } },
  { name: "Retro", values: { ...DEFAULTS, strength: 80, original: 30 } },
  { name: "Quick 2×", values: { ...DEFAULTS, scale: 2 } },
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

/** The network file the values use (ui/models/<file>.bin). */
export const modelFile = (v) => (MODELS.find((m) => m.value === v.model) ?? MODELS[0]).file;

/** The engine's values for one texture: its alpha scale (0 full, 1 GS) and edges (0 to 3). */
export function engineValues(v, alpha, edges) {
  return [
    v.scale,
    NEURAL,
    alpha,
    edges,
    v.deposterize,
    v.exactAlpha ? 1 : 0,
    v.tolerance,
    v.luminance,
    v.directionBias,
    v.sharpen,
    v.original,
    v.model === 0 ? v.denoise : 100,
    v.strength,
    v.colourLock,
  ];
}

/** An option's value as the page shows it. */
export function shown(o, v) {
  if (o.type === "bool") return v ? "On" : "Off";
  if (o.type === "choice") return o.choices.find((c) => c.value === v)?.name ?? String(v);
  return `${o.format ? o.format(v) : v}${o.unit ?? ""}`;
}
