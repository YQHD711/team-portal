/**
 * 滤波有效性 / 陷波配置（ruleId: filter_notch）测试。
 *
 * 交叉验证是本规则的核心：只有"振动确实被测到并且超标"时才允许给陷波参数建议；
 * 振动健康时给参数就是噪声源，振动测不出来时给结论就是把未知说成通过。
 */

import { describe, expect, it } from "vitest";
import { constant, healthyVibe, makeSeries, uniformTime } from "./helpers/flightlogFixture";
import { RULE_DT, RULE_N, findingsFor, scenario, vibeWithClipDelta } from "./helpers/flightlogScenario";

const NOTCH_OFF = { INS_HNTCH_ENABLE: 0, FFT_ENABLE: 1 };

describe("滤波（陷波）规则", () => {
  it("振动超标但陷波未启用 → 触发并给出启用参数建议", () => {
    // ⚠️ 冲击必须在**飞行中段**：末尾的冲击属于降落段，会被排除（见下一条测试）
    const series = healthyVibe(RULE_N, RULE_DT).map((s) =>
      makeSeries("VIBE", s.instance, uniformTime(RULE_N, RULE_DT), {
        VibeX: Array.from(s.fields.VibeX),
        VibeY: Array.from(s.fields.VibeY),
        VibeZ: Array.from(s.fields.VibeZ),
        Clip: [...constant(300, 0), ...constant(RULE_N - 300, 165)],   // 累积计数在中段跳到 165
      }),
    );
    const doc = scenario(series, { params: NOTCH_OFF });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.severity).toBe("critical");
    expect(f.status).toBe("fired");
    expect(f.suggestions.some((s) => s.param?.name === "INS_HNTCH_ENABLE")).toBe(true);
    // 建议必须先排除机械原因、再采集频谱，不能一上来就让用户填频率
    expect(f.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(f.suggestions[0].text).toContain("机械");
    expect(f.suggestions.every((s) => s.param?.name !== "INS_HNTCH_FREQ")).toBe(true);
  });

  it("⚠️ 只有降落段的冲击（末尾 clip）→ 不推荐启用陷波（落地冲击不是机架振动）", () => {
    const doc = scenario(vibeWithClipDelta(165), { params: NOTCH_OFF });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.suggestions.every((s) => s.param?.name !== "INS_HNTCH_ENABLE")).toBe(true);
  });

  it("负向对照：振动健康且陷波未启用时判通过，且**不得**给参数数值（只给方向）", () => {
    const doc = scenario(healthyVibe(RULE_N, RULE_DT), { params: NOTCH_OFF });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    // 用户要求「每一项都有建议」：通过也要给，但**不能编数值**（没有 FFT 主峰就没有频率起点）
    expect(f.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(f.suggestions.every((s) => s.param === null)).toBe(true);
    expect(f.suggestions[0].text).toContain("①触发签名");
    expect(f.suggestions[0].text).toContain("⑥官方文档");
  });

  it("⚠️ 自相矛盾修复：ATT=40 dB（超过 20 dB 自检上限）必须告警并给出 15–20 dB 建议", () => {
    const doc = scenario(healthyVibe(RULE_N, RULE_DT), {
      params: { INS_HNTCH_ENABLE: 1, INS_HNTCH_FREQ: 80, INS_HNTCH_ATT: 40, FFT_ENABLE: 1 },
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.severity).toBe("warning");
    expect(f.status).toBe("fired");
    expect(f.phenomenon).toContain("ATT=40");
    const att = f.suggestions.find((s) => s.param?.name === "INS_HNTCH_ATT");
    expect(att?.param?.to).toBe(20);
    expect(att?.text).toContain("15–20 dB");
    expect(f.phenomenon).not.toContain("配置有效");
  });

  it("⚠️ 边界修复：FREQ 与 FFT 主峰偏差恰好 20.0% 也算不合格（判据用 >=）并给出 FREQ 建议", () => {
    // FtX/FtY/FtZ = 100 Hz、FREQ = 80 Hz → 偏差正好 20.0%（旧实现 `> 0.2` 会放过）
    const vibe = healthyVibe(RULE_N, RULE_DT);
    const ftn = makeSeries("FTN1", 0, uniformTime(RULE_N, RULE_DT), {
      SnX: constant(RULE_N, 30), SnY: constant(RULE_N, 30), SnZ: constant(RULE_N, 30),
      FtX: constant(RULE_N, 100), FtY: constant(RULE_N, 100), FtZ: constant(RULE_N, 100),
    });
    const doc = scenario([...vibe, ftn], {
      params: { INS_HNTCH_ENABLE: 1, INS_HNTCH_FREQ: 80, INS_HNTCH_BW: 40, INS_HNTCH_ATT: 15, FFT_ENABLE: 1 },
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("fired");
    expect(f.phenomenon).toContain("20.0%");
    const freq = f.suggestions.find((s) => s.param?.name === "INS_HNTCH_FREQ");
    expect(freq?.param?.to).toBe(100);
    expect(f.phenomenon).not.toContain("对齐");
  });

  it("⚠️ MODE=4 但 FFT_ENABLE=0 → 告警并给出修正方向（不给编造数值）", () => {
    const doc = scenario(healthyVibe(RULE_N, RULE_DT), {
      params: { INS_HNTCH_ENABLE: 1, INS_HNTCH_FREQ: 80, INS_HNTCH_ATT: 15, INS_HNTCH_MODE: 4, FFT_ENABLE: 0 },
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("fired");
    expect(f.phenomenon).toContain("MODE=4");
    expect(f.suggestions.some((s) => s.text.includes("FFT_ENABLE=1") || s.text.includes("MODE=1/3"))).toBe(true);
  });

  it("负向对照：振动测不出来时不得声称「无需启用陷波」（不能把未知说成通过）", () => {
    // 只有 10 条 VIBE（低于 50 条门槛）→ 振动不可评估
    const doc = scenario(healthyVibe(10, RULE_DT), {
      durationSec: 10 * RULE_DT,
      params: NOTCH_OFF,
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("insufficient_data");
    expect(f.severity).toBe("unknown");
    expect(f.note).toContain("样本不足");
    expect(f.phenomenon).not.toContain("在阈值内");
  });

  it("固件版本低于 4.1 时判不适用并说明原因", () => {
    const doc = scenario(healthyVibe(RULE_N, RULE_DT), {
      firmwareVersion: "3.6.0",
      versionNumeric: 30600,
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("not_applicable");
    expect(f.note).toContain("当前日志");
  });
});
