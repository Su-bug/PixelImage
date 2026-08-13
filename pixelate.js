/**
 * 像素马赛克 + 特征保留降采样 + 色盘量化
 *
 * 默认不再使用平均池化。细轮廓 / 眼睛等高频特征会被平均成灰、
 * 再量化后断线。这里采用 PixelOE 思路的轮廓扩张，再按对比度与
 * 梯度从块内选出真实源像素，最后修补 1px 断线。
 */
(function (global) {
  const MAX_SOURCE = 2048;

  const PRESET_PALETTES = {
    gameboy: [
      [15, 56, 15],
      [48, 98, 48],
      [139, 172, 15],
      [155, 188, 15],
    ],
    pico8: [
      [0, 0, 0],
      [29, 43, 83],
      [126, 37, 83],
      [0, 135, 81],
      [171, 82, 54],
      [95, 87, 79],
      [194, 195, 199],
      [255, 241, 232],
      [255, 0, 77],
      [255, 163, 0],
      [255, 236, 39],
      [0, 228, 54],
      [41, 173, 255],
      [131, 118, 156],
      [255, 119, 168],
      [255, 204, 170],
    ],
    "1bit": [
      [0, 0, 0],
      [255, 255, 255],
    ],
  };

  function clampInt(value, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function luma(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function lumaAt(data, i) {
    return luma(data[i], data[i + 1], data[i + 2]);
  }

  function sigmoid(x) {
    if (x > 20) return 1;
    if (x < -20) return 0;
    return 1 / (1 + Math.exp(-x));
  }

  function drawSource(img) {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const scale = Math.min(1, MAX_SOURCE / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = scale < 0.85;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function computeSobel(data, w, h) {
    const mag = new Float32Array(w * h);
    const L = (x, y) => lumaAt(data, (y * w + x) * 4);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const tl = L(x - 1, y - 1);
        const t = L(x, y - 1);
        const tr = L(x + 1, y - 1);
        const lft = L(x - 1, y);
        const rgt = L(x + 1, y);
        const bl = L(x - 1, y + 1);
        const b = L(x, y + 1);
        const br = L(x + 1, y + 1);
        const gx = -tl + tr - 2 * lft + 2 * rgt - bl + br;
        const gy = -tl - 2 * t - tr + bl + 2 * b + br;
        mag[y * w + x] = Math.hypot(gx, gy);
      }
    }
    return mag;
  }

  function cellBounds(tx, ty, targetW, targetH, srcW, srcH) {
    const x0 = Math.floor((tx * srcW) / targetW);
    const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * srcW) / targetW));
    const y0 = Math.floor((ty * srcH) / targetH);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * srcH) / targetH));
    return { x0, x1, y0, y1 };
  }

  function upsampleBilinear(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const fy = ((y + 0.5) * sh) / dh - 0.5;
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
      const y1 = Math.min(sh - 1, y0 + 1);
      const ty = Math.max(0, Math.min(1, fy - Math.floor(fy)));
      for (let x = 0; x < dw; x++) {
        const fx = ((x + 0.5) * sw) / dw - 0.5;
        const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
        const x1 = Math.min(sw - 1, x0 + 1);
        const tx = Math.max(0, Math.min(1, fx - Math.floor(fx)));
        const v00 = src[y0 * sw + x0];
        const v10 = src[y0 * sw + x1];
        const v01 = src[y1 * sw + x0];
        const v11 = src[y1 * sw + x1];
        out[y * dw + x] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      }
    }
    return out;
  }

  function morphLuma(imageData, mode, iterations) {
    if (iterations <= 0) return imageData;
    const w = imageData.width;
    const h = imageData.height;
    let src = new Uint8ClampedArray(imageData.data);
    let dst = new Uint8ClampedArray(src.length);

    for (let n = 0; n < iterations; n++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const io = (y * w + x) * 4;
          if (src[io + 3] < 8) {
            dst[io] = 0;
            dst[io + 1] = 0;
            dst[io + 2] = 0;
            dst[io + 3] = 0;
            continue;
          }
          let bestL = mode === "dilate" ? -1e9 : 1e9;
          let best = io;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= w) continue;
              const i = (ny * w + nx) * 4;
              if (src[i + 3] < 8) continue;
              const L = lumaAt(src, i);
              if (mode === "dilate" ? L > bestL : L < bestL) {
                bestL = L;
                best = i;
              }
            }
          }
          dst[io] = src[best];
          dst[io + 1] = src[best + 1];
          dst[io + 2] = src[best + 2];
          dst[io + 3] = src[best + 3];
        }
      }
      const tmp = src;
      src = dst;
      dst = tmp;
    }
    return new ImageData(new Uint8ClampedArray(src), w, h);
  }

  function expansionWeightMap(data, srcW, srcH, targetW, targetH) {
    const weights = new Float32Array(targetW * targetH);
    let wMin = Infinity;
    let wMax = -Infinity;

    for (let ty = 0; ty < targetH; ty++) {
      const y0 = Math.max(0, Math.floor(((ty - 0.5) * srcH) / targetH));
      const y1 = Math.min(srcH, Math.ceil(((ty + 1.5) * srcH) / targetH));
      for (let tx = 0; tx < targetW; tx++) {
        const x0 = Math.max(0, Math.floor(((tx - 0.5) * srcW) / targetW));
        const x1 = Math.min(srcW, Math.ceil(((tx + 1.5) * srcW) / targetW));
        let minL = 255;
        let maxL = 0;
        let sum = 0;
        let count = 0;
        const hist = new Uint16Array(256);

        for (let y = y0; y < y1; y++) {
          let i = (y * srcW + x0) * 4;
          for (let x = x0; x < x1; x++) {
            if (data[i + 3] >= 16) {
              const L = Math.round(lumaAt(data, i));
              hist[L]++;
              sum += L;
              count++;
              if (L < minL) minL = L;
              if (L > maxL) maxL = L;
            }
            i += 4;
          }
        }

        let med = minL;
        if (count) {
          let acc = 0;
          const mid = count / 2;
          for (let t = 0; t < 256; t++) {
            acc += hist[t];
            if (acc >= mid) {
              med = t;
              break;
            }
          }
        } else {
          minL = 128;
          maxL = 128;
          med = 128;
          sum = 128;
          count = 1;
        }

        const avg = med / 255;
        const brightDist = (maxL - med) / 255;
        const darkDist = (med - minL) / 255;
        const w = sigmoid((avg - 0.5) * 10 - (brightDist - darkDist) * 4);
        weights[ty * targetW + tx] = w;
        if (w < wMin) wMin = w;
        if (w > wMax) wMax = w;
      }
    }

    const span = Math.max(1e-6, wMax - wMin);
    for (let i = 0; i < weights.length; i++) weights[i] = (weights[i] - wMin) / span;
    return upsampleBilinear(weights, targetW, targetH, srcW, srcH);
  }

  function outlineExpand(imageData, targetW, targetH) {
    const srcW = imageData.width;
    const srcH = imageData.height;
    const patch = Math.min(srcW / targetW, srcH / targetH);
    const thickness = patch >= 16 ? 2 : 1;
    const data = imageData.data;
    const weight = expansionWeightMap(data, srcW, srcH, targetW, targetH);
    const eroded = morphLuma(imageData, "erode", thickness);
    const dilated = morphLuma(imageData, "dilate", thickness);
    const out = new ImageData(srcW, srcH);
    const d = out.data;
    const e = eroded.data;
    const dil = dilated.data;

    for (let p = 0, i = 0; p < srcW * srcH; p++, i += 4) {
      if (data[i + 3] < 8) {
        d[i + 3] = 0;
        continue;
      }
      const wt = weight[p];
      const origW = sigmoid((wt - 0.5) * 5) * 0.25;
      const inv = 1 - wt;
      for (let c = 0; c < 4; c++) {
        const morph = e[i + c] * wt + dil[i + c] * inv;
        d[i + c] = Math.round(morph * (1 - origW) + data[i + c] * origW);
      }
    }

    if (srcW * srcH > 1.2e6) return out;
    return morphLuma(morphLuma(morphLuma(out, "erode", 1), "dilate", 1), "erode", 1);
  }

  function writePixel(dst, di, src, si) {
    dst[di] = src[si];
    dst[di + 1] = src[si + 1];
    dst[di + 2] = src[si + 2];
    dst[di + 3] = src[si + 3];
  }

  function mosaicAverage(srcImageData, targetW, targetH) {
    const srcW = srcImageData.width;
    const srcH = srcImageData.height;
    const src = srcImageData.data;
    const out = new ImageData(targetW, targetH);
    const dst = out.data;

    for (let ty = 0; ty < targetH; ty++) {
      for (let tx = 0; tx < targetW; tx++) {
        const { x0, x1, y0, y1 } = cellBounds(tx, ty, targetW, targetH, srcW, srcH);
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let count = 0;
        for (let y = y0; y < y1; y++) {
          let i = (y * srcW + x0) * 4;
          for (let x = x0; x < x1; x++) {
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            a += src[i + 3];
            count++;
            i += 4;
          }
        }
        const di = (ty * targetW + tx) * 4;
        dst[di] = Math.round(r / count);
        dst[di + 1] = Math.round(g / count);
        dst[di + 2] = Math.round(b / count);
        dst[di + 3] = Math.round(a / count);
      }
    }
    return out;
  }

  function mosaicMedian(srcImageData, targetW, targetH) {
    const srcW = srcImageData.width;
    const srcH = srcImageData.height;
    const src = srcImageData.data;
    const out = new ImageData(targetW, targetH);
    const dst = out.data;
    const hist = new Uint32Array(256);

    for (let ty = 0; ty < targetH; ty++) {
      for (let tx = 0; tx < targetW; tx++) {
        const { x0, x1, y0, y1 } = cellBounds(tx, ty, targetW, targetH, srcW, srcH);
        hist.fill(0);
        let count = 0;
        let sumA = 0;
        let centerI = -1;
        const cy = (y0 + y1) >> 1;
        const cx = (x0 + x1) >> 1;

        for (let y = y0; y < y1; y++) {
          let i = (y * srcW + x0) * 4;
          for (let x = x0; x < x1; x++) {
            if (src[i + 3] >= 16) {
              hist[Math.round(lumaAt(src, i))]++;
              count++;
              sumA += src[i + 3];
              if (y === cy && x === cx) centerI = i;
            } else if (centerI < 0 && y === cy && x === cx) {
              centerI = i;
            }
            i += 4;
          }
        }

        const di = (ty * targetW + tx) * 4;
        if (!count) {
          dst[di + 3] = 0;
          continue;
        }

        let acc = 0;
        let medianL = 0;
        const mid = count / 2;
        for (let t = 0; t < 256; t++) {
          acc += hist[t];
          if (acc >= mid) {
            medianL = t;
            break;
          }
        }

        let bestI = centerI;
        let bestD = 1e9;
        for (let y = y0; y < y1; y++) {
          let i = (y * srcW + x0) * 4;
          for (let x = x0; x < x1; x++) {
            if (src[i + 3] >= 16) {
              const d = Math.abs(lumaAt(src, i) - medianL);
              if (d < bestD) {
                bestD = d;
                bestI = i;
              }
            }
            i += 4;
          }
        }
        writePixel(dst, di, src, bestI);
        dst[di + 3] = Math.round(sumA / count);
      }
    }
    return out;
  }

  function mosaicKCentroid(srcImageData, targetW, targetH) {
    const srcW = srcImageData.width;
    const srcH = srcImageData.height;
    const src = srcImageData.data;
    const out = new ImageData(targetW, targetH);
    const dst = out.data;

    for (let ty = 0; ty < targetH; ty++) {
      for (let tx = 0; tx < targetW; tx++) {
        const { x0, x1, y0, y1 } = cellBounds(tx, ty, targetW, targetH, srcW, srcH);
        const samples = [];
        let minI = -1;
        let maxI = -1;
        let minL = 255;
        let maxL = 0;
        let sumA = 0;

        for (let y = y0; y < y1; y++) {
          let i = (y * srcW + x0) * 4;
          for (let x = x0; x < x1; x++) {
            if (src[i + 3] >= 16) {
              const L = lumaAt(src, i);
              samples.push(i);
              sumA += src[i + 3];
              if (L < minL) {
                minL = L;
                minI = i;
              }
              if (L > maxL) {
                maxL = L;
                maxI = i;
              }
            }
            i += 4;
          }
        }

        const di = (ty * targetW + tx) * 4;
        if (!samples.length) {
          dst[di + 3] = 0;
          continue;
        }
        if (samples.length === 1 || maxL - minL < 18) {
          writePixel(dst, di, src, samples[samples.length >> 1]);
          dst[di + 3] = Math.round(sumA / samples.length);
          continue;
        }

        let c0 = [src[minI], src[minI + 1], src[minI + 2]];
        let c1 = [src[maxI], src[maxI + 1], src[maxI + 2]];
        let n0 = 1;
        let n1 = 1;
        for (let iter = 0; iter < 6; iter++) {
          let s0 = [0, 0, 0];
          let s1 = [0, 0, 0];
          n0 = 0;
          n1 = 0;
          for (let s = 0; s < samples.length; s++) {
            const i = samples[s];
            const d0 = colorDist2([src[i], src[i + 1], src[i + 2]], c0);
            const d1 = colorDist2([src[i], src[i + 1], src[i + 2]], c1);
            if (d0 <= d1) {
              s0[0] += src[i];
              s0[1] += src[i + 1];
              s0[2] += src[i + 2];
              n0++;
            } else {
              s1[0] += src[i];
              s1[1] += src[i + 1];
              s1[2] += src[i + 2];
              n1++;
            }
          }
          if (!n0 || !n1) break;
          c0 = [s0[0] / n0, s0[1] / n0, s0[2] / n0];
          c1 = [s1[0] / n1, s1[1] / n1, s1[2] / n1];
        }

        const major = n0 >= n1 ? c0 : c1;
        let bestI = samples[0];
        let bestD = 1e18;
        for (let s = 0; s < samples.length; s++) {
          const i = samples[s];
          const d = colorDist2([src[i], src[i + 1], src[i + 2]], major);
          if (d < bestD) {
            bestD = d;
            bestI = i;
          }
        }
        writePixel(dst, di, src, bestI);
        dst[di + 3] = Math.round(sumA / samples.length);
      }
    }
    return out;
  }

  function mosaicFeature(srcImageData, targetW, targetH) {
    const srcW = srcImageData.width;
    const srcH = srcImageData.height;
    const src = srcImageData.data;
    const grad = computeSobel(src, srcW, srcH);
    const out = new ImageData(targetW, targetH);
    const dst = out.data;
    const hist = new Uint32Array(256);

    for (let ty = 0; ty < targetH; ty++) {
      for (let tx = 0; tx < targetW; tx++) {
        const { x0, x1, y0, y1 } = cellBounds(tx, ty, targetW, targetH, srcW, srcH);
        const area = (x1 - x0) * (y1 - y0);
        hist.fill(0);
        let count = 0;
        let sumL = 0;
        let sumA = 0;
        let minL = 255;
        let maxL = 0;
        let maxG = -1;
        let maxGI = -1;
        let centerI = -1;
        const cy = (y0 + y1) >> 1;
        const cx = (x0 + x1) >> 1;

        for (let y = y0; y < y1; y++) {
          let i = (y * srcW + x0) * 4;
          for (let x = x0; x < x1; x++) {
            if (src[i + 3] >= 16) {
              const L = lumaAt(src, i);
              const Li = Math.max(0, Math.min(255, Math.round(L)));
              hist[Li]++;
              count++;
              sumL += L;
              sumA += src[i + 3];
              if (L < minL) minL = L;
              if (L > maxL) maxL = L;
              const g = grad[y * srcW + x];
              if (g > maxG) {
                maxG = g;
                maxGI = i;
              }
              if (y === cy && x === cx) centerI = i;
            }
            i += 4;
          }
        }

        const di = (ty * targetW + tx) * 4;
        if (!count || count / area < 0.12) {
          dst[di + 3] = 0;
          continue;
        }

        let acc = 0;
        let medianL = minL;
        const mid = count / 2;
        for (let t = 0; t < 256; t++) {
          acc += hist[t];
          if (acc >= mid) {
            medianL = t;
            break;
          }
        }

        const contrast = maxL - minL;
        const split = (minL + maxL) * 0.5;
        let darkCount = 0;
        const splitBin = Math.max(0, Math.min(255, Math.round(split)));
        for (let t = 0; t <= splitBin; t++) darkCount += hist[t];
        const darkRatio = darkCount / count;

        let bestI = maxGI >= 0 ? maxGI : centerI >= 0 ? centerI : (y0 * srcW + x0) * 4;
        let bestScore = -1e18;

        for (let y = y0; y < y1; y++) {
          let i = (y * srcW + x0) * 4;
          for (let x = x0; x < x1; x++) {
            if (src[i + 3] >= 16) {
              const L = lumaAt(src, i);
              const g = grad[y * srcW + x];
              let score;
              if (contrast < 28) {
                score = -Math.abs(L - medianL) * 8;
              } else {
                score = g;
                if (darkRatio >= 0.05 && darkRatio <= 0.42 && contrast >= 50 && L <= split) {
                  score += 90 + (split - L);
                }
                if (darkRatio >= 0.58 && darkRatio <= 0.95 && contrast >= 50 && L >= split) {
                  score += 90 + (L - split);
                }
              }
              if (score > bestScore) {
                bestScore = score;
                bestI = i;
              }
            }
            i += 4;
          }
        }

        writePixel(dst, di, src, bestI);
        dst[di + 3] = Math.round(sumA / count);
      }
    }
    return out;
  }

  function colorDist2(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
  }

  function pixelAt(data, w, h, x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const i = (y * w + x) * 4;
    if (data[i + 3] < 8) return null;
    return [data[i], data[i + 1], data[i + 2], data[i + 3], i];
  }

  function similarColor(a, b, thresh2) {
    if (!a || !b) return false;
    return colorDist2(a, b) <= thresh2;
  }

  function reconnectContours(imageData, exact) {
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src);
    const thresh2 = exact ? 1 : 28 * 28;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = pixelAt(src, w, h, x, y);
        const l = pixelAt(src, w, h, x - 1, y);
        const r = pixelAt(src, w, h, x + 1, y);
        const u = pixelAt(src, w, h, x, y - 1);
        const d = pixelAt(src, w, h, x, y + 1);
        const i = (y * w + x) * 4;

        const hFill = similarColor(l, r, thresh2) && (!c || !similarColor(c, l, thresh2));
        const vFill = similarColor(u, d, thresh2) && (!c || !similarColor(c, u, thresh2));

        if (hFill && !vFill) {
          dst[i] = l[0];
          dst[i + 1] = l[1];
          dst[i + 2] = l[2];
          dst[i + 3] = Math.max(l[3], r[3]);
        } else if (vFill && !hFill) {
          dst[i] = u[0];
          dst[i + 1] = u[1];
          dst[i + 2] = u[2];
          dst[i + 3] = Math.max(u[3], d[3]);
        } else if (hFill && vFill && similarColor(l, u, thresh2)) {
          dst[i] = l[0];
          dst[i + 1] = l[1];
          dst[i + 2] = l[2];
          dst[i + 3] = Math.max(l[3], u[3]);
        }
      }
    }
    return new ImageData(dst, w, h);
  }

  function channelRange(pixels) {
    let minR = 255;
    let maxR = 0;
    let minG = 255;
    let maxG = 0;
    let minB = 255;
    let maxB = 0;
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      if (p[0] < minR) minR = p[0];
      if (p[0] > maxR) maxR = p[0];
      if (p[1] < minG) minG = p[1];
      if (p[1] > maxG) maxG = p[1];
      if (p[2] < minB) minB = p[2];
      if (p[2] > maxB) maxB = p[2];
    }
    const ranges = [maxR - minR, maxG - minG, maxB - minB];
    let channel = 0;
    if (ranges[1] > ranges[channel]) channel = 1;
    if (ranges[2] > ranges[channel]) channel = 2;
    return { channel, maxRange: ranges[channel] };
  }

  function averageColor(pixels) {
    let r = 0;
    let g = 0;
    let b = 0;
    const n = pixels.length;
    for (let i = 0; i < n; i++) {
      r += pixels[i][0];
      g += pixels[i][1];
      b += pixels[i][2];
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function medianCutPalette(imageData, colorCount) {
    const d = imageData.data;
    const pixels = [];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 16) continue;
      pixels.push([d[i], d[i + 1], d[i + 2]]);
    }
    if (pixels.length === 0) return [[0, 0, 0]];

    const k = Math.max(1, Math.min(colorCount, pixels.length));
    const buckets = [pixels];

    while (buckets.length < k) {
      let bestIdx = -1;
      let bestRange = -1;
      for (let i = 0; i < buckets.length; i++) {
        if (buckets[i].length <= 1) continue;
        const info = channelRange(buckets[i]);
        if (info.maxRange > bestRange) {
          bestRange = info.maxRange;
          bestIdx = i;
        }
      }
      if (bestIdx < 0 || bestRange <= 0) break;

      const bucket = buckets.splice(bestIdx, 1)[0];
      const { channel } = channelRange(bucket);
      bucket.sort((a, b) => a[channel] - b[channel]);
      const mid = Math.max(1, Math.floor(bucket.length / 2));
      buckets.push(bucket.slice(0, mid));
      buckets.push(bucket.slice(mid));
    }

    return buckets.map(averageColor);
  }

  function nearestColor(rgb, palette) {
    let best = palette[0];
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const d = colorDist2(rgb, palette[i]);
      if (d < bestD) {
        bestD = d;
        best = palette[i];
      }
    }
    return best;
  }

  function quantize(imageData, palette) {
    if (!palette || palette.length === 0) return imageData;
    const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
        continue;
      }
      const c = nearestColor([d[i], d[i + 1], d[i + 2]], palette);
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
    return out;
  }

  function uniqueColors(imageData) {
    const seen = new Set();
    const list = [];
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (seen.has(key)) continue;
      seen.add(key);
      list.push([d[i], d[i + 1], d[i + 2]]);
      if (list.length >= 96) break;
    }
    return list;
  }

  function resizeImageData(src, w, h) {
    const from = imageDataToCanvas(src);
    const to = document.createElement("canvas");
    to.width = w;
    to.height = h;
    const ctx = to.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(from, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function computeBlockGrid(srcW, srcH, blockSize, maxOutput) {
    const block = clampInt(blockSize, 1, 32);
    let w = Math.max(1, srcW);
    let h = Math.max(1, srcH);
    const cap = maxOutput > 0 ? clampInt(maxOutput, 32, 1024) : 1024;
    const scale = Math.min(1, cap / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    return {
      width: Math.max(1, Math.round(w / block)),
      height: Math.max(1, Math.round(h / block)),
      workW: w,
      workH: h,
      block,
    };
  }

  function quantizeDither(imageData, palette) {
    const w = imageData.width;
    const h = imageData.height;
    const out = new ImageData(new Uint8ClampedArray(imageData.data), w, h);
    const d = out.data;
    const f = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) f[i] = d[i];

    const diffuse = (x, y, er, eg, eb, factor) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const j = (y * w + x) * 4;
      if (f[j + 3] < 8) return;
      f[j] += er * factor;
      f[j + 1] += eg * factor;
      f[j + 2] += eb * factor;
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (f[i + 3] < 8) continue;
        const oldR = f[i];
        const oldG = f[i + 1];
        const oldB = f[i + 2];
        const nc = nearestColor([oldR, oldG, oldB], palette);
        f[i] = nc[0];
        f[i + 1] = nc[1];
        f[i + 2] = nc[2];
        const er = oldR - nc[0];
        const eg = oldG - nc[1];
        const eb = oldB - nc[2];
        diffuse(x + 1, y, er, eg, eb, 7 / 16);
        diffuse(x - 1, y + 1, er, eg, eb, 3 / 16);
        diffuse(x, y + 1, er, eg, eb, 5 / 16);
        diffuse(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }

    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.max(0, Math.min(255, Math.round(f[i])));
      d[i + 1] = Math.max(0, Math.min(255, Math.round(f[i + 1])));
      d[i + 2] = Math.max(0, Math.min(255, Math.round(f[i + 2])));
      d[i + 3] = d[i + 3];
    }
    return out;
  }

  function resolvePalette(mode, imageData, colorCount) {
    if (!mode || mode === "none") return null;
    if (mode === "auto") return medianCutPalette(imageData, clampInt(colorCount, 2, 256));
    if (mode === "auto8") return medianCutPalette(imageData, 8);
    if (mode === "auto16") return medianCutPalette(imageData, 16);
    if (mode === "auto32") return medianCutPalette(imageData, 32);
    return PRESET_PALETTES[mode] ? PRESET_PALETTES[mode].map((c) => c.slice()) : null;
  }

  function pixelateImage(img, options) {
    const sample = options.sample || "average";
    let src = drawSource(img);
    let width;
    let height;

    if (options.sizeMode === "block") {
      const grid = computeBlockGrid(src.width, src.height, options.blockSize, options.maxOutput);
      if (grid.workW !== src.width || grid.workH !== src.height) {
        src = resizeImageData(src, grid.workW, grid.workH);
      }
      width = grid.width;
      height = grid.height;
    } else {
      width = clampInt(options.width, 1, 512);
      height = clampInt(options.height, 1, 512);
    }

    const cellCount = width * height;
    const useOutline = options.outline !== false && cellCount <= 96 * 96;
    const useReconnect = options.reconnect !== false && cellCount <= 128 * 128;

    if (useOutline) src = outlineExpand(src, width, height);

    let pixels;
    if (sample === "feature") pixels = mosaicFeature(src, width, height);
    else if (sample === "median") pixels = mosaicMedian(src, width, height);
    else if (sample === "centroid") pixels = mosaicKCentroid(src, width, height);
    else pixels = mosaicAverage(src, width, height);

    if (useReconnect) pixels = reconnectContours(pixels, false);

    const palette = resolvePalette(options.palette, pixels, options.colorCount);
    if (palette) {
      pixels = options.dither ? quantizeDither(pixels, palette) : quantize(pixels, palette);
    }
    if (useReconnect) pixels = reconnectContours(pixels, !!palette);

    return { imageData: pixels, palette: palette || uniqueColors(pixels), width, height };
  }

  function imageDataToCanvas(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    return canvas;
  }

  function drawUpscaled(ctx, imageData, scale, showGrid) {
    const w = imageData.width;
    const h = imageData.height;
    const dw = w * scale;
    const dh = h * scale;
    ctx.canvas.width = dw;
    ctx.canvas.height = dh;
    ctx.imageSmoothingEnabled = false;
    const srcCanvas = imageDataToCanvas(imageData);
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(srcCanvas, 0, 0, dw, dh);

    if (showGrid && scale >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x++) {
        const px = x * scale + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, dh);
      }
      for (let y = 0; y <= h; y++) {
        const py = y * scale + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(dw, py);
      }
      ctx.stroke();
    }
  }

  function canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("导出失败"));
      }, type || "image/png");
    });
  }

  global.Pixelate = {
    PRESET_PALETTES,
    clampInt,
    computeBlockGrid,
    pixelateImage,
    imageDataToCanvas,
    drawUpscaled,
    canvasToBlob,
  };
})(window);
