// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The page as the launcher shows it, on your own computer: host.html frames ui/index.html and
// answers its calls the way the launcher does, from your extracted levels and texture dump.
//
//   node tools/dev/serve.mjs --levels <assets/port/rac1/ntsc> [--dump <texture_dumps/rac1-ntsc>] [--port 8766]
//
// then open http://localhost:8766/. Copy build-wasm/nanotech.wasm to ui/ first. Packs it makes
// are written to --out (dist/dev by default).
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, normalize, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ui = resolve(here, "../../ui");
const roots = { levels: args.levels && resolve(args.levels), dump: args.dump && resolve(args.dump) };
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".png": "image/png",
};
const out = resolve(args.out ?? resolve(here, "../../dist/dev"));
const READABLE = /\.(png|gif|glb|gltf|bin|json|txt)$/i;

function inside(root, rel) {
  const path = resolve(root, normalize(rel));
  if (path !== root && !path.startsWith(root + sep)) throw new Error("outside");
  return path;
}

async function list(root, at = "", out = []) {
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = at ? `${at}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await list(root, rel, out);
    else if (entry.isFile() && READABLE.test(entry.name))
      out.push({ path: rel, size: (await stat(join(root, rel))).size });
  }
  return out;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/save") {
      // The pack, part by part: ?name= to start it (empty), then each part appended.
      const name = url.searchParams.get("name").replace(/[^\w .-]/g, "_");
      await mkdir(out, { recursive: true });
      const file = join(out, name);
      const body = [];
      for await (const chunk of req) body.push(chunk);
      if (url.searchParams.get("start")) await writeFile(file, "");
      else if (url.searchParams.get("drop")) await rm(file, { force: true });
      else await appendFile(file, Buffer.concat(body));
      res.end(file);
    } else if (url.pathname === "/api/list") {
      const root = roots[url.searchParams.get("root")];
      res.end(JSON.stringify(root ? await list(root) : []));
    } else if (url.pathname === "/api/read") {
      const root = roots[url.searchParams.get("root")];
      const bytes = await readFile(inside(root, url.searchParams.get("path")));
      const start = Number(url.searchParams.get("start") ?? 0);
      const length = url.searchParams.has("length") ? Number(url.searchParams.get("length")) : bytes.length;
      res.end(bytes.subarray(start, start + length));
    } else {
      const rel = url.pathname === "/" ? "host.html" : url.pathname.slice(1);
      const file = rel.startsWith("ui/") ? inside(ui, rel.slice(3)) : inside(here, rel);
      res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
      res.end(await readFile(file));
    }
  } catch (e) {
    res.statusCode = 404;
    res.end(String(e.message));
  }
}).listen(Number(args.port ?? 8766), () => console.log(`http://localhost:${args.port ?? 8766}/`));
