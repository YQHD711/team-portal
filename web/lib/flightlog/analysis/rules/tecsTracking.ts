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
import { unknownFinding } from "../finding";
import { dataGapStep, unknownWithAdvice } from "./tuningSteps";
import { mainFinding, TECS_DOC, TECS_RULE_ID, TECS_TITLE } from "./tecsFinding";
import { longestWindow } from "../windows";
import { TECS } from "../thresholds";
import {
  PITCH_EPS_DEG, THROTTLE_EPS, buildMetrics, fixedSaturationRatio, pitchLimitsValid,
  rmsOfDiff, saturationRatio, tecsActive, verdictOf, type Metric,
} from "./tecsMetrics";

const RULE_ID = TECS_RULE_ID;
const TITLE = TECS_TITLE;
const DOC = TECS_DOC;


export const tecsTrackingRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "params",
  appliesTo: [
    {
      platform: "ardupilot",
      // ⚠️ 不把 TECS 放进 requires：非 Plane 机型本就该由规则自己判 not_applicable（折叠进「本机型不适用」）。
      // 放进 requires 会让引擎先生成一条 missing_required 卡片，Copter 报告里就挂着一条用不到的消息（用户抱怨点）。
      requires: [],
      optional: ["TECS", "ARM"],
      note: "TECS 是固定翼（Plane）的总能量控制器；Copter/Sub/Rover 不使用该消息，本规则在这些机型上判 not_applicable",
    },
  ],
  run(ctx: RuleContext) {
    const kind = ctx.doc.meta.vehicleKind;
    if (kind !== "plane") {
      return [unknownWithAdvice({
        ruleId: RULE_ID, title: TITLE, status: "not_applicable",
        reason: `TECS（总能量控制）是固定翼专用控制器：当前机型 ${ctx.doc.meta.vehicle}（${kind}）不使用它，因此本规则不适用（不代表通过）。`,
        docLinks: [DOC],
        suggestions: [dataGapStep({
          signature: `本机型（${kind}）没有 TECS 总能量控制`,
          missing: "TECS 是固定翼专用控制器，本机型不使用",
          howToFix: "该规则不适用、无需调参；请改看本机型对应的纵向/速度环结论（同一份报告里其余结论仍有效）",
          doc: DOC,
        })],
      })];
    }

    const series = ctx.series("TECS", 0);
    const w = longestWindow(ctx.armedWindows()) ?? { startSec: 0, endSec: ctx.doc.meta.durationSec };
    const sp = ctx.windowed("TECS", "sp", w);
    const spdem = ctx.windowed("TECS", "spdem", w);
    const h = ctx.windowed("TECS", "h", w);
    const hdem = ctx.windowed("TECS", "hdem", w);
    if (!series || !sp || !spdem || !h || !hdem) {
      return [unknownWithAdvice({
        ruleId: RULE_ID, title: TITLE, status: "missing_required",
        reason: "日志里没有可用的 TECS 序列（需要 Plane 且记录 TECS 消息：spdem/sp/hdem/h）—— 无法评估 TECS 跟踪质量，这不代表通过。",
        docLinks: [DOC],
        suggestions: [dataGapStep({
          signature: "缺少 TECS 序列（spdem/sp/hdem/h）",
          missing: "本份日志没有记录 TECS 或字段不全",
          howToFix: "确认飞控日志已启用 TECS 记录后复飞重采；或改用同一飞行的其它纵向指标（CTUN/NTUN）判读",
          doc: DOC,
        })],
      })];
    }

    const samples = Math.min(sp.values.length, spdem.values.length, h.values.length, hdem.values.length);
    const mask = tecsActive(spdem.values, samples);
    const activeCount = mask.reduce((a, b) => a + b, 0);
    if (activeCount < TECS.minSamples) {
      return [unknownWithAdvice({
        ruleId: RULE_ID, title: TITLE, status: "insufficient_data",
        reason: `TECS 真正在工作（有目标空速 spdem>0）的样本只有 ${activeCount} 个，低于门槛 ${TECS.minSamples} 个（窗口 ${w.startSec.toFixed(1)}–${w.endSec.toFixed(1)}s），无法给出统计结论。`,
        docLinks: [DOC],
        suggestions: [dataGapStep({
          signature: `TECS 有效样本 ${activeCount} < 门槛 ${TECS.minSamples}`,
          missing: "本次飞行 TECS 真正工作的样本太少（多为地面/待机段）",
          howToFix: "做一次含巡航与爬升/下降科目的固定翼飞行后复飞重采",
          doc: DOC,
        })],
      })];
    }

    const th = ctx.windowed("TECS", "th", w);
    const ph = ctx.windowed("TECS", "ph", w);
    const pmin = ctx.windowed("TECS", "pmin", w);
    const pmax = ctx.windowed("TECS", "pmax", w);
    if (!th || !ph || !pmin || !pmax) {
      return [unknownWithAdvice({
        ruleId: RULE_ID, title: TITLE, status: "missing_required",
        reason: "TECS 消息缺少 th/ph/pmin/pmax 字段，无法计算饱和占比（这不代表通过）。",
        docLinks: [DOC],
        suggestions: [dataGapStep({
          signature: "TECS 缺少 th/ph/pmin/pmax 字段",
          missing: "饱和占比所需的字段不全",
          howToFix: "按官方 TECS 页核对油门/俯仰限幅参数，并确认固件会记录这些字段后复飞重采",
          doc: DOC,
        })],
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
      findings.push(unknownWithAdvice({
        ruleId: RULE_ID, title: `${TITLE}：${m.label}`, status: "insufficient_data",
        reason: `${m.label}无法计算：${m.key === "pitchSatRatio" ? "日志里 TECS 的 pmin/pmax 没有记录有效限幅范围（中位幅度 < 5°），无法判断是否触及限幅" : "该量在 TECS 工作样本内没有有效数据"} —— 这不代表通过。`,
        docLinks: [DOC],
        suggestions: [dataGapStep({
          signature: `${m.label}无法计算`,
          missing: "该量在 TECS 工作样本内没有有效数据",
          howToFix: "按官方 TECS 页确认该量所需的参数/字段是否启用后复飞重采",
          doc: DOC,
        })],
      }));
    }

    return findings;
  },
};

/** TECS 工作窗口内的事件（供 UI 叠加竖线；规则本身不消费） */
export function tecsRelevantKinds(): readonly string[] {
  return ["mode", "failsafe", "error"];
}
