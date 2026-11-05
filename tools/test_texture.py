#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (c) 2026 Mateusz Kłysz
"""A test texture drawn here, as a PNG: gradients, hard diagonals and a cut-out grid.
CI upscales it with the native command and the page's WebAssembly and compares the bytes.

    tools/test_texture.py <out.png> [side, 256 by default]
"""

import struct
import sys
import zlib


def texel(x: int, y: int) -> bytes:
    alpha = 255 if (x // 16 + y // 16) % 3 else 0
    return bytes(((x * 3 + y) % 256, (x ^ y) % 256, (y * 5) // 4 % 256, alpha))


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def main() -> int:
    side = int(sys.argv[2]) if len(sys.argv) > 2 else 256
    rows = b"".join(b"\0" + b"".join(texel(x, y) for x in range(side)) for y in range(side))
    header = struct.pack(">IIBBBBB", side, side, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
    with open(sys.argv[1], "wb") as out:
        out.write(png)
    return 0


if __name__ == "__main__":
    sys.exit(main())
