/**
 * PX4 饱和规则的「未饱和/缺数据」两条路径（从 px4SaturationRule.ts 拆出：原文件超过 200 行）。
 *
 * 纪律：**未饱和也要给建议**（"排除饱和"本身就是有用结论），
 * 缺 actuator 数据则判 unknown 并说明怎么才能采集到。
 */

import type { Finding } from "../../../types/report";
import { makeFinding, step } from "../../finding";
import { improvementStep, unknownWithAdvice } from "../tuningSteps";
import { PX4_MC_DOC } from "./px4RateTitles";
import { SATURATION_RATIO_WARN, type ControlEvidence } from "./px4ControlSignals";

export const PX4_SAT_RULE_ID = "px4_actuator_saturation";
export const PX4_SAT_TITLE = "PX4 执行器 / 控制量饱和";

export function missingControlsFinding(reason: string): Finding {
  return unknownWithAdvice({
    ruleId: PX4_SAT_RULE_ID,
    title: PX4_SAT_TITLE,
    status: "missing_required",
    reason,
    docLinks: [PX4_MC_DOC],
    suggestions: [
      improvementStep({
        signature: "缺少执行器/控制量序列",
        current: reason,
        direction: "按 PX4 默认 SDLOG_PROFILE 复飞重采（需记录 actuator 组）",
        missing: "没有控制量就无法判断是否饱和",
        verify: "重采后本条从「无法判断」变为有依据的饱和/未饱和结论",
        doc: PX4_MC_DOC,
      }),
    ],
  });
}

export function notSaturatedFinding(ev: ControlEvidence, rateErrors: string[], window: { startSec: number; endSec: number }): Finding {
  const worstRatio = ev.worst?.saturationRatio ?? 0;
  return makeFinding({
    ruleId: PX4_SAT_RULE_ID,
    title: PX4_SAT_TITLE,
    severity: "ok",
    status: "passed",
    window,
    phenomenon: `控制量未饱和：最差通道 ${ev.worst?.field} 贴边 ${(worstRatio * 100).toFixed(1)}%（门槛 ${(SATURATION_RATIO_WARN * 100).toFixed(0)}%），力矩/推力指令无明显贴边`,
    impact: "控制器仍有可用行程；若姿态跟踪仍差，**方向是增益/滤波/机械**而不是饱和",
    evidence: [
      step("数据来源", `${ev.topic}，样本 ${ev.samples}`),
      step("最差通道", `${ev.worst?.field}：贴边 ${(worstRatio * 100).toFixed(1)}%、max|value|=${ev.worst?.maxAbs.toFixed(2)}`
        + (ev.pinned.length > 0 ? `；已排除恒定贴边的未使用槽位 ${ev.pinned.map((c) => c.field).join("、")}` : "")),
      step("速率环误差（可信轴）", rateErrors.length > 0 ? rateErrors.join("；") : "本次没有可信的速率环误差（数据对齐存疑）"),
    ],
    metrics: {
      worstSaturationRatio: worstRatio,
      torqueSaturationRatio: ev.torqueSaturationRatio,
      thrustSaturationRatio: ev.thrustSaturationRatio,
      samples: ev.samples,
    },
    docLinks: [PX4_MC_DOC],
    suggestions: [
      improvementStep({
        signature: `控制量未饱和（最差贴边 ${(worstRatio * 100).toFixed(1)}%）`,
        current: `max|value|=${ev.worst?.maxAbs.toFixed(2)}`,
        direction: rateErrors.length > 0
          ? "误差来源**排除饱和**：按速率环/角度环结论调增益与滤波（先滤波后增益）"
          : "维持当前参数；若要进一步定位误差来源，需要时间对齐可信的速率环数据",
        missing: rateErrors.length > 0 ? "无（已排除饱和）" : "缺可信的指令/实际配对数",
        verify: "复飞后控制量仍不贴边，且跟踪误差按增益/滤波改动方向变化",
        doc: PX4_MC_DOC,
      }),
    ],
  });
}
