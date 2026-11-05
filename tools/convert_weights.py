#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (c) 2026 Mateusz Kłysz
"""A super-resolution network's weights (a PyTorch .pth) as the engine reads them, without PyTorch.

    tools/convert_weights.py <model.pth> <out.bin> [--wdn <realesr-general-wdn-x4v3.pth>]

Real-ESRGAN's compact network (SRVGGNetCompact: realesr-general-x4v3, realesr-animevideov3) and
PLKSR-Rep (PLKSR with its 1x1 branches folded into the 3x3s) are read. out.bin is the op list of
src/engine/neural.hpp ("NTN2"). With --wdn the weakly denoising model is written second (the
engine blends the two, as Real-ESRGAN's denoise strength does).
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
    return state.get("params_ema") or state.get("params", state)


def conv(k, n, o, src, dst, weights, bias, act=0, aux=0, pas=0, slopes=None):
    values = list(weights) + list(bias) + (list(slopes) if act == 1 else [])
    return struct.pack("<9I", 0, k, n, o, src, dst, act, aux, pas) + struct.pack(f"<{len(values)}f", *values)


def shuffle(src, input_):
    return struct.pack("<3I", 1, src, input_)


def compact(state):
    """SRVGGNetCompact: body.0 conv, body.1 PReLU, then conv/PReLU pairs, the last conv (48)."""
    index = sorted({int(k.split(".")[1]) for k in state})
    ops, src, dst, i = [], 0, 1, 0
    while i < len(index):
        (o, n, k, _), w = state[f"body.{index[i]}.weight"]
        b = state[f"body.{index[i]}.bias"][1]
        slope = state.get(f"body.{index[i + 1]}.weight") if i + 1 < len(index) else None
        if slope is not None and f"body.{index[i + 1]}.bias" not in state:
            ops.append(conv(k, n, o, src, dst, w, b, act=1, slopes=slope[1]))
            i += 2
        else:
            ops.append(conv(k, n, o, src, dst, w, b))
            i += 1
        src, dst = dst, (2 if dst == 1 else 1)
    ops.append(shuffle(src, 0))
    return ops


def folded(state, name):
    """A RepVGG-style conv: its 1x1 branch added to the 3x3's centre."""
    (o, n, k, _), w = state[f"{name}.rbr_dense.weight"]
    w = array("f", w)
    _, w1 = state[f"{name}.rbr_1x1.weight"]
    for oi in range(o):
        for ii in range(n):
            w[((oi * n + ii) * k + k // 2) * k + k // 2] += w1[oi * n + ii]
    b = [x + y for x, y in zip(state[f"{name}.rbr_dense.bias"][1], state[f"{name}.rbr_1x1.bias"][1])]
    return o, n, k, w, b


def plksr(state):
    """PLKSR-Rep: feats.0 conv, PLK blocks, the last conv (48). A block: channel mixer (3x3 to 2x,
    GELU, 3x3 back), the large kernel on the first channels, an attention gate, a 1x1 refine plus
    the block's input."""
    blocks = sorted({int(k.split(".")[1]) for k in state if ".lk." in k})
    (o, n, k, _), w = state["feats.0.weight"]
    ops = [conv(k, n, o, 0, 1, w, state["feats.0.bias"][1])]
    x, y = 1, 6
    for i in blocks:
        p = f"feats.{i}."
        o, n, k, w, b = folded(state, p + "channe_mixer.conv1")
        ops.append(conv(k, n, o, x, 2, w, b, act=2))
        o, n, k, w, b = folded(state, p + "channe_mixer.conv2")
        ops.append(conv(k, n, o, 2, 3, w, b))
        (o, n, k, _), w = state[p + "lk.conv.weight"]
        ops.append(conv(k, n, o, 3, 4, w, state[p + "lk.conv.bias"][1], pas=1))
        (o, n, k, _), w = state[p + "attn.f.0.weight"]
        ops.append(conv(k, n, o, 4, 5, w, state[p + "attn.f.0.bias"][1], act=3, aux=4))
        (o, n, k, _), w = state[p + "refine.weight"]
        ops.append(conv(k, n, o, 5, y, w, state[p + "refine.bias"][1], act=4, aux=x))
        x, y = y, x
    last = max(int(k.split(".")[1]) for k in state if k.startswith("feats."))
    (o, n, k, _), w = state[f"feats.{last}.weight"]
    ops.append(conv(k, n, o, x, 7, w, state[f"feats.{last}.bias"][1]))
    ops.append(shuffle(7, 0))
    return ops


def network(state):
    if any(k.startswith("body.") for k in state):
        return compact(state)
    if any(".lk." in k for k in state):
        return plksr(state)
    raise SystemExit("not a network this tool knows (SRVGGNetCompact or PLKSR-Rep)")


def main() -> int:
    args = sys.argv[1:]
    wdn = None
    if "--wdn" in args:
        at = args.index("--wdn")
        wdn = args[at + 1]
        del args[at : at + 2]
    source, out = args
    models = [network(load(source))] + ([network(load(wdn))] if wdn else [])
    with open(out, "wb") as f:
        f.write(b"NTN2" + struct.pack("<II", 2, len(models)))
        for ops in models:
            f.write(struct.pack("<I", len(ops)))
            f.writelines(ops)
            print(f"{len(ops)} ops")
    return 0


if __name__ == "__main__":
    sys.exit(main())
