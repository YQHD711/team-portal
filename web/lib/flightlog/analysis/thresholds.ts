/**
 * 全部诊断阈值集中在此，**不得散落在规则里**。
 *
 * 每个阈值的来源见注释；改动必须同时更新 evidence 里的口径说明，
 * 否则报告会与代码不一致（这比阈值本身错更危险）。
 *
 * ⚠️ 阈值经过 6 份真实日志实测标定（见 docs/日志诊断-接口契约.md §1.2/§1.5），
 * 不是从方案文档抄来的猜测值。
 */

import type { VehicleKind } from "../types/log";

export const VIBRATION = {
  /** ArduPilot 官方：Vibe 理想 < 15 m/s² */
  stdWarning: 15,
  /** ArduPilot 官方：Vibe 必须 < 30 m/s²；超过即严重 */
  stdCritical: 30,
  /** 任何 clip 计数增量都算严重（官方要求 clipping 必须为 0） */
  clipDeltaCritical: 1,
  minSamples: 50,
} as const;

export const PID_RATE = {
  /**
   * 评估跟踪质量所需的最小指令激励（deg/s）。
   * 悬停飞行时指令角速度极小（实测 quad 本次飞行 roll TarRMS 仅 3.2°/s），
   * 此时 Err/Tar 天然大于 1，若不设门槛会**对健康日志误报**。
   */
  minExcitationDegPerSec: 10,
  /** Err/Tar 均值比：>0.5 跟踪偏差明显；>1.0 误差已达指令量级 */
  errRatioWarning: 0.5,
  errRatioCritical: 1,
  /**
   * 最少样本数 = 10 秒飞行（10 Hz 记录 100 点）。
   * 依据：RMS 比值在 100 点上已经稳定（几十个样本即可，估计误差随 √n）；
   * 实测 user_0509 的 arm 窗口只有 125 点（12.5 s），若门槛设 200（20 s）
   * 会把正常的短程飞行一律判成"无法判断"，失去可用性。
   */
  minSamples: 100,
} as const;

export const FILTER = {
  /** 飞控自身 FFT 的 SNR 参考值（ArduPilot FFT_SNR_REF 默认 25 dB） */
  ftnSnrReferenceDb: 25,
  minSamples: 30,
  /** 振动达到该标准差才建议启用陷波，避免对健康机架乱给参数建议 */
  vibrationNeedsNotchStd: 15,
  /** 振动健康而陷波未启用时，仅提示不报警 */
  /** 频谱图所需的最小记录率（Hz）：低于此值频谱几乎无信息量 */
  minSpectrumRateHz: 20,
} as const;

/**
 * 角度环（外环）跟踪：ATT.Des* vs ATT.*，单位一律是**度**，跨机型一致。
 *
 * ⚠️ 下面的数值是**待标定的初值**：实施时必须用真实语料（66 Copter / 9 Plane）
 * 实测各轴角度误差的分布，再据此定档并把实测数字写进回报——不许直接照抄。
 */
export const ATTITUDE = {
  /** 评估跟踪所需的最小指令角度（RMS，度）。太小则误差/指令比天然失真 */
  minExcitationDeg: 5,
  errRmsWarningDeg: 5,
  errRmsCriticalDeg: 10,
  minSamples: 100,
} as const;

/**
 * 速度环 / 位置环跟踪。
 *
 * Copter：PSCN/PSCE 的 `TV*`(目标速度) vs `V*`(实际速度)、`TP*`(目标位置) vs `P*`(实际位置)。
 * Plane ：CTUN 的 `AsT`(目标空速) vs `As`，NTUN 的 `XT`(航迹横向偏差)、`AltE`(高度偏差)。
 */
export const SPEED_POSITION = {
  /** 速度环最小指令激励（m/s，RMS）：低于它不判定 */
  minVelocityExcitationMps: 1,
  errRatioWarning: 0.5,
  errRatioCritical: 1,
  /** 位置误差（m）：Copter 位置偏差 / Plane 航迹横向偏差 XT */
  posErrWarningM: 5,
  posErrCriticalM: 15,
  /** Plane 高度偏差 AltE（m） */
  altErrWarningM: 5,
  altErrCriticalM: 20,
  minSamples: 100,
} as const;

/**
 * 固定翼 TECS（总能量控制）系统。数据来自 TECS 消息：
 * `spdem/sp`(目标/实际空速)、`hdem/h`(目标/实际高度)、`th`(油门 0..1)、`ph`(俯仰)、`pmin/pmax`。
 *
 * ⚠️ 同 ATTITUDE：数值是初值，必须用 9 份真实 Plane 日志实测分布后定档。
 */
export const TECS = {
  minSamples: 50,
  /** 空速跟踪误差 RMS（m/s） */
  airspeedErrWarningMps: 2,
  airspeedErrCriticalMps: 4,
  /** 高度跟踪误差 RMS（m） */
  heightErrWarningM: 5,
  heightErrCriticalM: 15,
  /** 油门顶到 0/1 的时间占比 */
  throttleSaturationWarning: 0.1,
  throttleSaturationCritical: 0.3,
  /** 俯仰触及 pmin/pmax 的时间占比 */
  pitchSaturationWarning: 0.1,
} as const;

/**
 * 速率环原生单位 → deg/s。
 *
 * ArduPilot 各机型的速率控制器内部单位不同：Copter/Sub 用 rad/s，
 * Plane/Rover 用 deg/s。日志里 PIDx.Tar/Act/Err 就是控制器原生单位，
 * 因此跨机型比较前必须换算，否则阈值会差 57 倍。
 */
export const RATE_UNIT_TO_DEG_PER_SEC: Readonly<Record<VehicleKind, number>> = {
  copter: 180 / Math.PI,
  sub: 180 / Math.PI,
  tracker: 180 / Math.PI,
  blimp: 180 / Math.PI,
  plane: 1,
  rover: 1,
  "px4-multirotor": 180 / Math.PI,
  "px4-fixedwing": 1,
  unknown: 1,
};
