/**
 * ULog 的 meta（机型/固件/板型/时长/是否解锁）。
 *
 * ⚠️ PX4 的日志里**没有** "ArduCopter V4.6.2" 这类横幅，只能从自描述信息里取：
 *  - `ver_sw_release`（uint32）按 pyulog `get_version_info` 的位定义拆出 major/minor/patch/type；
 *    类型字节：≥0 开发版、≥64 alpha、≥128 beta、≥192 RC、255 正式版；
 *  - `ver_hw` → board；`sys_name` → vehicle（通常是 "PX4"）；
 *  - 机型（copter/plane）PX4 也不直接记录：按**topic 组合**推断，推断不出来就 "unknown"
 *    （**不允许**凭感觉写成 copter —— 规则会按机型选阈值，猜错比 unknown 更糟）。
 */

import type { LogMeta, LogEvent, VehicleKind } from "../types/log";
import { encodeVersion } from "../version";

/** 固定翼特征 topic（出现任一即判 fixedwing） */
const FIXED_WING_TOPICS: readonly string[] = [
  "tecs_status",
  "fw_pos_control_status",
  "fixed_wing_lateral_setpoint",
  "airspeed",
  "fw_att_control",
];

/** 多旋翼特征 topic */
const MULTIROTOR_TOPICS: readonly string[] = [
  "actuator_motors",
  "actuator_controls_0",
  "actuator_controls_1",
  "vehicle_attitude",
];

export function vehicleKindFromTopics(topics: readonly string[]): VehicleKind {
  const set = new Set(topics);
  if (FIXED_WING_TOPICS.some((t) => set.has(t))) return "px4-fixedwing";
  if (MULTIROTOR_TOPICS.some((t) => set.has(t))) return "px4-multirotor";
  return "unknown";
}

/** `ver_sw_release` → { major, minor, patch, type }（pyulog 位定义） */
export function decodeSwRelease(value: number): { major: number; minor: number; patch: number; type: number } {
  return {
    major: (value >> 24) & 0xff,
    minor: (value >> 16) & 0xff,
    patch: (value >> 8) & 0xff,
    type: value & 0xff,
  };
}

/** 与 pyulog `get_version_info_str` 同口径；开发版不给具体版本号 */
export function formatVersion(value: number): { version: string; firmwareString: string; numeric: number } {
  const { major, minor, patch, type } = decodeSwRelease(value);
  const numeric = encodeVersion(major, minor, patch);
  if (type >= 64) {
    const suffix = type < 128 ? " (alpha)" : type < 192 ? " (beta)" : type < 255 ? " (RC)" : "";
    return {
      version: `${major}.${minor}.${patch}${suffix}`,
      firmwareString: `PX4 v${major}.${minor}.${patch}${suffix}`,
      numeric,
    };
  }
  return { version: "development", firmwareString: `PX4 development (build ${value})`, numeric };
}

export interface UlogMetaInput {
  info: ReadonlyMap<string, number | string | Uint8Array>;
  topics: readonly string[];
  t0us: number;
  lastUs: number;
  events: readonly LogEvent[];
}

export function buildUlogMeta(input: UlogMetaInput): LogMeta {
  const release = input.info.get("ver_sw_release");
  const parsed = typeof release === "number" && release > 0
    ? formatVersion(release)
    : { version: "unknown", firmwareString: "", numeric: 0 };
  const sysName = input.info.get("sys_name");
  const hw = input.info.get("ver_hw");
  const durationSec = input.lastUs > input.t0us ? (input.lastUs - input.t0us) / 1e6 : 0;
  return {
    platform: "px4",
    vehicleKind: vehicleKindFromTopics(input.topics),
    vehicle: typeof sysName === "string" && sysName.length > 0 ? sysName : "PX4",
    firmwareVersion: parsed.version,
    firmwareString: parsed.firmwareString,
    versionNumeric: parsed.numeric,
    board: typeof hw === "string" && hw.length > 0 ? hw : undefined,
    durationSec,
    armed: input.events.some((e) => e.kind === "arm" || e.kind === "disarm"),
  };
}

/**
 * `actuator_armed` 的 0→1 / 1→0 跳变 → arm/disarm 事件。
 * PX4 没有 DataFlash 的 `ARM` 消息，这是唯一自描述的解锁来源（缺它就不产出事件，不猜）。
 */
export function armEventsFrom(
  timeSec: Float64Array | null,
  armed: Float64Array | null,
): LogEvent[] {
  if (!timeSec || !armed) return [];
  const events: LogEvent[] = [];
  let previous = armed.length > 0 ? (armed[0] !== 0 ? 1 : 0) : 0;
  for (let i = 1; i < armed.length; i += 1) {
    const current = armed[i] !== 0 ? 1 : 0;
    if (current !== previous) {
      events.push({
        tSec: timeSec[i],
        kind: current === 1 ? "arm" : "disarm",
        label: current === 1 ? "解锁（ARM）" : "上锁（DISARM）",
      });
      previous = current;
    }
  }
  return events;
}
