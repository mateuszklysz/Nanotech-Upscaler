# Contributing

## Commits

Conventional Commits: `<type>(<scope>): <summary>`, with a type of `feat`, `fix`, `docs`,
`chore`, `refactor`, `test`, `build`, `ci`, `perf`, `style` or `revert`; a subject of at most 100
characters, no trailing period. Bodies say why.

## AI tools

Work prepared with an AI agent is fine; what enters the history is yours:

- No agent trailers (`Co-Authored-By:`, `Claude-Session:`) in commit messages, pull request
  descriptions or review comments. The one co-author line allowed credits a person, by their
  GitHub noreply address: `Co-authored-by: login <12345+login@users.noreply.github.com>`.
- No AI tool footers ("Generated with ...") and no links to AI chat or agent sessions
  (claude.ai, chatgpt.com): sessions are private, this repository is public.
- Author and committer are you, never an AI agent identity (an anthropic.com or openai.com
  address, Claude, Copilot or another bot).

The `ai-rules` workflow (`scripts/check-ai.py`) checks every pull request and push. Run the same
check on your own commits with the hook:

```sh
ln -sf ../../scripts/commit-msg.py .git/hooks/commit-msg
```

It drops agent trailers from your message and rejects the rest. A line that has to name what the
rules forbid (a test of the rules) carries `ai-rules: allow`.

## Game data

Never commit anything from Ratchet & Clank's discs (textures, models, sounds, text,
executables), and no texture upscaled from one. The tests and the page opened on its own use
textures drawn by the code (`tests/samples.hpp`, `ui/samples.js`); the mod reads the game's
textures only on the player's own device.

## The same bytes everywhere

A texture and its options must give the same PNG on every system and in the WebAssembly, so a pack
made on a phone matches one made on a PC (on the processor; the GPU path is close, not exact). So
the engine uses integers, or floats with no fused multiply-adds and no fast maths
(`CMakeLists.txt`), its own `exp` and `erf`, sums in a fixed order and one thread per texture.

`tests/golden.txt` holds the result of every sample with every engine. CI checks it on Windows,
Linux, macOS and in WebAssembly, and compares their PNGs byte for byte. If a change is meant to
give other bytes, update the file:

```sh
cmake -DUPDATE=ON -DPROGRAM=build/golden -DEXPECTED=tests/golden.txt -P tests/compare.cmake
```
