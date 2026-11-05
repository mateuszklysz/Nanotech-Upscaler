// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// The network (src/engine/neural.hpp's op list) on the GPU with WebGL2: every convolution a few
// draws into half-float texture arrays (4 channels a layer, 16 channels a draw), the texture worked
// on in tiles so memory stays small on a phone. Its result is close to the CPU's, not the same
// bytes (each GPU rounds its own way): the page's CPU switch gives those.

const TILE = 128; // a tile's side on the GPU, margin included
const MARGIN = 16; // texels of real neighbours around each tile (the CPU's whole texture has 8)
const INNER = TILE - 2 * MARGIN;
const WIDTH = 2048; // the weight texture's width, in texels (WebGL2 promises 2048)
const SETTLE_EVERY = 4; // convolutions sent before waiting for the GPU

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1));
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const CONV = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
uniform sampler2DArray src;
uniform sampler2DArray aux;
uniform sampler2D weights;
uniform int K, CI4, OG0, NOUT, ACT, SIZE, BASE, BIAS, SLOPES;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
vec4 w(int i) { return texelFetch(weights, ivec2(i % ${WIDTH}, i / ${WIDTH}), 0); }
vec4 erf4(vec4 x) {
  vec4 a = abs(x);
  vec4 t = 1.0 / (1.0 + 0.3275911 * a);
  vec4 p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign(x) * (1.0 - p * exp(-a * a));
}
vec4 finish(vec4 v, int j, ivec2 at) {
  int og = OG0 + j;
  if (ACT == 1) return mix(v, v * w(SLOPES + og), lessThan(v, vec4(0.0)));
  if (ACT == 2) return 0.5 * v * (1.0 + erf4(v * 0.70710678118654752));
  if (ACT == 3) return texelFetch(aux, ivec3(at, og), 0) / (1.0 + exp(-v));
  if (ACT == 4) return v + texelFetch(aux, ivec3(at, og), 0);
  return v;
}
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 acc[4];
  for (int j = 0; j < 4; j++) acc[j] = j < NOUT ? w(BIAS + OG0 + j) : vec4(0.0);
  int r = K / 2;
  int taps = K * K;
  for (int ky = 0; ky < K; ky++) {
    int sy = at.y + ky - r;
    if (sy < 0 || sy >= SIZE) continue;
    for (int kx = 0; kx < K; kx++) {
      int sx = at.x + kx - r;
      if (sx < 0 || sx >= SIZE) continue;
      int tap = ky * K + kx;
      for (int g = 0; g < CI4; g++) {
        vec4 v = texelFetch(src, ivec3(sx, sy, g), 0);
        for (int j = 0; j < 4; j++) {
          if (j >= NOUT) break;
          int b = BASE + (((OG0 + j) * CI4 + g) * taps + tap) * 4;
          acc[j] += mat4(w(b), w(b + 1), w(b + 2), w(b + 3)) * v;
        }
      }
    }
  }
  o0 = finish(acc[0], 0, at);
  o1 = NOUT > 1 ? finish(acc[1], 1, at) : vec4(0.0);
  o2 = NOUT > 2 ? finish(acc[2], 2, at) : vec4(0.0);
  o3 = NOUT > 3 ? finish(acc[3], 3, at) : vec4(0.0);
}`;

const COPY = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray src;
uniform int FIRST, N;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  o0 = texelFetch(src, ivec3(at, FIRST), 0);
  o1 = N > 1 ? texelFetch(src, ivec3(at, FIRST + 1), 0) : vec4(0.0);
  o2 = N > 2 ? texelFetch(src, ivec3(at, FIRST + 2), 0) : vec4(0.0);
  o3 = N > 3 ? texelFetch(src, ivec3(at, FIRST + 3), 0) : vec4(0.0);
}`;

const SHUFFLE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray src;
uniform sampler2DArray input0;
uniform int MARGIN;
out vec4 colour;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  ivec2 s = at / 4 + ivec2(MARGIN);
  int sub = (at.y % 4) * 4 + at.x % 4;
  vec3 c;
  for (int i = 0; i < 3; i++) {
    int ch = i * 16 + sub;
    c[i] = texelFetch(src, ivec3(s, ch / 4), 0)[ch % 4];
  }
  colour = vec4(clamp(c + texelFetch(input0, ivec3(s, 0), 0).rgb, 0.0, 1.0), 1.0);
}`;

/** The op list of a network file (src/engine/neural.hpp), its models' weights as floats. */
export function parseNetwork(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== "NTN2" || view.getUint32(4, true) !== 2) throw new Error("not a network file");
  const models = view.getUint32(8, true);
  let p = 12;
  const u32 = () => {
    const v = view.getUint32(p, true);
    p += 4;
    return v;
  };
  const floats = (n) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getFloat32(p + 4 * i, true);
    p += 4 * n;
    return out;
  };
  const read = () => {
    const ops = [];
    const count = u32();
    for (let i = 0; i < count; i++) {
      if (u32() === 1) {
        ops.push({ shuffle: true, src: u32(), aux: u32() });
        continue;
      }
      const [k, inC, out, src, dst, act, aux, pass] = Array.from({ length: 8 }, u32);
      const op = { k, in: inC, out, src, dst, act, aux, pass: pass !== 0 };
      op.weights = floats(out * inC * k * k);
      op.bias = floats(out);
      op.slopes = act === 1 ? floats(out) : null;
      ops.push(op);
    }
    return ops;
  };
  const net = { ops: read(), denoise: models === 2 ? read() : null };
  return net;
}

/** `net`'s ops with the denoising model blended in (`strength` as Real-ESRGAN's, in percent). */
function blended(net, strength) {
  if (!net.denoise || strength >= 100) return net.ops;
  const a = Math.fround(strength / 100);
  const b = Math.fround((100 - strength) / 100);
  const mix = (x, y) => x && Float32Array.from(x, (v, i) => v * a + y[i] * b);
  return net.ops.map((op, i) => {
    if (op.shuffle) return op;
    const d = net.denoise[i];
    return { ...op, weights: mix(op.weights, d.weights), bias: mix(op.bias, d.bias), slopes: mix(op.slopes, d.slopes) };
  });
}

// Lets other work run, without setTimeout's 4 ms floor for nested timers.
const channel = new MessageChannel();
const waiting = [];
channel.port1.onmessage = () => waiting.shift()?.();
function yieldTask() {
  return new Promise((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}

export class GpuNetwork {
  /** A GPU network on `canvas` (an OffscreenCanvas or a canvas), or null when WebGL2 cannot run it. */
  static create(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false });
    if (!gl) return null;
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return null;
    if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 4) return null;
    try {
      return new GpuNetwork(gl);
    } catch {
      return null;
    }
  }

  constructor(gl) {
    this.gl = gl;
    this.programs = {
      conv: this.#program(CONV),
      copy: this.#program(COPY),
      shuffle: this.#program(SHUFFLE),
    };
    this.vao = gl.createVertexArray();
    this.fbo = gl.createFramebuffer();
    this.buffers = new Map(); // id -> {texture, layers}
    this.output = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.output);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, INNER * 4, INNER * 4);
    this.net = null;
    this.loaded = null; // {strength, ops (with weight offsets), texture}
  }

  #program(source) {
    const gl = this.gl;
    const shader = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, source));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program");
    const uniforms = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(p, i).name;
      uniforms[name] = gl.getUniformLocation(p, name);
    }
    return { p, u: uniforms };
  }

  /** Uses `bytes` (a network file) from now on. */
  load(bytes) {
    this.net = parseNetwork(bytes);
    if (this.loaded) this.gl.deleteTexture(this.loaded.texture);
    this.loaded = null;
    // Each buffer as many layers as the most channels written to it (the input: one).
    const layers = new Map([[0, 1]]);
    for (const op of this.net.ops) {
      if (op.shuffle) continue;
      const channels = op.out + (op.pass ? this.#channels(op.src, layers) - op.in : 0);
      layers.set(op.dst, Math.max(layers.get(op.dst) ?? 0, Math.ceil(channels / 4)));
    }
    const gl = this.gl;
    for (const b of this.buffers.values()) gl.deleteTexture(b.texture);
    this.buffers.clear();
    for (const [id, n] of layers) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, TILE, TILE, n);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.buffers.set(id, { texture, layers: n });
    }
  }

  #channels(id, layers) {
    return (layers.get(id) ?? 0) * 4;
  }

  // The weights for `strength` in one RGBA32F texture: per conv its 4x4 blocks ([out group][in
  // group][tap][input]), then its bias and PReLU slopes, one texel per 4 outputs.
  #weights(strength) {
    if (this.loaded?.strength === strength) return this.loaded;
    const ops = blended(this.net, strength);
    let size = 0;
    const placed = ops.map((op) => {
      if (op.shuffle) return op;
      const ci4 = Math.ceil(op.in / 4);
      const co4 = Math.ceil(op.out / 4);
      const base = size;
      size += co4 * ci4 * op.k * op.k * 4;
      const bias = size;
      size += co4;
      const slopes = size;
      if (op.slopes) size += co4;
      return { ...op, ci4, co4, base, biasAt: bias, slopesAt: slopes };
    });
    const rows = Math.ceil(size / WIDTH);
    if (rows > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) throw new Error("the network is too big for this GPU");
    const data = new Float32Array(WIDTH * rows * 4);
    for (const op of placed) {
      if (op.shuffle) continue;
      const taps = op.k * op.k;
      for (let o = 0; o < op.out; o++) {
        for (let c = 0; c < op.in; c++) {
          for (let t = 0; t < taps; t++) {
            const texel = op.base + ((((o >> 2) * op.ci4 + (c >> 2)) * taps + t) << 2) + (c & 3);
            data[texel * 4 + (o & 3)] = op.weights[(o * op.in + c) * taps + t];
          }
        }
        data[(op.biasAt + (o >> 2)) * 4 + (o & 3)] = op.bias[o];
        if (op.slopes) data[(op.slopesAt + (o >> 2)) * 4 + (o & 3)] = op.slopes[o];
      }
    }
    const gl = this.gl;
    if (this.loaded) gl.deleteTexture(this.loaded.texture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, WIDTH, rows);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WIDTH, rows, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.loaded = { strength, ops: placed, texture };
    return this.loaded;
  }

  // Waits, without blocking, until the GPU has done what was asked so far.
  async #settle() {
    const gl = this.gl;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    try {
      for (let tries = 0; ; tries++) {
        const state = gl.clientWaitSync(fence, 0, 0);
        if (state !== gl.TIMEOUT_EXPIRED) break; // done, or the wait failed
        if (gl.isContextLost()) throw new Error("the graphics card was reset");
        // A quick look first; then a timer, so a long draw does not keep a core busy.
        await (tries < 2 ? yieldTask() : new Promise((resolve) => setTimeout(resolve, 2)));
      }
    } finally {
      gl.deleteSync(fence);
    }
  }

  #target(id, first, n) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const texture = this.buffers.get(id).texture;
    const attachments = [];
    for (let i = 0; i < 4; i++) {
      if (i < n) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, texture, 0, first + i);
        attachments.push(gl.COLOR_ATTACHMENT0 + i);
      } else {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, null, 0, 0);
        attachments.push(gl.NONE);
      }
    }
    gl.drawBuffers(attachments);
  }

  #bind(unit, target, texture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, texture);
  }

  /**
   * `rgba` (width x height, alpha ignored) 4x larger through the network: RGBA bytes, alpha 255.
   * `wrapX`/`wrapY`: the texture tiles. `denoise`: the denoise strength in percent. Each draw
   * is waited for before the next, so the GPU is never held long: the game's launcher, the page
   * and the phone's own screen draw in between (and a slow phone's GPU watchdog never fires).
   */
  async run(rgba, width, height, { wrapX = false, wrapY = false, denoise = 100 } = {}) {
    const gl = this.gl;
    const { ops, texture: weights } = this.#weights(denoise);
    const out = new Uint8Array(width * 4 * height * 4 * 4);
    const tile = new Float32Array(TILE * TILE * 4);
    const pick = (v, n, wrap) => (wrap ? ((v % n) + n) % n : Math.min(n - 1, Math.max(0, v)));
    const pixels = new Uint8Array(INNER * 4 * INNER * 4 * 4);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, TILE, TILE);
    gl.disable(gl.BLEND);
    let sent = 0;
    for (let ty = 0; ty < height; ty += INNER) {
      for (let tx = 0; tx < width; tx += INNER) {
        // The tile and its margin: the texture's own neighbours, by its edges.
        for (let y = 0; y < TILE; y++) {
          const sy = pick(ty + y - MARGIN, height, wrapY);
          for (let x = 0; x < TILE; x++) {
            const s = (sy * width + pick(tx + x - MARGIN, width, wrapX)) * 4;
            const d = (y * TILE + x) * 4;
            tile[d] = rgba[s] / 255;
            tile[d + 1] = rgba[s + 1] / 255;
            tile[d + 2] = rgba[s + 2] / 255;
            tile[d + 3] = 0;
          }
        }
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.buffers.get(0).texture);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, TILE, TILE, 1, gl.RGBA, gl.FLOAT, tile);
        gl.viewport(0, 0, TILE, TILE);
        for (const op of ops) {
          if (op.shuffle) {
            const { p, u } = this.programs.shuffle;
            gl.useProgram(p);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.output, 0);
            for (let i = 1; i < 4; i++)
              gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, null, 0, 0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
            this.#bind(0, gl.TEXTURE_2D_ARRAY, this.buffers.get(op.src).texture);
            this.#bind(1, gl.TEXTURE_2D_ARRAY, this.buffers.get(op.aux).texture);
            gl.uniform1i(u.src, 0);
            gl.uniform1i(u.input0, 1);
            gl.uniform1i(u.MARGIN, MARGIN);
            gl.viewport(0, 0, INNER * 4, INNER * 4);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            break;
          }
          if (++sent % SETTLE_EVERY === 0) await this.#settle();
          else gl.flush();
          const { p, u } = this.programs.conv;
          gl.useProgram(p);
          this.#bind(0, gl.TEXTURE_2D_ARRAY, this.buffers.get(op.src).texture);
          this.#bind(1, gl.TEXTURE_2D_ARRAY, this.buffers.get(op.act >= 3 ? op.aux : op.src).texture);
          this.#bind(2, gl.TEXTURE_2D, weights);
          gl.uniform1i(u.src, 0);
          gl.uniform1i(u.aux, 1);
          gl.uniform1i(u.weights, 2);
          gl.uniform1i(u.K, op.k);
          gl.uniform1i(u.CI4, op.ci4);
          gl.uniform1i(u.ACT, op.act);
          gl.uniform1i(u.SIZE, TILE);
          gl.uniform1i(u.BASE, op.base);
          gl.uniform1i(u.BIAS, op.biasAt);
          gl.uniform1i(u.SLOPES, op.slopesAt);
          for (let og = 0; og < op.co4; og += 4) {
            const n = Math.min(4, op.co4 - og);
            this.#target(op.dst, og, n);
            gl.uniform1i(u.OG0, og);
            gl.uniform1i(u.NOUT, n);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          if (op.pass) {
            const copy = this.programs.copy;
            gl.useProgram(copy.p);
            gl.uniform1i(copy.u.src, 0);
            const total = this.buffers.get(op.src).layers;
            for (let first = op.co4; first < total; first += 4) {
              const n = Math.min(4, total - first);
              this.#target(op.dst, first, n);
              gl.uniform1i(copy.u.FIRST, first);
              gl.uniform1i(copy.u.N, n);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
          }
        }
        await this.#settle();
        gl.readPixels(0, 0, INNER * 4, INNER * 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const w = Math.min(INNER, width - tx) * 4;
        const h = Math.min(INNER, height - ty) * 4;
        for (let y = 0; y < h; y++) {
          out.set(pixels.subarray(y * INNER * 16, y * INNER * 16 + w * 4), ((ty * 4 + y) * width * 4 + tx * 4) * 4);
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
}
