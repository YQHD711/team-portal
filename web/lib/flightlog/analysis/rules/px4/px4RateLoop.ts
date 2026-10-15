/**
 * 规则：PX4 速率环跟踪质量（task-34 第 1 项）。
 *
 * 口径（冻结契约）：指令 `vehicle_rates_setpoint.{roll,pitch,yaw}`、实际
 * `vehicle_angular_velocity.xyz[0..2]`（均为 rad/s）；时间轴已是秒；SI 单位。
 *
 * 分级语义与 ArduPilot 侧**完全一致**：A/B → `passed`；**C → `fired`+`warning`
 * （"能跟但偏松，仍有明显改进空间"）**；D → `critical`。
 * 「无法评价」的四种情形（缺 topic / 样本不足 / 没激励 / 指令↔实际对不上）拆在 `px4RateGaps.ts`。
 *
 * 签名算法复用 `analysis/trackingSignatures.ts`（同一份实现，不复制粘贴），
 * 建议复用 `rules/tuningSteps.ts` 的六要素格式。
 */

import type { Finding } from "../../../types/report";
import type { Rule, RuleContext } from "../../../types/rule";
import type { TimeWindow } from "../../../types/log";
import { makeFinding, step } from "../../finding";
import { globalInsufficient } from "../../trackingUnknowns";
import { longestWindow } from "../../windows";
import { PID_RATE } from "../../thresholds";
import { px4Family, px4FfPolicy, resolvePx4RateParams, type Px4Axis } from "./px4ParamNames";
import { collectPx4RateMetrics } from "./px4RateMetrics";
import { buildPx4RateAdvice } from "./px4RateAdvice";
import { insufficientSamplesFinding, missingTopicFinding, noExcitationFinding, unreliablePairFinding } from "./px4RateGaps";
import { PX4_FW_DOC, PX4_MC_DOC, PX4_RATE_RULE_ID, PX4_RATE_TITLE } from "./px4RateTitles";

export { PX4_MC_DOC, PX4_FW_DOC, PX4_RATE_RULE_ID, PX4_RATE_TITLE };

const AXES: readonly { axis: Px4Axis; label: string }[] = [
  { axis: "roll", label: "Roll" },
  { axis: "pitch", label: "Pitch" },
  { axis: "yaw", label: "Yaw" },
];

const GRADE_SCORE: Readonly<Record<string, number>> = { A: 4, B: 3, C: 2, D: 1 };

function axisFinding(ctx: RuleContext, axis: Px4Axis, label: string, window: TimeWindow): Finding {
  const family = px4Family(ctx.doc.meta.vehicleKind);
  const doc = family === "fw" ? PX4_FW_DOC : PX4_MC_DOC;
  const title = `${PX4_RATE_TITLE}（${label}）`;

  for (const [topic, why] of [
    ["vehicle_rates_setpoint", "速率环指令"],
    ["vehicle_angular_velocity", "实际角速率"],
  ] as const) {
    if (ctx.series(topic) === null) return missingTopicFinding(axis, label, topic, why, doc);
  }

  const params = resolvePx4RateParams(ctx, family, axis);
  const metrics = collectPx4RateMetrics(ctx, axis, window, {
    minSamples: PID_RATE.minSamples,
    maxLagSec: 0.3,
    highCommandFraction: 0.3,
    defaultDominantHz: 0.5,
    intLimit: params.intLimit,
  });
  if (!metrics) return insufficientSamplesFinding(axis, label, PID_RATE.minSamples, doc);

  // 数据可信度两道门槛（顺序重要）：先"有没有动"，再"两条 topic 对不对得上"
  if (metrics.cmdStd < 0.05) return noExcitationFinding(axis, label, metrics, doc);
  if (metrics.peakCorr < 0.5 || Math.abs(metrics.lagMs) > 60) {
    return unreliablePairFinding(axis, label, metrics, doc);
  }

  const suggestions = buildPx4RateAdvice({
    m: metrics,
    params,
    family,
    ffPolicy: px4FfPolicy(family),
    doc,
    label,
    lagPlausible: true,   // 上面已把不合逻辑的滞后挡在"无法评价"一侧
  });
  const note = [
    `实测：Err/Tar=${metrics.errRatio.toFixed(3)}（仅高指令样本）、滞后 ${metrics.lagSamples} 个采样（≈${Math.round(metrics.lagMs)} ms）、`
    + `指令主频 ${metrics.dominantHz.toFixed(2)} Hz、|积分均值|/限幅=${(metrics.integralBiasRatio * 100).toFixed(1)}%、`
    + `指令↔实际互相关峰值 ${metrics.peakCorr.toFixed(2)}`,
    "⚠️ 建议值是**由实测签名推导的起点值**；真正的增益需要阶跃响应或系统辨识，日志里没有。",
    ...metrics.assumptions,
    ...(params.unavailableReason ? [params.unavailableReason] : []),
  ].join("\n");

  const common = {
    ruleId: PX4_RATE_RULE_ID,
    title: `${PX4_RATE_TITLE}（${label} · ${metrics.grade} 级）`,
    axis,
    window,
    evidence: [
      step("数据口径", `指令 vehicle_rates_setpoint.${axis}、实际 vehicle_angular_velocity.xyz[${axis === "roll" ? 0 : axis === "pitch" ? 1 : 2}]（rad/s）；误差 = 指令 − 实际（PX4 不记 Err）；两条 topic 重采样到同一 100 Hz 网格后比较`),
      step("签名", `互相关峰值 ${metrics.peakCorr.toFixed(2)}；Err/Tar=${metrics.errRatio.toFixed(3)}；峰值滞后 ${metrics.lagSamples} 采样（≈${Math.round(metrics.lagMs)} ms）；指令主频 ${metrics.dominantHz.toFixed(2)} Hz；样本 ${metrics.samples}`),
      step("参数", params.prefix === null ? (params.unavailableReason ?? "参数未探测到") : `${params.prefix}_P=${params.p ?? "?"}、_I=${params.i ?? "?"}、_D=${params.d ?? "?"}、_FF=${params.ff ?? "?"}、积分限幅=${params.intLimit ?? "未记录"}`),
      step("判据来源", "分级按 Err/Tar（A<0.20、B<0.40、C<0.70、D≥0.70；**起点值**，真实 PX4 语料因时间对齐问题尚无法标定，已在回报中说明）"),
    ],
    metrics: {
      gradeScore: GRADE_SCORE[metrics.grade] ?? 0,
      errRatio: metrics.errRatio,
      peakCorr: metrics.peakCorr,
      cmdStd: metrics.cmdStd,
      lagSamples: metrics.lagSamples,
      lagMs: metrics.lagMs,
      integralBiasRatio: metrics.integralBiasRatio,
      samples: metrics.samples,
    },
    docLinks: [doc],
    charts: [],
    note,
    suggestions,
  };

  if (metrics.grade === "A" || metrics.grade === "B") {
    return makeFinding({
      ...common,
      severity: "ok",
      status: "passed",
      phenomenon: `${label} 轴跟踪紧（${metrics.grade} 级）：Err/Tar=${metrics.errRatio.toFixed(3)}，滞后 ${metrics.lagSamples} 采样`,
      impact: "速率环跟得上指令，不构成姿态控制风险；下面仍给出可继续优化的空间",
    });
  }
  if (metrics.grade === "C") {
    return makeFinding({
      ...common,
      severity: "warning",
      status: "fired",
      phenomenon: `${label} 轴**能跟但偏松**（C 级，仍有明显改进空间）：Err/Tar=${metrics.errRatio.toFixed(3)}，滞后 ${metrics.lagSamples} 采样（≈${Math.round(metrics.lagMs)} ms）`,
      impact: "跟踪偏差会表现为姿态抖动与位置精度下降，并随参数/机械状态恶化而放大",
    });
  }
  return makeFinding({
    ...common,
    severity: "critical",
    status: "fired",
    phenomenon: `${label} 轴跟踪不足（D 级）：Err/Tar=${metrics.errRatio.toFixed(3)}，实际角速率 RMS ${metrics.actRms.toFixed(3)} rad/s`,
    impact: "跟踪误差已达指令量级，姿态控制明显吃力，风扰或机动下可能失控",
  });
}

export const px4RateTrackingRule: Rule = {
  id: PX4_RATE_RULE_ID,
  title: PX4_RATE_TITLE,
  category: "pid",
  appliesTo: [
    {
      platform: "px4",
      requires: [],
      optional: ["vehicle_rates_setpoint", "vehicle_angular_velocity", "rate_ctrl_status", "vehicle_attitude"],
      note: "PX4 速率环：指令 vehicle_rates_setpoint、实际 vehicle_angular_velocity；参数名按机型族（MC_ROLLRATE_* / FW_RR_*）探测",
    },
  ],
  run(ctx) {
    const window = longestWindow(ctx.armedWindows());
    if (!window) {
      return [
        globalInsufficient(
          PX4_RATE_RULE_ID,
          PX4_RATE_TITLE,
          "没有可用的飞行（arm）时间段，无法评估 PX4 速率环跟踪",
          PX4_MC_DOC,
        ),
      ];
    }
    return AXES.map(({ axis, label }) => axisFinding(ctx, axis, label, window));
  },
};
