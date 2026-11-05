// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// Ratchet in the preview, as the levels hold him (mobys/moby_0.glb): his model, posed by his own
// idle animation, drawn twice with WebGL, his original textures left of the line and the
// upscaled ones right of it. Nothing of him is in this repository; he is read from the player's
// extracted levels.

// ---------------------------------------------------------------------------------------------
// glTF

const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function parseGlb(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a .glb");
  const jsonLength = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binAt = 20 + jsonLength;
  const bin = new Uint8Array(buffer, binAt + 8, view.getUint32(binAt, true));
  return { doc, bin };
}

/** An accessor as floats (normalized when it says so), `size` per element. */
function accessor({ doc, bin }, index, asFloat = true) {
  const a = doc.accessors[index];
  const view = doc.bufferViews[a.bufferView];
  const Type = ARRAYS[a.componentType];
  const size = SIZES[a.type];
  const stride = view.byteStride || size * Type.BYTES_PER_ELEMENT;
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const data = new DataView(bin.buffer);
  const out = asFloat ? new Float32Array(a.count * size) : new Uint32Array(a.count * size);
  const scale = asFloat && a.normalized ? NORMALIZE[a.componentType] : 1;
  const getters = {
    5120: (o) => data.getInt8(o),
    5121: (o) => data.getUint8(o),
    5122: (o) => data.getInt16(o, true),
    5123: (o) => data.getUint16(o, true),
    5125: (o) => data.getUint32(o, true),
    5126: (o) => data.getFloat32(o, true),
  };
  const get = getters[a.componentType];
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < size; c++) out[i * size + c] = get(start + i * stride + c * Type.BYTES_PER_ELEMENT) / scale;
  }
  return { data: out, size, count: a.count };
}

// ---------------------------------------------------------------------------------------------
// Matrices (column-major, as glTF and WebGL)

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return new Float32Array([
    (1 - 2 * (y * y + z * z)) * s[0],
    2 * (x * y + z * w) * s[0],
    2 * (x * z - y * w) * s[0],
    0,
    2 * (x * y - z * w) * s[1],
    (1 - 2 * (x * x + z * z)) * s[1],
    2 * (y * z + x * w) * s[1],
    0,
    2 * (x * z + y * w) * s[2],
    2 * (y * z - x * w) * s[2],
    (1 - 2 * (x * x + y * y)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ]);
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ]);
}

/** A camera at `eye` looking at `at`, Z up (the levels' axes). */
function lookAt(eye, at) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (v) => v.map((x) => x / Math.hypot(...v));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(at, eye));
  const s = norm(cross(f, [0, 0, 1]));
  const u = cross(s, f);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([
    s[0],
    u[0],
    -f[0],
    0,
    s[1],
    u[1],
    -f[1],
    0,
    s[2],
    u[2],
    -f[2],
    0,
    -dot(s, eye),
    -dot(u, eye),
    dot(f, eye),
    1,
  ]);
}

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d *= s;
  if (d > 0.9995) {
    const q = a.map((v, i) => v + (b[i] * s - v) * t);
    const n = Math.hypot(...q);
    return q.map((v) => v / n);
  }
  const th = Math.acos(d);
  const wa = Math.sin((1 - t) * th) / Math.sin(th);
  const wb = (Math.sin(t * th) / Math.sin(th)) * s;
  return a.map((v, i) => v * wa + b[i] * wb);
}

// ---------------------------------------------------------------------------------------------
// The model

/** Ratchet's model in a level's files: the levels' list (bridge.js, list "levels"). Prefers one
 *  with his animations, the smallest such. */
export function findRatchet(files) {
  const all = files.filter((f) => /(^|\/)mobys\/moby_0\.glb$/.test(f.path));
  // The front end's copy has no animations and is small: a level's is posed by them.
  const levels = all.filter((f) => !/^level_9\d\//.test(f.path)).sort((a, b) => a.size - b.size);
  return levels[0] ?? all[0] ?? null;
}

function resolvePath(base, uri) {
  const out = [];
  for (const part of (base + decodeURIComponent(uri)).split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/** The parts of the model: each with its texture's path, its mesh, and how to pose it. */
export function loadModel(buffer, path) {
  const glb = parseGlb(buffer);
  const { doc } = glb;
  const base = path.slice(0, path.lastIndexOf("/") + 1);
  const meshNode = doc.nodes.findIndex((n) => n.mesh !== undefined);
  const node = doc.nodes[meshNode];
  const skin = node.skin !== undefined ? doc.skins[node.skin] : null;
  const parts = doc.meshes[node.mesh].primitives.map((p) => {
    const material = doc.materials?.[p.material] ?? {};
    const texture = doc.textures?.[material.pbrMetallicRoughness?.baseColorTexture?.index];
    const uri = doc.images?.[texture?.source]?.uri;
    const attr = p.attributes;
    return {
      texture: uri ? resolvePath(base, uri) : null,
      cutout: material.alphaMode === "MASK",
      blend: material.alphaMode === "BLEND",
      position: accessor(glb, attr.POSITION),
      normal: attr.NORMAL !== undefined ? accessor(glb, attr.NORMAL) : null,
      uv: attr.TEXCOORD_0 !== undefined ? accessor(glb, attr.TEXCOORD_0) : null,
      color: attr.COLOR_0 !== undefined ? accessor(glb, attr.COLOR_0) : null,
      joints: attr.JOINTS_0 !== undefined ? accessor(glb, attr.JOINTS_0, false) : null,
      weights: attr.WEIGHTS_0 !== undefined ? accessor(glb, attr.WEIGHTS_0) : null,
      indices: p.indices !== undefined ? accessor(glb, p.indices, false).data : null,
    };
  });
  const inverseBind = skin?.inverseBindMatrices !== undefined ? accessor(glb, skin.inverseBindMatrices).data : null;
  // His idle (the first sequence), when the level has his animations.
  const animation = doc.animations?.[0]
    ? doc.animations[0].channels.map((c) => {
        const s = doc.animations[0].samplers[c.sampler];
        return {
          node: c.target.node,
          path: c.target.path,
          times: accessor(glb, s.input).data,
          values: accessor(glb, s.output),
          step: s.interpolation === "STEP",
        };
      })
    : [];
  const duration = animation.reduce((m, c) => Math.max(m, c.times[c.times.length - 1] ?? 0), 0);
  return { doc, parts, skin, inverseBind, animation, duration, roots: doc.scenes[doc.scene ?? 0].nodes };
}

function sample(channel, t) {
  const { times, values } = channel;
  const n = values.size;
  let i = 0;
  while (i < times.length - 1 && times[i + 1] <= t) i++;
  const at = (k) => Array.from(values.data.subarray(k * n, k * n + n));
  if (channel.step || i >= times.length - 1) return at(i);
  const f = (t - times[i]) / (times[i + 1] - times[i]);
  const a = at(i);
  const b = at(i + 1);
  return channel.path === "rotation" ? slerp(a, b, f) : a.map((v, k) => v + (b[k] - v) * f);
}

/** Every vertex where the animation puts it at `time` (seconds): one Float32Array per part. */
export function pose(model, time) {
  const { doc } = model;
  const local = doc.nodes.map((n) => ({ t: n.translation, r: n.rotation, s: n.scale, m: n.matrix }));
  const t = model.duration ? time % model.duration : 0;
  for (const c of model.animation) {
    const v = sample(c, t);
    if (c.path === "translation") local[c.node].t = v;
    else if (c.path === "rotation") local[c.node].r = v;
    else if (c.path === "scale") local[c.node].s = v;
  }
  const world = new Array(doc.nodes.length);
  const walk = (i, parent) => {
    const l = local[i];
    world[i] = multiply(parent, l.m ? new Float32Array(l.m) : compose(l.t, l.r, l.s));
    for (const child of doc.nodes[i].children ?? []) walk(child, world[i]);
  };
  for (const root of model.roots) walk(root, compose());
  const joints = model.skin
    ? model.skin.joints.map((j, k) => multiply(world[j], model.inverseBind.subarray(k * 16, k * 16 + 16)))
    : [];
  return model.parts.map((p) => {
    const src = p.position.data;
    if (!joints.length || !p.joints) return src;
    const out = new Float32Array(src.length);
    for (let v = 0; v < p.position.count; v++) {
      const x = src[v * 3],
        y = src[v * 3 + 1],
        z = src[v * 3 + 2];
      let ox = 0,
        oy = 0,
        oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = p.weights.data[v * 4 + k];
        if (!w) continue;
        const m = joints[p.joints.data[v * 4 + k]];
        ox += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
        oy += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
        oz += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      out[v * 3] = ox;
      out[v * 3 + 1] = oy;
      out[v * 3 + 2] = oz;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// Drawing

const VERTEX = `
attribute vec3 position; attribute vec2 uv; attribute vec4 color;
uniform mat4 view; varying vec2 vUv; varying vec4 vColor;
void main() { vUv = uv; vColor = color; gl_Position = view * vec4(position, 1.0); }`;
const FRAGMENT = `
precision mediump float;
uniform sampler2D map; uniform float cutout; varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 c = texture2D(map, vUv) * vec4(vColor.rgb, 1.0);
  if (c.a < cutout) discard;
  gl_FragColor = c;
}`;

function compile(gl) {
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  return program;
}

/** Ratchet on `canvas`: `textures(original, upscaled)` sets both sets (path → {width, height,
 *  rgba}); `split` is where the line is (0..1); `turn` turns him. */
export class RatchetView {
  constructor(canvas, model) {
    this.canvas = canvas;
    this.model = model;
    this.split = 0.5;
    this.angle = -0.6;
    this.close = false;
    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error("no WebGL");
    this.gl = gl;
    this.program = compile(gl);
    this.sets = [new Map(), new Map()];
    this.buffers = model.parts.map((p) => {
      const make = (data) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
      };
      const index = gl.createBuffer();
      const indices = p.indices ? new Uint16Array(p.indices) : null;
      if (indices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      }
      const colors = p.color
        ? p.color.size === 4
          ? p.color.data
          : expand(p.color.data)
        : new Float32Array(p.position.count * 4).fill(0.5);
      return {
        position: make(p.position.data),
        uv: make(p.uv?.data ?? new Float32Array(p.position.count * 2)),
        color: make(colors),
        index: indices ? index : null,
        count: indices ? indices.length : p.position.count,
      };
    });
    // Where he stands: his bounds, to frame him.
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const positions of pose(model, 0)) {
      for (let i = 0; i < positions.length; i += 3) {
        for (let c = 0; c < 3; c++) {
          lo[c] = Math.min(lo[c], positions[i + c]);
          hi[c] = Math.max(hi[c], positions[i + c]);
        }
      }
    }
    this.center = lo.map((v, i) => (v + hi[i]) / 2);
    this.height = hi[2] - lo[2];
    this.start = performance.now();
  }

  textures(index, images) {
    const gl = this.gl;
    for (const t of this.sets[index].values()) gl.deleteTexture(t);
    this.sets[index] = new Map();
    for (const [path, image] of images) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        image.width,
        image.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength),
      );
      // The original as the PS2 shows it up close (bilinear), the upscaled the same way.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const pow2 = (n) => (n & (n - 1)) === 0;
      const wrap = pow2(image.width) && pow2(image.height) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      this.sets[index].set(path, t);
    }
  }

  draw() {
    const { gl, canvas } = this;
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    const time = (performance.now() - this.start) / 1000;
    const positions = pose(this.model, time);
    const target = this.close ? [this.center[0], this.center[1], this.center[2] + this.height * 0.3] : this.center;
    const distance = this.height * (this.close ? 0.75 : 1.9);
    const eye = [
      target[0] + Math.cos(this.angle) * distance,
      target[1] + Math.sin(this.angle) * distance,
      target[2] + this.height * 0.08,
    ];
    const view = multiply(perspective(0.7, w / h, this.height * 0.05, this.height * 10), lookAt(eye, target));
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "view"), false, view);
    const split = Math.round(w * this.split);
    for (const [index, x, width] of [
      [0, 0, split],
      [1, split, w - split],
    ]) {
      if (width <= 0) continue;
      gl.scissor(x, 0, width, h);
      this.#drawParts(positions, this.sets[index]);
    }
  }

  #drawParts(positions, textures) {
    const { gl, program } = this;
    const at = (name) => gl.getAttribLocation(program, name);
    this.model.parts.forEach((p, i) => {
      const b = this.buffers[i];
      const texture = textures.get(p.texture);
      if (!texture) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.position);
      gl.bufferData(gl.ARRAY_BUFFER, positions[i], gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(at("position"), 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(at("position"));
      gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);
      gl.vertexAttribPointer(at("uv"), 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(at("uv"));
      gl.bindBuffer(gl.ARRAY_BUFFER, b.color);
      gl.vertexAttribPointer(at("color"), 4, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(at("color"));
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1f(gl.getUniformLocation(program, "cutout"), p.cutout ? 0.5 : 0.01);
      if (b.index) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.index);
        gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0);
      } else gl.drawArrays(gl.TRIANGLES, 0, b.count);
    });
  }
}

function expand(rgb) {
  const out = new Float32Array((rgb.length / 3) * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    out[j] = rgb[i];
    out[j + 1] = rgb[i + 1];
    out[j + 2] = rgb[i + 2];
    out[j + 3] = 1;
  }
  return out;
}
