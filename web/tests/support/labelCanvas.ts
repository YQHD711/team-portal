/**
 * jsdom 没有 canvas 2D 上下文。二维码是「按方块 fillRect」画出来的，所以这里只要把 fillRect
 * 栅格化成像素缓冲，就能交给 jsQR 解码，验证「真的扫得出来」；文字（fillText）不落像素，
 * 不影响二维码区域。仅测试用。
 */
import { vi } from "vitest";
import jsQR from "jsqr";

export interface FakeCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface CanvasRect {
  x: number;
  y: number;
  size: number;
}

const buffers = new WeakMap<HTMLCanvasElement, FakeCanvas>();

function rgbOf(css: string): [number, number, number] {
  if (css.startsWith("#")) {
    const h = css.slice(1);
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6);
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  return [0, 0, 0];
}

function paint(canvas: FakeCanvas, css: string, x: number, y: number, w: number, h: number): void {
  const [r, g, b] = rgbOf(css);
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(canvas.width, Math.round(x + w));
  const y1 = Math.min(canvas.height, Math.round(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * canvas.width + px) * 4;
      canvas.pixels[i] = r;
      canvas.pixels[i + 1] = g;
      canvas.pixels[i + 2] = b;
      canvas.pixels[i + 3] = 255;
    }
  }
}

/** 装上 canvas 替身，返回本次测试里创建的像素缓冲（按创建顺序） */
export function installFakeCanvas(): FakeCanvas[] {
  const created: FakeCanvas[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    let buf = buffers.get(this);
    if (!buf) {
      buf = { width: this.width, height: this.height, pixels: new Uint8ClampedArray(this.width * this.height * 4).fill(255) };
      buffers.set(this, buf);
      created.push(buf);
    }
    const buffer = buf;
    let fill = "#ffffff";
    return {
      set fillStyle(v: string) { fill = v; },
      get fillStyle() { return fill; },
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      fillRect: (x: number, y: number, w: number, h: number) => paint(buffer, fill, x, y, w, h),
      fillText: () => {},
      measureText: (t: string) => ({ width: t.length * 8 }),
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
  return created;
}

/** 区域内非白像素的包围盒（用来量二维码实际画出来的尺寸） */
export function darkExtent(canvas: FakeCanvas, rect: CanvasRect): { width: number; height: number } | null {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(canvas.width, x0 + Math.round(rect.size));
  const y1 = Math.min(canvas.height, y0 + Math.round(rect.size));
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (canvas.pixels[(y * canvas.width + x) * 4] < 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 裁剪一块正方形区域交给 jsQR 解码；识别不出返回 null */
export function decodeQr(canvas: FakeCanvas, rect: CanvasRect): string | null {
  const size = Math.round(rect.size);
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  if (size <= 0 || x0 < 0 || y0 < 0 || x0 + size > canvas.width || y0 + size > canvas.height) return null;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = ((y0 + y) * canvas.width + x0) * 4;
    data.set(canvas.pixels.subarray(src, src + size * 4), y * size * 4);
  }
  return jsQR(data, size, size)?.data ?? null;
}
