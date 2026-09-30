/**
 * 从截图中找出"主色簇"：把像素按色相分桶，报告占比最高的几个色相及其代表色。
 *
 * 用途：在没有 DevTools 的情况下，判断界面主色调是否真的随壁纸变化。
 * 纯 Node 解码 PNG（zlib + 手工反滤波），不依赖第三方库。
 *
 * 用法：node scripts/dominant_color.mjs <png路径> [topN]
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`不支持的色彩类型 ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rb = raw[pos++];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = y > 0 && x >= channels ? out[prevStart + x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = rb; break;
        case 1: val = rb + a; break;
        case 2: val = rb + b; break;
        case 3: val = rb + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知滤波 ${filter}`);
      }
      out[rowStart + x] = val & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

const path = process.argv[2];
const topN = Number(process.argv[3] ?? 6);
const img = decodePng(readFileSync(path));
const { width, height, channels, data } = img;

const BUCKETS = 24;
const weight = new Array(BUCKETS).fill(0);
const sumR = new Array(BUCKETS).fill(0);
const sumG = new Array(BUCKETS).fill(0);
const sumB = new Array(BUCKETS).fill(0);
let total = 0;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    total++;
    if (s < 0.06 || l < 0.06 || l > 0.97) continue; // 忽略近灰与纯黑白
    const idx = Math.floor(h / (360 / BUCKETS)) % BUCKETS;
    weight[idx] += s * s;
    sumR[idx] += r * s * s;
    sumG[idx] += g * s * s;
    sumB[idx] += b * s * s;
  }
}

const rows = [];
for (let i = 0; i < BUCKETS; i++) {
  if (weight[i] <= 0) continue;
  const w = weight[i];
  rows.push({
    hueRange: `${Math.round(i * 15)}-${Math.round(i * 15 + 15)}°`,
    share: +(w / total).toFixed(5),
    hex:
      "#" +
      [sumR[i] / w, sumG[i] / w, sumB[i] / w]
        .map((v) => Math.round(v).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase(),
  });
}
rows.sort((a, b) => b.share - a.share);

console.log(JSON.stringify({ file: path, size: `${width}x${height}`, top: rows.slice(0, topN) }, null, 2));
