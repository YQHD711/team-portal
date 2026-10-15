/**
 * 降落/触地段的**独立结论**（不混进常规振动评估）。
 *
 * 用户反馈：「有时候降落坠机产生的震动不能算异常的一部分」。
 * 判定：
 *  - 触地段 clip 增量 ≥ 阈值（加速度计饱和）或 std ≥ 严重线 → 判「触地/坠机冲击」（critical）
 *  - 触地段有明显冲击但未饱和 → 警告，提示与机架振动区分开
 *  - 无冲击 → 不产生结论（但常规结论的 note 会说明排除了哪一段、依据是什么）
 */

import type { Finding } from "../../types/report";
import { makeFinding, step, describeWindow } from "../finding";
import { tuningStep } from "./tuningSteps";
import type { VibrationIndicator } from "../vibrationIndicators";
import { VIBRATION } from "../thresholds";
import { VIB_DOC, VIB_RULE_ID } from "./vibrationFinding";

export function landingFinding(ind: VibrationIndicator): Finding | null {
  const land = ind.landing;
  if (!land || !ind.excluded) return null;
  const saturated = land.clipDelta >= VIBRATION.clipDeltaCritical;
  const severe = land.worstStd >= VIBRATION.stdCritical;
  const touched = land.clipDelta > 0 || land.worstStd >= VIBRATION.stdWarning;
  if (!touched && !severe && !saturated) return null;
  const crash = saturated || severe;
  const label = crash ? "触地/坠机冲击（独立事件）" : "降落/触地冲击（已从常规振动中排除）";
  return makeFinding({
    ruleId: VIB_RULE_ID,
    title: label,
    severity: crash ? "critical" : "warning",
    status: "fired",
    window: land.window,
    phenomenon:
      `${describeWindow(land.window)} 内出现${crash ? "冲击性" : "明显"}振动：` +
      `最差轴 ${land.worstAxis.toUpperCase()} std ${land.worstStd.toFixed(2)} m/s²、峰值 ${land.max.toFixed(1)} m/s²、clip 增量 ${land.clipDelta}`,
    impact: crash
      ? "触地/坠机冲击可能已造成结构、桨或减振件损伤；这类事件必须先排除机械损伤再谈振动调参"
      : "落地冲击属于事件性振动，不代表机架振动异常；但可能掩盖真实的持续振动水平",
    evidence: [
      step("识别依据", ind.excluded.basis),
      step(
        "该段实测",
        `样本 ${land.samples} 条；最差轴 ${land.worstAxis.toUpperCase()} std ${land.worstStd.toFixed(2)}、峰值 ${land.max.toFixed(1)}、clip 增量 ${land.clipDelta}`,
      ),
      step(
        "与常规振动的区分",
        `常规飞行段（已排除该段）最差轴 std ${ind.worstStd.toFixed(2)}、clip 增量 ${ind.clipDelta}；官方要求 clip 必须为 0`,
      ),
      step(
        "判据",
        `触地段 clip ≥ ${VIBRATION.clipDeltaCritical} 或 std ≥ ${VIBRATION.stdCritical} → 判「冲击/坠机」；否则只提示不告警`,
      ),
    ],
    metrics: {
      landingWorstStd: land.worstStd,
      landingMax: land.max,
      landingClipDelta: land.clipDelta,
      flightWorstStd: ind.worstStd,
      flightClipDelta: ind.clipDelta,
      samples: land.samples,
    },
    suggestions: [
      tuningStep({
        order: 1,
        signature: crash
          ? `触地段 clip 增量 ${land.clipDelta}（≥${VIBRATION.clipDeltaCritical}）或 std ${land.worstStd.toFixed(2)}（≥${VIBRATION.stdCritical}）`
          : `触地段出现冲击：clip 增量 ${land.clipDelta}、std ${land.worstStd.toFixed(2)}`,
        current: `该段 std ${land.worstStd.toFixed(2)}、峰值 ${land.max.toFixed(1)} m/s²、clip 增量 ${land.clipDelta}`,
        suggested: crash
          ? "先做落地后检查：机架/起落架裂纹、桨与电机轴、减振件移位；确认无损伤后再复飞，并复核下降率与触地速度"
          : "本次按事件处理即可；若同机多次出现，检查下降率/触地姿态与场地（软硬地）",
        basis: "官方：clipping 必须为 0；触地冲击是事件而不是机架振动，混入常规统计会误导滤波/调参结论",
        verify: `复飞后本段 clip 增量为 0，且常规飞行段 std 仍低于 ${VIBRATION.stdWarning}`,
        doc: VIB_DOC,
      }),
    ],
    note: "本结论由降落/触地段单独统计得出，**没有**混进常规振动评估（用户反馈：落地冲击不算振动异常）。",
  });
}
