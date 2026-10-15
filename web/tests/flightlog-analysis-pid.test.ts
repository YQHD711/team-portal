/**
 * 速率环跟踪质量（ruleId: pid_rate_tracking）测试。
 *
 * 关键纪律：**悬停时必须判"无法判断"**。实测 quad 本次飞行 roll 指令 RMS 仅 3.2 °/s，
 * 此时 Err/Tar 天然 > 1；若不设激励门槛，规则会对健康日志误报。
 * 单位：Copter 原生 rad/s、Plane 原生 deg/s（相差 57 倍），门槛统一按 deg/s 判定。
 *
 * ⚠️ 线上真实事故的回归测试在最后：**固定翼没有 yaw 速率环**，
 * 曾经的 `requires: ["PIDR","PIDP","PIDY"]` 会把整条规则打成"缺少必需消息"，
 * 连 roll/pitch 的分析一起废掉。适用性必须**按轴判断**。
 */

import { describe, expect, it } from "vitest";
import { analyzeLog } from "@/lib/flightlog/analysis/engine";
import { findingsFor, pidMessages, pidScenario } from "./helpers/flightlogScenario";
import { makeDoc } from "./helpers/flightlogFixture";

const RULE_DT = 0.1;
const RULE_N = 600;

/** 平面机型、只有 roll/pitch 速率环（无 PIDY）—— 真实 ArduPlane 的样子 */
function planeWithoutYaw() {
  const series = pidMessages(70, 42).filter((s) => s.name !== "PIDY");
  return makeDoc({
    vehicleKind: "plane",
    vehicle: "ArduPlane",
    firmwareVersion: "4.6.1",
    versionNumeric: 40601,
    series,
    durationSec: RULE_N * RULE_DT,
  });
}

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

  it("触发时给出按机型的参数建议与复飞验证指标（固定翼用 RLL2SRV，不是 Copter 的 ATC_RAT_*）", () => {
    const [f] = findingsFor(pidScenario(70, 90, "plane"), "pid_rate_tracking");
    // 线上实测缺陷回归：曾写死 ATC_RAT_*，给固定翼推了不存在的参数
    expect(f.suggestions.some((s) => s.param?.name === "RLL2SRV_P")).toBe(true);
    expect(f.suggestions.some((s) => (s.param?.name ?? "").startsWith("ATC_RAT_"))).toBe(false);
    expect(f.suggestions.some((s) => (s.verify ?? "").includes("RMS"))).toBe(true);
  });

  it("Copter 用 ATC_RAT_*（参数名必须按机型映射）", () => {
    const series = pidMessages(0.6, 0.9).filter((s) => s.name !== "PIDY");
    const doc = makeDoc({ vehicleKind: "copter", series, durationSec: RULE_N * RULE_DT });
    const roll = findingsFor(doc, "pid_rate_tracking").find((f) => f.axis === "roll");
    expect(roll!.suggestions.some((s) => s.param?.name === "ATC_RAT_RLL_P")).toBe(true);
  });

  it("悬停（激励不足）时判无法判断，且明确说明不等于通过", () => {
    const found = findingsFor(pidScenario(0.08, 0.05, "copter"), "pid_rate_tracking");
    expect(found[0].status).toBe("insufficient_data");
    expect(found[0].severity).toBe("unknown");
    expect(found[0].note).toContain("门槛");
    expect(found[0].note).toContain("不代表通过");
  });

  it("⚠️ 回归：固定翼缺 PIDY 时，整条规则**不得**被打成缺少必需消息", () => {
    const report = analyzeLog(planeWithoutYaw());
    const pid = report.findings.filter((f) => f.ruleId === "pid_rate_tracking");
    // 关键：roll/pitch 必须真的被评估，而不是"缺少必需消息"
    expect(pid.find((f) => f.axis === "roll")?.status).toBe("fired");
    expect(pid.find((f) => f.axis === "pitch")?.status).toBe("fired");
    expect(pid.some((f) => f.note?.includes("PIDY") && f.status === "missing_required")).toBe(false);
  });

  it("⚠️ 回归：固定翼的 yaw 轴判**不适用**（不是缺数据），并说明原因", () => {
    const yaw = findingsFor(planeWithoutYaw(), "pid_rate_tracking").find((f) => f.axis === "yaw");
    expect(yaw?.status).toBe("not_applicable");
    expect(yaw?.severity).toBe("unknown");
    expect(yaw?.note).toContain("yaw 速率控制器");
    expect(yaw?.status).not.toBe("passed");
  });

  it("对比：Copter 缺 PIDY 时仍算缺数据（它本该有 yaw 速率环）", () => {
    const series = pidMessages(0.5, 0.3).filter((s) => s.name !== "PIDY");
    const doc = makeDoc({ vehicleKind: "copter", series, durationSec: RULE_N * RULE_DT });
    const yaw = findingsFor(doc, "pid_rate_tracking").find((f) => f.axis === "yaw");
    expect(yaw?.status).toBe("missing_required");
    expect(yaw?.note).toContain("PIDY");
  });

  it("Rover 同样没有 yaw 速率环 → 不适用", () => {
    const series = pidMessages(20, 3).filter((s) => s.name !== "PIDY");
    const doc = makeDoc({ vehicleKind: "rover", vehicle: "ArduRover", series, durationSec: RULE_N * RULE_DT });
    const yaw = findingsFor(doc, "pid_rate_tracking").find((f) => f.axis === "yaw");
    expect(yaw?.status).toBe("not_applicable");
  });
});
