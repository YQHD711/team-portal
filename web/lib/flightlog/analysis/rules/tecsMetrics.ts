/**
 * TECS 四个量的**计算**（纯函数，便于单测；tecsTracking 只负责组装 Finding/图表）。
 *
 * 关键口径（实测 9 份 Plane 日志后收紧的）：
 *  - 只统计 **TECS 真正在工作** 的样本（`spdem > 0`）——否则手动/地面段会把 RMS 和饱和占比算歪；
 *  - 俯仰饱和需要**有效限幅**（`pmax − pmin` 中位数 ≥ 5°）；日志没记录限幅时返回 NaN，
 *    由调用方落 unknown 一侧，**不得**当成 0（那会变成"看起来正常"）。
 */

import type { SeriesWindow } from "../../types/rule";
import type { Severity } from "../../types/report";
import { TECS } from "../thresholds";

/** 饱和判定容差：油门顶到 2% 以内、俯仰触及限幅 0.5° 以内算饱和 */
export const THROTTLE_EPS = 0.02;
export const PITCH_EPS_DEG = 0.5;

export interface Metric {
  key: string;
  label: string;
  value: number;
  warning: number;
  critical: number | null;
  unit: string;
  samples: number;
}

export function verdictOf(m: Metric): Severity {
  if (!Number.isFinite(m.value)) return "unknown";
  if (m.critical !== null && m.value > m.critical) return "critical";
  if (m.value > m.warning) return "warning";
  return "ok";
}

/** TECS 工作掩码：`spdem > 0`（有目标空速）才算在工作 */
export function tecsActive(spdem: Float64Array, n: number): Uint8Array {
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = Number.isFinite(spdem[i]) && spdem[i] > 0 ? 1 : 0;
  return mask;
}

/** 饱和占比：值贴着上下限的时间比例（只看 mask 内样本）；无样本 → NaN */
export function saturationRatio(values: Float64Array, low: Float64Array, high: Float64Array, eps: number, mask: Uint8Array): number {
  let hits = 0, total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    const lo = low[i], hi = high[i];
    if (!Number.isFinite(values[i]) || !Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    total++;
    if (values[i] <= lo + eps || values[i] >= hi - eps) hits++;
  }
  return total === 0 ? NaN : hits / total;
}

/** 定长饱和比例（油门 0..1） */
export function fixedSaturationRatio(values: Float64Array, lo: number, hi: number, eps: number, mask: Uint8Array): number {
  let hits = 0, total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    total++;
    if (v <= lo + eps || v >= hi - eps) hits++;
  }
  return total === 0 ? NaN : hits / total;
}

/** 有符号误差的 RMS（只看 mask 内样本） */
export function rmsOfDiff(a: SeriesWindow, b: SeriesWindow, mask: Uint8Array): { value: number; samples: number } {
  const n = Math.min(a.values.length, b.values.length);
  let acc = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const d = a.values[i] - b.values[i];
    if (!Number.isFinite(d)) continue;
    acc += d * d;
    count++;
  }
  return { value: count === 0 ? NaN : Math.sqrt(acc / count), samples: count };
}

/** 俯仰限幅是否记录了有效范围（pmax−pmin 中位数 ≥ 5°） */
export function pitchLimitsValid(pmin: SeriesWindow, pmax: SeriesWindow, mask: Uint8Array): boolean {
  const n = Math.min(pmin.values.length, pmax.values.length);
  const ranges: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const r = pmax.values[i] - pmin.values[i];
    if (Number.isFinite(r)) ranges.push(r);
  }
  if (ranges.length === 0) return false;
  ranges.sort((a, b) => a - b);
  return ranges[Math.floor(ranges.length / 2)] >= 5;
}

/** 组装四个量的阈值（统一从 thresholds.TECS 取，避免散落） */
export function buildMetrics(
  air: { value: number; samples: number },
  alt: { value: number; samples: number },
  throttleSat: number,
  pitchSat: number,
  activeCount: number,
): Metric[] {
  return [
    { key: "airspeedErrRmsMps", label: "空速跟踪误差 RMS", value: air.value, warning: TECS.airspeedErrWarningMps, critical: TECS.airspeedErrCriticalMps, unit: "m/s", samples: air.samples },
    { key: "heightErrRmsM", label: "高度跟踪误差 RMS", value: alt.value, warning: TECS.heightErrWarningM, critical: TECS.heightErrCriticalM, unit: "m", samples: alt.samples },
    { key: "throttleSatRatio", label: "油门饱和占比", value: throttleSat, warning: TECS.throttleSaturationWarning, critical: TECS.throttleSaturationCritical, unit: "", samples: activeCount },
    { key: "pitchSatRatio", label: "俯仰饱和占比", value: pitchSat, warning: TECS.pitchSaturationWarning, critical: null, unit: "", samples: activeCount },
  ];
}
