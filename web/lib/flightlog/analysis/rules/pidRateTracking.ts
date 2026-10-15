/**
 * 规则 2：速率环跟踪质量（分轴）
 *
 * ⚠️ 与方案 v2 的差异（实测否决，依据见 docs/日志诊断-接口契约.md §1.5）：
 *   方案要求"对 TARG 与实际值做差 → FFT 找主峰，峰频 <10 Hz 且功率超阈值即判振荡"。
 *   实测否决两处：
 *     ① **Nyquist 不够**：ArduPilot 的 PID 消息默认只有 10 Hz（实测 6 份日志均为 10 Hz，
 *        固定翼 25 Hz）→ 只能观测 <5 Hz。方案举例的 6.2 Hz 主峰在 PID 日志里**测不到**。
 *     ② **阈值不可分**：0.8–4 Hz 频带能量占比在健康与故障日志间完全重叠（0.027–0.572），
 *        任何固定频谱阈值都会误报。
 *   因此本规则不做频谱定阈判定，改用可判定的时域跟踪质量（Err/Tar），
 *   并如实声明频率域的能力边界与补齐方法。
 *
 * 另一个实测教训：悬停飞行时指令角速度极小（quad 实测 roll Tar RMS 仅 3.2 deg/s），
 * 此时 Err/Tar 天然 > 1。若不设激励门槛，会对**健康日志误报**——这是必须避免的失败模式。
 * （注：这个门槛是**比值判据**的补丁；绝对量判据不该有它，见契约 §0.5.7 原则一。）
 */

import type { Rule, RuleContext } from "../../types/rule";
import { unknownFinding } from "../finding";
import { longestWindow } from "../windows";
import {
  computeRateAxisEvidence,
  spectrumCapabilityNote,
  type RateAxisSpec,
} from "../rateAxisEvidence";
import { buildAxisFinding, PID_RULE_ID, PID_RULE_TITLE } from "./pidAxisFinding";

const PARAM_MAP = {
  rollRateP: "ATC_RAT_RLL_P",
  pitchRateP: "ATC_RAT_PIT_P",
  yawRateP: "ATC_RAT_YAW_P",
} as const;

const AXES: readonly RateAxisSpec[] = [
  { axis: "roll", message: "PIDR", label: "Roll", paramName: PARAM_MAP.rollRateP },
  { axis: "pitch", message: "PIDP", label: "Pitch", paramName: PARAM_MAP.pitchRateP },
  { axis: "yaw", message: "PIDY", label: "Yaw", paramName: PARAM_MAP.yawRateP },
];

/** 固定翼/车辆默认没有 yaw **速率**控制器：YAW2SRV_* 是协调转弯阻尼，不是速率环。 */
const NO_YAW_RATE_VEHICLES: readonly string[] = ["plane", "rover"];

export function hasYawRateController(ctx: RuleContext): boolean {
  if (ctx.series("PIDY") !== null) return true;
  return !NO_YAW_RATE_VEHICLES.includes(ctx.doc.meta.vehicleKind);
}

export const pidRateTrackingRule: Rule = {
  id: PID_RULE_ID,
  title: PID_RULE_TITLE,
  category: "pid",
  appliesTo: [
    {
      platform: "ardupilot",
      minVersion: 30400,
      // ⚠️ 曾经写成 ["PIDR","PIDP","PIDY"]，结果**固定翼日志把整条规则打成"缺少必需消息"**，
      // 连 roll/pitch 的分析一起废掉（线上真实反馈）。yaw 是否适用必须**按轴判断**，
      // 不能当整条规则的门槛。
      requires: ["PIDR", "PIDP"],
      optional: ["PIDY"],
      paramMap: PARAM_MAP,
      note: "PIDx 逐项日志（含 Tar/Act/Err）自 3.4 起稳定；4.1+ 的 P 参数名为 ATC_RAT_*_P；固定翼默认没有 yaw 速率环",
    },
  ],
  run(ctx: RuleContext) {
    const window = longestWindow(ctx.armedWindows());
    if (!window) {
      return [
        unknownFinding({
          ruleId: PID_RULE_ID,
          title: PID_RULE_TITLE,
          status: "insufficient_data",
          note: "没有可用的飞行（arm）时间段，无法评估速率环跟踪质量",
        }),
      ];
    }
    const capNote = spectrumCapabilityNote(ctx);
    const yawApplicable = hasYawRateController(ctx);
    return AXES.map((spec) => {
      const ev = computeRateAxisEvidence(ctx, spec, window);
      if ("kind" in ev) {
        // 缺 yaw 速率环 ≠ 数据缺失：固定翼就是没有这个环，如实说"不适用"而不是"缺数据"
        if (spec.axis === "yaw" && !yawApplicable) {
          return unknownFinding({
            ruleId: PID_RULE_ID,
            title: `${PID_RULE_TITLE}（${spec.label}）`,
            status: "not_applicable",
            axis: spec.axis,
            note:
              `${ctx.doc.meta.vehicleKind === "rover" ? "Rover" : "固定翼"}默认没有 yaw 速率控制器` +
              "（没有 PIDY 日志；YAW2SRV_* 是协调转弯阻尼，不是速率环），该轴不适用本检查",
          });
        }
        return unknownFinding({
          ruleId: PID_RULE_ID,
          title: `${PID_RULE_TITLE}（${spec.label}）`,
          status: ev.kind === "missing" ? "missing_required" : "insufficient_data",
          axis: spec.axis,
          note: ev.detail,
        });
      }
      return buildAxisFinding(ev, capNote, ctx.param(spec.paramName));
    });
  },
};
