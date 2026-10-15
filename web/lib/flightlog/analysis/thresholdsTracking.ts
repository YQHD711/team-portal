/**
 * 角度环 / 速度位置环的阈值（从 thresholds.ts 拆出：原文件超过 200 行上限）。
 * 说明与标定依据见各常量注释；thresholds.ts 作为 barrel 原样再导出，故调用方 import 路径不变。
 */

import type { VehicleKind } from "../types/log";

export interface AxisThresholds {
  roll: number;
  pitch: number;
  yaw: number;
}

/** 按机型取分轴阈值；未收录的机型落到 default */
export function thresholdsFor(
  table: Readonly<Record<string, AxisThresholds>>,
  kind: VehicleKind,
): AxisThresholds {
  return table[kind] ?? table.default;
}

export const ATTITUDE = {
  /**
   * ⚠️ 这里**故意不设激励门槛**（`minExcitationDeg` 已删除）。
   *
   * 理由：激励门槛是**比值判据**的补丁——比值在小分母下会天然放大，所以必须先确认指令够大。
   * 但角度环用的是**绝对误差**（度），一个 30° 的姿态误差不管指令多小都是真的没跟上。
   * 实测证据：Copter 有 5 份日志 roll 绝对误差 14.95–30.04°，却因为"指令激励 < 2°"被挡在
   * `insufficient_data` 一侧 —— 那正是最该被看见的日志。绝对误差只保留 `minSamples`。
   */
  minSamples: 100,
  /**
   * 分轴警告阈值（度）。按机型分档是必须的：
   * 实测 Plane Roll 误差 RMS 降序为 55.41 / 50.33 / 33.40 / 25.43 / 19.79 / 13.16 / 9.10 / 4.13 / 0.01，
   * 而 Copter Roll p50 只有 0.63°、p90 5.82°。
   * Plane 用 Copter 的 5/10 会让 7/9 份健康固定翼判 fired（实测），
   * 取 40/55 则只有最差的两份触发（50.33 warn、55.41 crit）。
   * 注意：Plane 的 `ATT.DesRoll` 是导航给出的快速指令，而滚转时间常数（RLL2SRV_TCONST≈0.5 s）必然带来滞后，
   * 所以该机型的基线本来就高——**这批日志没有人工故障标注，阈值是按"不误报 + 抓最差"定的**。
   */
  warnDeg: {
    copter: { roll: 5, pitch: 5, yaw: 10 },
    plane: { roll: 40, pitch: 20, yaw: 10 },
    rover: { roll: 5, pitch: 5, yaw: 10 },
    default: { roll: 5, pitch: 5, yaw: 10 },
  } as Readonly<Record<string, AxisThresholds>>,
  critDeg: {
    copter: { roll: 10, pitch: 10, yaw: 20 },
    plane: { roll: 55, pitch: 25, yaw: 20 },
    rover: { roll: 10, pitch: 10, yaw: 20 },
    default: { roll: 10, pitch: 10, yaw: 20 },
  } as Readonly<Record<string, AxisThresholds>>,
} as const;

/**
 * 速度环 / 位置环跟踪。
 *
 * Copter：PSCN/PSCE/PSCD 的 `TV*`(目标速度) vs `V*`(实际速度)、`TP*`(目标位置) vs `P*`(实际位置)。
 * Plane ：空速用 `TECS.spdem/sp`（**实测 `CTUN.AsT` 不能顶替**：AsT RMS 只有 1.0–2.8 m/s 而实际空速 6–22 m/s），
 *         位置/高度用 `NTUN.XT`(航迹横向偏差) 与 `NTUN.AltE`(高度偏差)。
 *
 * ⚠️ 米制阈值**必须按机型分档**：实测 Copter 位置误差 p50 0.065–0.094 m / p90 ≤0.16 m，
 * 而 Plane 航迹横向偏差 p90 **51.6 m**、高度偏差 p50 **18.2 m** —— 相差两个数量级。
 * 一律用 5/15 m 会让 Copter 永不触发、Plane 几乎全部 fired（已实测）。
 */
export interface MetreThresholds {
  warnM: number;
  critM: number;
}

export function metresFor(
  table: Readonly<Record<string, MetreThresholds>>,
  kind: VehicleKind,
): MetreThresholds {
  return table[kind] ?? table.default;
}

export const SPEED_POSITION = {
  /**
   * 速度环最小指令激励（m/s，RMS）—— **只对"比值"判据有效**（速度/空速的 误差/目标）。
   * 比值在小分母下会天然放大，所以必须先确认指令够大。
   *
   * ⚠️ **绝对量判据（位置/高度的米）不要用这个门槛**：一个 30 m 的高度偏差
   * 与"目标速度有多小"无关，用激励门槛挡掉它就是把最该看见的日志藏起来。
   * 位置/高度只保留 `minSamples`。
   *
   * 实测：Copter 目标速度 p50 只有 0.23–0.99 → 门槛 1 会误拒 27/66~53/66，故取 0.5。
   */
  minVelocityExcitationMps: 0.5,
  /** 速度/空速用 误差/目标 比值（无量纲，跨机型可比）：实测 P50 0.10–0.35、P90 ≤0.59 → 保持不动 */
  errRatioWarning: 0.5,
  errRatioCritical: 1,
  minSamples: 100,
  /** 水平位置 / 航迹横向偏差（米） */
  positionM: {
    copter: { warnM: 0.5, critM: 2 },
    plane: { warnM: 20, critM: 45 },
    default: { warnM: 5, critM: 15 },
  } as Readonly<Record<string, MetreThresholds>>,
  /** 高度偏差（米）。Plane 的 AltE p50 18.2 m 属于该机型的常态基线，阈值必须在其之上 */
  altitudeM: {
    copter: { warnM: 0.5, critM: 2 },
    plane: { warnM: 30, critM: 50 },
    default: { warnM: 5, critM: 20 },
  } as Readonly<Record<string, MetreThresholds>>,
} as const;
