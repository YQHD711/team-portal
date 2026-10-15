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
import { computeSpectrum } from "./spectrum";
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

/** 互相关求滞后（正 = Act 滞后于 Tar）。返回采样数与相关系数峰值。 */
function crossCorrelationLag(
  tar: Float64Array,
  act: Float64Array,
  maxLag = 10,
): { lag: number; corr: number } {
  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let num = 0;
    let d1 = 0;
    let d2 = 0;
    for (let i = 0; i < tar.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= act.length) continue;
      num += tar[i] * act[j];
      d1 += tar[i] * tar[i];
      d2 += act[j] * act[j];
    }
    const corr = num / Math.sqrt(Math.max(d1 * d2, 1e-30));
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return { lag: bestLag, corr: bestCorr };
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

  const tarRms = rms(tar.values);
  if (tarRms <= 1e-9) return null;

  // 只统计高指令样本（|Tar| ≥ 0.3·RMS）：低指令时段 Err/Tar 天然被放大
  const thr = PID_TUNING.highCommandFraction * tarRms;
  const ev: number[] = [];
  const tv: number[] = [];
  for (let i = 0; i < tar.values.length; i++) {
    if (Math.abs(tar.values[i]) >= thr) {
      ev.push(err.values[i]);
      tv.push(tar.values[i]);
    }
  }
  if (ev.length < 30) return null;
  const errRatio = rms(Float64Array.from(ev)) / Math.max(rms(Float64Array.from(tv)), 1e-9);

  const { lag } = crossCorrelationLag(tar.values, act.values, PID_TUNING.maxLagSamples);
  // 采样间隔由窗口内时间戳估计
  const times = err.timeSec;
  const dt = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 0;
  const lagMs = dt > 0 ? lag * dt * 1000 : 0;

  const spectrum = computeSpectrum(tar.timeSec, tar.values, {
    minHz: 0.2,
    maxHz: 20,
    maxSamples: 4096,
  });

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
  if (!spectrum) assumptions.push("无法从指令求主频，滞后→误差的换算用了默认频率");
  if (!p) assumptions.push("日志里没有 P 项输出，P 增益只能取参数值");
  if (!i || !imax) assumptions.push("缺少 I 项输出或 IMAX 参数，I 项偏置未评估");

  return {
    errRatio,
    lagSamples: lag,
    lagMs,
    dominantHz: spectrum?.peakHz ?? PID_TUNING.defaultDominantHz,
    pOverErr,
    dOverErr,
    iBiasRatio,
    grade: gradeOf(errRatio),
    samples: err.values.length,
    assumptions,
  };
}
