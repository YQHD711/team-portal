/**
 * 滤波有效性 / 陷波配置（ruleId: filter_notch）测试。
 *
 * 交叉验证是本规则的核心：只有"振动确实被测到并且超标"时才允许给陷波参数建议；
 * 振动健康时给参数就是噪声源，振动测不出来时给结论就是把未知说成通过。
 */

import { describe, expect, it } from "vitest";
import { healthyVibe } from "./helpers/flightlogFixture";
import { RULE_DT, RULE_N, findingsFor, scenario, vibeWithClipDelta } from "./helpers/flightlogScenario";

const NOTCH_OFF = { INS_HNTCH_ENABLE: 0, FFT_ENABLE: 1 };

describe("滤波（陷波）规则", () => {
  it("振动超标但陷波未启用 → 触发并给出启用参数建议", () => {
    const doc = scenario(vibeWithClipDelta(165), { params: NOTCH_OFF });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.severity).toBe("critical");
    expect(f.status).toBe("fired");
    expect(f.suggestions.some((s) => s.param?.name === "INS_HNTCH_ENABLE")).toBe(true);
    // 建议必须先排除机械原因、再采集频谱，不能一上来就让用户填频率
    expect(f.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(f.suggestions[0].text).toContain("机械");
    expect(f.suggestions.every((s) => s.param?.name !== "INS_HNTCH_FREQ")).toBe(true);
  });

  it("负向对照：振动健康且陷波未启用时判通过，且**不得**给参数建议", () => {
    const doc = scenario(healthyVibe(RULE_N, RULE_DT), { params: NOTCH_OFF });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.suggestions).toHaveLength(0);
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
