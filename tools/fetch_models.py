#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (c) 2026 Mateusz Kłysz
"""The page's networks, fetched from where their authors publish them and converted:
ui/models/{general,anime,detailed}.bin.

    tools/fetch_models.py [--out ui/models] [--cache DIR] [--only general]

Each download is checked against its SHA-256 below before it is read. The weights are not in git:
CI fetches them for the mod's archive (THIRD_PARTY.md lists their licences). Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REAL_ESRGAN = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/"
# The NTIRE 2026 Mobile Real-World SR challenge's model zoo (github.com/jiatongli2024/
# NTIRE2026_Mobile_RealWorld_ImageSR): team VIPSL's PLKSR-Rep.
DRIVE = "https://drive.usercontent.google.com/download?export=download&confirm=t&id="

FILES = {
    "realesr-general-x4v3.pth": (
        REAL_ESRGAN + "realesr-general-x4v3.pth",
        "8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292",
    ),
    "realesr-general-wdn-x4v3.pth": (
        REAL_ESRGAN + "realesr-general-wdn-x4v3.pth",
        "1641f8c4464b9f097c9fdda5589273713f67cf59f3d909e0bd688f0cee269dca",
    ),
    "realesr-animevideov3.pth": (
        REAL_ESRGAN + "realesr-animevideov3.pth",
        "b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d",
    ),
    "vipsl-plksr-rep.pth": (
        DRIVE + "1sfCu9c7Rr6legy6ShxwaxgNMgt0W3VJa",
        "2990afbf1460cf4b6cb6b34a5c2994ec6f4d3a64328565c87bd2fa85b23484af",
    ),
}

MODELS = {
    "general": ["realesr-general-x4v3.pth", "--wdn", "realesr-general-wdn-x4v3.pth"],
    "anime": ["realesr-animevideov3.pth"],
    "detailed": ["vipsl-plksr-rep.pth"],
}


def fetch(cache: Path, name: str) -> Path:
    url, sha = FILES[name]
    path = cache / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != sha:
        print(f"fetching {name}")
        with urllib.request.urlopen(url, timeout=300) as response:
            data = response.read()
        got = hashlib.sha256(data).hexdigest()
        if got != sha:
            raise SystemExit(f"{name}: SHA-256 {got}, expected {sha}")
        path.write_bytes(data)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=ROOT / "ui" / "models")
    parser.add_argument("--cache", type=Path, default=ROOT / "build" / "weights")
    parser.add_argument("--only", choices=sorted(MODELS), help="just this network (CI's same-bytes check)")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    for model, parts in MODELS.items():
        if args.only and model != args.only:
            continue
        sources = [p if p.startswith("--") else str(fetch(args.cache, p)) for p in parts]
        out = args.out / f"{model}.bin"
        subprocess.run(
            [sys.executable, "-I", str(ROOT / "tools" / "convert_weights.py"), sources[0], str(out), *sources[1:]],
            check=True,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
