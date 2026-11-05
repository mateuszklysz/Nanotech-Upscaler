// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Mateusz Kłysz
// A .zip written as it is made, part by part (the launcher's saveWrite), so a pack of thousands
// of textures never sits in memory whole. Entries are stored: a PNG is compressed already. Past
// 4 GB or 65535 entries it carries the ZIP64 records.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 2026-01-01 00:00, in DOS time: every entry the same, so the same textures make the same file.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const MAX32 = 0xffffffff;
const encoder = new TextEncoder();

export class ZipWriter {
  /** `sink(bytes)` takes each part in order (and may be slow: it is awaited). */
  constructor(sink, partSize = 8 << 20) {
    this.sink = sink;
    this.partSize = partSize;
    this.parts = [];
    this.buffered = 0;
    this.offset = 0;
    this.entries = [];
  }

  async add(name, bytes) {
    const path = encoder.encode(name);
    const crc = crc32(bytes);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // names in UTF-8
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, DOS_TIME, true);
    header.setUint16(12, DOS_DATE, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, path.length, true);
    this.entries.push({ path, crc, size: bytes.length, offset: this.offset });
    await this.#write(new Uint8Array(header.buffer));
    await this.#write(path);
    await this.#write(bytes);
  }

  /** The central directory, and the rest written out. */
  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const far = e.offset >= MAX32;
      const entry = new DataView(new ArrayBuffer(46 + (far ? 12 : 0)));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, far ? 45 : 20, true);
      entry.setUint16(6, far ? 45 : 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, DOS_TIME, true);
      entry.setUint16(14, DOS_DATE, true);
      entry.setUint32(16, e.crc, true);
      entry.setUint32(20, e.size, true);
      entry.setUint32(24, e.size, true);
      entry.setUint16(28, e.path.length, true);
      entry.setUint16(30, far ? 12 : 0, true);
      entry.setUint32(38, 0o644 << 16, true);
      entry.setUint32(42, far ? MAX32 : e.offset, true);
      await this.#write(new Uint8Array(entry.buffer, 0, 46));
      await this.#write(e.path);
      if (far) {
        const extra = new DataView(new ArrayBuffer(12));
        extra.setUint16(0, 0x0001, true);
        extra.setUint16(2, 8, true);
        extra.setBigUint64(4, BigInt(e.offset), true);
        await this.#write(new Uint8Array(extra.buffer));
      }
    }
    const size = this.offset - start;
    const count = this.entries.length;
    if (count > 0xffff || start >= MAX32 || size >= MAX32) {
      const end64 = this.offset;
      const record = new DataView(new ArrayBuffer(56 + 20));
      record.setUint32(0, 0x06064b50, true);
      record.setBigUint64(4, 44n, true);
      record.setUint16(12, 45, true);
      record.setUint16(14, 45, true);
      record.setBigUint64(24, BigInt(count), true);
      record.setBigUint64(32, BigInt(count), true);
      record.setBigUint64(40, BigInt(size), true);
      record.setBigUint64(48, BigInt(start), true);
      record.setUint32(56, 0x07064b50, true);
      record.setBigUint64(64, BigInt(end64), true);
      record.setUint32(72, 1, true);
      await this.#write(new Uint8Array(record.buffer));
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Math.min(count, 0xffff), true);
    end.setUint16(10, Math.min(count, 0xffff), true);
    end.setUint32(12, Math.min(size, MAX32), true);
    end.setUint32(16, Math.min(start, MAX32), true);
    await this.#write(new Uint8Array(end.buffer));
    await this.#flush();
    return this.offset;
  }

  async #write(bytes) {
    this.parts.push(bytes);
    this.buffered += bytes.length;
    this.offset += bytes.length;
    if (this.buffered >= this.partSize) await this.#flush();
  }

  async #flush() {
    if (!this.buffered) return;
    const out = new Uint8Array(this.buffered);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    this.parts = [];
    this.buffered = 0;
    await this.sink(out);
  }
}
