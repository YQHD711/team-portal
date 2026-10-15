/**
 * PX4 速率环「**无法评价**」的四种情形（从 px4RateLoop.ts 拆出：原文件超过 200 行）。
 *
 * 纪律（一次都不能破）：**判不出就判 unknown，且必须说明缺什么**——
 *  ① 缺 topic（指令/实际之一没记录）
 *  ② 样本/高指令样本不足（比值判据在小分母下会被放大）
 *  ③ 指令几乎没变化（没动的时候"误差小"不代表跟踪好）
 *  ④ 指令↔实际对不上（互相关峰值太低，或最佳对齐落在速率环不可能有的毫秒数上）
 * 四种情形都**不带任何增益数值**，只给方向 + 需要补的数据。
 */

import type { Finding } from "../../../types/report";
import type { Px4Axis } from "./px4ParamNames";
import { dataGapStep, improvementStep, unknownWithAdvice } from "../tuningSteps";
import {
  PX4_MIN_PEAK_CORR, PX4_MIN_RATE_CMD_STD_RAD_S, PX4_PLAUSIBLE_LAG_MS,
} from "./px4Excitation";
import type { Px4RateMetrics } from "./px4RateMetrics";
import { PX4_RATE_RULE_ID, PX4_RATE_TITLE } from "./px4RateTitles";

export function missingTopicFinding(
  axis: Px4Axis,
  label: string,
  topic: string,
  why: string,
  doc: string,
): Finding {
  return unknownWithAdvice({
    ruleId: PX4_RATE_RULE_ID,
    title: `${PX4_RATE_TITLE}（${label}）`,
    status: "missing_required",
    axis,
    reason: `日志里没有 ${topic}（${why}），无法评估 ${label} 轴速率环`,
    docLinks: [doc],
    suggestions: [
      dataGapStep({
        signature: `缺少 ${topic}`,
        missing: `${why}序列缺失`,
        howToFix: "按 PX4 默认日志配置（SDLOG_PROFILE）复飞重采后重试",
        doc,
      }),
    ],
  });
}

export function insufficientSamplesFinding(axis: Px4Axis, label: string, minSamples: number, doc: string): Finding {
  return unknownWithAdvice({
    ruleId: PX4_RATE_RULE_ID,
    title: `${PX4_RATE_TITLE}（${label}）`,
    status: "insufficient_data",
    axis,
    reason:
      `${label} 轴本次飞行的指令激励或样本不足（门槛：样本 ≥ ${minSamples}、且高指令样本 ≥ 30 条），`
      + "无法给出可信的 Err/Tar —— 这不代表通过",
    docLinks: [doc],
    suggestions: [
      dataGapStep({
        signature: `${label} 轴高指令样本不足`,
        missing: "本次飞行该轴几乎没有明显机动，或两条 topic 未同时记录",
        howToFix: "复飞时给出明显的滚转/俯仰/偏航机动后重采",
        doc,
      }),
    ],
  });
}

/** 指令几乎没变化（std 低于按真实日志标定的门槛）→ 无法评价，绝不给 passed */
export function noExcitationFinding(axis: Px4Axis, label: string, m: Px4RateMetrics, doc: string): Finding {
  return unknownWithAdvice({
    ruleId: PX4_RATE_RULE_ID,
    title: `${PX4_RATE_TITLE}（${label}）`,
    status: "insufficient_data",
    axis,
    reason:
      `${label} 轴本次飞行的速率指令几乎没有变化（指令 std=${m.cmdStd.toFixed(4)} rad/s、`
      + `RMS=${m.cmdRms.toFixed(4)} rad/s，门槛 std ≥ ${PX4_MIN_RATE_CMD_STD_RAD_S} rad/s）：`
      + "激励不足时 Err/Tar 会被小分母放大，因此不做判定 —— **这不代表通过**",
    docLinks: [doc],
    metrics: { cmdStd: m.cmdStd, cmdRms: m.cmdRms, samples: m.samples },
    suggestions: [
      dataGapStep({
        signature: `${label} 轴速率指令 std=${m.cmdStd.toFixed(4)} rad/s < 门槛 ${PX4_MIN_RATE_CMD_STD_RAD_S}`,
        missing: "本次飞行该轴几乎没有速率机动（悬停/平飞），无法评价速率环跟踪",
        howToFix:
          "复飞时给出明显的姿态机动（自稳模式快速打杆，或自动模式航线转弯/急停）后重采；"
          + "只有在有足够激励的飞行上，速率环结论才有意义",
        doc,
      }),
      improvementStep({
        order: 2,
        signature: "激励不足时**任何**增益建议都不可靠",
        current: `指令 std=${m.cmdStd.toFixed(4)} rad/s`,
        direction: "保持当前参数不动，先补齐机动数据；此时改参数等于盲调",
        missing: "缺足够激励的飞行段，无法判断增益是否合适",
        verify: "复飞后有足够机动，本轴从「无法评价」变成有依据的 A/B/C/D",
        doc,
      }),
    ],
  });
}

/** 指令与实际对不上（峰值相关太低 / 最佳对齐毫秒数不可能）→ 无法评价 */
export function unreliablePairFinding(axis: Px4Axis, label: string, m: Px4RateMetrics, doc: string): Finding {
  const byCorrelation = m.peakCorr < PX4_MIN_PEAK_CORR;
  const reason = byCorrelation
    ? `${label} 轴的速率指令与实际角速率互相关峰值只有 ${m.peakCorr.toFixed(2)}（下限 ${PX4_MIN_PEAK_CORR}）：`
      + "两条 topic 的对应关系不可信（可能是记录率/时间基准不同或该段未真正跟踪），因此不做分级判断 —— 这不代表通过"
    : `${label} 轴的指令↔实际互相关峰值出现在 **${Math.round(m.lagMs)} ms**（峰值相关 ${m.peakCorr.toFixed(2)}，`
      + `0 滞后时只有 ${m.corrAtZeroLag.toFixed(2)}），超出速率环合理范围 ±${PX4_PLAUSIBLE_LAG_MS} ms：`
      + "这更像两条 topic 的记录/时间基准错位，而不是真实相位滞后。已实测排除两种常见原因："
      + "① `vehicle_angular_velocity.timestamp` 与 `timestamp_sample` 平均只差 **0.1 ms**（不是时间基准混用）；"
      + "② 两条 topic 在整段飞行里都被连续记录（不是只记了不同阶段）。"
      + "此时 Err/Tar 也被错位放大，因此不做分级判断 —— **这不代表通过**，需要人工核对一段曲线或提供时间对齐可信的日志";
  return unknownWithAdvice({
    ruleId: PX4_RATE_RULE_ID,
    title: `${PX4_RATE_TITLE}（${label}）`,
    status: "insufficient_data",
    axis,
    reason,
    docLinks: [doc],
    metrics: { peakCorr: m.peakCorr, lagMs: m.lagMs, lagSamples: m.lagSamples, samples: m.samples },
    suggestions: [
      dataGapStep({
        signature: byCorrelation
          ? `${label} 轴互相关峰值 ${m.peakCorr.toFixed(2)} < ${PX4_MIN_PEAK_CORR}`
          : `${label} 轴最佳对齐在 ${Math.round(m.lagMs)} ms（超出 ±${PX4_PLAUSIBLE_LAG_MS} ms）`,
        missing: byCorrelation
          ? "vehicle_rates_setpoint 与 vehicle_angular_velocity 无法对上"
          : "可信的（指令，实际）时间对齐",
        howToFix:
          "确认日志记录率（SDLOG_PROFILE）与两条 topic 的时间基准；在明显机动段复飞后重采，"
          + "并人工核对一段曲线再判断速率环",
        doc,
      }),
      improvementStep({
        order: 2,
        signature: "数据不可信时不给任何增益建议（也不给 FF 数值）",
        current: `峰值相关 ${m.peakCorr.toFixed(2)}`,
        direction: "保持参数不变；先解决数据可读性/时间对齐，再评估速率环",
        missing: "缺可信的指令/实际配对数据",
        verify: "复飞后峰值相关 ≥ 0.5 且滞后落在几十毫秒内，本轴从「无法评价」变成有依据的分级",
        doc,
      }),
    ],
  });
}
