"use client";

import { useEffect, useRef, useState } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { ChartRequest } from "@/lib/flightlog/types/report";
import type { LogEvent } from "@/lib/flightlog/types/log";
import { buildChartData, buildChartOptions, type SeriesInput } from "./chartData";

/**
 * uPlot 封装（Canvas，**不降采样**；本切片的分析视图不用 recharts）。
 * - timeseries：阈值线(y) + 高亮窗口 + 事件竖线；信号数据由 `series`（来自 LogDocument）传入
 * - spectrum：阈值线(x) + peakMarkers；点来自 `ChartRequest.spectrum`（规则算好，UI 不重算 FFT）
 * 拿不到数据时显示"数据不可用"，**不猜、不补零**（缺数据必须显式表达）。
 *
 * uPlot 走**动态 import**：它模块初始化会碰 `matchMedia`，静态 import 会让「只要引到诊断面板
 * 的页面」（例如 /flightlog 页本身在 jsdom 测试里）直接抛 `matchMedia is not a function`；
 * 顺带也避免默认标签页把图表库打进首屏包。
 */
export function UplotChart({ chart, series = [], events = [], height = 220 }: {
  chart: ChartRequest;
  /** 从 LogDocument 取出的曲线（pickSeries） */
  series?: readonly SeriesInput[];
  events?: readonly LogEvent[];
  height?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const measured = holder.current?.clientWidth ?? 0;
    setWidth(measured > 0 ? measured : 640);   // jsdom / 首帧拿不到宽度时兜底
  }, []);

  const data = buildChartData(chart, series);

  useEffect(() => {
    if (!data || !holder.current) return;
    let cancelled = false;
    let instance: uPlot | null = null;

    void import("uplot")
      .then(mod => {
        if (cancelled || !holder.current) return;
        instance = new mod.default(buildChartOptions(chart, series, width, height, events), data, holder.current);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [chart, series, events, width, height, data]);

  return (
    <figure data-testid="diagnosis-chart" data-chart-kind={chart.kind} className="rounded-lg border border-border bg-surface p-2">
      <figcaption className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="font-medium">{chart.title}</span>
        <span className="text-[10px] text-faint">{chart.kind === "spectrum" ? "频谱（规则已算好）" : "时序（不降采样）"}</span>
      </figcaption>
      {!data ? (
        <p data-testid="diagnosis-chart-empty" className="px-2 py-6 text-center text-xs text-faint">
          图表数据不可用（{chart.kind === "spectrum" ? "规则未提供频谱点" : "未取到对应信号"}）
        </p>
      ) : failed ? (
        <p data-testid="diagnosis-chart-failed" className="px-2 py-6 text-center text-xs text-danger">
          图表库加载失败；数据仍可在「关键量 / 判定过程」里查看
        </p>
      ) : (
        <div ref={holder} data-testid="diagnosis-chart-canvas" className="w-full" />
      )}
    </figure>
  );
}
