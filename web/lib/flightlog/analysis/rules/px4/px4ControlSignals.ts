/**
 * PX4 控制量/执行器的取证（task-34 第 2 项）。
 *
 * 要回答用户最关心的问题：**「PID 调不好」到底是增益不够，还是控制量已经饱和/被削顶**。
 * 饱和时提高增益是**错的方向**，必须先指出这一点。
 *
 * 数据来源按优先级探测（**存在性探测，不猜字段**）：
 *  1. `actuator_controls_0.control[0..7]`（归一化控制量，−1..1 或 0..1）
 *  2. `actuator_motors.control[0..11]`（归一化电机指令，0..1，含 `reversible_flags`）
 *  3. `actuator_outputs.output[0..15]`（归一化输出，−1..1）
 * 另外看 `vehicle_torque_setpoint.xyz`（控制分配前的力矩指令）与
 * `vehicle_rates_setpoint.thrust_body[2]`（推力指令，PX4 负值向上）。
 */

import type { RuleContext } from "../../../types/rule";
import type { TimeWindow } from "../../../types/log";
import { absMax, meanOf, stdDev } from "../../stats";

export type ControlSource = "actuator_controls" | "actuator_motors" | "actuator_outputs";

export interface ChannelStat {
  /** 通道名（如 control[0]） */
  field: string;
  /** 贴边占比（|v| ≥ 0.95） */
  saturationRatio: number;
  /** 均值（判断单边顶住） */
  mean: number;
  /** 标准差（判断信号是否几乎不动） */
  std: number;
  maxAbs: number;
  /** 同号占比（0.5 = 无偏置；1 = 全时同一方向） */
  signPersistence: number;
}

export interface ControlEvidence {
  source: ControlSource | null;
  topic: string | null;
  channels: ChannelStat[];
  /** 最差通道（贴边占比最高；**已排除恒定贴边的未使用槽位**） */
  worst: ChannelStat | null;
  /** 恒定贴边通道（PX4 未使用的 actuator 槽位常被填成固定 0/−1；列出但不算饱和） */
  pinned: ChannelStat[];
  /** 力矩指令贴边（vehicle_torque_setpoint.xyz） */
  torqueSaturationRatio: number;
  torqueAvailable: boolean;
  /** 推力指令贴边（thrust_body[2]），PX4 负值向上 */
  thrustSaturationRatio: number;
  thrustAvailable: boolean;
  samples: number;
  unavailableReason: string | null;
}

const CANDIDATES: readonly { source: ControlSource; topic: string; count: number }[] = [
  { source: "actuator_controls", topic: "actuator_controls_0", count: 8 },
  { source: "actuator_motors", topic: "actuator_motors", count: 12 },
  { source: "actuator_outputs", topic: "actuator_outputs", count: 16 },
];

function statsOf(values: Float64Array, threshold: number): Omit<ChannelStat, "field"> {
  let hit = 0;
  let positive = 0;
  let nonzero = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (Math.abs(v) >= threshold) hit += 1;
    if (v !== 0) {
      nonzero += 1;
      if (v > 0) positive += 1;
    }
    sum += v;
  }
  const signPersistence = nonzero > 0 ? Math.max(positive, nonzero - positive) / nonzero : 0.5;
  return {
    saturationRatio: values.length > 0 ? hit / values.length : 0,
    mean: values.length > 0 ? sum / values.length : 0,
    std: stdDev(values),
    maxAbs: absMax(values),
    signPersistence,
  };
}

/** 采集控制量/执行器证据；三类 topic 都没有时给出可读原因 */
export function collectControlEvidence(ctx: RuleContext, window: TimeWindow): ControlEvidence {
  for (const candidate of CANDIDATES) {
    if (ctx.series(candidate.topic) === null) continue;
    const channels: ChannelStat[] = [];
    const pinned: ChannelStat[] = [];
    let samples = Number.MAX_SAFE_INTEGER;
    const prefix = candidate.source === "actuator_outputs" ? "output" : "control";
    for (let i = 0; i < candidate.count; i += 1) {
      const series = ctx.windowed(candidate.topic, `${prefix}[${i}]`, window);
      if (!series || series.values.length < 2) continue;
      samples = Math.min(samples, series.values.length);
      const stat = { field: `${prefix}[${i}]`, ...statsOf(series.values, 0.95) };
      // 恒定贴边的槽位（std≈0 且 |值|≈1）视为**未使用**：它没有控制信息（实测 log_11 的 control[7] 恒 −1.000）。
      // 这类通道要列进 evidence（不许静默），但不参与"是否饱和"的判定，否则每份日志都会假红。
      if (stat.std < 0.01 && Math.abs(stat.mean) >= 0.95) pinned.push(stat);
      else channels.push(stat);
    }
    if (channels.length === 0) continue;   // 全是未使用槽位 → 换下一个候选 topic
    const worst = channels.reduce((a, b) => (b.saturationRatio > a.saturationRatio ? b : a), channels[0]);

    const torque = ["xyz[0]", "xyz[1]", "xyz[2]"].map((f) => ctx.windowed("vehicle_torque_setpoint", f, window));
    const torqueAvailable = torque.every((s) => s !== null);
    const torqueSaturationRatio = torqueAvailable
      ? Math.max(...torque.map((s) => statsOf(s!.values, 0.95).saturationRatio))
      : 0;

    // 推力：PX4 的 thrust_body[2] 负值向上，|值| 接近 1 即贴边
    const thrust = ctx.windowed("vehicle_rates_setpoint", "thrust_body[2]", window)
      ?? ctx.windowed("vehicle_thrust_setpoint", "xyz[2]", window);
    const thrustAvailable = thrust !== null;
    const thrustSaturationRatio = thrust ? statsOf(thrust.values, 0.95).saturationRatio : 0;

    return {
      source: candidate.source,
      topic: candidate.topic,
      channels,
      worst,
      pinned,
      torqueSaturationRatio,
      torqueAvailable,
      thrustSaturationRatio,
      thrustAvailable,
      samples: samples === Number.MAX_SAFE_INTEGER ? 0 : samples,
      unavailableReason: null,
    };
  }
  return {
    source: null,
    topic: null,
    channels: [],
    worst: null,
    pinned: [],
    torqueSaturationRatio: 0,
    torqueAvailable: false,
    thrustSaturationRatio: 0,
    thrustAvailable: false,
    samples: 0,
    unavailableReason:
      "日志里没有 actuator_controls_0 / actuator_motors / actuator_outputs 中的任何一个，"
      + "无法评估控制量是否饱和（需要 SDLOG_PROFILE 记录 actuator 组）",
  };
}

/** 该证据是否"明显饱和"（贴边占比门槛 5%，起点值：正常飞行几乎不贴边） */
export const SATURATION_RATIO_WARN = 0.05;

export function isSaturated(ev: ControlEvidence, axisMeanOf?: (c: ChannelStat) => number): boolean {
  const worstRatio = Math.max(ev.worst?.saturationRatio ?? 0, ev.torqueSaturationRatio, ev.thrustSaturationRatio);
  if (worstRatio >= SATURATION_RATIO_WARN) return true;
  if (axisMeanOf) return ev.channels.some((c) => Math.abs(axisMeanOf(c)) > 0.2 && c.signPersistence > 0.9);
  return false;
}

/**
 * 单边顶住的通道（重心/配平问题的候选）。
 *
 * ⚠️ 门槛故意保守（|均值| ≥ 0.7、同号 > 95%、std < 0.05）：
 * 悬停时电机/控制量的**常态集合值**本身就有均值（实测约 0.3–0.5），用"|mean|>0.2"会把
 * **每一份正常日志**都误报成"单边顶住"（本任务实现时实测踩到）。
 */
export function biasedChannels(ev: ControlEvidence): ChannelStat[] {
  return ev.channels.filter((c) => c.signPersistence > 0.95 && Math.abs(c.mean) >= 0.7 && c.std < 0.05);
}

export { meanOf };
