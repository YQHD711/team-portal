/**
 * 速率环跟踪质量（ruleId: pid_rate_tracking）测试。
 *
 * 关键纪律：**悬停时必须判"无法判断"**。实测 quad 本次飞行 roll 指令 RMS 仅 3.2 °/s，
 * 此时 Err/Tar 天然 > 1；若不设激励门槛，规则会对健康日志误报。
 * 单位：Copter 原生 rad/s、Plane 原生 deg/s（相差 57 倍），门槛统一按 deg/s 判定。
 */

import { describe, expect, it } from "vitest";
import { findingsFor, pidScenario } from "./helpers/flightlogScenario";

describe("速率环跟踪质量规则", () => {
  it("跟踪偏差大时触发警告（Err/Tar ≈ 0.6）", () => {
    const found = findingsFor(pidScenario(70, 42, "plane"), "pid_rate_tracking");
    expect(found).toHaveLength(3);
    expect(found[0].severity).toBe("warning");
    expect(found[0].status).toBe("fired");
    expect(found[0].suggestions.length).toBeGreaterThan(0);
  });

  it("误差达到指令量级时判严重（Err/Tar ≈ 1.29）", () => {
    const [f] = findingsFor(pidScenario(70, 90, "plane"), "pid_rate_tracking");
    expect(f.severity).toBe("critical");
  });

  it("触发时给出按官方顺序的参数建议与复飞验证指标", () => {
    const [f] = findingsFor(pidScenario(70, 90, "plane"), "pid_rate_tracking");
    expect(f.suggestions.some((s) => s.param?.name === "ATC_RAT_RLL_P")).toBe(true);
    expect(f.suggestions.some((s) => (s.verify ?? "").includes("RMS"))).toBe(true);
  });

  it("悬停（激励不足）时判无法判断，且明确说明不等于通过", () => {
    const found = findingsFor(pidScenario(0.08, 0.05, "copter"), "pid_rate_tracking");
    expect(found[0].status).toBe("insufficient_data");
    expect(found[0].severity).toBe("unknown");
    expect(found[0].note).toContain("门槛");
    expect(found[0].note).toContain("不代表通过");
  });
});
