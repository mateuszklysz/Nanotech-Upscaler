# Third-party code

## xBRZ

xBRZ 1.8 by Zenju, unmodified, in `third_party/xbrz/`: <https://sourceforge.net/projects/xbrz/>.
GPL-3 with the linking exception in its `License.txt`. This is why the mod is GPL-3.0-or-later.

## stb

`stb_image.h` 2.30 and `stb_image_write.h` by Sean Barrett, in `third_party/stb/`:
<https://github.com/nothings/stb>. MIT or public domain (see the end of each file). The game reads
its textures with the same `stb_image`, so both name a texture the same way.

## The networks (ui/models/)

Not in git. `tools/fetch_models.py` downloads the weights, checks each pinned SHA-256 and converts
them with `tools/convert_weights.py`. The release archive includes the result.

- `general.bin`, `anime.bin`: Real-ESRGAN's `realesr-general-x4v3`, `realesr-general-wdn-x4v3`
  and `realesr-animevideov3` by Xintao Wang et al. BSD 3-Clause:
  <https://github.com/xinntao/Real-ESRGAN>.
- `detailed.bin`: PLKSR-Rep by team VIPSL (JiaHao Deng et al.), from the NTIRE 2026 Mobile
  Real-World Image Super-Resolution challenge's model zoo:
  <https://github.com/jiatongli2024/NTIRE2026_Mobile_RealWorld_ImageSR> (MIT). Based on PLKSR:
  <https://github.com/dslisleedh/PLKSR> (MIT).

## Game data

Nothing from the Ratchet & Clank discs is in this mod. It reads the game's textures on the
player's device and writes the pack there.
