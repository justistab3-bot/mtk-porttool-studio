/**
 * 图像特征分析（开发辅助，不参与打包）。
 *
 * 在无法直接查看截图的场合，用像素统计判断窗口是否真的渲染出了界面：
 * 平均色、主色簇、非背景像素占比、分区密度。纯 Node 解码 PNG（zlib + 手工反滤波）。
 *
 * 用法：node scripts/analyze_image.mjs <png路径>
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
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
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
      const rawByte = raw[pos++];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = y > 0 && x >= channels ? out[prevStart + x - channels] : 0;
      let val;
      switch (filter) {
        case 0:
          val = rawByte;
          break;
        case 1:
          val = rawByte + a;
          break;
        case 2:
          val = rawByte + b;
          break;
        case 3:
          val = rawByte + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`未知滤波 ${filter}`);
      }
      out[rowStart + x] = val & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

const path = process.argv[2];
const img = decodePng(readFileSync(path));
const { width, height, channels, data } = img;

const key = (i) => {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return `${r >> 4},${g >> 4},${b >> 4}`;
};

const histogram = new Map();
let sumR = 0;
let sumG = 0;
let sumB = 0;
let nonWhite = 0;
let dark = 0;
const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0));
const gridTotal = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0));

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    const k = key(i);
    histogram.set(k, (histogram.get(k) ?? 0) + 1);
    const lum = (r + g + b) / 3;
    if (lum < 250) nonWhite++;
    if (lum < 90) dark++;
    const gy = Math.min(3, Math.floor((y / height) * 4));
    const gx = Math.min(3, Math.floor((x / width) * 4));
    gridTotal[gy][gx]++;
    if (lum < 200) grid[gy][gx]++;
  }
}

const total = width * height;
const top = [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

console.log(
  JSON.stringify(
    {
      file: path,
      size: `${width}x${height}`,
      channels,
      averageRgb: [Math.round(sumR / total), Math.round(sumG / total), Math.round(sumB / total)],
      nonWhiteRatio: +(nonWhite / total).toFixed(4),
      darkRatio: +(dark / total).toFixed(4),
      topColors: top.map(([k, c]) => ({ rgb4bit: k, ratio: +(c / total).toFixed(4) })),
      densityGrid: grid.map((row, gy) =>
        row.map((c, gx) => +(c / gridTotal[gy][gx]).toFixed(3)),
      ),
    },
    null,
    2,
  ),
);
