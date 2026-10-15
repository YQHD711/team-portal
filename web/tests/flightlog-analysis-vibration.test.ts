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

  it("飞行中段 clip 增量 > 0 判严重（即使标准差正常；与降落段无关）", () => {
    const series = healthyVibe(RULE_N, RULE_DT).map((s) =>
      makeSeries("VIBE", s.instance, uniformTime(RULE_N, RULE_DT), {
        VibeX: Array.from(s.fields.VibeX),
        VibeY: Array.from(s.fields.VibeY),
        VibeZ: Array.from(s.fields.VibeZ),
        // 冲击发生在**飞行中段**（第 300 个样本，远离降落段）
        // Clip 是**累积计数**：从第 300 个样本起跳到 62（与真实日志语义一致）
        Clip: [...constant(300, 0), ...constant(RULE_N - 300, 62)],
      }),
    );
    const [f] = findingsFor(scenario(series), "vibration_level");
    expect(f.severity).toBe("critical");
    expect(f.status).toBe("fired");
    expect(f.phenomenon).toContain("饱和");
  });

  it("⚠️ 降落段（末尾）的 clip 冲击单列为独立结论，不混进常规振动", () => {
    const found = findingsFor(scenario(vibeWithClipDelta(62)), "vibration_level");
    // 常规振动结论：飞行段本身健康 → 通过（落地冲击没有把它拉爆）
    const main = found.find((f) => f.title === "振动超标");
    expect(main?.status).toBe("passed");
    expect(main?.metrics.clipDelta).toBe(0);
    // 独立结论：触地/坠机冲击（critical），并给出该段的实测数字
    const landing = found.find((f) => f.title.includes("冲击"));
    expect(landing?.severity).toBe("critical");
    expect(landing?.status).toBe("fired");
    expect(landing?.metrics.landingClipDelta).toBe(62);
    expect(landing?.evidence.some((e) => e.label === "识别依据")).toBe(true);
    expect(main?.note).toContain("降落段");
  });

  it("⚠️ 识别不出降落段（无 disarm 事件）时必须写明「未排除」，不静默处理", () => {
    const series = healthyVibe(RULE_N, RULE_DT).map((s) =>
      makeSeries("VIBE", s.instance, uniformTime(RULE_N, RULE_DT), {
        VibeX: Array.from(s.fields.VibeX),
        VibeY: Array.from(s.fields.VibeY),
        VibeZ: Array.from(s.fields.VibeZ),
        Clip: [...constant(RULE_N - 1, 0), 62],   // 累积计数在最后一步跳到 62
      }),
    );
    // 没有任何 arm/disarm 事件 → 无法识别降落段
    const doc = makeDoc({ series, durationSec: RULE_N * RULE_DT, events: [] });
    const [f] = findingsFor(doc, "vibration_level");
    expect(f.status).toBe("fired");
    expect(f.note).toContain("未能识别降落段");
    expect(f.evidence.some((e) => e.detail.includes("未识别出降落段"))).toBe(true);
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
