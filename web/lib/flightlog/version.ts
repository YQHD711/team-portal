/**
 * 固件版本解析 —— 规则 applies_to 的判定基础。
 *
 * 数值版本编码（全项目唯一口径）：major*10000 + minor*100 + patch
 *   4.6.2 → 40602    4.1.0 → 40100    3.6.11 → 30611
 * 首位主版本号可以 >9（如 10.x），编码仍然单调递增，安全。
 */

import type { VehicleKind } from "./types/log";

export interface ParsedVersion {
  /** 规范化后的点分版本字符串，如 "4.6.2" */
  version: string;
  numeric: number;
}

export function encodeVersion(
  major: number,
  minor: number,
  patch: number,
): number {
  return major * 10000 + minor * 100 + patch;
}

/** 解析 "4.6.2" / "v4.6.2" / "4.6" / "4.6.2-rc1"；失败返回 null */
export function parseVersion(text: string): ParsedVersion | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] === undefined ? 0 : Number(m[3]);
  return {
    version: `${major}.${minor}.${patch}`,
    numeric: encodeVersion(major, minor, patch),
  };
}

export interface ArduPilotBanner {
  vehicle: string;
  kind: VehicleKind;
  version: string;
  numeric: number;
}

const ARDUPILOT_VEHICLES: readonly [string, VehicleKind][] = [
  ["ArduCopter", "copter"],
  ["ArduPlane", "plane"],
  ["ArduRover", "rover"],
  ["ArduSub", "sub"],
  ["AntennaTracker", "tracker"],
  ["Blimp", "blimp"],
];

/**
 * 解析 ArduPilot 版本横幅。
 * 实机样例（quad_20260617.bin 的 MSG/VER 字段）：
 *   "ArduCopter V4.6.2 (1ebd4d99)"
 */
export function parseArduPilotBanner(banner: string): ArduPilotBanner | null {
  const found = ARDUPILOT_VEHICLES.find(([name]) => banner.includes(name));
  if (!found) return null;
  const parsed = parseVersion(banner);
  if (!parsed) return null;
  return {
    vehicle: found[0],
    kind: found[1],
    version: parsed.version,
    numeric: parsed.numeric,
  };
}

/** PX4 横幅样例： "PX4 Autopilot v1.14.3" / "PX4-Autopilot 1.14.3" */
export function parsePx4Banner(
  banner: string,
  fixedWing = false,
): ArduPilotBanner | null {
  if (!/PX4/i.test(banner)) return null;
  const parsed = parseVersion(banner);
  if (!parsed) return null;
  return {
    vehicle: "PX4",
    kind: fixedWing ? "px4-fixedwing" : "px4-multirotor",
    version: parsed.version,
    numeric: parsed.numeric,
  };
}

/** 供 UI 展示版本区间用，如 40100 → "4.1.0" */
export function describeNumeric(numeric: number): string {
  const major = Math.floor(numeric / 10000);
  const minor = Math.floor((numeric % 10000) / 100);
  const patch = numeric % 100;
  return `${major}.${minor}.${patch}`;
}
