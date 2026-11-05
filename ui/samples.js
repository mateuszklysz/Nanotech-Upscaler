// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// Small textures in the PS2 games' style, drawn here (never taken from a disc), for the page opened
// on its own, outside the launcher. tests/samples.hpp draws most of them for the engine's tests.

function image(width, height, texel) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set(texel(x, y), (y * width + x) * 4);
  }
  return { width, height, rgba };
}

const bolt = (x, y) => {
  // A bolt's hexagon head with a shine, on a transparent ground.
  const dx = Math.abs(x - 11.5),
    dy = Math.abs(y - 11.5);
  const inside = dx * 0.866 + dy * 0.5 < 9 && dy < 9;
  if (!inside) return [255, 0, 255, 0];
  const rim = dx * 0.866 + dy * 0.5 > 7.5 || dy > 7.5;
  const shine = x + y < 14 ? 40 : 0;
  return rim ? [120, 100, 40, 255] : [200 + shine / 2, 170 + shine, 60 + shine, 255];
};

/** Each sample with the alpha scale and edges it would have in the game (upscale.hpp). */
export const SAMPLES = {
  panel: {
    title: "Steel panel",
    alpha: 0,
    edges: 1,
    ...image(32, 32, (x, y) => {
      const step = Math.floor((x + y) / 4) * 8;
      const rivet = ((x % 16) - 4) ** 2 + ((y % 16) - 4) ** 2 <= 2;
      return rivet ? [220, 220, 230, 255] : [60 + step / 2, 70 + step / 2, 90 + step / 2, 255];
    }),
  },
  leaf: {
    title: "Leaf cut-out",
    alpha: 0,
    edges: 0,
    ...image(24, 24, (x, y) => {
      const d = (x - 12) ** 2 * 2 + (y - 12) ** 2;
      if (d < 100) return [40 + y * 4, 140 + x * 3, 30, 255];
      if (d < 130) return [20, 50, 10, 255];
      return [255, 0, 255, 0];
    }),
  },
  glow: {
    title: "Glow (effect)",
    alpha: 1,
    edges: 0,
    ...image(16, 16, (x, y) => {
      const a = 128 - Math.floor((((2 * x - 15) ** 2 + (2 * y - 15) ** 2) * 128) / 450);
      return [255, 200, 80, Math.max(0, a)];
    }),
  },
  lines: {
    title: "Letter strokes (font)",
    alpha: 1,
    edges: 0,
    ...image(16, 16, (x, y) => {
      const on = x === y || x === 15 - y || x === 3 || y === 12;
      return on ? [250, 250, 250, 128] : [0, 0, 0, 0];
    }),
  },
  bricks: {
    title: "Brick wall (tiles)",
    alpha: 0,
    edges: 1,
    ...image(32, 16, (x, y) => {
      const row = Math.floor(y / 8),
        bx = (x + row * 8) % 16;
      const mortar = y % 8 === 0 || bx === 0;
      const tone = (Math.floor((x + row * 8) / 16) * 37 + row * 53) % 40;
      return mortar ? [150, 145, 135, 255] : [150 + tone, 70 + tone / 2, 50, 255];
    }),
  },
  bolt: { title: "Bolt (HUD)", alpha: 0, edges: 0, ...image(24, 24, bolt) },
  sky: {
    title: "Sky (a palette's steps)",
    alpha: 0,
    edges: 1,
    ...image(32, 32, (x, y) => {
      // Bands of a 16-colour gradient with a cloud: the steps a small palette leaves.
      const band = Math.floor((y + Math.floor(x / 8)) / 3);
      const cloud = (x - 20) ** 2 / 3 + (y - 12) ** 2 < 30;
      return cloud ? [235 - band, 235 - band, 240, 255] : [40 + band * 6, 90 + band * 6, 170 + band * 4, 255];
    }),
  },
};
