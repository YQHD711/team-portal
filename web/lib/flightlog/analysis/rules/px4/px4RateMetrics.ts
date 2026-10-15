/**
 * PX4 速率环的**调参取证**：从两条独立 topic 重建（指令、实际、误差），并算出与 ArduPilot 同一套签名。
 *
 * 数据口径（冻结契约）：
 *  - 指令 `vehicle_rates_setpoint.{roll,pitch,yaw}`（rad/s）
 *  - 实际 `vehicle_angular_velocity.xyz[0..2]`（rad/s；0=X/roll、1=Y/pitch、2=Z/yaw）
 *  - 误差 = 指令 − 实际（PX4 不记 `Err`，必须自己算）
 *  - 两条 topic 采样率不同 → **零阶保持**把指令对齐到实际的时间轴（`alignTargetToActual`）
 *  - I 项签名来自 `rate_ctrl_status.{rollspeed_integ,pitchspeed_integ,yawspeed_integ}`
 *
 * 签名算法（高指令比值、互相关滞后、主频、采样间隔）全部复用 `analysis/trackingSignatures.ts`，
 * 与 ArduPilot 侧**同一份实现**（不复制粘贴）。
 */

import type { RuleContext } from "../../../types/rule";
import type { TimeWindow } from "../../../types/log";
import { meanOf, rms, stdDev } from "../../stats";
import {
  crossCorrelationLag, dominantHzOf, highCommandRatio, medianDt, resampleToGrid, uniformGrid,
} from "../../trackingSignatures";
import type { Px4Axis } from "./px4ParamNames";

/** 分级门槛（起点值，26 份 MC 语料实测分位数见测试打印；与 ArduPilot 口径一致起步） */
export const PX4_RATE_GRADE_BANDS = { aMax: 0.2, bMax: 0.4, cMax: 0.7 } as const;

export interface Px4RateMetrics {
  axis: Px4Axis;
  /** 仅高指令样本的 RMS(Err)/RMS(Tar) */
  errRatio: number;
  lagSamples: number;
  lagMs: number;
  dominantHz: number;
  samples: number;
  actRms: number;
  /** 指令变化（std，rad/s）——激励门槛用它而不是 RMS（恒定指令 RMS 大但 std=0） */
  cmdStd: number;
  cmdRms: number;
  /** 指令↔实际互相关峰值（0..1）：**低于可信下限时不允许据此判分级/给滞后建议** */
  peakCorr: number;
  /** 0 滞后处的相关系数（与峰值差距大 = 靠"错位"才对上，需人工核对） */
  corrAtZeroLag: number;
  /** 积分项 |均值| / 限幅（>0.5 说明长期单边顶住 → 先查重心/配平） */
  integralBiasRatio: number;
  grade: "A" | "B" | "C" | "D";
  assumptions: string[];
}

const INTEGRAL_FIELD: Readonly<Record<Px4Axis, string>> = {
  roll: "rollspeed_integ",
  pitch: "pitchspeed_integ",
  yaw: "yawspeed_integ",
};

const XYZ_INDEX: Readonly<Record<Px4Axis, number>> = { roll: 0, pitch: 1, yaw: 2 };

export function gradePx4Rate(errRatio: number): "A" | "B" | "C" | "D" {
  const b = PX4_RATE_GRADE_BANDS;
  if (errRatio < b.aMax) return "A";
  if (errRatio < b.bMax) return "B";
  if (errRatio < b.cMax) return "C";
  return "D";
}

export interface Px4RateCollectOptions {
  minSamples: number;
  /** 互相关搜索范围（秒，正负各取这么长；速率环的正常相位滞后远小于此） */
  maxLagSec: number;
  highCommandFraction: number;
  defaultDominantHz: number;
  /** 该轴积分限幅参数值（拿不到传 null） */
  intLimit: number | null;
}

/** 采集 PX4 速率环指标；数据不足返回 null（调用方判 insufficient_data） */
export function collectPx4RateMetrics(
  ctx: RuleContext,
  axis: Px4Axis,
  window: TimeWindow,
  options: Px4RateCollectOptions,
): Px4RateMetrics | null {
  const actual = ctx.windowed("vehicle_angular_velocity", `xyz[${XYZ_INDEX[axis]}]`, window);
  const cmd = ctx.windowed("vehicle_rates_setpoint", axis, window);
  if (!actual || !cmd || actual.values.length < options.minSamples || cmd.values.length < 2) return null;

  // ⚠️ 两条 topic 采样率不同（实测 221 Hz vs 286 Hz）：先重采样到同一 **100 Hz** 网格再比较，
  // 否则"采样率差"会被算成相位滞后（按索引互相关会一路顶到搜索上限，实测踩到）。
  const start = Math.max(cmd.timeSec[0], actual.timeSec[0]);
  const end = Math.min(cmd.timeSec[cmd.timeSec.length - 1], actual.timeSec[actual.timeSec.length - 1]);
  if (!(end > start)) return null;
  const grid = uniformGrid(start, end, 100);
  const cmdGrid = resampleToGrid(cmd.timeSec, cmd.values, grid);
  const actGrid = resampleToGrid(actual.timeSec, actual.values, grid);

  const tar: number[] = [];
  const act: number[] = [];
  const errs: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < grid.length; i += 1) {
    if (!Number.isFinite(cmdGrid[i]) || !Number.isFinite(actGrid[i])) continue;
    tar.push(cmdGrid[i]);
    act.push(actGrid[i]);
    errs.push(cmdGrid[i] - actGrid[i]);
    times.push(grid[i]);
  }
  if (errs.length < options.minSamples) return null;

  const tarArr = Float64Array.from(tar);
  const errArr = Float64Array.from(errs);
  const timeArr = Float64Array.from(times);
  const ratio = highCommandRatio(tarArr, errArr, options.highCommandFraction, options.minSamples);
  if (!ratio) return null;

  // 100 Hz 网格 → 滞后毫秒 = 采样数 × 10
  const maxLag = Math.max(1, Math.round(options.maxLagSec * 100));
  const { lag, corr, corrAtZero } = crossCorrelationLag(tarArr, Float64Array.from(act), maxLag);
  const dt = medianDt(timeArr);
  const dominantHz = dominantHzOf(timeArr, tarArr) ?? options.defaultDominantHz;

  const assumptions: string[] = [];
  if (dt <= 0) assumptions.push("无法从时间戳估计采样间隔，滞后毫秒数按 0 处理");
  if (dominantHz === options.defaultDominantHz) assumptions.push("无法从指令求主频，滞后→误差换算用了默认频率");
  if (Math.abs(lag) >= maxLag) {
    assumptions.push(`互相关峰值顶到搜索上限（±${options.maxLagSec} s）：两条 topic 的对应关系存疑，滞后数字不可用`);
  }

  let integralBiasRatio = 0;
  const integ = ctx.windowed("rate_ctrl_status", INTEGRAL_FIELD[axis], window);
  if (integ && integ.values.length > 0 && options.intLimit !== null && options.intLimit > 0) {
    integralBiasRatio = Math.abs(meanOf(integ.values)) / options.intLimit;
  } else {
    assumptions.push(
      options.intLimit === null
        ? "没有读到该轴积分限幅参数，I 项偏置未评估"
        : "日志里没有 rate_ctrl_status 的积分项，I 项偏置未评估",
    );
  }

  return {
    axis,
    errRatio: ratio.errRatio,
    lagSamples: lag,
    lagMs: dt > 0 ? lag * dt * 1000 : 0,
    dominantHz,
    samples: errs.length,
    actRms: rms(Float64Array.from(act)),
    cmdStd: stdDev(tarArr),
    cmdRms: rms(tarArr),
    peakCorr: corr,
    corrAtZeroLag: corrAtZero,
    integralBiasRatio,
    grade: gradePx4Rate(ratio.errRatio),
    assumptions,
  };
}
