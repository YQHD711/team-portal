/**
 * 规则 5：固定翼 TECS（总能量控制）跟踪质量
 *
 * 四个量：空速跟踪误差 RMS（spdem−sp）、高度跟踪误差 RMS（hdem−h）、
 * 油门饱和占比（th 顶到 0/1）、俯仰饱和占比（ph 触及 pmin/pmax）。
 * 计算与判档在 `tecsMetrics.ts`（纯函数），本文件只做适用性判断、组装 Finding 与图表。
 *
 * 纪律：**只对 Plane 适用**（Copter/Sub/Rover → not_applicable + 原因，不是 missing_required）；
 * 缺 TECS 消息 → missing_required；有效样本 < TECS.minSamples → insufficient_data（附门槛数字）；
 * 某个量算不出来（如未记录俯仰限幅）→ 单独落 unknown 一侧，绝不混进"通过"。
 * 阈值取自 `analysis/thresholds.ts` 的 `TECS`（初值待标定，本文件不改它）。
 */

import type { ChartRequest, Finding, Severity } from "../../types/report";
import type { Rule, RuleContext } from "../../types/rule";
import { makeFinding, step, suggestion, unknownFinding } from "../finding";
import { longestWindow } from "../windows";
import { TECS } from "../thresholds";
import {
  PITCH_EPS_DEG, THROTTLE_EPS, buildMetrics, fixedSaturationRatio, pitchLimitsValid,
  rmsOfDiff, saturationRatio, tecsActive, verdictOf, type Metric,
} from "./tecsMetrics";

const RULE_ID = "tecs_tracking";
const TITLE = "TECS 总能量控制跟踪";
const DOC = "https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html";

function chart(id: string, title: string, signals: ChartRequest["signals"], thresholds: ChartRequest["thresholds"], highlight: ChartRequest["highlightWindow"] = null): ChartRequest {
  return { id, kind: "timeseries", title, signals, window: null, thresholds, peakMarkers: [], highlightWindow: highlight, spectrum: null };
}

function buildCharts(w: { startSec: number; endSec: number }, satWindow: ChartRequest["highlightWindow"]): ChartRequest[] {
  const ref = (field: string, label: string, color: string) => ({ series: "TECS", field, instance: 0, label, color });
  return [
    chart("tecs-airspeed", "空速：目标 vs 实际", [ref("spdem", "目标空速 spdem", "#0ea5e9"), ref("sp", "实际空速 sp", "#f97316")], []),
    chart("tecs-height", "高度：目标 vs 实际", [ref("hdem", "目标高度 hdem", "#0ea5e9"), ref("h", "实际高度 h", "#f97316")], [], w),
    chart("tecs-throttle", "油门（饱和段高亮）", [ref("th", "油门 th", "#22c55e")],
      [{ value: 1, label: "上限 1.0", axis: "y" }, { value: 0, label: "下限 0.0", axis: "y" }], satWindow),
    chart("tecs-pitch", "俯仰（限幅饱和高亮）", [ref("ph", "俯仰 ph", "#a855f7"), ref("pmin", "俯仰下限 pmin", "#94a3b8"), ref("pmax", "俯仰上限 pmax", "#94a3b8")],
      [], satWindow),
  ];
}

/** 主结论：最差的量决定严重等级；只要有一个量没算出来，就单独补一条 unknown 结论 */
function mainFinding(metrics: readonly Metric[], worst: Metric | null, w: { startSec: number; endSec: number }, activeCount: number, fired: boolean): Finding {
  const severity: Severity = worst ? verdictOf(worst) : "ok";
  return makeFinding({
    ruleId: RULE_ID,
    title: TITLE,
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
      ...metrics.map(m => step(m.label, `${m.value.toFixed(3)}${m.unit}（警告 >${m.warning}${m.unit}${m.critical !== null ? `，严重 >${m.critical}${m.unit}` : ""}），样本 ${m.samples} 点`)),
      step("计算过程", `窗口 ${w.startSec.toFixed(1)}–${w.endSec.toFixed(1)}s；只统计 TECS 真正工作的 ${activeCount} 个样本（spdem>0）；RMS = sqrt(mean((目标−实际)²))；饱和 = 触及上限/下限（油门 ±${THROTTLE_EPS}、俯仰 ±${PITCH_EPS_DEG}°）的样本占比`),
      step("阈值来源", "analysis/thresholds.ts 的 TECS（初值，本切片用 9 份真实 Plane 日志标定）"),
    ],
    metrics: Object.fromEntries(metrics.map(m => [m.key, m.value])),
    suggestions: fired
      ? [
          suggestion(1, "先确认配平与航速包线：空速跟踪差通常先查空速计（校准/位置）与失速裕度，再动参数", {
            verify: "复飞后空速跟踪误差 RMS 下降 ≥30%",
          }),
          suggestion(2, "若空速可信，按官方顺序调 TECS：TIME_CONST → SPDWEIGHT → CLMB/SINK_MAX", {
            param: { name: "TECS_TIME_CONST", from: null, to: 5, reason: "时间常数决定高度/速度分配快慢，先放回默认值再谈其它" },
            verify: "高度与空速跟踪误差 RMS 同时下降，且油门不再长时间顶死",
          }),
        ]
      : [],
    docLinks: [DOC],
    charts: buildCharts(w, fired ? w : null),
    note: fired ? null : "已算出的指标均在阈值内；阈值是初值，若与试飞手感不符请以试飞为准。",
  });
}

export const tecsTrackingRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "params",
  appliesTo: [
    {
      platform: "ardupilot",
      requires: ["TECS"],
      optional: ["TECS", "ARM"],
      note: "TECS 是固定翼（Plane）的总能量控制器；Copter/Sub/Rover 不使用该消息，本规则在这些机型上判 not_applicable",
    },
  ],
  run(ctx: RuleContext) {
    const kind = ctx.doc.meta.vehicleKind;
    if (kind !== "plane") {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "not_applicable",
        note: `TECS（总能量控制）是固定翼专用控制器：当前机型 ${ctx.doc.meta.vehicle}（${kind}）不使用它，因此本规则不适用（不代表通过）。`,
      })];
    }

    const series = ctx.series("TECS", 0);
    const w = longestWindow(ctx.armedWindows()) ?? { startSec: 0, endSec: ctx.doc.meta.durationSec };
    const sp = ctx.windowed("TECS", "sp", w);
    const spdem = ctx.windowed("TECS", "spdem", w);
    const h = ctx.windowed("TECS", "h", w);
    const hdem = ctx.windowed("TECS", "hdem", w);
    if (!series || !sp || !spdem || !h || !hdem) {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "missing_required",
        note: "日志里没有可用的 TECS 序列（需要 Plane 且记录 TECS 消息：spdem/sp/hdem/h）—— 无法评估 TECS 跟踪质量，这不代表通过。",
      })];
    }

    const samples = Math.min(sp.values.length, spdem.values.length, h.values.length, hdem.values.length);
    const mask = tecsActive(spdem.values, samples);
    const activeCount = mask.reduce((a, b) => a + b, 0);
    if (activeCount < TECS.minSamples) {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "insufficient_data",
        note: `TECS 真正在工作（有目标空速 spdem>0）的样本只有 ${activeCount} 个，低于门槛 ${TECS.minSamples} 个（窗口 ${w.startSec.toFixed(1)}–${w.endSec.toFixed(1)}s），无法给出统计结论。`,
      })];
    }

    const th = ctx.windowed("TECS", "th", w);
    const ph = ctx.windowed("TECS", "ph", w);
    const pmin = ctx.windowed("TECS", "pmin", w);
    const pmax = ctx.windowed("TECS", "pmax", w);
    if (!th || !ph || !pmin || !pmax) {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "missing_required",
        note: "TECS 消息缺少 th/ph/pmin/pmax 字段，无法计算饱和占比（这不代表通过）。",
      })];
    }

    const metrics = buildMetrics(
      rmsOfDiff(spdem, sp, mask),
      rmsOfDiff(hdem, h, mask),
      fixedSaturationRatio(th.values, 0, 1, THROTTLE_EPS, mask),
      pitchLimitsValid(pmin, pmax, mask) ? saturationRatio(ph.values, pmin.values, pmax.values, PITCH_EPS_DEG, mask) : NaN,
      activeCount,
    );
    const measured = metrics.filter(m => Number.isFinite(m.value));
    const unavailable = metrics.filter(m => !Number.isFinite(m.value));
    const worst = measured.reduce((m, x) => (verdictOf(x) === "ok" ? m : (m === null ? x : m)), null as Metric | null);
    const findings: Finding[] = [mainFinding(measured, worst, w, activeCount, worst !== null)];

    for (const m of unavailable) {
      findings.push(unknownFinding({
        ruleId: RULE_ID, title: `${TITLE}：${m.label}`, status: "insufficient_data",
        note: `${m.label}无法计算：${m.key === "pitchSatRatio" ? "日志里 TECS 的 pmin/pmax 没有记录有效限幅范围（中位幅度 < 5°），无法判断是否触及限幅" : "该量在 TECS 工作样本内没有有效数据"} —— 这不代表通过。`,
      }));
    }

    return findings;
  },
};

/** TECS 工作窗口内的事件（供 UI 叠加竖线；规则本身不消费） */
export function tecsRelevantKinds(): readonly string[] {
  return ["mode", "failsafe", "error"];
}
