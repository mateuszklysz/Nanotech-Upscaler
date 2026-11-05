// SPDX-License-Identifier: GPL-3.0-or-later
// Answers the page's calls as the launcher does (launcher/src/lib/modTool.ts), from serve.mjs.
const frame = document.getElementById("page");
// The mod's store, kept in the browser like the launcher keeps it on disk (a reload keeps it).
const store = {
  get: (key) => {
    try {
      return JSON.parse(localStorage.getItem(`nanotech:${key}`));
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(`nanotech:${key}`, JSON.stringify(value));
    } catch {
      // A browser that keeps nothing: the page starts fresh.
    }
  },
};
// The launcher's colours (info.theme, then "theme" events): its own, and a theme with an accent.
const THEMES = [
  {
    "--ink": "#181820",
    "--ink-deep": "#12121a",
    "--panel": "#1d1d28",
    "--panel-hi": "#22222f",
    "--text": "#e8f0ff",
    "--body": "#c3cdea",
    "--dim": "#8f9ac4",
    "--line": "rgb(156 161 212 / 0.22)",
    "--line-strong": "rgb(156 161 212 / 0.35)",
    "--amber": "#ffb443",
    "--brand": "#d58a00",
    "--bar-top": "#e5a013",
    "--bar-bottom": "#cd8300",
    "--bar-ink-deep": "#1b1206",
  },
  {
    "--ink": "#282828",
    "--ink-deep": "#1d2021",
    "--panel": "#32302f",
    "--panel-hi": "#3c3836",
    "--text": "#fbf1c7",
    "--body": "#ebdbb2",
    "--dim": "#a89984",
    "--line": "rgb(168 153 132 / 0.22)",
    "--line-strong": "rgb(168 153 132 / 0.36)",
    "--amber": "#7fcff5",
    "--brand": "#43a3de",
    "--bar-top": "#7fcdf5",
    "--bar-bottom": "#43a3de",
    "--bar-ink-deep": "#03141f",
  },
];
let theme = 0;
const saving = new Map();
let token = 0;

function download(name, parts) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(parts)), download: name });
  a.click();
}

async function answer(call, args) {
  switch (call) {
    case "info":
      return {
        game: "rac1",
        version: "ntsc",
        packId: "rac1-ntsc",
        system: "desktop",
        mod: { id: "nanotech-upscaler", name: "Nanotech Upscaler", version: "dev" },
        theme: THEMES[theme],
      };
    case "list":
      return (await fetch(`/api/list?root=${args.root}`)).json();
    case "read": {
      const part = args.length === undefined ? "" : `&start=${args.start ?? 0}&length=${args.length}`;
      const r = await fetch(`/api/read?root=${args.root}&path=${encodeURIComponent(args.path)}${part}`);
      if (!r.ok) throw new Error(await r.text());
      return r.arrayBuffer();
    }
    case "storeGet":
      return store.get(args.key) ?? null;
    case "storeSet":
      store.set(args.key, args.value);
      return null;
    case "save":
      download(`${args.name}.${args.extension}`, [args.bytes]);
      return `${args.name}.${args.extension}`;
    case "saveStart": {
      const name = `${args.name}.${args.extension}`;
      saving.set(++token, name);
      await fetch(`/api/save?start=1&name=${encodeURIComponent(name)}`, { method: "POST" });
      return token;
    }
    case "saveWrite":
      await fetch(`/api/save?name=${encodeURIComponent(saving.get(args.token))}`, { method: "POST", body: args.bytes });
      return null;
    case "saveEnd": {
      const name = saving.get(args.token);
      saving.delete(args.token);
      const drop = args.keep ? "" : "&drop=1";
      return (
        (await (await fetch(`/api/save?name=${encodeURIComponent(name)}${drop}`, { method: "POST" })).text()) &&
        (args.keep ? name : "")
      );
    }
    case "open":
      return null;
    case "close":
      document.getElementById("said").textContent = "closed";
      return null;
    default:
      throw new Error(`no call ${call}`);
  }
}

window.addEventListener("message", async (e) => {
  if (e.source !== frame.contentWindow || e.data?.openrac !== 1 || "ok" in e.data) return;
  const { id, call, args } = e.data;
  try {
    const value = await answer(call, args ?? {});
    frame.contentWindow.postMessage(
      { openrac: 1, id, ok: true, value },
      "*",
      value instanceof ArrayBuffer ? [value] : [],
    );
  } catch (err) {
    frame.contentWindow.postMessage({ openrac: 1, id, ok: false, error: String(err.message ?? err) }, "*");
  }
});

for (const b of document.querySelectorAll("[data-pad]")) {
  b.addEventListener("click", () => {
    frame.contentWindow.postMessage({ openrac: 1, event: "pad", button: b.dataset.pad, down: true }, "*");
    frame.contentWindow.postMessage({ openrac: 1, event: "pad", button: b.dataset.pad, down: false }, "*");
  });
}

document.getElementById("theme").addEventListener("click", () => {
  theme = (theme + 1) % THEMES.length;
  frame.contentWindow.postMessage({ openrac: 1, event: "theme", theme: THEMES[theme] }, "*");
});
