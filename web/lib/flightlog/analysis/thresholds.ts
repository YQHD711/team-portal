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
 * 角度环（外环）跟踪：ATT.Des* vs ATT.*，单位一律是**度**。
 *
 * ⚠️ **必须按机型 + 轴分档**：用同一份阈值管所有机型是**假红根源**。
 * 实测（76 份语料，armed 窗口）：
 *   Copter Roll 误差 p50 0.63° / p90 5.82°；Pitch p50 0.91° / p90 4.73°
 *   Plane  Roll 误差 p50 **19.79°** / p90 51.3°；Pitch p50 **8.77°** / p90 19.3°
 * 若 Plane 用 Copter 的 5/10 → **7/9 份健康固定翼日志全判 fired**（已实测）。
 * Plane 的角误差天然大：`ATT.DesRoll ≈ CTUN.NavRoll`（经 pymavlink 独立复核，不是字段错位），
 * 导航转弯与阵风下实际滚转滞后是常态。
 */
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
  /** 评估跟踪所需的最小指令角度（RMS，度）。实测 Copter roll 激励 p50 仅 2.58°、pitch 3.88°、
   *  yaw 6.32° → 门槛设 5 会把 60/66、43/66、30/66 判成"激励不足"，覆盖率太低；2 仍能挡住纯悬停。 */
  minExcitationDeg: 2,
  minSamples: 100,
  warnDeg: {
    copter: { roll: 5, pitch: 5, yaw: 10 },
    plane: { roll: 25, pitch: 12, yaw: 10 },
    rover: { roll: 5, pitch: 5, yaw: 10 },
    default: { roll: 5, pitch: 5, yaw: 10 },
  } as Readonly<Record<string, AxisThresholds>>,
  critDeg: {
    copter: { roll: 10, pitch: 10, yaw: 20 },
    plane: { roll: 50, pitch: 25, yaw: 20 },
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
  /** 速度环最小指令激励（m/s，RMS）。实测 Copter 目标速度 p50 只有 0.23–0.99 → 门槛 1 会拒判 27/66~53/66 */
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

/**
 * 固定翼 TECS（总能量控制）系统。数据来自 TECS 消息：
 * `spdem/sp`(目标/实际空速)、`hdem/h`(目标/实际高度)、`th`(油门 0..1)、`ph`(俯仰)、`pmin/pmax`。
 *
 * ⚠️ 已用 7 份真实 Plane 日志标定（每份一个值）：
 *   空速误差 RMS : 2.47 / 4.26 / 4.74 / 5.42 / 6.42 / 13.60 / 14.97 m/s
 *   高度误差 RMS : 0.03 / 2.29 / 3.17 / 3.57 / 4.91 / 8.53 / 28.59 m
 *   油门饱和占比 : 0 / 0.21 / 0.21 / 0.44 / 0.98 / 0.99 / 1.00
 *   俯仰饱和占比 : 全部 0
 *
 * 定档依据（**不是猜的**）：
 *  - 空速误差有天然底噪：最小值就有 2.47、中位数 5.42，因为 TECS 本来就用高度换空速，
 *    爬升/下降段必然出现空速偏差。所以阈值必须落在**上四分位之外**，否则每份日志都报。
 *  - 高度误差呈"正常簇 + 离群点"：0.03–8.53 是常态，28.59 是离群 → 阈值放在簇之上。
 *  - 油门饱和占比是**双峰**的（0–0.44 与 0.98–1.0 之间没有中间值）→ 阈值放在双峰之间，
 *    标出来的日志确实有 ~98% 时间顶在油门极限（推算力余量问题，值得看）。
 *  - 俯仰饱和占比实测恒为 0 → 保留 0.1 作为"真的顶到限幅"的门槛。
 */
export const TECS = {
  minSamples: 50,
  /** 空速跟踪误差 RMS（m/s）：p50=5.42 / p90=14.97，阈值取在簇之上 */
  airspeedErrWarningMps: 8,
  airspeedErrCriticalMps: 15,
  /** 高度跟踪误差 RMS（m）：常态簇 0.03–8.53，离群 28.59 */
  heightErrWarningM: 10,
  heightErrCriticalM: 25,
  /** 油门顶到 0/1 的时间占比（双峰分布，切在中间） */
  throttleSaturationWarning: 0.8,
  throttleSaturationCritical: 0.95,
  /** 俯仰触及 pmin/pmax 的时间占比（实测恒为 0） */
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
