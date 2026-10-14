/**
 * 全链路集成验证：**真实 9.8 MB 日志** → TS 解析器 → 规则引擎。
 *
 * 为什么还要这一层：切片黄金对照只证明"解析器与 pymavlink 在 200 KB 上一致"，
 * 而本文件做的是**两条独立管线在同一份全量日志上的数值交叉验证**——
 *   管线 A：Python + pymavlink（标定用，见 docs/日志诊断-接口契约.md §1.5）
 *   管线 B：TS 解析器 + 规则引擎（生产路径）
 * 期望值全部是管线 A 实测出来的常量，不是"看起来合理"的估计值。
 *
 * CI 上没有 testdata 目录 → 整组跳过（`existsSync` 门控），
 * 提交的门禁只依赖仓库内的 200 KB 切片。
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDataflash } from "@/lib/flightlog/dataflash";
import { analyzeLog } from "@/lib/flightlog/analysis/engine";
import type { LogDocument, Series } from "@/lib/flightlog/types/log";

const FULL_BIN = "G:/ardupilot_log_analysis/WebTools/testdata/quad_20260617.bin";
const HAS_FULL_BIN = existsSync(FULL_BIN);

const skip = !HAS_FULL_BIN;

/** 管线 A（pymavlink）实测值：全日志口径、总体标准差（psetdev）与 RMS */
const PYMAVLINK = {
  records: 229_590,
  durationSec: 362.1,
  messageCounts: { VIBE: 9822, PIDR: 3274, IMU: 24_561, FTN2: 9822, PIDY: 3274 },
  /** VIBE 各 IMU 的 X/Y/Z 总体标准差（m/s²） */
  vibeStd: {
    0: [1.96, 2.75, 3.08],
    1: [1.92, 2.74, 3.31],
    2: [1.76, 1.99, 2.89],
  },
  /** PIDx 的 Tar / Err RMS（控制器原生单位 rad/s） */
  pidRms: {
    PIDR: [0.056, 0.069],
    PIDP: [0.058, 0.067],
    PIDY: [0.273, 0.06],
  },
} as const;

function mean(values: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function pstdev(values: Float64Array): number {
  const m = mean(values);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

function rms(values: Float64Array): number {
  let acc = 0;
  for (let i = 0; i < values.length; i++) acc += values[i] * values[i];
  return Math.sqrt(acc / values.length);
}

// ⚠️ 必须惰性加载：`describe.skipIf` 的**回调仍会在收集阶段执行**，
// 若在读文件写在 describe 体内，CI（没有 testdata）会直接在收集阶段 ENOENT 报错，
// 门禁变成红的 —— 这正是"跳过测试"最容易踩的坑。
let cached: { doc: LogDocument; records: number } | null = null;

function load(): { doc: LogDocument; records: number } {
  if (!cached) {
    const bytes = new Uint8Array(readFileSync(FULL_BIN));
    const parsed = parseDataflash(bytes);
    cached = { doc: parsed.doc, records: parsed.stats.records };
  }
  return cached;
}

function series(doc: LogDocument, name: string, instance: number): Series {
  const s = doc.series[`${name}:${instance}`];
  if (!s) throw new Error(`缺少 ${name}:${instance}`);
  return s;
}

describe.skipIf(skip)("真实 9.8 MB 日志：TS 管线必须与 pymavlink 数值一致", () => {
  it("解析聚合量：记录数与关键消息条数与 pymavlink 完全相等", () => {
    const { doc, records } = load();
    expect(records).toBe(PYMAVLINK.records);
    for (const [name, count] of Object.entries(PYMAVLINK.messageCounts)) {
      expect(`${name}=${doc.messageCounts[name]}`).toBe(`${name}=${count}`);
    }
    expect(doc.meta.durationSec).toBeCloseTo(PYMAVLINK.durationSec, 0);
  });

  it("meta：机型/机型类别/固件版本/数值版本正确（规则靠它换速率单位）", () => {
    const { doc } = load();
    expect(doc.meta.vehicle).toBe("ArduCopter");
    expect(doc.meta.vehicleKind).toBe("copter");
    expect(doc.meta.firmwareVersion).toBe("4.6.2");
    expect(doc.meta.versionNumeric).toBe(40602);
    expect(doc.meta.armed).toBe(true);
  });

  it("数值交叉验证：VIBE 三个 IMU 的 X/Y/Z 标准差与 pymavlink 一致", () => {
    const { doc } = load();
    for (const instance of [0, 1, 2]) {
      const s = series(doc, "VIBE", instance);
      const actual = ["VibeX", "VibeY", "VibeZ"].map((f) =>
        pstdev(s.fields[f]),
      );
      const expected = PYMAVLINK.vibeStd[instance as 0 | 1 | 2];
      actual.forEach((value, axis) => {
        expect(
          Math.abs(value - expected[axis]),
          `IMU${instance} 轴${axis}: TS=${value.toFixed(3)} pymavlink=${expected[axis]}`,
        ).toBeLessThan(0.01);
      });
    }
  });

  it("数值交叉验证：PIDx 的 Tar/Err RMS 与 pymavlink 一致", () => {
    const { doc } = load();
    for (const [message, [tarExpected, errExpected]] of Object.entries(
      PYMAVLINK.pidRms,
    )) {
      const s = series(doc, message, 0);
      const tar = rms(s.fields.Tar);
      const err = rms(s.fields.Err);
      expect(Math.abs(tar - tarExpected), `${message} Tar: ${tar}`).toBeLessThan(0.002);
      expect(Math.abs(err - errExpected), `${message} Err: ${err}`).toBeLessThan(0.002);
    }
  });

  it("引擎结论：健康悬停日志不得出现严重/警告，PID 因激励不足不判定", () => {
    const report = analyzeLog(load().doc);
    expect(report.summary.critical).toBe(0);
    expect(report.summary.warning).toBe(0);

    const vibe = report.findings.filter((f) => f.ruleId === "vibration_level");
    expect(vibe).toHaveLength(3);
    expect(vibe.every((f) => f.status === "passed")).toBe(true);
    expect(vibe.every((f) => f.metrics.clipDelta === 0)).toBe(true);

    const pid = report.findings.filter((f) => f.ruleId === "pid_rate_tracking");
    for (const axis of ["roll", "pitch"] as const) {
      const f = pid.find((x) => x.axis === axis);
      expect(f?.status).toBe("insufficient_data");
      expect(f?.severity).toBe("unknown");
    }
    expect(pid.find((f) => f.axis === "yaw")?.status).toBe("passed");

    const filter = report.findings.filter((f) => f.ruleId === "filter_notch");
    expect(filter).toHaveLength(1);
    expect(filter[0].status).toBe("passed");
  });
});
