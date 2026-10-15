/**
 * PX4 角度环的（指令、实际）配对：**实际姿态是四元数**，必须先转欧拉角。
 *
 * 数据口径：指令 = `vehicle_attitude_setpoint.{roll_body,pitch_body,yaw_body}`（**弧度**，转成度）；
 * 实际 = `vehicle_attitude.q[0..3]` → `quatToEulerDeg`（含 yaw 的 ±180° 环绕）。
 * 两条 topic 采样率不同 → 零阶保持对齐（与速率环同一策略）。
 */

import type { RuleContext } from "../../../types/rule";
import type { TimeWindow } from "../../../types/log";
import type { TrackingPair } from "../../trackingEvidence";
import { alignTargetToActual } from "../../trackingSignatures";
import { quatToEulerDeg } from "../../../ulog/quaternion";
import { rms, stdDev, absMax } from "../../stats";

export type Px4AngleAxis = "roll" | "pitch" | "yaw";

const TARGET_FIELD: Readonly<Record<Px4AngleAxis, string>> = {
  roll: "roll_body",
  pitch: "pitch_body",
  yaw: "yaw_body",
};

const RAD_TO_DEG = 180 / Math.PI;

/** yaw 归一到 ±180°（欧拉角由四元数换算已归一，指令侧也要归一，否则误差会出现 360° 假跳变） */
function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/**
 * 构造角度环 TrackingPair（度）。缺任一侧数据返回 null（调用方判 unknown 并说明缺什么）。
 */
export function px4AnglePair(
  ctx: RuleContext,
  axis: Px4AngleAxis,
  window: TimeWindow,
  minSamples: number,
): TrackingPair | null {
  const q0 = ctx.windowed("vehicle_attitude", "q[0]", window);
  const q1 = ctx.windowed("vehicle_attitude", "q[1]", window);
  const q2 = ctx.windowed("vehicle_attitude", "q[2]", window);
  const q3 = ctx.windowed("vehicle_attitude", "q[3]", window);
  const cmd = ctx.windowed("vehicle_attitude_setpoint", TARGET_FIELD[axis], window);
  if (!q0 || !q1 || !q2 || !q3 || !cmd) return null;
  if (q0.values.length < minSamples || cmd.values.length < 2) return null;

  // 实际姿态：四元数 → 欧拉角（度）
  const acts = new Float64Array(q0.values.length);
  const times = new Float64Array(q0.values.length);
  for (let i = 0; i < q0.values.length; i += 1) {
    const euler = quatToEulerDeg(q0.values[i], q1.values[i], q2.values[i], q3.values[i]);
    acts[i] = axis === "roll" ? euler.roll : axis === "pitch" ? euler.pitch : euler.yaw;
    times[i] = q0.timeSec[i];
  }

  // 指令（弧度 → 度）对齐到实际的时间轴
  const cmdDeg = new Float64Array(cmd.values.length);
  for (let i = 0; i < cmd.values.length; i += 1) cmdDeg[i] = cmd.values[i] * RAD_TO_DEG;
  const aligned = alignTargetToActual(cmd.timeSec, cmdDeg, times);

  const targets: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const t = aligned.target[i];
    if (!Number.isFinite(t) || !Number.isFinite(acts[i])) continue;
    targets.push(axis === "yaw" ? wrap180(t) : t);
    actuals.push(axis === "yaw" ? wrap180(acts[i]) : acts[i]);
  }
  if (targets.length < minSamples) return null;

  const error = new Float64Array(targets.length);
  for (let i = 0; i < targets.length; i += 1) {
    const diff = targets[i] - actuals[i];
    error[i] = axis === "yaw" ? wrap180(diff) : diff;
  }
  const targetArr = Float64Array.from(targets);
  const span = times.length > 0 ? times[times.length - 1] - times[0] : 0;
  return {
    message: "vehicle_attitude_setpoint / vehicle_attitude",
    window,
    samples: targets.length,
    sampleRateHz: span > 0 ? targets.length / span : null,
    // 航向用目标**标准差**（绝对航向的 RMS 无意义），其它轴用目标 RMS
    excitement: axis === "yaw" ? stdDev(targetArr) : rms(targetArr),
    targetRms: rms(targetArr),
    errorRms: rms(error),
    maxAbsError: absMax(error),
    ratio: Number.POSITIVE_INFINITY,
    error,
    isDeviation: false,
  };
}
