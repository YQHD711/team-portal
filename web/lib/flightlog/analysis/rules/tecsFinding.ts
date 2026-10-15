/**
 * TECS 主结论与图表的构造（从 tecsTracking.ts 拆出：原文件超过 200 行上限）。
 *
 * 纪律：通过（ok）与触发（fired）**都必须带建议**（用户：「每一项都有建议」）。
 * 通过时给方向 + 说明缺什么数据，绝不编数值；触发时按官方 TECS 调参顺序给起点值。
 */

import type { ChartRequest, Finding, Severity } from "../../types/report";
import { makeFinding, step } from "../finding";
import { improvementStep, tuningStep } from "./tuningSteps";
import { PITCH_EPS_DEG, THROTTLE_EPS, verdictOf, type Metric } from "./tecsMetrics";

export const TECS_RULE_ID = "tecs_tracking";
export const TECS_TITLE = "TECS 总能量控制跟踪";
export const TECS_DOC =
  "https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html";

function chart(
  id: string,
  title: string,
  signals: ChartRequest["signals"],
  thresholds: ChartRequest["thresholds"],
  highlight: ChartRequest["highlightWindow"] = null,
): ChartRequest {
  return { id, kind: "timeseries", title, signals, window: null, thresholds, peakMarkers: [], highlightWindow: highlight, spectrum: null };
}

export function buildCharts(w: { startSec: number; endSec: number }): ChartRequest[] {
  const ref = (field: string, label: string, color: string) => ({ series: "TECS", field, instance: 0, label, color });
  return [
    chart("tecs-airspeed", "空速：目标 vs 实际", [ref("spdem", "目标空速 spdem", "#0ea5e9"), ref("sp", "实际空速 sp", "#f97316")], []),
    chart("tecs-height", "高度：目标 vs 实际", [ref("hdem", "目标高度 hdem", "#0ea5e9"), ref("h", "实际高度 h", "#f97316")], [], w),
    chart("tecs-throttle", "油门（饱和段高亮）", [ref("th", "油门 th", "#22c55e")],
      [{ value: 1, label: "上限 1.0", axis: "y" }, { value: 0, label: "下限 0.0", axis: "y" }], w),
    chart("tecs-pitch", "俯仰（限幅饱和高亮）", [ref("ph", "俯仰 ph", "#a855f7"), ref("pmin", "俯仰下限 pmin", "#94a3b8"), ref("pmax", "俯仰上限 pmax", "#94a3b8")],
      [], w),
  ];
}

/** 主结论：最差的量决定严重等级；通过也要给建议 */
export function mainFinding(
  metrics: readonly Metric[],
  worst: Metric | null,
  w: { startSec: number; endSec: number },
  activeCount: number,
  fired: boolean,
): Finding {
  const severity: Severity = worst ? verdictOf(worst) : "ok";
  const values = metrics.map((m) => `${m.label}=${m.value.toFixed(3)}${m.unit}`).join("；");
  return makeFinding({
    ruleId: TECS_RULE_ID,
    title: TECS_TITLE,
    severity,
    status: fired ? "fired" : "passed",
    window: w,
    phenomenon: fired
      ? `${worst!.label} ${worst!.value.toFixed(3)}${worst!.unit} 超过阈值 ${worst!.warning}${worst!.unit}`
      : `TECS 已算出的跟踪指标均在阈值内（有效样本 ${activeCount} 点）`,
    impact: fired
      ? "总能量控制跟不上目标：表现为掉高/超速/油门顶死，纵向轨迹不可信"
      : "未发现 TECS 跟踪层面的明显问题",
    evidence: [
      ...metrics.map((m) => step(m.label, `${m.value.toFixed(3)}${m.unit}（警告 >${m.warning}${m.unit}${m.critical !== null ? `，严重 >${m.critical}${m.unit}` : ""}），样本 ${m.samples} 点`)),
      step("计算过程", `窗口 ${w.startSec.toFixed(1)}–${w.endSec.toFixed(1)}s；只统计 TECS 真正工作的 ${activeCount} 个样本（spdem>0）；RMS = sqrt(mean((目标−实际)²))；饱和 = 触及上限/下限（油门 ±${THROTTLE_EPS}、俯仰 ±${PITCH_EPS_DEG}°）的样本占比`),
      step("阈值来源", "analysis/thresholds.ts 的 TECS（初值，已用 9 份真实 Plane 日志标定）"),
    ],
    metrics: Object.fromEntries(metrics.map((m) => [m.key, m.value])),
    suggestions: fired
      ? [
          tuningStep({
            order: 1,
            signature: `${worst!.label} ${worst!.value.toFixed(3)}${worst!.unit} > 警告 ${worst!.warning}${worst!.unit}`,
            current: values,
            suggested: "按官方顺序调 TECS：TIME_CONST → SPDWEIGHT → CLMB/SINK_MAX；空速跟踪差先查空速计与失速裕度",
            basis: "官方 TECS 指南：高度/速度跟踪相互耦合，必须按顺序改并逐次复飞验证（起点值，非最优）",
            verify: "高度与空速跟踪误差 RMS 同时下降，且油门不再长时间顶死",
            doc: TECS_DOC,
            param: { name: "TECS_TIME_CONST", from: null, to: 5, reason: "先把时间常数放回默认值 5 再谈其它；当前值需在 PARM 里核对" },
          }),
        ]
      : [
          improvementStep({
            signature: `TECS 已算出的 ${metrics.length} 个量都在阈值内（有效样本 ${activeCount} 点）`,
            current: values,
            direction: "维持当前 TECS 配置；若要进一步收紧高度/速度保持，先记录本次各量作为基线，再按官方顺序微调",
            missing: "没有阶跃/爬升-俯冲激励段时无法给出参数起点值（需专门试飞科目）",
            verify: "复飞后各量不劣于本次基线，油门饱和占比不上升",
            doc: TECS_DOC,
          }),
        ],
    docLinks: [TECS_DOC],
    charts: buildCharts(w),
    note: fired ? null : "已算出的指标均在阈值内；阈值是初值，若与试飞手感不符请以试飞为准。",
  });
}
