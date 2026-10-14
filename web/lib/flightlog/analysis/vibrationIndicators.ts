/**
 * 振动指标扫描 —— 振动规则与滤波规则**共用**。
 *
 * 抽出来的原因：滤波建议只有在"确实存在振动问题"时才允许给出，
 * 否则就会变成对健康机架乱推参数的噪声源。两个规则必须看到同一份证据。
 */

import type { TimeWindow } from "../types/log";
import type { RuleContext } from "../types/rule";
import { longestWindow } from "./windows";
import { absMax, stdDev } from "./stats";
import { VIBRATION } from "./thresholds";

export type VibrationAxis = "x" | "y" | "z";

export interface VibrationAxisStat {
  axis: VibrationAxis;
  /** VIBE 字段名：VibeX / VibeY / VibeZ */
  field: string;
  std: number;
  max: number;
}

export interface VibrationIndicator {
  /** IMU 实例号 */
  instance: number;
  window: TimeWindow;
  samples: number;
  axes: VibrationAxisStat[];
  worstStd: number;
  worstAxis: VibrationAxis;
  worstMax: number;
  /** 窗口内 clip 计数增量 */
  clipDelta: number;
  /** 超过阈值的时间段，用于图表高亮；未超阈值则 null */
  exceedWindow: TimeWindow | null;
  /** 被超过的阈值（30 优先于 15）；未超阈值则 null */
  exceedThreshold: number | null;
}

export interface VibrationScan {
  indicators: VibrationIndicator[];
  /** 无法扫描的原因；null 表示可用 */
  unavailable: string | null;
}

const AXES: readonly { axis: VibrationAxis; field: string }[] = [
  { axis: "x", field: "VibeX" },
  { axis: "y", field: "VibeY" },
  { axis: "z", field: "VibeZ" },
];

function exceedRange(
  timeSec: Float64Array,
  columns: Float64Array[],
  level: number,
): TimeWindow | null {
  let start: number | null = null;
  let end: number | null = null;
  for (let i = 0; i < timeSec.length; i++) {
    let hit = false;
    for (const col of columns) {
      if (col[i] > level) {
        hit = true;
        break;
      }
    }
    if (hit) {
      if (start === null) start = timeSec[i];
      end = timeSec[i];
    }
  }
  return start === null || end === null ? null : { startSec: start, endSec: end };
}

export function scanVibration(ctx: RuleContext): VibrationScan {
  const anyInstance = ctx.doc.series["VIBE:0"] !== undefined;
  if (!anyInstance && ctx.series("VIBE") === null) {
    return {
      indicators: [],
      unavailable: "日志中没有 VIBE（振动水平）消息，无法评估振动",
    };
  }
  const window = longestWindow(ctx.armedWindows());
  if (!window) {
    return {
      indicators: [],
      unavailable: "没有可用的飞行（arm）时间段，无法评估飞行中的振动",
    };
  }

  const instances = Object.keys(ctx.doc.series)
    .filter((k) => k.startsWith("VIBE:"))
    .map((k) => Number(k.slice("VIBE:".length)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (instances.length === 0) {
    return { indicators: [], unavailable: "日志中没有 VIBE 消息" };
  }

  const indicators: VibrationIndicator[] = [];
  const skipped: string[] = [];
  for (const instance of instances) {
    const columns: Float64Array[] = [];
    let timeSec: Float64Array | null = null;
    let samples = Number.MAX_SAFE_INTEGER;
    const axes: VibrationAxisStat[] = [];
    for (const { axis, field } of AXES) {
      const w = ctx.windowed("VIBE", field, window, instance);
      if (!w) {
        samples = 0;
        break;
      }
      columns.push(w.values);
      samples = Math.min(samples, w.values.length);
      if (!timeSec || w.timeSec.length > timeSec.length) timeSec = w.timeSec;
      axes.push({ axis, field, std: stdDev(w.values), max: absMax(w.values) });
    }
    if (!timeSec || samples < VIBRATION.minSamples) {
      skipped.push(`IMU${instance}（样本 ${Math.max(0, samples)} 条，门槛 ${VIBRATION.minSamples}）`);
      continue;
    }

    const clip = ctx.windowed("VIBE", "Clip", window, instance);
    const clipDelta =
      clip && clip.values.length >= 2
        ? clip.values[clip.values.length - 1] - clip.values[0]
        : 0;

    const worst = axes.reduce((a, b) => (b.std > a.std ? b : a), axes[0]);
    const criticalHit = exceedRange(timeSec, columns, VIBRATION.stdCritical);
    const warnHit = exceedRange(timeSec, columns, VIBRATION.stdWarning);
    indicators.push({
      instance,
      window,
      samples,
      axes,
      worstStd: worst.std,
      worstAxis: worst.axis,
      worstMax: Math.max(...axes.map((a) => a.max)),
      clipDelta,
      exceedWindow: criticalHit ?? warnHit,
      exceedThreshold:
        criticalHit !== null
          ? VIBRATION.stdCritical
          : warnHit !== null
            ? VIBRATION.stdWarning
            : null,
    });
  }

  if (indicators.length === 0) {
    return {
      indicators: [],
      unavailable: `飞行段内 VIBE 样本不足，无法评估（${skipped.join("、")}）`,
    };
  }
  return { indicators, unavailable: null };
}
