/**
 * 规则：角度环（外环）跟踪质量 —— 分轴 roll / pitch / yaw。
 *
 * 判据：**绝对**误差 RMS = RMS(Des* − 实际*)（单位统一为度，跨机型可比），分档用
 * `ATTITUDE.warnDeg / critDeg`（按机型 + 轴取表）。
 *
 * ⚠️ **本规则刻意没有激励门槛**（Lead 裁决 2，2026-10）：激励门槛是**比值判据**的补丁，
 *   而绝对角度误差不管指令多小都是"没跟上"——实测有 5 份 Copter 日志 roll 绝对误差
 *   14.95–30.04°，却因"指令激励 < 2°"被挡在 unknown 一侧，那正是最该被看见的日志。
 *   因此这里只保留 `minSamples`（样本不足才落 insufficient_data）。
 *
 * ⚠️ 适用性**按轴**判断，`appliesTo.requires` 故意留空：
 *   缺 `ATT` 或缺某一对列只影响**该轴**，绝不能把整条规则打成 missing_required
 *   （上一轮 PID 规则把 PIDY 写进 requires，固定翼日志整条规则作废 —— 线上真实事故）。
 *
 * ⚠️ 航向环绕：`ATT.DesYaw/Yaw` 单位是 `degheading`（0–360），DesYaw=359 / Yaw=1 的误差是
 *   −2° 而不是 358°；且航向的激励量用**指令标准差**而非 RMS（绝对航向的 RMS 无意义）。
 */

import type { Rule, RuleContext } from "../../types/rule";
import type { Finding } from "../../types/report";
import { longestWindow } from "../windows";
import { suggestion } from "../finding";
import { extractPair, timeAxis } from "../trackingEvidence";
import { absoluteThresholds, highlightFor, trackingChart } from "../trackingCharts";
import { channelFinding } from "../trackingFindings";
import { globalInsufficient, notApplicable, unavailable } from "../trackingUnknowns";
import { ATTITUDE, thresholdsFor } from "../thresholds";

const RULE_ID = "attitude_tracking";
const TITLE = "角度环跟踪质量";
const DOC_COPTER = "https://ardupilot.org/copter/docs/tuning-process-instructions.html";
const DOC_PLANE = "https://ardupilot.org/plane/docs/roll-pitch-controller-tuning.html";

/** 没有"航向角指令"的机型：ATT.DesYaw 恒 0 是结构性的（见 axisFinding 里的裁决说明） */
const NO_YAW_COMMAND_KINDS: readonly string[] = ["plane", "px4-fixedwing", "rover", "tracker"];
/** "指令恒为 0"的判定阈值（度）：只是零判定，不是标定档位（角度环已无激励门槛） */
const YAW_COMMAND_EPSILON_DEG = 1e-6;

interface AxisSpec {
  axis: "roll" | "pitch" | "yaw";
  label: string;
  des: string;
  act: string;
  /** Copter 口径的角度环 P（`ATC_ANG_*_P`） */
  param: string;
  /** 固定翼口径：实测无 `ATC_ANG_*`，角度环是**时间常数**；空串 = 该机型没有对应参数 */
  planeParam: string;
  wrap: boolean;
}

/** ATT 的 Des 与实际 列名；`degheading` 的 yaw 走环绕 */
const AXES: readonly AxisSpec[] = [
  { axis: "roll", label: "Roll", des: "DesRoll", act: "Roll", param: "ATC_ANG_RLL_P", planeParam: "RLL2SRV_TCONST", wrap: false },
  { axis: "pitch", label: "Pitch", des: "DesPitch", act: "Pitch", param: "ATC_ANG_PIT_P", planeParam: "PTCH2SRV_TCONST", wrap: false },
  { axis: "yaw", label: "Yaw", des: "DesYaw", act: "Yaw", param: "ATC_ANG_YAW_P", planeParam: "", wrap: true },
];
// 角度环增益的机型口径（task-36）：Copter/Rover=ATC_ANG_*_P；固定翼无该参数组（实测 4.6.1），
// 角度环是时间常数 RLL2SRV_TCONST/PTCH2SRV_TCONST —— 语义不同；探不到只给方向（绝不给 to=0）。
function angleGainHint(ctx: RuleContext, kind: string, spec: AxisSpec): {
  name: string; value: number | null; plane: boolean;
} {
  const plane = kind === "plane" || kind === "px4-fixedwing";
  const name = plane ? spec.planeParam : spec.param;
  if (name.length === 0) return { name: "", value: null, plane };
  return { name, value: ctx.param(name), plane };
}

function axisFinding(ctx: RuleContext, spec: AxisSpec): Finding {
  const subject = `${spec.label} 角度环`;
  const window = longestWindow(ctx.armedWindows());
  if (!window) return globalInsufficient(RULE_ID, TITLE, "没有可用的飞行（arm）时间段，无法评估角度环跟踪");

  // 阈值必须按机型 + 轴取（同一档管所有机型是假红根源，见 thresholds.ts 的实测注释）
  const kind = ctx.doc.meta.vehicleKind;
  const warn = thresholdsFor(ATTITUDE.warnDeg, kind)[spec.axis];
  const crit = thresholdsFor(ATTITUDE.critDeg, kind)[spec.axis];

  const pair = extractPair(ctx, "ATT", spec.des, spec.act, window, ATTITUDE.minSamples, {
    wrap: spec.wrap,
    missingDetail: `ATT 没有 ${spec.des}/${spec.act} 列，${subject}无法评估`,
  });
  if ("kind" in pair) {
    // ATT 整个消息都没有时才算"缺必需数据"，单缺列也只是该轴无法评估
    return unavailable({
      ruleId: RULE_ID, ruleTitle: TITLE, subject, pair, missingIsRequired: true, axis: spec.axis,
    });
  }

  // 航向轴的结构性不适用：固定翼/车辆没有"航向角指令"（航向靠滚转协调转弯实现），
  // ATT.DesYaw 恒 0 是**机型结构**，不是这次没采到 → not_applicable。
  // 判定用"指令标准差恒 0"（YAW_COMMAND_EPSILON_DEG 只是零判定阈值，不是标定档位）：
  // 角度环整体已**不设激励门槛**（Lead 裁决 2），所以多旋翼的 DesYaw 恒 0 会照常按绝对误差判。
  if (spec.axis === "yaw" && NO_YAW_COMMAND_KINDS.includes(kind)
    && pair.excitement <= YAW_COMMAND_EPSILON_DEG) {
    return notApplicable({
      ruleId: RULE_ID,
      ruleTitle: TITLE,
      subject,
      axis: spec.axis,
      note: `${kind === "rover" ? "地面车" : "固定翼"}没有航向角指令（航向由滚转协调转弯实现），`
        + `ATT.DesYaw 恒为 0（实测标准差 ${pair.excitement.toFixed(3)}°）属于机型结构，不是缺数据，该轴不适用本检查`,
    });
  }

  const time = timeAxis(ctx, "ATT", window, pair.samples);
  const gainHint = angleGainHint(ctx, kind, spec);
  const chart = trackingChart({
    id: `${RULE_ID}-${spec.axis}`,
    title: `${spec.label} 角度环：指令 / 实际 / 误差`,
    message: "ATT",
    targetField: spec.des,
    actualField: spec.act,
    targetLabel: `指令 ${spec.des} (°)`,
    actualLabel: `实际 ${spec.act} (°)`,
    window,
    thresholds: absoluteThresholds(warn, crit, "°"),
    highlight: highlightFor(time, pair.error, warn),
  });

  return channelFinding({
    ruleId: RULE_ID,
    ruleTitle: TITLE,
    subject,
    axis: spec.axis,
    pair,
    mode: "absolute",
    errorUnit: "°",
    excitationUnit: "°",
    warning: warn,
    critical: crit,
    // 不传 minExcitation：绝对量判据不设激励门槛（见文件头说明）
    chart,
    docLinks: [DOC_COPTER, DOC_PLANE],
    suggestions: [
      suggestion(1, "先按振动与滤波规则确认机械与滤波是否正常（前一步未验证不做后一步）"),
      suggestion(2, `检查 ${spec.label} 轴配平/重心与舵面、电机一致性：持续单向偏差通常是机械问题，不是参数问题`),
      gainHint.value !== null && gainHint.name.length > 0
        ? suggestion(
            3,
            gainHint.plane
              ? `若机械正常，再调 ${gainHint.name}（固定翼角度环是**时间常数**，不是 P）：保守从 −20% 起步（时间常数越大响应越慢），复飞看误差 RMS 与超调`
              : `若机械正常，再调 ${gainHint.name}（角度环 P）：保守从 −20% 起步，复飞后看误差 RMS 是否下降`,
            {
              param: {
                name: gainHint.name,
                from: gainHint.value,
                to: Math.round(gainHint.value * 0.8 * 10000) / 10000,
                reason: gainHint.plane
                  ? "固定翼实测无 ATC_ANG_* 参数组，角度环由 RLL2SRV_TCONST/PTCH2SRV_TCONST 决定；先小幅收紧再评估"
                  : "角度环增益过大表现为超调与振荡；先降 P 再评估 D/FF",
              },
              verify: `${spec.label} 角度误差 RMS 下降 ≥30%`,
            },
          )
        : suggestion(
            3,
            `若机械正常，再调角度环增益：**本次不给数值** —— 日志里没有探测到 `
            + `${spec.param}${spec.planeParam ? ` / ${spec.planeParam}` : ""}（机型 ${kind} 的参数组名不同或未记录），`
            + "只给方向：先从时间常数/增益的响应速度入手，并复核滤波与机械",
            { param: null, verify: `${spec.label} 角度误差 RMS 下降 ≥30%，且不出现新的振荡` },
          ),
    ],
  });
}

export const attitudeTrackingRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "attitude",
  appliesTo: [
    {
      platform: "ardupilot",
      minVersion: 30400,
      // 故意留空：缺 ATT / 缺某一对列只影响该轴，绝不能把整条规则打成 missing_required
      requires: [],
      optional: ["ATT"],
      paramMap: { angleRollP: "ATC_ANG_RLL_P", anglePitchP: "ATC_ANG_PIT_P", angleYawP: "ATC_ANG_YAW_P" },
      note: "ATT 的 Des 与实际 对自 3.4 起稳定；航向列是 degheading（0–360，已做 ±180 环绕）；按轴判断适用性",
    },
  ],
  run(ctx: RuleContext) {
    if (!ctx.series("ATT")) {
      return AXES.map((spec) =>
        unavailable({
          ruleId: RULE_ID,
          ruleTitle: TITLE,
          subject: `${spec.label} 角度环`,
          pair: {
            kind: "missing",
            detail: `日志中没有 ATT 消息，${spec.label} 角度环无法评估（ATT 在 ArduPilot 各机型默认记录）`,
          },
          missingIsRequired: true,
          axis: spec.axis,
        }),
      );
    }
    return AXES.map((spec) => axisFinding(ctx, spec));
  },
};
