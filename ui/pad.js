// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The page with a pad (the launcher sends its buttons, bridge.js) or a keyboard: up and down move
// between controls, left and right change a slider or a list (or move on), accept presses,
// prev and next jump between the preview, the settings and the pack, back leaves.
import { onPad } from "./bridge.js";

function focusables() {
  return [...document.querySelectorAll("button, select, input, summary, [tabindex='0']")].filter(
    (el) => !el.disabled && el.offsetParent !== null && !el.closest("[hidden]"),
  );
}

function move(by) {
  const all = focusables();
  if (!all.length) return;
  const at = all.indexOf(document.activeElement);
  const next = all[at < 0 ? 0 : Math.min(all.length - 1, Math.max(0, at + by))];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

function section(by) {
  const sections = [...document.querySelectorAll("[data-section]")];
  const at = sections.findIndex((s) => s.contains(document.activeElement));
  const target = sections[(at + by + sections.length) % sections.length];
  const first = focusables().find((el) => target.contains(el));
  first?.focus();
  first?.scrollIntoView({ block: "nearest" });
}

function change(el, by) {
  if (el instanceof HTMLInputElement && el.type === "range") {
    const step = Number(el.step) || 1;
    el.value = String(
      Math.min(
        Number(el.max),
        Math.max(Number(el.min), Number(el.value) + by * step * (el.max - el.min > 50 && step === 1 ? 5 : 1)),
      ),
    );
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    const options = [...el.options];
    let i = el.selectedIndex;
    do i += by;
    while (i >= 0 && i < options.length && options[i].disabled);
    if (i < 0 || i >= options.length) return true;
    el.selectedIndex = i;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

/** `back()` is what the back button does (stop the pack, or leave the page). */
export function setupPad(back) {
  const press = (button) => {
    const el =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    switch (button) {
      case "up":
        move(-1);
        break;
      case "down":
        move(1);
        break;
      case "left":
      case "right":
        if (!el || !change(el, button === "left" ? -1 : 1)) move(button === "left" ? -1 : 1);
        break;
      case "accept":
        if (el instanceof HTMLInputElement && el.type === "checkbox") el.click();
        else if (el instanceof HTMLButtonElement || el.tagName === "SUMMARY") el.click();
        else if (!el) move(1);
        break;
      case "prev":
        section(-1);
        break;
      case "next":
        section(1);
        break;
      case "back":
        back();
        break;
    }
  };
  onPad((button, down) => {
    if (down) press(button);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      back();
    }
  });
}
