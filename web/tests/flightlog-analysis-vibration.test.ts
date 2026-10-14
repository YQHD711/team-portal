/**
 * 振动规则（ruleId: vibration_level）测试。
 * 正向对照来自 6 份真实日志的实测标定：健康机 std 0.68~3.31 / clip 恒 0；
 * 故障机 clip 增量 62~192。只用 std 会漏掉偶发冲击，只用 clip 会漏掉持续振动。
 */

import { describe, expect, it } from "vitest";
import { makeDoc, makeSeries, healthyVibe, noise, constant, uniformTime } from "./helpers/flightlogFixture";
import { RULE_DT, RULE_N, findingsFor, scenario, vibeWithClipDelta } from "./helpers/flightlogScenario";

describe("振动规则", () => {
  it("健康信号判通过（负向对照）", () => {
    const [f] = findingsFor(scenario(healthyVibe(RULE_N, RULE_DT)), "vibration_level");
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.metrics.clipDelta).toBe(0);
  });

  it("clip 计数增量 > 0 判严重（即使标准差正常）", () => {
    const [f] = findingsFor(scenario(vibeWithClipDelta(62)), "vibration_level");
    expect(f.severity).toBe("critical");
    expect(f.status).toBe("fired");
    expect(f.phenomenon).toContain("饱和");
  });

  it("标准差超 30 判严重（即使 clip 为 0）", () => {
    const series = [
      makeSeries("VIBE", 0, uniformTime(RULE_N, RULE_DT), {
        VibeX: noise(RULE_N, 25, 1),
        VibeY: noise(RULE_N, 30, 2),
        VibeZ: noise(RULE_N, 75, 3), // std ≈ 43
        Clip: constant(RULE_N, 0),
      }),
    ];
    const [f] = findingsFor(scenario(series), "vibration_level");
    expect(f.severity).toBe("critical");
  });

  it("标准差 15~30 判警告", () => {
    const series = [
      makeSeries("VIBE", 0, uniformTime(RULE_N, RULE_DT), {
        VibeX: noise(RULE_N, 25, 1),
        VibeY: noise(RULE_N, 30, 2),
        VibeZ: noise(RULE_N, 75, 3),
        Clip: constant(RULE_N, 0),
      }),
      makeSeries("VIBE", 1, uniformTime(RULE_N, RULE_DT), {
        VibeX: noise(RULE_N, 20, 4),
        VibeY: noise(RULE_N, 30, 5), // std ≈ 17.3 → 警告
        VibeZ: noise(RULE_N, 20, 6),
        Clip: constant(RULE_N, 0),
      }),
    ];
    const imu1 = findingsFor(scenario(series), "vibration_level").find((f) =>
      f.title.includes("IMU1"),
    );
    expect(imu1?.severity).toBe("warning");
  });

  it("负向对照：缺 VIBE 消息时必须是 unknown，不能是 passed", () => {
    const doc = makeDoc({ series: [], durationSec: RULE_N * RULE_DT });
    const [f] = findingsFor(doc, "vibration_level");
    expect(f.status).toBe("missing_required");
    expect(f.severity).toBe("unknown");
    expect(f.note).toContain("VIBE");
    expect(f.status).not.toBe("passed");
  });

  it("负向对照：VIBE 样本不足时判无法判断，不能是 passed", () => {
    const [f] = findingsFor(scenario(healthyVibe(10, RULE_DT)), "vibration_level");
    expect(f.status).toBe("insufficient_data");
    expect(f.severity).toBe("unknown");
  });
});
