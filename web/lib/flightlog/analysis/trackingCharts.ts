/**
 * 外环跟踪的图表构造：目标 / 实际 / 误差三条线 + 阈值线 + 高亮窗口。
 *
 * 为什么单独一处：angle / velocity / airspeed / cross-track 四类通道的曲线形状完全一致，
 * 阈值线口径也必须一致（否则同一张图上两条线的含义会打架）。
 */

import type { ChartRequest, ThresholdLine } from "../types/report";
import type { TimeWindow } from "../types/log";

/** 误差超过阈值的连续区间（图表高亮）；从未超过返回 null */
export function highlightFor(timeSec: Float64Array, error: Float64Array, threshold: number): TimeWindow | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < error.length && i < timeSec.length; i += 1) {
    if (Math.abs(error[i]) <= threshold) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return null;
  return { startSec: timeSec[first], endSec: timeSec[last] };
}

/** 目标/实际/误差三条线 + 阈值线 + 高亮窗口（时间序列图的标准形状） */
export function trackingChart(args: {
  id: string;
  title: string;
  message: string;
  targetField: string;
  actualField: string;
  targetLabel: string;
  actualLabel: string;
  window: TimeWindow;
  thresholds: readonly ThresholdLine[];
  highlight: TimeWindow | null;
}): ChartRequest {
  return {
    id: args.id,
    kind: "timeseries",
    title: args.title,
    signals: [
      { series: args.message, field: args.targetField, instance: 0, label: args.targetLabel },
      { series: args.message, field: args.actualField, instance: 0, label: args.actualLabel },
      // 误差列不在日志里（由规则算出），UI 依据 label 用同一条曲线的两点相减绘制
      { series: args.message, field: args.actualField, instance: 0, label: "误差（目标−实际）" },
    ],
    window: args.window,
    thresholds: args.thresholds,
    peakMarkers: [],
    highlightWindow: args.highlight,
    spectrum: null,
  };
}

/** 绝对量阈值线（角度用 °，位置/航迹/高度用 m） */
export function absoluteThresholds(warning: number, critical: number, unit: string): ThresholdLine[] {
  return [
    { value: warning, label: `警告 ${warning} ${unit}`, axis: "y" },
    { value: critical, label: `严重 ${critical} ${unit}`, axis: "y" },
  ];
}

/** 比值阈值线（误差/目标，无量纲） */
export function ratioThresholds(warning: number, critical: number): ThresholdLine[] {
  return [
    { value: warning, label: `警告 比值 ${warning}`, axis: "y" },
    { value: critical, label: `严重 比值 ${critical}`, axis: "y" },
  ];
}
