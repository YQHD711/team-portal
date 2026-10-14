/**
 * 引擎门控与汇总测试。
 *
 * 门控是引擎最容易被做错的地方：平台/版本不匹配必须显式判"不适用"（附原因），
 * 缺必需消息必须判"缺数据"，规则抛异常必须兜底而不是拖垮整份报告。
 */

import { describe, expect, it } from "vitest";
import { analyzeLog, sortFindings, summarize } from "@/lib/flightlog/analysis/engine";
import type { Rule } from "@/lib/flightlog/types/rule";
import type { Severity } from "@/lib/flightlog/types/report";
import { healthyVibe } from "./helpers/flightlogFixture";
import {
  RULE_DT,
  RULE_N,
  px4Scenario,
  scenario,
  vibeWithClipDelta,
} from "./helpers/flightlogScenario";

describe("引擎门控与汇总", () => {
  it("PX4 日志：ArduPilot 规则全部判不适用（架构位保留，本切片未实现 PX4 规则）", () => {
    const report = analyzeLog(px4Scenario());
    expect(report.findings).toHaveLength(3);
    expect(report.findings.every((f) => f.status === "not_applicable")).toBe(true);
    expect(report.summary.unknown).toBe(3);
    expect(report.summary.passed).toBe(0);
    expect(report.findings.every((f) => (f.note ?? "").length > 0)).toBe(true);
  });

  it("结论按严重程度排序，且统计数与条数一致", () => {
    const doc = scenario(vibeWithClipDelta(62), { params: { INS_HNTCH_ENABLE: 0 } });
    const report = analyzeLog(doc);
    const order: Severity[] = report.findings.map((f) => f.severity);
    const rank = { critical: 0, warning: 1, unknown: 2, ok: 3 };
    for (let i = 1; i < order.length; i++) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]]);
    }
    const counted =
      report.summary.critical +
      report.summary.warning +
      report.summary.passed +
      report.summary.unknown;
    expect(counted).toBe(report.findings.length);
    expect(report.summary.critical).toBeGreaterThan(0);
  });

  it("规则抛异常时兜底为无法判断，不拖垮整份报告", () => {
    const exploding: Rule = {
      id: "exploding_rule",
      title: "会抛异常的规则",
      category: "vibration",
      appliesTo: [{ platform: "ardupilot", requires: [] }],
      run() {
        throw new Error("模拟规则崩溃");
      },
    };
    const report = analyzeLog(scenario(healthyVibe(RULE_N, RULE_DT)), {
      rules: [exploding],
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].status).toBe("insufficient_data");
    expect(report.findings[0].severity).toBe("unknown");
    expect(report.findings[0].note).toContain("模拟规则崩溃");
  });

  it("sortFindings 稳定：同级保持原顺序；summarize 与条数一致", () => {
    const doc = scenario(healthyVibe(RULE_N, RULE_DT));
    const report = analyzeLog(doc);
    expect(sortFindings(report.findings).map((f) => f.ruleId)).toEqual(
      report.findings.map((f) => f.ruleId),
    );
    expect(summarize(report.findings).passed).toBeGreaterThan(0);
  });
});
