#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (c) 2026 Mateusz Kłysz
"""The mod's archive, the one the launcher installs: dist/nanotech-upscaler-<version>.zip.

    tools/package.py <nanotech.wasm> [-o dist]

One folder, nanotech-upscaler-<version>/, with the manifest, the licence, the page (ui/) and the
engine built for it. The same archive serves every system: the page runs in the launcher.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# What the page is made of; anything else in ui/ (an editor's files) stays out.
PAGE_FILES = {".html", ".js", ".css", ".svg", ".png", ".jpg", ".webp", ".json", ".woff2"}
# A fixed time for every entry, so the same files make the same archive.
STAMP = (2026, 1, 1, 0, 0, 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("wasm", type=Path)
    parser.add_argument("-o", "--out", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "openrac-mod.json").read_text(encoding="utf-8"))
    page = manifest["tool"]["page"]
    if not (ROOT / page).is_file():
        print(f"package: the manifest's page {page} is missing", file=sys.stderr)
        return 1
    if not args.wasm.is_file():
        print(f"package: {args.wasm} is missing (build it first)", file=sys.stderr)
        return 1
    files = [(ROOT / "openrac-mod.json", "openrac-mod.json"), (ROOT / "LICENSE", "LICENSE")]
    files += [(ROOT / "THIRD_PARTY.md", "THIRD_PARTY.md")]
    files += sorted(
        (p, p.relative_to(ROOT).as_posix())
        for p in (ROOT / "ui").rglob("*")
        if p.is_file() and p.suffix.lower() in PAGE_FILES
    )
    files.append((args.wasm, "ui/nanotech.wasm"))
    top = f"{manifest['id']}-{manifest['version']}"
    args.out.mkdir(parents=True, exist_ok=True)
    out = args.out / f"{top}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for source, name in files:
            info = zipfile.ZipInfo(f"{top}/{name}", STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, source.read_bytes())
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
