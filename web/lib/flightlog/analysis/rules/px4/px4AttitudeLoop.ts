/**
 * 规则：PX4 角度环跟踪质量（task-34 第 1 项）。
 *
 * 口径：指令 `vehicle_attitude_setpoint.{roll_body,pitch_body,yaw_body}`（**弧度**，转度）；
 * 实际由 `vehicle_attitude.q[0..3]` → 欧拉角（`quatToEulerDeg`，yaw ±180° 环绕）。
 *
 * 分级与 ArduPilot 角度环一致（绝对误差 RMS，按机型分档；PX4 MC 与 FW 基线不同），
 * 复用 `trackingFindings.channelFinding`（含 A/B/C/D 语义与 unknown 一侧纪律）与
 * `rules/tuningSteps.ts` 的六要素建议。
 */

import type { Finding } from "../../../types/report";
import type { Rule, RuleContext } from "../../../types/rule";
import type { TimeWindow } from "../../../types/log";
import { channelFinding } from "../../trackingFindings";
import { globalInsufficient, unavailable } from "../../trackingUnknowns";
import { longestWindow } from "../../windows";
import { stdDev } from "../../stats";
import { dataGapStep, tuningStep, unknownWithAdvice } from "../tuningSteps";
import { PX4_MIN_ANGLE_CMD_STD_DEG } from "./px4Excitation";
import { px4AnglePair, type Px4AngleAxis } from "./px4AnglePair";
import { px4AngleChart } from "./px4AttitudeChart";
import { px4Family, resolvePx4AngleGain } from "./px4ParamNames";
import { PX4_ATT_RULE_ID, PX4_ATT_TITLE, PX4_FW_DOC, PX4_MC_DOC } from "./px4RateTitles";

export { PX4_ATT_RULE_ID, PX4_ATT_TITLE };

/**
 * 角度误差阈值（度，**起点值**）：
 *  - MC（多旋翼）：实测语料 roll/pitch 姿态保持通常在个位数度；取 6/12 起步（后续按语料分位数复核）
 *  - FW（固定翼）：机身姿态跟随导航指令，基线天然更大；取 25/45（与 ArduPilot Plane 同量级起步）
 *  ⚠️ 这两个数字**不是**从真实 PX4 日志分位数标定来的（本机 27 份全是 MC），已在回报中标注。
 */
export const PX4_ANGLE_DEG = {
  mc: { roll: { warn: 6, crit: 12 }, pitch: { warn: 6, crit: 12 }, yaw: { warn: 12, crit: 25 } },
  fw: { roll: { warn: 25, crit: 45 }, pitch: { warn: 15, crit: 30 }, yaw: { warn: 15, crit: 30 } },
  unknown: { roll: { warn: 10, crit: 20 }, pitch: { warn: 10, crit: 20 }, yaw: { warn: 15, crit: 30 } },
} as const;

const AXES: readonly { axis: Px4AngleAxis; label: string; field: string }[] = [
  { axis: "roll", label: "Roll", field: "roll_body" },
  { axis: "pitch", label: "Pitch", field: "pitch_body" },
  { axis: "yaw", label: "Yaw", field: "yaw_body" },
];

function axisFinding(ctx: RuleContext, axis: Px4AngleAxis, label: string, window: TimeWindow): Finding {
  const family = px4Family(ctx.doc.meta.vehicleKind);
  const doc = family === "fw" ? PX4_FW_DOC : PX4_MC_DOC;
  const thresholds = PX4_ANGLE_DEG[family][axis];
  const pair = px4AnglePair(ctx, axis, window, 100);
  if (!pair) {
    return unavailable({
      ruleId: PX4_ATT_RULE_ID,
      ruleTitle: PX4_ATT_TITLE,
      subject: `${label} 角度环`,
      axis,
      missingIsRequired: ctx.series("vehicle_attitude") === null,
      doc,
      pair: {
        kind: ctx.series("vehicle_attitude") === null || ctx.series("vehicle_attitude_setpoint") === null ? "missing" : "tooFew",
        detail:
          `${label} 轴无法评估：需要 vehicle_attitude 的 q[0..3]（实际姿态，四元数）与 `
          + `vehicle_attitude_setpoint.${AXES.find((a) => a.axis === axis)?.field}（指令）；`
          + "本次至少一条缺失或样本不足 100 条",
      },
    });
  }

  // ⚠️ 激励纪律（Lead 纠偏）：**没动的时候"误差为 0"不代表跟踪好**。
  // 角度环是**绝对量判据**，所以与 ArduPilot 裁决 2 并存：
  //  低激励 **且误差也小** → insufficient_data（无法评价）；
  //  低激励 **但误差很大** → 照常 fired（真实存在的姿态误差不能藏）。
  const cmdSeries = ctx.windowed("vehicle_attitude_setpoint", AXES.find((a) => a.axis === axis)?.field ?? "roll_body", window);
  const cmdStd = cmdSeries ? stdDev(cmdSeries.values) * (180 / Math.PI) : 0;
  if (cmdStd < PX4_MIN_ANGLE_CMD_STD_DEG[axis] && pair.errorRms < thresholds.warn) {
    return unknownWithAdvice({
      ruleId: PX4_ATT_RULE_ID,
      title: `${PX4_ATT_TITLE}（${label} 角度环）`,
      status: "insufficient_data",
      axis,
      reason:
        `${label} 轴本次飞行的角度指令几乎没有变化（指令 std=${cmdStd.toFixed(2)}°，门槛 `
        + `≥ ${PX4_MIN_ANGLE_CMD_STD_DEG[axis]}°），误差 RMS ${pair.errorRms.toFixed(2)}° 也很小：`
        + "**没动的时候误差小不代表跟踪好**，因此不做判定 —— 这不代表通过",
      docLinks: [doc],
      metrics: { cmdStd, errRms: pair.errorRms, samples: pair.samples },
      suggestions: [
        dataGapStep({
          signature: `${label} 轴角度指令 std=${cmdStd.toFixed(2)}° < 门槛 ${PX4_MIN_ANGLE_CMD_STD_DEG[axis]}°`,
          missing: "本次飞行几乎没有姿态机动，无法评价角度环跟踪",
          howToFix: "复飞时给出明显的姿态指令变化（自稳模式快速打杆 / 自动模式转弯与爬升）后重采",
          doc,
        }),
        tuningStep({
          order: 2,
          signature: "激励不足时角度环增益建议不可靠",
          current: `${label} 角度指令 std=${cmdStd.toFixed(2)}°、误差 RMS ${pair.errorRms.toFixed(2)}°`,
          suggested: "维持当前参数；先补齐机动数据再评估（此时调参属于盲调）",
          basis: "角度环与速率环耦合，没有机动就看不到跟踪问题",
          verify: "复飞后有足够机动，本轴从「无法评价」变成有依据的分级",
          doc,
        }),
      ],
    });
  }

  const gain = resolvePx4AngleGain(ctx, family, axis);
  const suggestions = [
    tuningStep({
      order: 1,
      signature: `${label} 轴角度误差 RMS ${pair.errorRms.toFixed(2)}°（绝对量判据；激励不足且误差小时判"无法评价"，所以本结论已先过激励门槛）`,
      current: gain.name === null
        ? `未探测到该机型族的角度环增益参数（${family === "fw" ? "FW_*_TC" : "MC_*_P"}）`
        : `${gain.name}=${gain.value}`,
      suggested: gain.name === null
        ? "方向：先确认滤波与机械，再按 PX4 官方角度环指南调整；**不给数值**（参数名未探测到）"
        : gain.kind === "p"
          ? `${gain.name} → ${Math.round((gain.value as number) * 0.8 * 10000) / 10000}（−20% 起点值）`
          : `${gain.name} → ${Math.round((gain.value as number) * 0.8 * 10000) / 10000}（固定翼角度=时间常数，−20% 起步）`,
      basis: "角度环偏松/超调时优先小幅调整增益或时间常数；PX4 角度环与速率环耦合，改完必须复飞验证",
      verify: `${label} 角度误差 RMS 下降 ≥20%，且速率环结论不恶化`,
      doc,
      param: gain.name !== null && gain.value !== null
        ? { name: gain.name, from: gain.value, to: Math.round(gain.value * 0.8 * 10000) / 10000, reason: "角度环增益/时间常数保守调整" }
        : null,
    }),
    tuningStep({
      order: 2,
      signature: "角度环误差也受速率环与滤波影响",
      current: `本次 ${label} 角度误差 RMS ${pair.errorRms.toFixed(2)}°`,
      suggested: "先看同一份报告里的「PX4 速率环跟踪质量」与滤波结论：内环没弄好时调角度环是无效的",
      basis: "角度环输出的是速率指令，内环跟踪差会把误差传递到角度环",
      verify: "速率环结论改善后角度误差同步下降",
      doc,
    }),
  ];

  return channelFinding({
    ruleId: PX4_ATT_RULE_ID,
    ruleTitle: PX4_ATT_TITLE,
    subject: `${label} 角度环`,
    axis,
    pair,
    mode: "absolute",
    errorUnit: "°",
    excitationUnit: "°",
    warning: thresholds.warn,
    critical: thresholds.crit,
    /**
     * ⚠️ 文案必须与**行为**一致（task-34 修）：PX4 角度环不是"完全不看激励"，
     * 而是「低激励 **且误差小** → 无法评价；低激励但**误差大** → 照常 fired；有激励 → A/B/C/D」。
     * 之前这里复用了 ArduPilot 的"不设激励门槛"默认文案，跟实现说的不是一件事。
     */
    excitationPolicyNote:
      `目标 RMS ${pair.excitement.toFixed(3)}°（本次指令变化 std 见结论 note）；`
      + "本通道口径：**低激励且误差小 → 无法评价（没动≠跟得好）；低激励但误差大 → 照常报警；"
      + "有足够激励 → 按绝对误差 RMS 分 A/B/C/D**",
    chart: px4AngleChart(PX4_ATT_RULE_ID, axis, label, window),
    docLinks: [doc],
    suggestions,
  });
}

export const px4AttitudeTrackingRule: Rule = {
  id: PX4_ATT_RULE_ID,
  title: PX4_ATT_TITLE,
  category: "attitude",
  appliesTo: [
    {
      platform: "px4",
      requires: [],
      optional: ["vehicle_attitude", "vehicle_attitude_setpoint"],
      note: "PX4 姿态是四元数（vehicle_attitude.q）；指令在 vehicle_attitude_setpoint（弧度）。按轴判断适用性",
    },
  ],
  run(ctx) {
    const window = longestWindow(ctx.armedWindows());
    if (!window) {
      return [
        globalInsufficient(
          PX4_ATT_RULE_ID,
          PX4_ATT_TITLE,
          "没有可用的飞行（arm）时间段，无法评估 PX4 角度环跟踪",
          PX4_MC_DOC,
        ),
      ];
    }
    return AXES.map(({ axis, label }) => axisFinding(ctx, axis, label, window));
  },
};
