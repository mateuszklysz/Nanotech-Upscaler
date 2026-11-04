# Third-party code

## xBRZ

The engine's edge scaler is xBRZ 1.8 by Zenju, unmodified, in `third_party/xbrz/`:
<https://sourceforge.net/projects/xbrz/>. It is under the GNU General Public License 3, with the
linking exception in its `License.txt`; this mod is GPL-3.0-or-later (`LICENSE`) for that reason.

## stb

PNG reading and writing are Sean Barrett's `stb_image.h` 2.30 and `stb_image_write.h`, in
`third_party/stb/`: <https://github.com/nothings/stb>, MIT or public domain (the end of each
file). The port reads its levels' textures with the same `stb_image`, which is why the mod
names a texture as the port does.

## The networks (ui/models/)

Not in git: `tools/fetch_models.py` downloads them (each checked against a pinned SHA-256) and
`tools/convert_weights.py` writes them in the engine's format; the mod's archive carries the result.

- `general.bin`, `anime.bin`: Real-ESRGAN's `realesr-general-x4v3`, `realesr-general-wdn-x4v3`
  and `realesr-animevideov3` by Xintao Wang et al., BSD 3-Clause:
  <https://github.com/xinntao/Real-ESRGAN> (its `LICENSE`).
- `detailed.bin`: PLKSR-Rep by team VIPSL (JiaHao Deng et al.), the winner of the NTIRE 2026
  Mobile Real-World Image Super-Resolution challenge, from the challenge's model zoo:
  <https://github.com/jiatongli2024/NTIRE2026_Mobile_RealWorld_ImageSR> (MIT). PLKSR itself:
  <https://github.com/dslisleedh/PLKSR> (MIT).

Nothing from Ratchet & Clank's discs is in this mod: no texture, model, sound or text. It reads
the game's textures on the player's own device and writes the pack there.
