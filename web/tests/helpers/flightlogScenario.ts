/**
 * 规则测试的**场景夹具**。
 *
 * 与 `flightlogFixture.ts` 分工：那边只负责"造数据"（时间轴、噪声、Series、Doc），
 * 这边负责"造场景"（健康机 / 带 clip 的故障机 / 悬停 / 激励充足的固定翼），
 * 让每个规则的测试文件保持短小、只关心断言。
 */

import { analyzeLog } from "@/lib/flightlog/analysis/engine";
import type {
  LogDocument,
  Platform,
  Series,
  VehicleKind,
} from "@/lib/flightlog/types/log";
import type { Finding } from "@/lib/flightlog/types/report";
import {
  constant,
  healthyVibe,
  makeDoc,
  makeSeries,
  sineWave,
  uniformTime,
  type DocInit,
} from "./flightlogFixture";

/** 10 Hz 记录率（与 ArduPilot 的 PID/VIBE 实测记录率一致） */
export const RULE_DT = 0.1;
export const RULE_N = 600;
const DURATION = RULE_N * RULE_DT;

export function findingsFor(doc: LogDocument, ruleId: string): Finding[] {
  return analyzeLog(doc).findings.filter((f) => f.ruleId === ruleId);
}

export function scenario(series: readonly Series[], extra: DocInit = {}): LogDocument {
  return makeDoc({ series, durationSec: DURATION, ...extra });
}

/** 健康 VIBE，但 clip 计数在末尾跳到 `value`（模拟加速度计饱和） */
export function vibeWithClipDelta(
  value: number,
  count = RULE_N,
): Series[] {
  return healthyVibe(count, RULE_DT).map((s) =>
    makeSeries("VIBE", s.instance, uniformTime(count, RULE_DT), {
      VibeX: Array.from(s.fields.VibeX),
      VibeY: Array.from(s.fields.VibeY),
      VibeZ: Array.from(s.fields.VibeZ),
      Clip: [...constant(count - 1, 0), value],
    }),
  );
}

/** 把序列整体后移 lag 个采样（前面补 0）——用来造"实际滞后于指令"的真实情形 */
function delayed(values: readonly number[], lag: number): number[] {
  const out = new Array<number>(values.length).fill(0);
  for (let i = lag; i < values.length; i += 1) out[i] = values[i - lag];
  return out;
}

/** 三个速率轴的 PID 消息；Err 用不同频率，避免与 Tar 混叠；`lagSamples>0` 时 Act 滞后于 Tar */
export function pidMessages(
  tarAmplitude: number,
  errAmplitude: number,
  count = RULE_N,
  lagSamples = 0,
): Series[] {
  const time = uniformTime(count, RULE_DT);
  return ["PIDR", "PIDP", "PIDY"].map((name) => {
    const tar = sineWave(count, RULE_DT, 0.5, tarAmplitude);
    return makeSeries(
      name,
      0,
      time,
      {
        Tar: tar,
        Act: lagSamples > 0 ? delayed(tar, lagSamples) : sineWave(count, RULE_DT, 0.5, tarAmplitude),
        Err: sineWave(count, RULE_DT, 2.5, errAmplitude),
        P: constant(count, 1),
        I: constant(count, 0),
        D: constant(count, 0),
      },
      { Tar: "rad/s", Act: "rad/s", Err: "rad/s" },
    );
  });
}

export function pidScenario(
  tarAmplitude: number,
  errAmplitude: number,
  vehicleKind: VehicleKind,
  extra: DocInit = {},
): LogDocument {
  return makeDoc({
    vehicleKind,
    series: pidMessages(tarAmplitude, errAmplitude),
    durationSec: DURATION,
    ...extra,
  });
}

export function px4Scenario(extra: DocInit = {}): LogDocument {
  return makeDoc({
    platform: "px4" as Platform,
    vehicle: "PX4",
    vehicleKind: "px4-multirotor",
    firmwareVersion: "1.14.3",
    versionNumeric: 11403,
    series: healthyVibe(RULE_N, RULE_DT),
    durationSec: DURATION,
    ...extra,
  });
}
