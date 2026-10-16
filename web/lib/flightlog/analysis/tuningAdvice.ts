/**
 * 速率环的**调参取证**：从日志数据算出可推导、可复算的调参依据。
 *
 * 设计纪律（契约 §3.3 / §0.5.7）：
 *  - 每个数字都必须来自日志，并写进 evidence（含算式与样本数）；
 *  - **不许把"算不出最优值"包装成"最优"**：真值需要 step response/系统辨识，日志里没有；
 *    这里给的是**起点值**，并明确写出依赖的假设；
 *  - 测不出来就判 unknown 并说明缺什么。
 *
 * 物理依据（本模块最重要的一条）：
 *   实测这批语料 Tar→Act 滞后中位数 2 个采样（10 Hz → 200 ms），
 *   同时高频指令样本上 Err/Tar 中位数 0.58 —— 两者自洽：
 *     纯延迟 τ 在频率 f 下造成的误差幅度 ≈ 2πfτ·Tar
 *     0.5 Hz × 0.2 s → 0.63 ≈ 0.58（实测）
 *   ⇒ **误差主要由相位滞后贡献，而不是 P 不够**。
 *   FF（前馈）正是消滞后的手段，且不引入相位滞后；加 P 会同时放大噪声与振荡风险。
 *   所以建议顺序里 FF 排在 P 之前（这与"先滤波→P→D→I→FF"的官方顺序不冲突：
 *   官方顺序是**首次整定**的顺序；当数据表明误差是滞后主导时，FF 才是第一优先项）。
 */

import type { Suggestion } from "../types/report";
import type { RuleContext, SeriesWindow } from "../types/rule";
import type { TimeWindow } from "../types/log";
import { suggestion } from "./finding";
import { crossCorrelationLag, dominantHzOf, highCommandRatio, medianDt } from "./trackingSignatures";
import { meanOf, rms } from "./stats";
import { PID_TUNING, PID_RATE } from "./thresholds";
import type { RateAxisSpec } from "./rateAxisEvidence";

export type Grade = "A" | "B" | "C" | "D";

export interface RateTuningMetrics {
  /** 仅在高指令样本上统计的 Err/Tar（低指令时段会放大比值，必须剔除） */
  errRatio: number;
  /** Act 相对 Tar 的滞后（采样数，正 = 滞后） */
  lagSamples: number;
  lagMs: number;
  /** 指令主频（Hz），用于滞后→误差的换算 */
  dominantHz: number;
  /** 实测 P 项输出 / 误差（≈P 增益，用于校验参数与日志一致） */
  pOverErr: number;
  /** RMS(D项输出)/RMS(Err)：>0.5 说明 D 项过激或噪声大 */
  dOverErr: number;
  /** |mean(I 项)|/IMAX：单边偏置 → 重心/推力不对称 */
  iBiasRatio: number;
  grade: Grade;
  samples: number;
  /** 说明用了哪些假设；无法计算的项在这里写清缺什么 */
  assumptions: string[];
}

export function gradeOf(errRatio: number): Grade {
  const b = PID_TUNING.gradeBands;
  if (errRatio < b.aMax) return "A";
  if (errRatio < b.bMax) return "B";
  if (errRatio < b.cMax) return "C";
  return "D";
}

/** 采集速率环调参指标；数据不足时返回 null（由调用方判 insufficient_data） */
export function collectRateTuning(
  ctx: RuleContext,
  spec: RateAxisSpec,
  window: TimeWindow,
): RateTuningMetrics | null {
  const tar: SeriesWindow | null = ctx.windowed(spec.message, "Tar", window);
  const act: SeriesWindow | null = ctx.windowed(spec.message, "Act", window);
  const err: SeriesWindow | null = ctx.windowed(spec.message, "Err", window);
  if (!tar || !act || !err || err.values.length < PID_RATE.minSamples) return null;

  // 签名算法与 PX4 共用（analysis/trackingSignatures.ts）：只统计高指令样本
  const ratio = highCommandRatio(tar.values, err.values, PID_TUNING.highCommandFraction);
  if (!ratio || rms(tar.values) <= 1e-9) return null;
  const errRatio = ratio.errRatio;

  const { lag } = crossCorrelationLag(tar.values, act.values, PID_TUNING.maxLagSamples);
  const dt = medianDt(err.timeSec);
  const lagMs = dt > 0 ? lag * dt * 1000 : 0;

  const dominantHz = dominantHzOf(tar.timeSec, tar.values) ?? PID_TUNING.defaultDominantHz;

  const p = ctx.windowed(spec.message, "P", window);
  const d = ctx.windowed(spec.message, "D", window);
  const i = ctx.windowed(spec.message, "I", window);
  const errRms = rms(err.values);
  const pOverErr = p && errRms > 1e-9 ? rms(p.values) / errRms : 0;
  const dOverErr = d && errRms > 1e-9 ? rms(d.values) / errRms : 0;

  const imax = ctx.param(spec.paramName.replace(/_P$/, "_IMAX"));
  const iBiasRatio =
    i && imax && imax > 0 && i.values.length > 0
      ? Math.abs(meanOf(i.values)) / imax
      : 0;

  const assumptions: string[] = [];
  if (dominantHz === PID_TUNING.defaultDominantHz) assumptions.push("无法从指令求主频，滞后→误差的换算用了默认频率");
  if (!p) assumptions.push("日志里没有 P 项输出，P 增益只能取参数值");
  if (!i || !imax) assumptions.push("缺少 I 项输出或 IMAX 参数，I 项偏置未评估");

  return {
    errRatio,
    lagSamples: lag,
    lagMs,
    dominantHz,
    pOverErr,
    dOverErr,
    iBiasRatio,
    grade: gradeOf(errRatio),
    samples: err.values.length,
    assumptions,
  };
}
