// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// What an engine (a worker's, or the page's own when workers cannot start) does with a job:
//   skip    {names}                         names already in the pack being updated
//   name    {png}                           a texture's name in a pack
//   png     {png, values, model, ...}       a texture upscaled (on the CPU, its network `model`)
//   rgba    {rgba, width, height, values, model}   the page's own pictures, the same way
//   input   {png | rgba+width+height, values, skipKnown}   what the GPU's network is given
//   finish  {png | rgba+width+height, values, colour, ...} the rest, with the GPU's colour

const networks = new Map(); // name -> the file's bytes, fetched once per engine

/** The network file models/<name>.bin, loaded into `nt` (no name: the engine has none). */
async function useNetwork(nt, name) {
  if (!name) return;
  if (!networks.has(name)) {
    const response = await fetch(new URL(`models/${name}.bin`, import.meta.url));
    if (!response.ok) throw new Error(`the ${name} model is missing`);
    networks.set(name, new Uint8Array(await response.arrayBuffer()));
  }
  if (!nt.loadNetwork(name, networks.get(name))) throw new Error(`the ${name} model cannot be read`);
}

export async function handle(nt, job, context) {
  if (job.kind === "skip") {
    context.skip = new Set(job.names);
    return null;
  }
  const isRgba = job.rgba !== undefined;
  const data = isRgba ? new Uint8Array(job.rgba) : new Uint8Array(job.png);
  if (job.kind === "name") return { name: nt.name(data) };
  if (job.skipKnown && !isRgba) {
    const name = nt.name(data);
    if (name === null) return { error: "unreadable" };
    if (context.skip.has(name)) return { name, skipped: true };
  }
  if (job.kind === "input") return nt.neuralInput(data, isRgba ? job.width : 0, isRgba ? job.height : 0, job.values);
  const keep = (out) => {
    if (!job.keepRgba && !isRgba) delete out.rgba;
    return out;
  };
  if (job.kind === "finish") {
    const out = nt.upscaleColour(data, isRgba ? job.width : 0, isRgba ? job.height : 0, job.values, job.colour, {
      asPng: !isRgba && job.asPng,
    });
    return keep(out);
  }
  await useNetwork(nt, job.model);
  if (isRgba) return nt.upscaleRgba(data, job.width, job.height, job.values);
  return keep(nt.upscale(data, job.values, { asPng: job.asPng }));
}
