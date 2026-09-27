/**
 * The skin atlases and the hair cards' textures, read in node: the headless
 * renderer draws with them and the skin validator finds the painted areola on
 * the atlases.
 */

import { inflateSync } from "node:zlib";

/** Channels per pixel for each 8-bit PNG colour type this reads. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * A PNG, as linear-light floats.
 *
 * Only what the atlases and the card textures are: 8-bit grey or truecolour,
 * with or without alpha, no interlace, no palette. Colour is decoded from sRGB
 * and alpha is not, since alpha is a coverage and was never encoded. The five
 * filter types are the whole of the format's compression on top of DEFLATE,
 * and `zlib` supplies the rest.
 *
 * @returns {{width:number, height:number, channels:number, data:Float32Array}}
 */
export function decodePNG(bytes) {
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const channels = CHANNELS[bytes[25]];
  if (bytes[24] !== 8 || !channels || bytes[28] !== 0) {
    throw new Error("only 8-bit grey or truecolour, non-interlaced PNG is supported");
  }
  const alpha = channels === 2 || channels === 4 ? channels - 1 : -1;
  const chunks = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));

  const decode = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const s = i / 255;
    decode[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  const stride = width * channels;
  const out = new Float32Array(width * height * channels);
  const line = Buffer.alloc(stride);
  const prior = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prior[i];
      const c = i >= channels ? prior[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = value & 0xff;
    }
    for (let i = 0; i < stride; i += 1) {
      out[y * stride + i] = i % channels === alpha ? line[i] / 255 : decode[line[i]];
    }
    line.copy(prior);
  }
  return { width, height, channels, data: out };
}

/** Bilinear sample, wrapped, one value per channel. The atlas has a border of
 *  flat tone, so the wrap never shows; clamping instead would streak it. */
export function sampleAtlas(atlas, u, v) {
  const channels = atlas.channels ?? 3;
  const x = (u - Math.floor(u)) * atlas.width - 0.5;
  const y = (v - Math.floor(v)) * atlas.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px, py) => {
    const cx = ((px % atlas.width) + atlas.width) % atlas.width;
    const cy = ((py % atlas.height) + atlas.height) % atlas.height;
    return (cy * atlas.width + cx) * channels;
  };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const out = new Array(channels);
  for (let k = 0; k < channels; k += 1) {
    const top = atlas.data[a + k] + (atlas.data[b + k] - atlas.data[a + k]) * fx;
    const bottom = atlas.data[c + k] + (atlas.data[d + k] - atlas.data[c + k]) * fx;
    out[k] = top + (bottom - top) * fy;
  }
  return out;
}
