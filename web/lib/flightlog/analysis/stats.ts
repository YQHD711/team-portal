/**
 * 基础统计量。全部为**总体**（除以 n）口径，与 ArduPilot 文档中
 * "vibration standard deviation" 的常用口径一致，并在 evidence 中注明。
 *
 * 所有函数对空数组返回 0 / NaN 由调用方判断；规则必须先做样本数校验。
 */

export function meanOf(values: Float64Array): number {
  const n = values.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  return sum / n;
}

/** 总体标准差（除以 n） */
export function stdDev(values: Float64Array, knownMean?: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const m = knownMean === undefined ? meanOf(values) : knownMean;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - m;
    acc += d * d;
  }
  return Math.sqrt(acc / n);
}

/** 均方根（不减均值） */
export function rms(values: Float64Array): number {
  const n = values.length;
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += values[i] * values[i];
  return Math.sqrt(acc / n);
}

/** 去均值后的均方根，等价于标准差 */
export function acRms(values: Float64Array): number {
  return stdDev(values);
}

export function maxOf(values: Float64Array): number {
  let m = -Infinity;
  for (let i = 0; i < values.length; i++) if (values[i] > m) m = values[i];
  return values.length === 0 ? 0 : m;
}

export function minOf(values: Float64Array): number {
  let m = Infinity;
  for (let i = 0; i < values.length; i++) if (values[i] < m) m = values[i];
  return values.length === 0 ? 0 : m;
}

/** 绝对值最大（用于峰值展示） */
export function absMax(values: Float64Array): number {
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    const a = Math.abs(values[i]);
    if (a > m) m = a;
  }
  return m;
}

/** 中位数（会复制并排序，仅用于小样本判定，如采样间隔估计） */
export function median(values: Float64Array): number {
  const n = values.length;
  if (n === 0) return 0;
  const copy = Float64Array.from(values);
  copy.sort();
  const mid = n >> 1;
  return n % 2 === 1 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

/** 百分位（p ∈ [0,1]，线性插值） */
export function percentile(values: Float64Array, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const copy = Float64Array.from(values);
  copy.sort();
  const pos = Math.min(1, Math.max(0, p)) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return copy[lo];
  return copy[lo] + (copy[hi] - copy[lo]) * (pos - lo);
}

/** 首尾差值，用于 Clip 这类累积计数 */
export function delta(first: number, last: number): number {
  return last - first;
}
