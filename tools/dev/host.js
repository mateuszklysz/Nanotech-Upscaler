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
