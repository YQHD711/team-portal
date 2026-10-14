/**
 * uPlot 的数据/选项构造（纯函数，可在 vitest 里直接断言）。
 *
 * 约定（契约 §3.5）：
 *  - **不降采样**：源数组有多少点就给 uPlot 多少点（Err 峰值就是证据，削峰等于毁证据）；
 *  - 频谱点由规则算好放在 `ChartRequest.spectrum`，UI 不重算 FFT；
 *  - timeseries 的信号数据来自 `LogDocument`（`pickSeries` 按 SignalRef 取），
 *    取不到就返回 null，由组件显示"数据不可用"，**不猜、不补零**。
 */

import type uPlot from "uplot";
import type { ChartRequest, SignalRef } from "@/lib/flightlog/types/report";
import type { LogDocument, LogEvent } from "@/lib/flightlog/types/log";

export interface SeriesInput {
  label: string;
  values: Float64Array;
  timeSec: Float64Array;
  color?: string;
}

/** 按 SignalRef 从 LogDocument 取一条曲线；没有该消息/字段时返回 null（缺数据必须显式表达） */
export function pickSeries(doc: LogDocument, ref: SignalRef): SeriesInput | null {
  const key = `${ref.series}:${ref.instance ?? 0}`;
  const s = doc.series[key];
  const values = s?.fields[ref.field];
  if (!s || !values) return null;
  return {
    label: ref.label ?? `${ref.series}.${ref.field}${ref.instance ? `#${ref.instance}` : ""}`,
    values,
    timeSec: s.timeSec,
    color: ref.color,
  };
}

/** x 轴 + 各曲线的对齐数据；没有可用曲线时返回 null */
export function buildChartData(chart: ChartRequest, series: readonly SeriesInput[]): uPlot.AlignedData | null {
  if (chart.kind === "spectrum") {
    const points = chart.spectrum?.points;
    if (!points || points.length === 0) return null;
    return [points.map(p => p.freqHz), points.map(p => p.power)];
  }
  const usable = series.filter(s => s.values.length === s.timeSec.length && s.values.length > 0);
  if (usable.length === 0) return null;
  return [usable[0].timeSec, ...usable.map(s => s.values)];
}

const DEFAULT_COLORS = ["#0ea5e9", "#f97316", "#a855f7", "#22c55e"];

/** uPlot 选项：阈值线 / 高亮窗口 / 事件竖线 / 峰值标记都在 hooks.draw 里画 */
export function buildChartOptions(
  chart: ChartRequest,
  series: readonly SeriesInput[],
  width: number,
  height: number,
  events: readonly LogEvent[] = [],
): uPlot.Options {
  const isSpectrum = chart.kind === "spectrum";
  const usable = isSpectrum ? [] : series.filter(s => s.values.length === s.timeSec.length && s.values.length > 0);

  return {
    width,
    height,
    // 不降采样、不抽稀：点数与源数据一致
    pxAlign: false,
    scales: isSpectrum
      ? { x: { time: false }, y: { auto: true } }
      : { x: { time: false }, y: { auto: true } },
    axes: [
      { stroke: "#71717a", grid: { stroke: "rgba(148,163,184,0.25)" }, label: isSpectrum ? "频率 (Hz)" : "时间 (s)" },
      { stroke: "#71717a", grid: { stroke: "rgba(148,163,184,0.25)" }, label: isSpectrum ? "功率" : "" },
    ],
    series: [
      { label: isSpectrum ? "频率" : "时间" },
      ...(isSpectrum
        ? [{ label: chart.spectrum?.ref.label ?? "频谱", stroke: "#0ea5e9", width: 1 }]
        : usable.map((s, i) => ({
            label: s.label,
            stroke: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
            width: 1,
          }))),
    ],
    legend: { show: true },
    cursor: { show: true },
    hooks: {
      draw: [
        (u: uPlot) => {
          const { ctx } = u;
          const y0 = u.bbox.top;
          const y1 = u.bbox.top + u.bbox.height;
          const x0 = u.bbox.left;
          const x1 = u.bbox.left + u.bbox.width;

          // 异常时间段高亮（先画，压在曲线下面）
          const hl = chart.highlightWindow;
          if (hl && !isSpectrum) {
            const a = u.valToPos(hl.startSec, "x");
            const b = u.valToPos(hl.endSec, "x");
            ctx.save();
            ctx.fillStyle = "rgba(239,68,68,0.12)";
            ctx.fillRect(Math.min(a, b), y0, Math.abs(b - a), u.bbox.height);
            ctx.restore();
          }

          // 阈值线：timeseries 画水平线(y)，spectrum 画竖线(x)
          for (const th of chart.thresholds) {
            ctx.save();
            ctx.strokeStyle = "#ef4444";
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            if (th.axis === "y") {
              const y = u.valToPos(th.value, "y");
              ctx.moveTo(x0, y);
              ctx.lineTo(x1, y);
            } else {
              const x = u.valToPos(th.value, "x");
              ctx.moveTo(x, y0);
              ctx.lineTo(x, y1);
            }
            ctx.stroke();
            ctx.restore();
          }

          if (isSpectrum) {
            // 峰值参考频率（陷波中心/谐波）
            for (const peak of chart.peakMarkers) {
              const x = u.valToPos(peak.freqHz, "x");
              ctx.save();
              ctx.strokeStyle = "#a855f7";
              ctx.setLineDash([3, 3]);
              ctx.beginPath();
              ctx.moveTo(x, y0);
              ctx.lineTo(x, y1);
              ctx.stroke();
              ctx.restore();
            }
          } else {
            // 事件竖线（arm/mode/error…）
            for (const ev of events) {
              const x = u.valToPos(ev.tSec, "x");
              ctx.save();
              ctx.strokeStyle = ev.kind === "error" || ev.kind === "failsafe" ? "#ef4444" : "rgba(113,113,122,0.6)";
              ctx.beginPath();
              ctx.moveTo(x, y0);
              ctx.lineTo(x, y1);
              ctx.stroke();
              ctx.restore();
            }
          }
        },
      ],
    },
  };
}
