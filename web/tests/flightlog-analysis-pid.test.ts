/**
 * 速率环跟踪质量（ruleId: pid_rate_tracking）测试。
 *
 * 关键纪律：**悬停时必须判"无法判断"**（实测 quad 本次飞行 roll 指令 RMS 仅 3.2 °/s）。
 * 单位：Copter 原生 rad/s、Plane 原生 deg/s（相差 57 倍），门槛统一按 deg/s 判定。
 *
 * ⚠️ 两个线上真实事故的回归都在这里：
 *  ① 固定翼没有 yaw **速率**环 → 适用性必须按轴判断（曾经的 `requires:["PIDY"]` 把整条规则废掉）；
 *  ② **参数名与 FF 量级都按机型区分**（task-36）：固定翼是 `RLL_RATE_*`/`PTCH_RATE_*`
 *     （不是 RLL2SRV、更不是 ATC_RAT_*），且 FF/P≈4.31 → "FF ≤ 0.6×P"这类绝对上限只对 Copter 成立。
 */

import { describe, expect, it } from "vitest";
import { analyzeLog } from "@/lib/flightlog/analysis/engine";
import { findingsFor, pidMessages, pidScenario } from "./helpers/flightlogScenario";
import { makeDoc } from "./helpers/flightlogFixture";

const RULE_DT = 0.1;
const RULE_N = 600;

/** 真实 ArduPlane 4.6.1 实测参数（FF=0.345 / P=0.08；没有任何 ATC_RAT_*） */
const PLANE_PARAMS = {
  RLL_RATE_P: 0.08, RLL_RATE_I: 0.01, RLL_RATE_D: 0, RLL_RATE_FF: 0.345, RLL_RATE_D_FF: 0,
  PTCH_RATE_P: 0.11, PTCH_RATE_I: 0.1, PTCH_RATE_D: 0.03, PTCH_RATE_FF: 0.345, PTCH_RATE_D_FF: 0,
  RLL2SRV_TCONST: 0.5, RLL2SRV_RMAX: 180, YAW_RATE_ENABLE: 0,
} as const;

/** 真实 Copter 实测参数（语料 66/66 份 FF=0） */
const COPTER_PARAMS = {
  ATC_RAT_RLL_P: 0.15, ATC_RAT_RLL_I: 0.15, ATC_RAT_RLL_D: 0.0038, ATC_RAT_RLL_FF: 0, ATC_RAT_RLL_D_FF: 0,
  ATC_RAT_PIT_P: 0.15, ATC_RAT_PIT_I: 0.15, ATC_RAT_PIT_D: 0.0038, ATC_RAT_PIT_FF: 0,
  ATC_RAT_YAW_P: 0.2, ATC_RAT_YAW_I: 0.02, ATC_RAT_YAW_D: 0, ATC_RAT_YAW_FF: 0,
} as const;

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
    params: PLANE_PARAMS,
  });
}

const paramNames = (f: { suggestions: readonly { param: { name: string } | null }[] }): string[] =>
  f.suggestions.map((s) => s.param?.name).filter((n): n is string => typeof n === "string");

describe("速率环跟踪质量规则", () => {
  it("跟踪偏差大时触发警告（Err/Tar ≈ 0.6）", () => {
    const found = findingsFor(pidScenario(70, 42, "plane", { params: PLANE_PARAMS }), "pid_rate_tracking");
    expect(found).toHaveLength(3);
    expect(found[0].severity).toBe("warning");
    expect(found[0].status).toBe("fired");
    expect(found[0].suggestions.length).toBeGreaterThan(0);
  });

  it("误差达到指令量级时判严重（Err/Tar ≈ 1.29）", () => {
    const [f] = findingsFor(pidScenario(70, 90, "plane", { params: PLANE_PARAMS }), "pid_rate_tracking");
    expect(f.severity).toBe("critical");
  });

  it("⚠️ 固定翼参数名必须是 RLL_RATE_*/PTCH_RATE_*（不是 RLL2SRV，更不是 ATC_RAT_*）", () => {
    const [f] = findingsFor(pidScenario(70, 90, "plane", { params: PLANE_PARAMS }), "pid_rate_tracking");
    const names = paramNames(f);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.startsWith("RLL_RATE_") || n.startsWith("PTCH_RATE_"))).toBe(true);
    expect(names.some((n) => n.startsWith("RLL2SRV") || n.startsWith("ATC_RAT_"))).toBe(false);
    expect(f.suggestions.some((s) => (s.verify ?? "").includes("RMS"))).toBe(true);
  });

  /** 固定翼滞后主导场景：Act 滞后 Tar 2 个采样（真实速率环的相位滞后） */
  const planeLagging = () =>
    makeDoc({
      vehicleKind: "plane",
      vehicle: "ArduPlane",
      series: pidMessages(70, 90, RULE_N, 2),
      durationSec: RULE_N * RULE_DT,
      params: PLANE_PARAMS,
    });

  it("⚠️ 固定翼 FF 建议**不得低于当前值**（0.345）；定不出可靠上限时只给方向", () => {
    const [f] = findingsFor(planeLagging(), "pid_rate_tracking");
    const ff = f.suggestions.find((s) => s.param?.name.endsWith("_FF"));
    if (ff?.param) {
      expect(ff.param.to).toBeGreaterThanOrEqual(PLANE_PARAMS.RLL_RATE_FF);
      expect(ff.param.from).toBe(PLANE_PARAMS.RLL_RATE_FF);
    } else {
      // 只给方向时，必须把实测 FF/P 摆出来，让用户自己判断
      expect(f.suggestions.some((s) => s.text.includes("FF/P=4.31"))).toBe(true);
    }
    // 任何情况下都不允许出现"把 FF 改小"的建议
    expect(f.suggestions.some((s) => s.param?.name.endsWith("_FF") && s.param.to < PLANE_PARAMS.RLL_RATE_FF)).toBe(false);
  });

  it("⚠️ 固定翼 D 与 D_FF 都≈0 且滞后主导 → 点出未启用的 D 项前馈（不给数值）", () => {
    const [f] = findingsFor(planeLagging(), "pid_rate_tracking");
    expect(f.suggestions.some((s) => s.text.includes("D_FF"))).toBe(true);
  });

  it("Copter 用 ATC_RAT_*（参数名必须按机型映射）", () => {
    const series = pidMessages(0.6, 0.9).filter((s) => s.name !== "PIDY");
    const doc = makeDoc({ vehicleKind: "copter", series, durationSec: RULE_N * RULE_DT, params: COPTER_PARAMS });
    const roll = findingsFor(doc, "pid_rate_tracking").find((f) => f.axis === "roll");
    expect(paramNames(roll!).every((n) => n.startsWith("ATC_RAT_"))).toBe(true);
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
    expect(pid.find((f) => f.axis === "roll")?.status).toBe("fired");
    expect(pid.find((f) => f.axis === "pitch")?.status).toBe("fired");
    expect(pid.some((f) => f.note?.includes("PIDY") && f.status === "missing_required")).toBe(false);
  });

  it("⚠️ 回归：固定翼 yaw 轴判**不适用**（不是缺数据），并用参数存在性双重确认", () => {
    const yaw = findingsFor(planeWithoutYaw(), "pid_rate_tracking").find((f) => f.axis === "yaw");
    expect(yaw?.status).toBe("not_applicable");
    expect(yaw?.severity).toBe("unknown");
    expect(yaw?.note).toContain("yaw 速率控制器");
    expect(yaw?.note).toContain("YAW_RATE_ENABLE=0");
    expect(yaw?.status).not.toBe("passed");
  });

  it("对比：Copter 缺 PIDY 时仍算缺数据（它本该有 yaw 速率环）", () => {
    const series = pidMessages(0.5, 0.3).filter((s) => s.name !== "PIDY");
    const doc = makeDoc({ vehicleKind: "copter", series, durationSec: RULE_N * RULE_DT, params: COPTER_PARAMS });
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
