/**
 * 生成应用图标 PNG（无第三方依赖，手写 PNG 编码）
 * 图形：金色渐变圆角方块 + 三根递增的 K 线柱（深色）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 绘图（超采样抗锯齿） ---------- */
const SS = 3; // 超采样倍数

function lerp(a, b, t) { return a + (b - a) * t; }

/** 圆角矩形覆盖率 */
function roundRectCov(x, y, w, h, r) {
  // 返回该点在圆角矩形内的权重 0/1（用超采样已足够）
  const inX = x >= 0 && x <= w;
  const inY = y >= 0 && y <= h;
  if (!inX || !inY) return 0;
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const dx = x - cx, dy = y - cy;
  return (dx * dx + dy * dy) <= r * r + 1e-9 ? 1 : 0;
}

function drawIcon(size, opts) {
  const o = opts || {};
  const pad = o.pad == null ? 0.10 : o.pad;   // 安全边距比例
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);        // 透明底

  const m = S * pad;                          // 外边距
  const W = S - m * 2;                        // 图标实际宽度
  const R = W * 0.235;                        // 圆角半径（近似 iOS squircle）

  // 金色渐变：顶部亮 → 底部深
  const c1 = [255, 214, 74];
  const c2 = [240, 185, 11];
  const c3 = [201, 122, 6];

  // 柱子参数（相对图标宽度）
  const barW = W * 0.135;
  const gap = W * 0.075;
  const totalW = barW * 3 + gap * 2;
  const startX = (S - totalW) / 2;
  const baseY = m + W * 0.78;                 // 柱底
  const heights = [W * 0.26, W * 0.42, W * 0.60];
  const barR = barW / 2;
  const markColor = [18, 21, 26];

  function inBar(px, py, i) {
    const bx = startX + i * (barW + gap);
    const by = baseY - heights[i];
    // 胶囊形：竖条 + 顶/底半圆
    if (px < bx - barR || px > bx + barW + barR) return 0;
    if (py < by - barR || py > baseY + barR) return 0;
    const cx = Math.min(Math.max(px, bx + barR), bx + barW - barR);
    const cy = Math.min(Math.max(py, by + barR), baseY - barR);
    const dx = px - cx, dy = py - cy;
    return (dx * dx + dy * dy) <= barR * barR ? 1 : 0;
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const lx = x + 0.5, ly = y + 0.5;
      if (!roundRectCov(lx - m, ly - m, W, W, R)) continue;

      // 渐变
      const t = (ly - m) / W;
      let col;
      if (t < 0.55) {
        const k = t / 0.55;
        col = [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)];
      } else {
        const k = (t - 0.55) / 0.45;
        col = [lerp(c2[0], c3[0], k), lerp(c2[1], c3[1], k), lerp(c2[2], c3[2], k)];
      }

      // 三根柱子
      for (let b = 0; b < 3; b++) {
        if (inBar(lx, ly, b)) {
          col = markColor;
          break;
        }
      }
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }

  // 下采样到目标尺寸
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = (((y * SS + sy) * S) + (x * SS + sx)) * 4;
          const al = buf[i + 3] / 255;
          r += buf[i] * al; g += buf[i + 1] * al; b += buf[i + 2] * al; a += al;
        }
      }
      const n = SS * SS;
      const o2 = (y * size + x) * 4;
      out[o2] = a > 0 ? Math.round(r / a) : 0;
      out[o2 + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o2 + 2] = a > 0 ? Math.round(b / a) : 0;
      out[o2 + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePNG(size, size, out);
}

/* ---------- 输出 ---------- */
const root = path.resolve(__dirname, '..');
const webDir = path.join(root, 'www', 'icons');
fs.mkdirSync(webDir, { recursive: true });

const webSizes = [192, 512];
webSizes.forEach((s) => {
  fs.writeFileSync(path.join(webDir, 'icon-' + s + '.png'), drawIcon(s, { pad: 0.06 }));
  console.log('www/icons/icon-' + s + '.png');
});

// Android mipmap：标准图标 + 自适应图标前景（更大内边距）
const androidRes = path.join(root, 'android', 'res');
const mipmaps = [
  ['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]
];
mipmaps.forEach(([dir, s]) => {
  const d = path.join(androidRes, dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'ic_launcher.png'), drawIcon(s, { pad: 0.07 }));
  console.log('android/res/' + dir + '/ic_launcher.png (' + s + ')');
});

// 自适应图标前景 432x432（内容居中在 66% 安全区）
const fg = path.join(androidRes, 'mipmap-xxxhdpi');
fs.writeFileSync(path.join(fg, 'ic_launcher_fg.png'), drawIcon(432, { pad: 0.17 }));
console.log('android/res/mipmap-xxxhdpi/ic_launcher_fg.png (432)');

// PWA 用的 SVG 版本（矢量，随主题无关）
console.log('done');
