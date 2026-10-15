/**
 * 振动指标扫描 —— 振动规则与滤波规则**共用**。
 *
 * 抽出来的原因：滤波建议只有在"确实存在振动问题"时才允许给出，
 * 否则就会变成对健康机架乱推参数的噪声源。两个规则必须看到同一份证据。
 *
 * ⚠️ 降落/触地段处理（用户反馈：「有时候降落坠机产生的震动不能算异常的一部分」）：
 *   常规统计 = arm 窗口 **减去** 识别出的降落段；降落段单独统计成 `landing`。
 *   识别不出降落段时 `excluded = null`，调用方必须如实说明"未排除"。
 */

import type { TimeWindow } from "../types/log";
import type { RuleContext } from "../types/rule";
import { longestWindow } from "./windows";
import { detectLanding, type LandingDetection } from "./landingSegment";
import { scanInstance } from "./vibrationInstance";
import { FILTER, VIBRATION } from "./thresholds";

export type VibrationAxis = "x" | "y" | "z";

export interface VibrationAxisStat {
  axis: VibrationAxis;
  /** VIBE 字段名：VibeX / VibeY / VibeZ */
  field: string;
  std: number;
  max: number;
}

/** 降落/触地段的独立统计 */
export interface LandingStats {
  window: TimeWindow;
  samples: number;
  worstStd: number;
  worstAxis: VibrationAxis;
  max: number;
  /** 该段内加速度计饱和（clip）增量 */
  clipDelta: number;
}

export interface VibrationIndicator {
  /** IMU 实例号 */
  instance: number;
  /** 统计窗口（**已排除降落段**）；未排除时等于 arm 窗口 */
  window: TimeWindow;
  /** arm 窗口（含降落段），供证据说明 */
  armedWindow: TimeWindow;
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
  /** 降落/触地段（若识别出来）：单独统计，不混进上面的常规振动 */
  landing: LandingStats | null;
  /** 被排除区段的说明（依据 + 可信度）；未排除时为 null */
  excluded: LandingDetection | null;
}

export interface VibrationScan {
  indicators: VibrationIndicator[];
  /** 无法扫描的原因；null 表示可用 */
  unavailable: string | null;
}

/**
 * 振动是否已达到"需要陷波"的程度（振动规则与滤波规则共用，避免模块互相 import 成环）。
 * 只看**排除降落段之后**的常规振动 ✓（落地冲击不再污染这个判据）。
 */
export function vibrationBad(indicators: readonly VibrationIndicator[]): boolean {
  return indicators.some(
    (i) => i.worstStd >= FILTER.vibrationNeedsNotchStd || i.clipDelta >= VIBRATION.clipDeltaCritical,
  );
}

export function scanVibration(ctx: RuleContext): VibrationScan {
  const anyInstance = ctx.doc.series["VIBE:0"] !== undefined;
  if (!anyInstance && ctx.series("VIBE") === null) {
    return { indicators: [], unavailable: "日志中没有 VIBE（振动水平）消息，无法评估振动" };
  }
  const window = longestWindow(ctx.armedWindows());
  if (!window) {
    return { indicators: [], unavailable: "没有可用的飞行（arm）时间段，无法评估飞行中的振动" };
  }

  const instances = Object.keys(ctx.doc.series)
    .filter((k) => k.startsWith("VIBE:"))
    .map((k) => Number(k.slice("VIBE:".length)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (instances.length === 0) {
    return { indicators: [], unavailable: "日志中没有 VIBE 消息" };
  }

  // 降落段识别一次，所有 IMU 共用（依据与可信度写进证据）
  const landing = detectLanding(ctx, window);
  const indicators: VibrationIndicator[] = [];
  const skipped: string[] = [];
  for (const instance of instances) {
    const result = scanInstance(ctx, instance, window, landing);
    if ("skipped" in result) {
      skipped.push(result.skipped);
      continue;
    }
    indicators.push(result);
  }

  if (indicators.length === 0) {
    return {
      indicators: [],
      unavailable: `飞行段内 VIBE 样本不足，无法评估（${skipped.join("、")}）`,
    };
  }
  return { indicators, unavailable: null };
}
