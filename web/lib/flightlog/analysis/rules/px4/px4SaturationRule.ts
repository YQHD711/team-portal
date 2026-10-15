/**
 * 规则：PX4 执行器/控制量**饱和**（task-34 第 2 项）。
 *
 * 用户最关心的问题：「PID 调不好」到底是**增益不够**，还是**控制量已经饱和/被削顶**？
 * 饱和时提高增益是**错的方向**（越加越饱和），本规则必须先把这一点指出来。
 *
 * 判据（阈值是起点值，见 `SATURATION_RATIO_WARN` = 5%：正常飞行几乎不贴边）：
 *  - 任一控制量通道 |value| ≥ 0.95 的样本占比 ≥ 5% → 饱和
 *  - 力矩指令 `vehicle_torque_setpoint.xyz` 贴边、推力指令 `thrust_body[2]` 贴边 → 饱和
 *  - 单边顶住（同号占比 > 90% 且 |均值| > 0.2）→ 重心/配平问题（**不是** PID 问题）
 * 交叉引用速率环误差时**必须沿用数据可信度门槛**（峰值相关 ≥ 0.5 且滞后合理），
 * 否则只说饱和事实，不回答"是不是增益不够"。
 */

import type { Finding } from "../../../types/report";
import type { Rule, RuleContext } from "../../../types/rule";
import { makeFinding, step } from "../../finding";
import { improvementStep, tuningStep } from "../tuningSteps";
import { globalInsufficient } from "../../trackingUnknowns";
import { longestWindow } from "../../windows";
import { px4Family, resolvePx4RateParams, type Px4Axis } from "./px4ParamNames";
import { biasedChannels, collectControlEvidence, SATURATION_RATIO_WARN, type ControlEvidence } from "./px4ControlSignals";
import { collectPx4RateMetrics } from "./px4RateMetrics";
import { PX4_MC_DOC } from "./px4RateTitles";
import { PX4_MIN_PEAK_CORR, PX4_PLAUSIBLE_LAG_MS } from "./px4Excitation";
import { PID_RATE } from "../../thresholds";

import { PX4_SAT_RULE_ID, PX4_SAT_TITLE, missingControlsFinding, notSaturatedFinding } from "./px4SaturationPass";
export { PX4_SAT_RULE_ID, PX4_SAT_TITLE };

const AXES: readonly { axis: Px4Axis; label: string }[] = [
  { axis: "roll", label: "Roll" },
  { axis: "pitch", label: "Pitch" },
  { axis: "yaw", label: "Yaw" },
];

/** 交叉引用速率环误差：只取可信的轴（沿用同一套可信度门槛） */
function trustworthyRateErrors(ctx: RuleContext, window: { startSec: number; endSec: number }): string[] {
  const out: string[] = [];
  for (const { axis, label } of AXES) {
    const params = resolvePx4RateParams(ctx, px4Family(ctx.doc.meta.vehicleKind), axis);
    const m = collectPx4RateMetrics(ctx, axis, window, {
      minSamples: PID_RATE.minSamples,
      maxLagSec: 0.3,
      highCommandFraction: 0.3,
      defaultDominantHz: 0.5,
      intLimit: params.intLimit,
    });
    if (!m) continue;
    if (m.cmdStd < 0.05 || m.peakCorr < PX4_MIN_PEAK_CORR || Math.abs(m.lagMs) > PX4_PLAUSIBLE_LAG_MS) continue;
    out.push(`${label} 轴 Err/Tar=${m.errRatio.toFixed(2)}（${m.grade} 级，相关峰值 ${m.peakCorr.toFixed(2)}）`);
  }
  return out;
}

function saturationFinding(ev: ControlEvidence, rateErrors: string[]): Finding {
  const worst = ev.worst!;
  const ratio = Math.max(worst.saturationRatio, ev.torqueSaturationRatio, ev.thrustSaturationRatio);
  const severity = ratio >= 0.2 ? "critical" : "warning";
  const biased = biasedChannels(ev);
  const phenomenonParts = [
    `控制量贴边：${ev.topic}.${worst.field} 有 ${(worst.saturationRatio * 100).toFixed(1)}% 的样本 |value| ≥ 0.95`,
  ];
  if (ev.torqueAvailable && ev.torqueSaturationRatio > 0) {
    phenomenonParts.push(`力矩指令贴边 ${(ev.torqueSaturationRatio * 100).toFixed(1)}%`);
  }
  if (ev.thrustAvailable && ev.thrustSaturationRatio > 0) {
    phenomenonParts.push(`推力指令贴边 ${(ev.thrustSaturationRatio * 100).toFixed(1)}%`);
  }
  const phenomenon = `${phenomenonParts.join("；")}（门槛 ${(SATURATION_RATIO_WARN * 100).toFixed(0)}%）`;

  const suggestions = [
    tuningStep({
      order: 1,
      signature: `控制量饱和：${worst.field} 贴边 ${(worst.saturationRatio * 100).toFixed(1)}%${ev.torqueSaturationRatio > 0 ? `、力矩指令 ${(ev.torqueSaturationRatio * 100).toFixed(1)}%` : ""}`,
      current: `控制量 max|value|=${worst.maxAbs.toFixed(2)}，均值 ${worst.mean.toFixed(3)}`,
      suggested:
        "**先降指令/查余量，不要加增益**：① 降低最大角速度/加速度限制（`MC_ROLLRATE_MAX`/`MC_PITCHRATE_MAX`/`MC_YAWRATE_MAX` 与位置环速度限制）；"
        + "② 检查推力余量（超重/桨状态/电池电压）；③ 若单边顶住，先查重心与配平",
      basis: "饱和时控制器已经没有可用行程，继续加 P/D 只会让控制量更早贴边（越调越差）——先恢复行程再谈增益",
      verify: "复飞后贴边占比降到 5% 以下，且机动不再出现姿态跟不上",
      doc: PX4_MC_DOC,
    }),
    tuningStep({
      order: 2,
      signature: `推力指令${ev.thrustAvailable ? ` 贴边 ${(ev.thrustSaturationRatio * 100).toFixed(1)}%` : "未记录"}`,
      current: ev.thrustAvailable ? "vehicle_rates_setpoint.thrust_body[2]" : "缺少推力指令序列",
      suggested: "若推力贴边：优先减重/换桨/检查电池电压与电机状态；必要时限制最大爬升率与倾斜角",
      basis: "推力饱和是**能量/余量**问题，参数层面只能限制需求，不能创造推力",
      verify: "复飞后推力指令不再长时间贴边，且掉高现象消失",
      doc: PX4_MC_DOC,
    }),
  ];

  if (biased.length > 0) {
    suggestions.push(
      tuningStep({
        order: 3,
        signature: `单边顶住：${biased.map((c) => `${c.field}（同号 ${(c.signPersistence * 100).toFixed(0)}%、均值 ${c.mean.toFixed(2)}）`).join("、")}`,
        current: biased.map((c) => c.field).join("、"),
        suggested: "**先查重心/配平/机架对称性**（不要先动 PID）：配重、机臂水平、桨一致性",
        basis: "长期单边控制量是机械不对称的结果，用 PID 顶住会掩盖问题并吃掉行程",
        verify: "复飞后该通道均值明显回落，贴边占比下降",
        doc: PX4_MC_DOC,
      }),
    );
  }

  if (rateErrors.length > 0) {
    suggestions.push(
      improvementStep({
        order: 4,
        signature: `速率环误差（可信轴）：${rateErrors.join("；")}`,
        current: "控制量已饱和",
        direction: "**结论：先解决饱和，再谈增益** —— 当前误差里有多少来自饱和无法分离，但饱和未解决时任何加增益的方向都是错的",
        missing: "要区分'饱和导致的误差'与'增益不足导致的误差'需要一次降低指令后的对照飞行",
        verify: "降指令复飞后：贴边消失但误差仍在 → 才轮到增益/滤波",
        doc: PX4_MC_DOC,
      }),
    );
  } else {
    suggestions.push(
      improvementStep({
        order: 4,
        signature: "速率环误差不可信（相关峰值过低或滞后不合理），无法回答'是否增益不够'",
        current: "控制量饱和是**可直接判定**的事实",
        direction: "先按上面解决饱和；速率环的增益问题等时间对齐可信的日志再判",
        missing: "可信的（指令，实际）速率配对",
        verify: "对齐可信后重新判断误差来源",
        doc: PX4_MC_DOC,
      }),
    );
  }

  return makeFinding({
    ruleId: PX4_SAT_RULE_ID,
    title: PX4_SAT_TITLE,
    severity,
    status: "fired",
    window: ev.channels.length > 0 ? null : null,
    phenomenon,
    impact: "控制量达到行程上限时控制器无法继续纠偏：表现为机动跟不上、掉高、姿态抖动，继续加增益会更快贴边",
    evidence: [
      step("数据来源", `${ev.topic}（${ev.samples} 个样本/通道）+ ${ev.torqueAvailable ? "vehicle_torque_setpoint" : "无力矩指令"}${ev.thrustAvailable ? " + thrust_body[2]" : ""}`),
      step("最差通道", `${worst.field}：贴边 ${(worst.saturationRatio * 100).toFixed(1)}%、max|value|=${worst.maxAbs.toFixed(2)}、均值 ${worst.mean.toFixed(3)}、同号占比 ${(worst.signPersistence * 100).toFixed(0)}%`),
      step("各通道贴边占比", ev.channels.map((c) => `${c.field}=${(c.saturationRatio * 100).toFixed(1)}%`).join("，")
        + (ev.pinned.length > 0
          ? `；恒定贴边的未使用槽位（不计入饱和）：${ev.pinned.map((c) => `${c.field}=${c.mean.toFixed(2)}`).join("、")}`
          : "")),
      step("口径", `贴边 = |value| ≥ 0.95；门槛 ${(SATURATION_RATIO_WARN * 100).toFixed(0)}%（起点值）；单边 = 同号 > 90% 且 |均值| > 0.2`),
    ],
    metrics: {
      worstSaturationRatio: worst.saturationRatio,
      torqueSaturationRatio: ev.torqueSaturationRatio,
      thrustSaturationRatio: ev.thrustSaturationRatio,
      samples: ev.samples,
    },
    docLinks: [PX4_MC_DOC],
    suggestions,
    note:
      "饱和是**可直接判定**的事实（控制量有没有贴边不需要系统辨识）；"
      + "但'误差里多少来自饱和'需要对照飞行，日志本身分不开——所以先解决饱和再谈增益。",
  });
}

export const px4SaturationRule: Rule = {
  id: PX4_SAT_RULE_ID,
  title: PX4_SAT_TITLE,
  category: "pid",
  appliesTo: [
    {
      platform: "px4",
      requires: [],
      optional: ["actuator_controls_0", "actuator_motors", "actuator_outputs", "vehicle_torque_setpoint", "vehicle_rates_setpoint"],
      note: "PX4 控制量饱和：按 actuator_controls_0 → actuator_motors → actuator_outputs 顺序探测",
    },
  ],
  run(ctx) {
    const window = longestWindow(ctx.armedWindows());
    if (!window) {
      return [
        globalInsufficient(PX4_SAT_RULE_ID, PX4_SAT_TITLE, "没有可用的飞行（arm）时间段，无法评估控制量饱和", PX4_MC_DOC),
      ];
    }
    const ev = collectControlEvidence(ctx, window);
    if (ev.unavailableReason !== null) return [missingControlsFinding(ev.unavailableReason)];

    const worstRatio = Math.max(ev.worst?.saturationRatio ?? 0, ev.torqueSaturationRatio, ev.thrustSaturationRatio);
    if (worstRatio < SATURATION_RATIO_WARN && biasedChannels(ev).length === 0) {
      return [notSaturatedFinding(ev, trustworthyRateErrors(ctx, window), window)];
    }    return [saturationFinding(ev, trustworthyRateErrors(ctx, window))];
  },
};
