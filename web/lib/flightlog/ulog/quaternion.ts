/**
 * PX4 姿态是**四元数**（`vehicle_attitude.q[0..3]`），不是欧拉角 —— 后续规则要用角度，
 * 所以这一层必须有一个可单测的换算。
 *
 * 约定（与 PX4 / pyulog 一致）：
 *  - `q = [w, x, y, z]`，Hamilton 约定，`q` 表示 body(FRD) → NED 的旋转；
 *  - 返回角度单位 **度**，yaw 归一到 **±180°**（`-179.9 → +179.9` 的环绕必须处理，
 *    否则轨迹/航向误差会在 180° 处出现假跳变）；
 *  - `q` 与 `-q` 表示同一姿态，因此换算前先规范化（w ≥ 0），避免同一姿态两条记录
 *    在 yaw 上出现 ±180 的翻转；
 *  - 输入非有限或模长 ≈ 0 → 返回 NaN（**不伪装成 0**，缺数据必须显式）。
 */

export interface EulerDeg {
  roll: number;
  pitch: number;
  yaw: number;
}

/** yaw 归一到 ±180° */
export function wrap180Deg(deg: number): number {
  if (!Number.isFinite(deg)) return Number.NaN;
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export const RAD_TO_DEG = 180 / Math.PI;

/** 四元数 (w, x, y, z) → 欧拉角（度，yaw ∈ ±180） */
export function quatToEulerDeg(w: number, x: number, y: number, z: number): EulerDeg {
  const norm = Math.hypot(w, x, y, z);
  if (!Number.isFinite(norm) || norm < 1e-9) return { roll: Number.NaN, pitch: Number.NaN, yaw: Number.NaN };
  const nw = w / norm;
  const nx = x / norm;
  const ny = y / norm;
  const nz = z / norm;
  // q 与 -q 同一姿态：规范化到 w ≥ 0，避免同一姿态两种表示的 yaw 跳变
  const s = nw < 0 ? -1 : 1;
  const qw = nw * s;
  const qx = nx * s;
  const qy = ny * s;
  const qz = nz * s;

  const roll = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy));
  // asin 的入参必须夹紧：浮点误差会让 |v| 略大于 1 → NaN
  const sinPitch = Math.min(1, Math.max(-1, 2 * (qw * qy - qz * qx)));
  const pitch = Math.asin(sinPitch);
  const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
  return {
    roll: roll * RAD_TO_DEG,
    pitch: pitch * RAD_TO_DEG,
    yaw: wrap180Deg(yaw * RAD_TO_DEG),
  };
}

/** 从 `q[0]`…`q[3]` 四个数列取一条记录换算（越界/缺列 → NaN） */
export function quatColumnsToEulerDeg(
  w: Float64Array | undefined,
  x: Float64Array | undefined,
  y: Float64Array | undefined,
  z: Float64Array | undefined,
  index: number,
): EulerDeg {
  if (!w || !x || !y || !z) return { roll: Number.NaN, pitch: Number.NaN, yaw: Number.NaN };
  return quatToEulerDeg(w[index], x[index], y[index], z[index]);
}
