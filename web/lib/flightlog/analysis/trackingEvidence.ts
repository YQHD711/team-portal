/**
 * 外环（角度环 / 速度环 / 位置环）跟踪取证的**共用**机制。
 *
 * 与 `rateAxisEvidence.ts` 的分工：那边处理速率环的"控制器原生单位"陷阱；这边处理外环三件共性问题：
 *  ① **目标/实际差分**：ATT、PSC、TECS 都是"目标列 + 实际列"成对出现，误差要自己算；
 *  ② **偏差列**：NTUN 的 `XT`/`AltE`/`XTrack` 本身就是偏差（目标恒为 0），不能拿它做差分；
 *  ③ **航向环绕**：`degheading` 是 0–360，DesYaw=359 / Yaw=1 的误差是 −2° 而不是 358°。
 *
 * 单位口径：ATT 是**度**；PSC 与 TECS 是 **m 与 m/s**；NTUN 偏差是 **m**。全部总体 RMS 口径
 * （除以 n，与 stats.ts 一致），所以跨机型可比、且不受样本量小幅波动影响。
 */

import type { RuleContext } from "../types/rule";
import type { Series, TimeWindow } from "../types/log";
import { medianSampleInterval } from "./context";
import { absMax, rms, stdDev } from "./stats";

/** 航向角差归一到 (−180, 180]（`degheading` 字段必须走这里） */
export function wrap180(deg: number): number {
  const wrapped = (((deg + 180) % 360) + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export interface TrackingPair {
  message: string;
  window: TimeWindow;
  samples: number;
  sampleRateHz: number | null;
  /** 指令激励：角度/速度/空速用**目标 RMS**；航向用**目标标准差**（绝对航向的 RMS 无意义） */
  excitement: number;
  targetRms: number;
  errorRms: number;
  maxAbsError: number;
  /** errorRms / excitement；偏差列（目标恒 0）无意义，固定为 Infinity */
  ratio: number;
  error: Float64Array;
  /** true = 该序列本身是偏差列（XT/AltE/XTrack），判据只能走绝对量 */
  isDeviation: boolean;
}

export type PairUnavailable = { kind: "missing" | "tooFew"; detail: string };

interface CommonOptions {
  /** 航向类字段：误差环绕 ±180，激励改用目标标准差 */
  wrap?: boolean;
  missingDetail?: string;
}

function finish(
  message: string,
  window: TimeWindow,
  series: Series | null,
  samples: number,
  target: Float64Array,
  error: Float64Array,
  wrap: boolean,
  isDeviation: boolean,
): TrackingPair {
  const dt = medianSampleInterval(series, window);
  const excitation = isDeviation ? 0 : wrap ? stdDev(target) : rms(target);
  const errorRms = rms(error);
  return {
    message,
    window,
    samples,
    sampleRateHz: dt ? 1 / dt : null,
    excitement: excitation,
    targetRms: isDeviation ? 0 : rms(target),
    errorRms,
    maxAbsError: absMax(error),
    ratio: isDeviation || excitation <= 1e-9 ? Number.POSITIVE_INFINITY : errorRms / excitation,
    error,
    isDeviation,
  };
}

/** 取"目标列 + 实际列"窗口并算误差（误差 = 目标 − 实际） */
export function extractPair(
  ctx: RuleContext,
  message: string,
  targetField: string,
  actualField: string,
  window: TimeWindow,
  minSamples: number,
  options: CommonOptions = {},
): TrackingPair | PairUnavailable {
  const series = ctx.series(message);
  if (!series) {
    return { kind: "missing", detail: options.missingDetail ?? `日志中没有 ${message} 消息` };
  }
  const target = ctx.windowed(message, targetField, window);
  const actual = ctx.windowed(message, actualField, window);
  if (!target || !actual) {
    return {
      kind: "missing",
      detail: options.missingDetail ?? `${message} 缺少 ${targetField}/${actualField} 列，无法评估该通道`,
    };
  }
  const samples = Math.min(target.values.length, actual.values.length);
  if (samples < minSamples) {
    return { kind: "tooFew", detail: `飞行段内 ${message}.${targetField} 有效样本 ${samples} 条，低于门槛 ${minSamples}` };
  }
  const error = new Float64Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const delta = target.values[i] - actual.values[i];
    error[i] = options.wrap ? wrap180(delta) : delta;
  }
  return finish(message, window, series, samples, target.values.subarray(0, samples), error, options.wrap ?? false, false);
}

/**
 * 偏差列（`XT`/`AltE`/`XTrack`）：字段本身就是误差，目标恒为 0。
 * 差异差分（`f − f`）会得到恒 0 的假数据 —— 必须走这里。
 */
export function deviationPair(
  ctx: RuleContext,
  message: string,
  field: string,
  window: TimeWindow,
  minSamples: number,
  options: CommonOptions = {},
): TrackingPair | PairUnavailable {
  const series = ctx.series(message);
  if (!series) {
    return { kind: "missing", detail: options.missingDetail ?? `日志中没有 ${message} 消息` };
  }
  const values = ctx.windowed(message, field, window);
  if (!values) {
    return { kind: "missing", detail: options.missingDetail ?? `${message} 缺少 ${field} 列，无法评估该通道` };
  }
  if (values.values.length < minSamples) {
    return {
      kind: "tooFew",
      detail: `飞行段内 ${message}.${field} 有效样本 ${values.values.length} 条，低于门槛 ${minSamples}`,
    };
  }
  return finish(message, window, series, values.values.length, new Float64Array(0), values.values, false, true);
}

/** 时间轴（秒）用于曲线高亮 */
export function timeAxis(ctx: RuleContext, message: string, window: TimeWindow, samples: number): Float64Array {
  const w = ctx.windowed(message, "TimeUS", window);
  if (!w) return Float64Array.from({ length: samples }, (_, i) => window.startSec + i);
  return Float64Array.from(w.values.subarray(0, samples), (us) => us / 1e6);
}

