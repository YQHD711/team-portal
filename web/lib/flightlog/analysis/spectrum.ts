/**
 * 频谱分析：非均匀日志采样 → 均匀重采样 → Hann 窗 → 单边功率谱 → 主峰定位。
 *
 * 为什么必须重采样：DataFlash 的 TimeUS 是按日志事件写入的，采样间隔有抖动。
 * 直接对非均匀采样做 FFT 会把频谱抹宽，可能把真实的窄峰变成宽包络——
 * 而"窄峰"正是判断振荡与结构共振的关键证据，所以这里先线性插值到均匀网格。
 */

import { nextPowerOfTwo, realPowerSpectrum } from "./fft";
import { meanOf, median, percentile } from "./stats";

export interface Spectrum {
  freqs: Float64Array;
  power: Float64Array;
  /** 主峰频率（已做抛物线插值细化） */
  peakHz: number;
  peakPower: number;
  /** 主峰功率占分析频带总功率的比例，越高说明越像孤立窄峰 */
  peakShare: number;
  sampleRateHz: number;
  binHz: number;
  usedSamples: number;
  /** 采样间隔 p95/中位数：> 1.5 表示采样抖动明显，已重采样 */
  jitterRatio: number;
  resampled: boolean;
}

export interface SpectrumOptions {
  minHz?: number;
  maxHz?: number;
  /** 参与 FFT 的最大样本数（默认 65536，约 512 KB） */
  maxSamples?: number;
  minSamples?: number;
}

export interface UniformSeries {
  values: Float64Array;
  sampleRateHz: number;
  dtSec: number;
  jitterRatio: number;
}

const DEFAULT_MAX_SAMPLES = 65536;
const DEFAULT_MIN_SAMPLES = 64;

/** 估计采样间隔并线性插值到均匀网格；样本太少或时间戳退化时返回 null。 */
export function resampleUniform(
  timeSec: Float64Array,
  values: Float64Array,
  maxSamples: number = DEFAULT_MAX_SAMPLES,
): UniformSeries | null {
  const n = timeSec.length;
  if (n !== values.length || n < 3) return null;
  const diffs = new Float64Array(n - 1);
  let m = 0;
  for (let i = 1; i < n; i++) {
    const d = timeSec[i] - timeSec[i - 1];
    if (d > 1e-9) diffs[m++] = d;
  }
  if (m < 2) return null;
  const dt = median(diffs.subarray(0, m));
  if (!(dt > 1e-9)) return null;
  const jitterRatio = percentile(diffs.subarray(0, m), 0.95) / dt;

  const span = timeSec[n - 1] - timeSec[0];
  let count = Math.floor(span / dt) + 1;
  if (count < 3) return null;
  if (count > maxSamples) count = maxSamples;

  const out = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const t = timeSec[0] + i * dt;
    while (j + 2 < n && timeSec[j + 1] < t) j++;
    const t0 = timeSec[j];
    const t1 = timeSec[j + 1];
    const span2 = t1 - t0;
    const a = span2 > 1e-12 ? (t - t0) / span2 : 0;
    out[i] = values[j] + (values[j + 1] - values[j]) * a;
  }
  return { values: out, sampleRateHz: 1 / dt, dtSec: dt, jitterRatio };
}

/** Hann 窗（端点为零，减少泄漏） */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n <= 1) {
    w.fill(1);
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

/** 在主峰附近做 3 点抛物线插值，得到亚 bin 精度的频率 */
function refinePeak(freqs: Float64Array, power: Float64Array, i: number): number {
  if (i <= 0 || i >= power.length - 1) return freqs[i];
  const y0 = power[i - 1];
  const y1 = power[i];
  const y2 = power[i + 1];
  const denom = y0 - 2 * y1 + y2;
  if (Math.abs(denom) < 1e-30) return freqs[i];
  const d = (0.5 * (y0 - y2)) / denom;
  if (!Number.isFinite(d) || Math.abs(d) > 0.5) return freqs[i];
  return freqs[i] + d * (freqs[i + 1] - freqs[i]);
}

export function computeSpectrum(
  timeSec: Float64Array,
  values: Float64Array,
  options: SpectrumOptions = {},
): Spectrum | null {
  const minHz = options.minHz ?? 0.5;
  const maxHz = options.maxHz ?? 60;
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const uni = resampleUniform(
    timeSec,
    values,
    options.maxSamples ?? DEFAULT_MAX_SAMPLES,
  );
  if (!uni || uni.values.length < minSamples) return null;

  const n = uni.values.length;
  const mean = meanOf(uni.values);
  const window = hann(n);
  const nfft = nextPowerOfTwo(n);
  const signal = new Float64Array(nfft);
  for (let i = 0; i < n; i++) signal[i] = (uni.values[i] - mean) * window[i];

  const { freqs, power } = realPowerSpectrum(signal, uni.sampleRateHz);
  const binHz = uni.sampleRateHz / nfft;

  let lo = Math.max(1, Math.ceil(minHz / binHz));
  let hi = Math.min(power.length - 1, Math.floor(maxHz / binHz));
  if (hi <= lo) {
    lo = 1;
    hi = power.length - 1;
  }
  let bandPower = 0;
  for (let i = lo; i <= hi; i++) bandPower += power[i];
  let peakIndex = lo;
  for (let i = lo; i <= hi; i++) if (power[i] > power[peakIndex]) peakIndex = i;

  return {
    freqs,
    power,
    peakHz: refinePeak(freqs, power, peakIndex),
    peakPower: power[peakIndex],
    peakShare: bandPower > 0 ? power[peakIndex] / bandPower : 0,
    sampleRateHz: uni.sampleRateHz,
    binHz,
    usedSamples: n,
    jitterRatio: uni.jitterRatio,
    resampled: uni.jitterRatio > 1.05,
  };
}
