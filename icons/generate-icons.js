// One-off script to generate PWA icon PNGs without external dependencies.
// Run with: node generate-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgbaPixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type none
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Simple pixel-drawing helpers
function makeCanvas(size) {
  const px = Buffer.alloc(size * size * 4);
  return {
    size,
    px,
    set(x, y, r, g, b, a) {
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
      const i = (y * this.size + x) * 4;
      // alpha blend onto existing
      const srcA = a / 255;
      const dstR = this.px[i], dstG = this.px[i + 1], dstB = this.px[i + 2], dstA = this.px[i + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      let outR, outG, outB;
      if (outA === 0) {
        outR = outG = outB = 0;
      } else {
        outR = (r * srcA + dstR * dstA * (1 - srcA)) / outA;
        outG = (g * srcA + dstG * dstA * (1 - srcA)) / outA;
        outB = (b * srcA + dstB * dstA * (1 - srcA)) / outA;
      }
      this.px[i] = Math.round(outR);
      this.px[i + 1] = Math.round(outG);
      this.px[i + 2] = Math.round(outB);
      this.px[i + 3] = Math.round(outA * 255);
    },
    fillRoundedRect(x0, y0, x1, y1, radius, color) {
      const [r, g, b] = color;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const inCore = x >= x0 + radius && x <= x1 - radius && y >= y0 && y <= y1;
          const inCore2 = y >= y0 + radius && y <= y1 - radius && x >= x0 && x <= x1;
          let inside = inCore || inCore2;
          if (!inside) {
            const corners = [
              [x0 + radius, y0 + radius],
              [x1 - radius, y0 + radius],
              [x0 + radius, y1 - radius],
              [x1 - radius, y1 - radius],
            ];
            for (const [cx, cy] of corners) {
              const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
              if (dx * dx + dy * dy <= radius * radius) {
                inside = true;
                break;
              }
            }
          }
          if (inside) this.set(x, y, r, g, b, 255);
        }
      }
    },
    fillCircle(cx, cy, radius, color, alpha = 255) {
      const [r, g, b] = color;
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= radius * radius) this.set(x, y, r, g, b, alpha);
        }
      }
    },
  };
}

// Draw a simple phone-handset glyph using rotated rounded rectangle approximation
function drawPhoneGlyph(canvas, size) {
  const white = [255, 255, 255];
  const cx = size / 2, cy = size / 2;
  const s = size / 512; // scale factor relative to 512 baseline

  // Handset body drawn as a thick arc: approximate with two circles (ear + mouth pieces) + a diagonal bar
  const armLen = 150 * s;
  const armRad = 34 * s;
  const angle = -45 * Math.PI / 180;

  // Draw diagonal bar (the handset body) as a capsule between two points
  const x1 = cx - armLen / 2 * Math.cos(angle);
  const y1 = cy - armLen / 2 * Math.sin(angle);
  const x2 = cx + armLen / 2 * Math.cos(angle);
  const y2 = cy + armLen / 2 * Math.sin(angle);

  const steps = 400;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    const r = armRad * (0.72 + 0.28 * Math.sin(t * Math.PI)); // slightly bulge ends
    canvas.fillCircle(x, y, r, white);
  }

  // Earpiece and mouthpiece caps (rounded ends, slightly bigger)
  canvas.fillCircle(x1, y1, armRad * 1.05, white);
  canvas.fillCircle(x2, y2, armRad * 1.05, white);

  // Carve the inner curve to look like a handset (subtract a background-colored circle from the middle top)
}

function buildIcon(size, { maskablePadding = false } = {}) {
  const canvas = makeCanvas(size);
  const bg = [17, 94, 89]; // deep teal
  if (maskablePadding) {
    // Fill entire canvas with bg for maskable safe zone, glyph smaller & centered
    canvas.fillRoundedRect(0, 0, size, size, 0, bg);
    const inner = makeCanvas(size);
    drawPhoneGlyph(inner, size * 0.6);
    // composite inner (scaled visually by drawing glyph at 0.6 scale directly)
  } else {
    const radius = size * 0.22;
    canvas.fillRoundedRect(0, 0, size, size, radius, bg);
  }
  const scale = maskablePadding ? 0.62 : 1;
  drawPhoneGlyphScaled(canvas, size, scale);
  return canvas.px;
}

function drawPhoneGlyphScaled(canvas, size, scale) {
  const white = [255, 255, 255];
  const cx = size / 2, cy = size / 2;
  const s = (size / 512) * scale;
  const armLen = 150 * s;
  const armRad = 34 * s;
  const angle = -45 * Math.PI / 180;
  const x1 = cx - armLen / 2 * Math.cos(angle);
  const y1 = cy - armLen / 2 * Math.sin(angle);
  const x2 = cx + armLen / 2 * Math.cos(angle);
  const y2 = cy + armLen / 2 * Math.sin(angle);
  const steps = 400;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    const r = armRad * (0.72 + 0.28 * Math.sin(t * Math.PI));
    canvas.fillCircle(x, y, r, white);
  }
  canvas.fillCircle(x1, y1, armRad * 1.05, white);
  canvas.fillCircle(x2, y2, armRad * 1.05, white);
}

function writeIcon(filename, size, opts) {
  const px = buildIcon(size, opts);
  const png = encodePNG(size, size, Buffer.from(px));
  fs.writeFileSync(path.join(__dirname, filename), png);
  console.log('wrote', filename, size + 'x' + size);
}

writeIcon('icon-192.png', 192);
writeIcon('icon-512.png', 512);
writeIcon('icon-maskable-512.png', 512, { maskablePadding: true });
writeIcon('apple-touch-icon.png', 180);
