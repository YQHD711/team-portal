/**
 * **跨平台共用的跟踪签名算法**（task-34 从 tuningAdvice.ts 抽出，避免 PX4 与 ArduPilot 各写一份）。
 *
 * 三个签名与平台无关，只看（指令、实际、误差）三条序列 + 时间轴：
 *  ① `highCommandRatio`：只在高指令样本上算 Err/Tar（低指令时段比值天然放大）
 *  ② `crossCorrelationLag`：指令与实际互相关的峰值位置 = 相位滞后（采样数/毫秒）
 *  ③ `dominantHzOf`：指令主频（用于把滞后换算成误差幅度、决定 FF/P 的优先级）
 */

import { computeSpectrum } from "./spectrum";
import { rms } from "./stats";

/** 只统计 |Tar| ≥ fraction×RMS(Tar) 的样本，返回误差/指令比值与样本数 */
export function highCommandRatio(
  target: Float64Array,
  error: Float64Array,
  fraction: number,
  minSamples = 30,
): { errRatio: number; samples: number } | null {
  const targetRms = rms(target);
  if (targetRms <= 1e-9) return null;
  const threshold = fraction * targetRms;
  const errors: number[] = [];
  const targets: number[] = [];
  const count = Math.min(target.length, error.length);
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(target[i]) >= threshold) {
      errors.push(error[i]);
      targets.push(target[i]);
    }
  }
  if (errors.length < minSamples) return null;
  const ratio = rms(Float64Array.from(errors)) / Math.max(rms(Float64Array.from(targets)), 1e-9);
  return { errRatio: ratio, samples: count };
}

/** 互相关求滞后（正 = 实际滞后于指令）；同时给出 0 滞后处的相关系数（判断"是否靠滞后才对上"） */
export function crossCorrelationLag(
  target: Float64Array,
  actual: Float64Array,
  maxLag: number,
): { lag: number; corr: number; corrAtZero: number } {
  let bestLag = 0;
  let bestCorr = -Infinity;
  let corrAtZero = 0;
  const n = Math.min(target.length, actual.length);
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let num = 0;
    let d1 = 0;
    let d2 = 0;
    for (let i = 0; i < n; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= n) continue;
      num += target[i] * actual[j];
      d1 += target[i] * target[i];
      d2 += actual[j] * actual[j];
    }
    const corr = num / Math.sqrt(Math.max(d1 * d2, 1e-30));
    if (lag === 0) corrAtZero = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return { lag: bestLag, corr: bestCorr, corrAtZero };
}

/** 指令主频（Hz）；求不出返回 null（由调用方决定兜底值） */
export function dominantHzOf(
  timeSec: Float64Array,
  target: Float64Array,
  fallback?: number,
): number | null {
  const spectrum = computeSpectrum(timeSec, target, { minHz: 0.2, maxHz: 20, maxSamples: 4096 });
  if (!spectrum) return fallback ?? null;
  return spectrum.peakHz;
}

/** 采样间隔中位数（秒）；样本不足返回 0 */
export function medianDt(timeSec: Float64Array): number {
  if (timeSec.length < 3) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < timeSec.length; i += 1) {
    const d = timeSec[i] - timeSec[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return 0;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

/**
 * 把两条不同采样率的序列重采样到**同一均匀网格**（线性插值；网格外的点留 NaN）。
 *
 * 为什么需要：PX4 的 `vehicle_rates_setpoint` 与 `vehicle_angular_velocity` 采样率不同
 * （实测 221 Hz vs 286 Hz），直接按索引做互相关会把"采样率差"算成"相位滞后"。
 * 统一网格后，滞后（采样数）× 网格周期 = 真实毫秒数。
 */
export function resampleToGrid(
  timeSec: Float64Array,
  values: Float64Array,
  grid: Float64Array,
): Float64Array {
  const out = new Float64Array(grid.length);
  out.fill(Number.NaN);
  if (timeSec.length === 0) return out;
  let cursor = 0;
  for (let i = 0; i < grid.length; i += 1) {
    const t = grid[i];
    if (t < timeSec[0] || t > timeSec[timeSec.length - 1]) continue;
    while (cursor + 1 < timeSec.length && timeSec[cursor + 1] < t) cursor += 1;
    const t0 = timeSec[cursor];
    const t1 = cursor + 1 < timeSec.length ? timeSec[cursor + 1] : t0;
    const v0 = values[cursor];
    const v1 = cursor + 1 < timeSec.length ? values[cursor + 1] : v0;
    out[i] = t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v0;
  }
  return out;
}

/** 均匀网格（秒）；用于跨 topic 重采样 */
export function uniformGrid(startSec: number, endSec: number, hz: number): Float64Array {
  const step = 1 / hz;
  const count = Math.max(0, Math.floor((endSec - startSec) / step) + 1);
  const grid = new Float64Array(count);
  for (let i = 0; i < count; i += 1) grid[i] = startSec + i * step;
  return grid;
}
export function alignTargetToActual(
  targetTime: Float64Array,
  target: Float64Array,
  actualTime: Float64Array,
): { target: Float64Array; valid: number } {
  const out = new Float64Array(actualTime.length);
  out.fill(Number.NaN);
  let cursor = 0;
  let held = Number.NaN;
  let valid = 0;
  for (let i = 0; i < actualTime.length; i += 1) {
    const t = actualTime[i];
    while (cursor < targetTime.length && targetTime[cursor] <= t) {
      held = target[cursor];
      cursor += 1;
    }
    if (Number.isFinite(held)) {
      out[i] = held;
      valid += 1;
    }
  }
  return { target: out, valid };
}
