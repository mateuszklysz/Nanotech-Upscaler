// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The launcher's colours on the page: its theme and the picked game's accent, as the launcher sends
// them (info.theme, then a "theme" event when they change). Only these tokens, and only values
// that are colours or lengths, are taken.

const COLOURS = [
  "--ink",
  "--ink-deep",
  "--panel",
  "--panel-hi",
  "--brand",
  "--amber",
  "--gold",
  "--soft",
  "--dim",
  "--line",
  "--line-strong",
  "--text",
  "--body",
  "--warn",
  "--err",
  "--bar-top",
  "--bar-bottom",
  "--bar-ink-deep",
];
const LENGTHS = ["--radius", "--radius-sm"];

const fits = (v, kind) => typeof v === "string" && v.length <= 64 && CSS.supports(kind, v);

/** Puts `theme` ({"--ink": "#181820", ...}) on the page; anything else in it is left out. */
export function applyTheme(theme) {
  if (typeof theme !== "object" || theme === null) return;
  const root = document.documentElement.style;
  for (const name of COLOURS) if (fits(theme[name], "color")) root.setProperty(name, theme[name]);
  for (const name of LENGTHS) if (fits(theme[name], "width")) root.setProperty(name, theme[name]);
}
