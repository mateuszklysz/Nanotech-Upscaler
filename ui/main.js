// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The mod's page (its content policy runs no inline script).
import { loadEngine } from "./engine.js";

const status = document.getElementById("status");
loadEngine(new URL("nanotech.wasm", import.meta.url))
  .then(() => {
    status.textContent = "The engine is ready.";
  })
  .catch((e) => {
    status.textContent = `The engine did not load: ${e}`;
  });
