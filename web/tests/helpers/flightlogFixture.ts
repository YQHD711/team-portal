/**
 * 诊断测试用的合成 LogDocument 构造器。
 *
 * 用途：规则引擎的正确性可以**脱离解析器**独立验证（合成信号 + 已知答案），
 * 而解析器的正确性由 pymavlink 黄金对照保证（见 flightlog-dataflash.test.ts）。
 * 两层分开测，避免互相掩盖。
 */

import type {
  LogDocument,
  LogEvent,
  LogMeta,
  Platform,
  Series,
  VehicleKind,
} from "../../lib/flightlog/types/log";

export function makeSeries(
  name: string,
  instance: number,
  timeSec: readonly number[],
  fields: Readonly<Record<string, readonly number[]>>,
  units: Readonly<Record<string, string>> = {},
): Series {
  const built: Record<string, Float64Array> = {};
  for (const [key, values] of Object.entries(fields)) {
    built[key] = Float64Array.from(values);
  }
  return {
    name,
    instance,
    timeSec: Float64Array.from(timeSec),
    fields: built,
    units,
  };
}

/** 均匀时间轴，单位秒 */
export function uniformTime(count: number, dtSec: number, startSec = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(startSec + i * dtSec);
  return out;
}

/** 确定性伪随机（LCG）——测试必须可复现，不能用 Math.random */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function sineWave(
  count: number,
  dtSec: number,
  freqHz: number,
  amplitude: number,
  offset = 0,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(offset + amplitude * Math.sin(2 * Math.PI * freqHz * i * dtSec));
  }
  return out;
}

export function noise(count: number, scale: number, seed = 12345): number[] {
  const rand = lcg(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((rand() - 0.5) * 2 * scale);
  return out;
}

export function constant(count: number, value: number): number[] {
  return new Array<number>(count).fill(value);
}

export interface DocInit {
  platform?: Platform;
  vehicleKind?: VehicleKind;
  vehicle?: string;
  firmwareVersion?: string;
  versionNumeric?: number;
  durationSec?: number;
  series?: readonly Series[];
  params?: Readonly<Record<string, number>>;
  events?: readonly LogEvent[];
  messageCounts?: Readonly<Record<string, number>>;
}

export function makeDoc(init: DocInit = {}): LogDocument {
  const series: Record<string, Series> = {};
  const messageCounts: Record<string, number> = { ...init.messageCounts };
  const decodedFields: Record<string, string[]> = {};
  for (const s of init.series ?? []) {
    series[`${s.name}:${s.instance}`] = s;
    messageCounts[s.name] = (messageCounts[s.name] ?? 0) + s.timeSec.length;
    decodedFields[s.name] = Object.keys(s.fields);
  }
  const durationSec =
    init.durationSec ??
    (init.series ?? []).reduce(
      (m, s) => (s.timeSec.length > 0 ? Math.max(m, s.timeSec[s.timeSec.length - 1]) : m),
      0,
    );
  const meta: LogMeta = {
    platform: init.platform ?? "ardupilot",
    vehicleKind: init.vehicleKind ?? "copter",
    vehicle: init.vehicle ?? "ArduCopter",
    firmwareVersion: init.firmwareVersion ?? "4.6.2",
    firmwareString: `${init.vehicle ?? "ArduCopter"} V${init.firmwareVersion ?? "4.6.2"}`,
    versionNumeric: init.versionNumeric ?? 40602,
    durationSec,
    armed: true,
  };
  const events =
    init.events ??
    (durationSec > 0
      ? [
          { tSec: 0, kind: "arm" as const, label: "ARMED", code: 10 },
          { tSec: durationSec, kind: "disarm" as const, label: "DISARMED", code: 11 },
        ]
      : []);
  return {
    meta,
    series,
    events,
    params: init.params ?? {},
    messageCounts,
    decodedFields,
    warnings: [],
  };
}

/** 一份"健康"VIBE 序列：std ≈ 3、无 clip */
export function healthyVibe(
  count: number,
  dtSec: number,
  instances: readonly number[] = [0],
): Series[] {
  return instances.map((instance) =>
    makeSeries(
      "VIBE",
      instance,
      uniformTime(count, dtSec),
      {
        VibeX: noise(count, 5, 11 + instance),
        VibeY: noise(count, 8, 22 + instance),
        VibeZ: noise(count, 9, 33 + instance),
        Clip: constant(count, 0),
      },
      { VibeX: "m/s/s", VibeY: "m/s/s", VibeZ: "m/s/s", Clip: "" },
    ),
  );
}
