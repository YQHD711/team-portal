/**
 * 速率环分轴结论的构造（从 `pidRateTracking.ts` 拆出：原文件超过 200 行上限）。
 *
 * 这里只负责"把一份 RateAxisEvidence + 调参取证变成 Finding"；
 * 适用性判断（固定翼没有 yaw 速率环之类）留在规则文件里。
 *
 * ⚠️ 分级驱动严重度：**只有 A/B 才算"通过"**。C 级是"能跟但偏松、仍有明显改进空间"——
 * 二元判断会把"很一般"也显示成通过，这是用户反馈的核心问题。
 */

import type { ChartRequest, Finding, Suggestion } from "../../types/report";
import type { TimeWindow } from "../../types/log";
import { makeFinding, suggestion } from "../finding";
import { PID_RATE } from "../thresholds";
import type { RateAxisEvidence, RateAxisSpec } from "../rateAxisEvidence";
import type { Grade, RateTuningMetrics } from "../tuningAdvice";
import { buildRateAdvice } from "../rateTuningAdvice";
import { dataGapStep } from "./tuningSteps";

export const PID_RULE_ID = "pid_rate_tracking";
export const PID_RULE_TITLE = "速率环跟踪质量";
export const PID_DOC =
  "https://ardupilot.org/copter/docs/tuning-process-instructions.html";

const GRADE_SCORE: Readonly<Record<Grade, number>> = { A: 4, B: 3, C: 2, D: 1 };

export function pidChartsFor(spec: RateAxisSpec, window: TimeWindow): ChartRequest[] {
  return [
    {
      id: `${PID_RULE_ID}-${spec.axis}`,
      kind: "timeseries",
      title: `${spec.label} 速率环：指令 / 实际 / 误差`,
      signals: [
        { series: spec.message, field: "Tar", label: "指令 Tar" },
        { series: spec.message, field: "Act", label: "实际 Act" },
        { series: spec.message, field: "Err", label: "误差 Err" },
      ],
      window,
      thresholds: [],
      peakMarkers: [],
      highlightWindow: null,
      spectrum: null,
    },
  ];
}

export function axisParamSuffix(axis: "roll" | "pitch" | "yaw"): string {
  return axis === "roll" ? "RLL" : axis === "pitch" ? "PIT" : "YAW";
}

export interface AxisTuningParams {
  /** 该机型的参数前缀（Copter=ATC_RAT_RLL，Plane=RLL2SRV/PTCH2SRV）——写死 Copter 前缀会给固定翼推不存在的参数 */
  prefix: string;
  p: number | null;
  i: number | null;
  d: number | null;
  ff: number | null;
}

export function buildAxisFinding(
  ev: RateAxisEvidence,
  capNote: string | null,
  params: AxisTuningParams,
  tuning: RateTuningMetrics | null,
): Finding {
  const grade = tuning?.grade ?? null;
  const gradeText = grade ? ` · ${grade} 级` : "";
  const common = {
    ruleId: PID_RULE_ID,
    title: `${PID_RULE_TITLE}（${ev.spec.label}${gradeText}）`,
    axis: ev.spec.axis,
    window: ev.window,
    evidence: ev.evidence,
    metrics: tuning
      ? {
          ...ev.metrics,
          gradeScore: GRADE_SCORE[grade ?? "D"],
          lagSamples: tuning.lagSamples,
          iBiasRatio: tuning.iBiasRatio,
          dOverErr: tuning.dOverErr,
        }
      : ev.metrics,
    docLinks: [PID_DOC],
    charts: pidChartsFor(ev.spec, ev.window),
    note: capNote,
  };

  if (!ev.excited) {
    return makeFinding({
      ...common,
      severity: "unknown",
      status: "insufficient_data",
      phenomenon: `本次飞行 ${ev.spec.label} 轴指令过小：Tar RMS 仅 ${ev.tarRmsDegPerSec.toFixed(2)} deg/s（门槛 ${PID_RATE.minExcitationDegPerSec} deg/s），无法评价跟踪质量`,
      impact: "无法判断该轴跟踪是否正常，不代表通过",
      note: `指令激励 ${ev.tarRmsDegPerSec.toFixed(2)} deg/s 低于评估门槛 ${PID_RATE.minExcitationDegPerSec} deg/s：激励不足时 Err/Tar 天然可大于 1，因此不做判定，结果不代表通过。${capNote ?? ""}`.trim(),
      // 用户要求「每一项都有建议」：无法判断时给方向 + 说清缺什么，不给参数数值
      suggestions: [
        dataGapStep({
          signature: `${ev.spec.label} 轴指令激励 ${ev.tarRmsDegPerSec.toFixed(2)} deg/s < 门槛 ${PID_RATE.minExcitationDegPerSec} deg/s`,
          missing: "本次飞行该轴几乎没有明显机动，无法评估跟踪",
          howToFix: "复飞时给出明显的滚转/俯仰/偏航机动（航线转弯或手动扰动）后重采；本条不代表通过",
          doc: PID_DOC,
        }),
      ],
    });
  }

  const severity =
    grade === "D"
      ? "critical"
      : grade === "C"
        ? "warning"
        : grade
          ? "ok"
          : ev.ratio >= PID_RATE.errRatioCritical
            ? "critical"
            : "warning";

  const tuningNote = tuning
    ? [
        `实测：Err/Tar=${tuning.errRatio.toFixed(3)}（仅高指令样本）、滞后 ${tuning.lagSamples} 个采样（≈${Math.round(tuning.lagMs)} ms）、` +
          `指令主频 ${tuning.dominantHz.toFixed(2)} Hz、|I 项均值|/IMAX=${(tuning.iBiasRatio * 100).toFixed(1)}%、RMS(D)/RMS(误差)=${tuning.dOverErr.toFixed(2)}`,
        "⚠️ 建议值是**由实测签名推导的起点值**，依赖「纯延迟 + 单一主频」等近似；真正的增益需要阶跃响应或系统辨识，日志里没有。",
        ...tuning.assumptions,
      ].join("\n")
    : capNote;

  // ⚠️ **建议无论等级都附上**：用户明确要求"不是说通过就行了"——
  // A/B 级只代表"当前够用"，仍然要把实测能看出的改进空间与具体数值给出来。
  const advice: Suggestion[] = tuning
    ? buildRateAdvice(tuning, {
        prefix: params.prefix,
        p: params.p,
        i: params.i,
        d: params.d,
        ff: params.ff,
      })
    : legacySuggestions(ev, params.p);

  if (severity === "ok") {
    return makeFinding({
      ...common,
      severity: "ok",
      status: "passed",
      phenomenon: `${ev.spec.label} 轴跟踪紧（${grade ?? "?"} 级）：Err/Tar = ${tuning ? tuning.errRatio.toFixed(3) : ev.ratio.toFixed(3)}（指令 RMS ${ev.tarRmsDegPerSec.toFixed(2)} deg/s）`,
      impact: "速率环能够紧跟指令，不构成姿态控制风险；下面仍给出可继续优化的空间",
      note: tuningNote,
      suggestions: advice,
    });
  }

  const phenomenon =
    grade === "C"
      ? `${ev.spec.label} 轴**能跟但偏松**（C 级，仍有明显改进空间）：Err/Tar = ${tuning!.errRatio.toFixed(3)}，滞后 ${tuning!.lagSamples} 个采样（≈${Math.round(tuning!.lagMs)} ms）`
      : `${ev.spec.label} 轴跟踪不足（${grade ?? "?"} 级）：Err/Tar = ${tuning ? tuning.errRatio.toFixed(3) : ev.ratio.toFixed(3)}（Err RMS ${ev.errRms.toFixed(4)} ${ev.unit}）`;

  return makeFinding({
    ...common,
    note: tuningNote,
    severity,
    status: "fired",
    phenomenon,
    impact:
      "跟踪偏差会直接表现为姿态抖动与定位精度下降，并随参数与机械状态恶化而放大",
    suggestions: advice,
  });
}

/** 没有调参取证数据时的兜底建议（保持旧行为） */
function legacySuggestions(ev: RateAxisEvidence, currentP: number | null): Suggestion[] {
  return [
    suggestion(1, "确认滤波配置（按滤波规则给出的顺序，前一步未验证不做后一步）"),
    suggestion(
      2,
      `降低 ${ev.spec.label} 轴速率环 P（保守从 -20% 起步），复飞后再按误差 RMS 变化继续调整`,
      {
        param: {
          name: ev.spec.paramName,
          from: currentP,
          to: currentP !== null ? currentP * 0.8 : 0,
          reason: "跟踪误差偏大时优先降低 P；若降 P 后误差反而增大，再考虑 D/FF",
        },
        verify: `${ev.spec.label} 轴 rate error RMS 下降 ≥30%`,
      },
    ),
    suggestion(3, "若仍不跟踪，检查重心 / 推力不对称（I 项饱和方向）与舵面、电机一致性"),
  ];
}
