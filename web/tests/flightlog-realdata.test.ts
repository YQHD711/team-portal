/**
 * 真实日志端到端验证（**可选启用**）。
 *
 * 为什么单独一个文件：解析器正确性用 pymavlink 黄金对照（flightlog-dataflash.test.ts）验证，
 * 而"规则在真实数据上的结论是否符合标定预期"是另一件事——本文件用真实日志导出的
 * LogDocument JSON 直接驱动引擎，绕开解析器，验证判定本身。
 *
 * 启用方式：
 *   1) 用 tools/flightlog_dump_real.py 从真实 .bin 导出 JSON：
 *        python tools/flightlog_dump_real.py <out-dir>
 *   2) 设环境变量后运行：
 *        $env:FLIGHTLOG_REAL_DIR="<out-dir>"; npx vitest run tests/flightlog-realdata.test.ts
 *
 * 未设环境变量时整组跳过（不会让 CI 依赖本机日志）。
 * 期望值来自 docs/日志诊断-接口契约.md §1.5 的实测标定表。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeLog } from "@/lib/flightlog/analysis/engine";
import type { LogDocument, Series } from "@/lib/flightlog/types/log";
import type { DiagnosisReport } from "@/lib/flightlog/types/report";

const REAL_DIR = process.env.FLIGHTLOG_REAL_DIR;

interface RawSeries {
  name: string;
  instance: number;
  timeSec: number[];
  fields: Record<string, number[]>;
  units: Record<string, string>;
}

interface RawDoc {
  meta: LogDocument["meta"];
  series: Record<string, RawSeries>;
  events: LogDocument["events"];
  params: Record<string, number>;
  messageCounts: Record<string, number>;
  decodedFields: Record<string, string[]>;
  warnings: string[];
}

function load(name: string): DiagnosisReport {
  const raw = JSON.parse(
    readFileSync(join(REAL_DIR as string, `${name}.json`), "utf8"),
  ) as RawDoc;
  const series: Record<string, Series> = {};
  for (const [key, s] of Object.entries(raw.series)) {
    const fields: Record<string, Float64Array> = {};
    for (const [f, v] of Object.entries(s.fields)) fields[f] = Float64Array.from(v);
    series[key] = {
      name: s.name,
      instance: s.instance,
      timeSec: Float64Array.from(s.timeSec),
      fields,
      units: s.units ?? {},
    };
  }
  const doc: LogDocument = {
    meta: raw.meta,
    series,
    events: raw.events,
    params: raw.params,
    messageCounts: raw.messageCounts,
    decodedFields: raw.decodedFields,
    warnings: raw.warnings,
  };
  return analyzeLog(doc);
}

function byRule(report: DiagnosisReport, ruleId: string) {
  return report.findings.filter((f) => f.ruleId === ruleId);
}

const enabled = REAL_DIR !== undefined && REAL_DIR !== "";

describe.skipIf(!enabled)("真实日志：诊断结论必须与实测标定一致", () => {
  it("quad_20260617（健康悬停）：无严重/警告，振动通过，PID 因激励不足不判定", () => {
    const report = load("quad");
    expect(report.meta.firmwareVersion).toBe("4.6.2");
    expect(report.summary.critical).toBe(0);
    expect(report.summary.warning).toBe(0);

    const vibe = byRule(report, "vibration_level");
    expect(vibe).toHaveLength(3);
    expect(vibe.every((f) => f.status === "passed")).toBe(true);
    expect(Math.max(...vibe.map((f) => f.metrics.vibrationWorstStd ?? 0))).toBeLessThan(15);

    const pid = byRule(report, "pid_rate_tracking");
    const roll = pid.find((f) => f.axis === "roll");
    const yaw = pid.find((f) => f.axis === "yaw");
    expect(roll?.status).toBe("insufficient_data");
    expect(roll?.severity).toBe("unknown");
    expect(yaw?.status).toBe("passed");

    expect(byRule(report, "filter_notch")[0].status).toBe("passed");
  });

  it("fr_batch_0713（振动超标）：必须判严重，且陷波规则触发", () => {
    const report = load("fr_batch");
    expect(report.summary.critical).toBeGreaterThan(0);
    const vibe = byRule(report, "vibration_level");
    expect(vibe.some((f) => f.severity === "critical")).toBe(true);
    expect(
      vibe.some((f) => (f.metrics.clipDelta ?? 0) > 0),
    ).toBe(true);
    const filter = byRule(report, "filter_notch")[0];
    expect(filter.status).toBe("fired");
    expect(filter.suggestions.some((s) => s.param?.name === "INS_HNTCH_ENABLE")).toBe(true);
  });

  it("flight_20260527（Plane，clip 73/112）：两个 IMU 都判严重，但 PID 跟踪正常", () => {
    const report = load("f0527");
    const vibe = byRule(report, "vibration_level");
    expect(vibe.filter((f) => f.severity === "critical").length).toBeGreaterThanOrEqual(2);
    const pid = byRule(report, "pid_rate_tracking");
    expect(pid.every((f) => f.status === "passed")).toBe(true);
  });

  it("user_0509（Plane，clip 165/192）：振动严重；roll/pitch 跟踪正常，yaw 因激励不足不判定", () => {
    const report = load("user0509");
    const vibe = byRule(report, "vibration_level");
    expect(vibe.filter((f) => f.severity === "critical").length).toBeGreaterThanOrEqual(2);

    const pid = byRule(report, "pid_rate_tracking");
    // arm 窗口只有 125 点（12.5 s），说明"只统计飞行段"确实生效
    expect(pid.find((f) => f.axis === "roll")?.status).toBe("passed");
    expect(pid.find((f) => f.axis === "pitch")?.status).toBe("passed");
    // 固定翼协调转弯时 yaw 指令本来就小（实测 9.78 °/s < 门槛 10），
    // 此时必须报"无法判断"而不是硬判通过或误判为跟踪失败
    const yaw = pid.find((f) => f.axis === "yaw");
    expect(yaw?.status).toBe("insufficient_data");
    expect(yaw?.severity).toBe("unknown");
    expect(yaw?.note).toContain("不代表通过");
  });

  it("任何日志都不允许把 unknown 结论算成通过", () => {
    for (const name of ["quad", "fr_batch", "f0527", "user0509"]) {
      const report = load(name);
      for (const f of report.findings) {
        if (f.status !== "passed") {
          // 未通过的一律不能带 ok 等级；否则 UI 会把"无法判断"显示成"通过"
          expect(f.severity).not.toBe("ok");
        }
      }
      expect(
        report.summary.passed + report.summary.critical + report.summary.warning + report.summary.unknown,
      ).toBe(report.findings.length);
    }
  });
});
