/**
 * 单个 IMU 实例的振动统计（从 vibrationIndicators.ts 拆出：原文件超过 200 行上限）。
 *
 * 关键点：**降落/触地段与常规飞行段分开统计**（用户反馈：落地冲击不算机架振动异常）。
 * 常规统计只覆盖"排除降落段之后"的飞行段，触地段单独返回，供规则作为独立结论。
 */

import type { RuleContext } from "../types/rule";
import type { TimeWindow } from "../types/log";
import { absMax, stdDev } from "./stats";
import { VIBRATION } from "./thresholds";
import type { LandingDetection } from "./landingSegment";
import type { LandingStats, VibrationAxis, VibrationAxisStat, VibrationIndicator } from "./vibrationIndicators";

export const AXES: readonly { axis: VibrationAxis; field: string }[] = [
  { axis: "x", field: "VibeX" },
  { axis: "y", field: "VibeY" },
  { axis: "z", field: "VibeZ" },
];

function exceedRange(timeSec: Float64Array, columns: Float64Array[], level: number): TimeWindow | null {
  let start: number | null = null;
  let end: number | null = null;
  for (let i = 0; i < timeSec.length; i += 1) {
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

function clipDeltaIn(ctx: RuleContext, instance: number, w: TimeWindow | null): number {
  if (!w) return 0;
  const clip = ctx.windowed("VIBE", "Clip", w, instance);
  return clip && clip.values.length >= 2 ? clip.values[clip.values.length - 1] - clip.values[0] : 0;
}

/** 片段内的三轴统计（样本不足返回 null） */
export function segmentStats(
  ctx: RuleContext,
  instance: number,
  w: TimeWindow | null,
  minSamples: number,
): { samples: number; axes: VibrationAxisStat[]; timeSec: Float64Array } | null {
  if (!w) return null;
  const axes: VibrationAxisStat[] = [];
  let timeSec: Float64Array | null = null;
  let samples = Number.MAX_SAFE_INTEGER;
  for (const { axis, field } of AXES) {
    const s = ctx.windowed("VIBE", field, w, instance);
    if (!s) return null;
    samples = Math.min(samples, s.values.length);
    if (!timeSec || s.timeSec.length > timeSec.length) timeSec = s.timeSec;
    axes.push({ axis, field, std: stdDev(s.values), max: absMax(s.values) });
  }
  if (!timeSec || samples < minSamples) return null;
  return { samples, axes, timeSec };
}

/**
 * 扫描一个 IMU：常规飞行段（**排除降落段**）+ 降落段单独统计。
 * 排除后样本不足时返回 null（由调用方记入 unavailable，绝不静默当成"没问题"）。
 */
export function scanInstance(
  ctx: RuleContext,
  instance: number,
  armed: TimeWindow,
  landing: LandingDetection,
): VibrationIndicator | { skipped: string } {
  const cut = landing.window;
  const flightWindow: TimeWindow =
    cut && cut.startSec > armed.startSec ? { startSec: armed.startSec, endSec: cut.startSec } : armed;
  const stats = segmentStats(ctx, instance, flightWindow, VIBRATION.minSamples);
  if (!stats) {
    const full = segmentStats(ctx, instance, armed, VIBRATION.minSamples);
    return {
      skipped:
        cut && cut.startSec > armed.startSec && full
          ? `IMU${instance}（排除降落段后飞行段样本 < ${VIBRATION.minSamples}，无法只按飞行段评估）`
          : `IMU${instance}（样本 ${full?.samples ?? 0} 条，门槛 ${VIBRATION.minSamples}）`,
    };
  }

  const columns = AXES.map(({ field }) => {
    const s = ctx.windowed("VIBE", field, flightWindow, instance);
    return s ? s.values : new Float64Array(0);
  });
  const worst = stats.axes.reduce((a, b) => (b.std > a.std ? b : a), stats.axes[0]);
  const criticalHit = exceedRange(stats.timeSec, columns, VIBRATION.stdCritical);
  const warnHit = exceedRange(stats.timeSec, columns, VIBRATION.stdWarning);
  const clipDelta = clipDeltaIn(ctx, instance, flightWindow);

  let landingStats: LandingStats | null = null;
  if (cut) {
    const land = segmentStats(ctx, instance, cut, 5);
    if (land) {
      const worstLand = land.axes.reduce((a, b) => (b.std > a.std ? b : a), land.axes[0]);
      landingStats = {
        window: cut,
        samples: land.samples,
        worstStd: worstLand.std,
        worstAxis: worstLand.axis,
        max: Math.max(...land.axes.map((a) => a.max)),
        clipDelta: clipDeltaIn(ctx, instance, cut),
      };
    }
  }

  return {
    instance,
    window: flightWindow,
    armedWindow: armed,
    samples: stats.samples,
    axes: stats.axes,
    worstStd: worst.std,
    worstAxis: worst.axis,
    worstMax: Math.max(...stats.axes.map((a) => a.max)),
    clipDelta,
    exceedWindow: criticalHit ?? warnHit,
    exceedThreshold:
      criticalHit !== null ? VIBRATION.stdCritical : warnHit !== null ? VIBRATION.stdWarning : null,
    landing: landingStats,
    excluded: cut ? landing : null,
  };
}
