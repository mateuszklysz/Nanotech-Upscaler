#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (c) 2026 Mateusz Kłysz
"""Real-ESRGAN's SRVGGNetCompact weights (a PyTorch .pth) as the engine reads them, without PyTorch.

    tools/convert_weights.py <realesr-general-x4v3.pth> <out.bin> [--wdn <realesr-general-wdn-x4v3.pth>]

out.bin: "NTNN", then u32 version 1, u32 layers; per layer u32 kind (0 conv 3x3, 1 PReLU),
u32 out, u32 in, then its floats (little end): a conv's weights [out][in][3][3] and bias [out],
a PReLU's slopes [out]. With --wdn the two models' weights are both written, the weakly denoising one
second (the engine blends them, as Real-ESRGAN's denoise strength does).
"""
from __future__ import annotations

import pickle
import struct
import sys
import zipfile
from array import array


class _Storage:
    def __init__(self, key: str):
        self.key = key


def load(path: str) -> dict[str, tuple[list[int], array]]:
    z = zipfile.ZipFile(path)
    prefix = z.namelist()[0].split("/")[0]

    def rebuild(storage, offset, size, stride, *_):
        data = array("f")
        data.frombytes(z.read(f"{prefix}/data/{storage.key}"))
        if sys.byteorder != "little":
            data.byteswap()
        count = 1
        for s in size:
            count *= s
        return (list(size), data[offset : offset + count])

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if name == "_rebuild_tensor_v2":
                return rebuild
            if module == "collections" and name == "OrderedDict":
                import collections

                return collections.OrderedDict
            if name == "FloatStorage":
                return "float"
            raise pickle.UnpicklingError(f"{module}.{name} is not expected in weights")

        def persistent_load(self, pid):
            return _Storage(pid[2])

    state = Unpickler(z.open(f"{prefix}/data.pkl")).load()
    return state.get("params", state)


def layers(state):
    # body.0 conv in, body.1 PReLU, then pairs, the last conv: SRVGGNetCompact's order.
    index = sorted({int(k.split(".")[1]) for k in state}, key=int)
    for i in index:
        w = state.get(f"body.{i}.weight")
        b = state.get(f"body.{i}.bias")
        if b is not None:
            (o, n, kh, kw), weights = w
            assert (kh, kw) == (3, 3)
            yield 0, o, n, list(weights) + list(b[1])
        else:
            (o,), slopes = w
            yield 1, o, o, list(slopes)


def main() -> int:
    args = sys.argv[1:]
    wdn = None
    if "--wdn" in args:
        at = args.index("--wdn")
        wdn = args[at + 1]
        del args[at : at + 2]
    source, out = args
    models = [load(source)] + ([load(wdn)] if wdn else [])
    with open(out, "wb") as f:
        for state in models:
            ls = list(layers(state))
            f.write(b"NTNN" + struct.pack("<II", 1, len(ls)))
            for kind, o, n, values in ls:
                f.write(struct.pack("<III", kind, o, n))
                f.write(struct.pack(f"<{len(values)}f", *values))
            print(f"{len(ls)} layers, {sum(len(v) for *_, v in ls)} values")
    return 0


if __name__ == "__main__":
    sys.exit(main())
