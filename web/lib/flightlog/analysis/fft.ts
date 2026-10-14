/**
 * 原地基-2 FFT（Cooley-Tukey）。长度为 2 的幂。
 *
 * 效率考虑：
 *  - 旋转因子按长度缓存，避免内层循环里反复调用 Math.cos/sin
 *    （16k 点单次 FFT 可省下 ~20 万次三角函数调用）；
 *  - 位反转与蝶形都直接在传入的 Float64Array 上做，不分配中间数组；
 *  - 频谱每帧重算（诊断只跑一次），但缓存表在多次调用间复用。
 */

interface Twiddles {
  cos: Float64Array;
  sin: Float64Array;
}

const twiddleCache = new Map<number, Twiddles>();

function twiddlesFor(n: number): Twiddles {
  const cached = twiddleCache.get(n);
  if (cached) return cached;
  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const ang = (-2 * Math.PI * k) / n;
    cos[k] = Math.cos(ang);
    sin[k] = Math.sin(ang);
  }
  const tw = { cos, sin };
  // 只保留最近 8 个长度，避免长会话里缓存无界增长
  if (twiddleCache.size >= 8) {
    const oldest = twiddleCache.keys().next().value;
    if (oldest !== undefined) twiddleCache.delete(oldest);
  }
  twiddleCache.set(n, tw);
  return tw;
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** 原地 FFT。re/im 长度必须相等且为 2 的幂，否则抛错（调用方先做校验）。 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || !isPowerOfTwo(n)) {
    throw new Error(`fftInPlace 要求长度为 2 的幂且 re/im 等长，收到 ${n}/${im.length}`);
  }
  if (n === 1) return;

  // 位反转重排
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  const { cos, sin } = twiddlesFor(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let base = 0; base < n; base += len) {
      for (let j = 0; j < half; j++) {
        const tw = j * step;
        const wr = cos[tw];
        const wi = sin[tw];
        const a = base + j;
        const b = a + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        const ur = re[a];
        const ui = im[a];
        re[a] = ur + vr;
        im[a] = ui + vi;
        re[b] = ur - vr;
        im[b] = ui - vi;
      }
    }
  }
}

/**
 * 实数序列单边功率谱（已按窗能量归一化，便于跨窗长比较）。
 * 返回长度 = n/2 + 1，索引 i 对应频率 i * sampleRate / n。
 */
export function realPowerSpectrum(
  signal: Float64Array,
  sampleRateHz: number,
): { freqs: Float64Array; power: Float64Array } {
  const n = signal.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(signal);
  fftInPlace(re, im);
  const bins = (n >> 1) + 1;
  const freqs = new Float64Array(bins);
  const power = new Float64Array(bins);
  const scale = 1 / (sampleRateHz * n);
  for (let i = 0; i < bins; i++) {
    freqs[i] = (i * sampleRateHz) / n;
    const mag2 = re[i] * re[i] + im[i] * im[i];
    // 单边谱：除直流与 Nyquist 外能量翻倍
    const fold = i === 0 || i === bins - 1 ? 1 : 2;
    power[i] = (mag2 * fold * scale) / (sampleRateHz * n);
  }
  return { freqs, power };
}
