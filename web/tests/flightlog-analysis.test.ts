/**
 * 规则引擎测试：用**合成信号 + 已知答案**验证判定逻辑。
 *
 * 重点不是"能跑通"，而是三条纪律：
 *   ① 正向对照：构造明确的故障信号，规则必须触发且分档正确；
 *   ② 负向对照：健康信号必须判通过，且缺数据时**绝不能**判通过；
 *   ③ 交叉验证：只有证据齐备时才给参数建议（否则就是噪声源）。
 */

import { describe, expect, it } from "vitest";
import { analyzeLog } from "@/lib/flightlog/analysis/engine";
import type { Finding, Severity } from "@/lib/flightlog/types/report";
import {
  constant,
  healthyVibe,
  makeDoc,
  makeSeries,
  noise,
  sineWave,
  uniformTime,
} from "./helpers/flightlogFixture";

const DT = 0.1;
const N = 600;

function findingsFor(
  doc: Parameters<typeof analyzeLog>[0],
  ruleId: string,
): Finding[] {
  return analyzeLog(doc).findings.filter((f) => f.ruleId === ruleId);
}

function withVibe(
  vibe: ReturnType<typeof healthyVibe>,
  extra: Parameters<typeof makeDoc>[0] = {},
) {
  return makeDoc({ series: vibe, durationSec: N * DT, ...extra });
}

describe("振动规则", () => {
  it("健康信号判通过（负向对照）", () => {
    const doc = withVibe(healthyVibe(N, DT));
    const [f] = findingsFor(doc, "vibration_level");
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.metrics.clipDelta).toBe(0);
  });

  it("clip 计数增量 > 0 判严重", () => {
    const vibe = healthyVibe(N, DT).map((s) =>
      makeSeries("VIBE", s.instance, uniformTime(N, DT), {
        VibeX: Array.from(s.fields.VibeX),
        VibeY: Array.from(s.fields.VibeY),
        VibeZ: Array.from(s.fields.VibeZ),
        Clip: [...constant(N - 1, 0), 62],
      }),
    );
    const [f] = findingsFor(withVibe(vibe), "vibration_level");
    expect(f.severity).toBe("critical");
    expect(f.status).toBe("fired");
    expect(f.phenomenon).toContain("饱和");
  });

  it("标准差超 30 判严重（即使无 clip）", () => {
    const count = N;
    const vibe = [
      makeSeries("VIBE", 0, uniformTime(count, DT), {
        VibeX: noise(count, 25, 1),
        VibeY: noise(count, 30, 2),
        VibeZ: noise(count, 75, 3), // std ≈ 43
        Clip: constant(count, 0),
      }),
    ];
    const [f] = findingsFor(withVibe(vibe), "vibration_level");
    expect(f.severity).toBe("critical");
  });

  it("标准差 15~30 判警告", () => {
    const count = N;
    const vibe = [
      makeSeries("VIBE", 0, uniformTime(count, DT), {
        VibeX: noise(count, 25, 1),
        VibeY: noise(count, 30, 2),
        VibeZ: noise(count, 55, 3), // std ≈ 31.7 → 仍为严重
        Clip: constant(count, 0),
      }),
      makeSeries("VIBE", 1, uniformTime(count, DT), {
        VibeX: noise(count, 20, 4),
        VibeY: noise(count, 30, 5), // std ≈ 17.3 → 警告
        VibeZ: noise(count, 20, 6),
        Clip: constant(count, 0),
      }),
    ];
    const found = findingsFor(withVibe(vibe), "vibration_level");
    const imu1 = found.find((f) => f.title.includes("IMU1"));
    expect(imu1?.severity).toBe("warning");
  });

  it("负向对照：缺 VIBE 消息时必须是 unknown，不能是 passed", () => {
    const doc = makeDoc({ series: [], durationSec: N * DT });
    const [f] = findingsFor(doc, "vibration_level");
    expect(f.status).toBe("missing_required");
    expect(f.severity).toBe("unknown");
    expect(f.note).toContain("VIBE");
    expect(f.status).not.toBe("passed");
  });

  it("负向对照：VIBE 样本不足时判无法判断，不能是 passed", () => {
    const doc = withVibe(healthyVibe(10, DT));
    const [f] = findingsFor(doc, "vibration_level");
    expect(f.status).toBe("insufficient_data");
    expect(f.severity).toBe("unknown");
  });
});

describe("速率环跟踪质量规则", () => {
  function pidSeries(
    amplitudeTar: number,
    amplitudeErr: number,
  ) {
    const t = uniformTime(N, DT);
    const build = (name: string) =>
      makeSeries(
        name,
        0,
        t,
        {
          Tar: sineWave(N, DT, 0.5, amplitudeTar),
          Act: sineWave(N, DT, 0.5, amplitudeTar),
          Err: sineWave(N, DT, 2.5, amplitudeErr),
          P: constant(N, 1),
          I: constant(N, 0),
          D: constant(N, 0),
        },
        { Tar: "rad/s", Act: "rad/s", Err: "rad/s" },
      );
    return [build("PIDR"), build("PIDP"), build("PIDY")];
  }

  it("跟踪偏差大时触发警告（Err/Tar ≈ 0.6）", () => {
    const doc = makeDoc({
      vehicleKind: "plane",
      series: pidSeries(70, 42),
      durationSec: N * DT,
    });
    const found = findingsFor(doc, "pid_rate_tracking");
    expect(found).toHaveLength(3);
    expect(found[0].severity).toBe("warning");
    expect(found[0].status).toBe("fired");
    expect(found[0].suggestions.length).toBeGreaterThan(0);
  });

  it("误差达到指令量级时判严重（Err/Tar ≈ 1.29）", () => {
    const doc = makeDoc({
      vehicleKind: "plane",
      series: pidSeries(70, 90),
      durationSec: N * DT,
    });
    const [f] = findingsFor(doc, "pid_rate_tracking");
    expect(f.severity).toBe("critical");
  });

  it("悬停（激励不足）时判无法判断，且明确说明不等于通过", () => {
    const doc = makeDoc({
      vehicleKind: "copter",
      series: pidSeries(0.08, 0.05),
      durationSec: N * DT,
    });
    const found = findingsFor(doc, "pid_rate_tracking");
    expect(found[0].status).toBe("insufficient_data");
    expect(found[0].severity).toBe("unknown");
    expect(found[0].note).toContain("门槛");
    expect(found[0].note).toContain("不代表通过");
  });
});

describe("滤波（陷波）规则", () => {
  function clipVibe() {
    return healthyVibe(N, DT).map((s) =>
      makeSeries("VIBE", s.instance, uniformTime(N, DT), {
        VibeX: Array.from(s.fields.VibeX),
        VibeY: Array.from(s.fields.VibeY),
        VibeZ: Array.from(s.fields.VibeZ),
        Clip: [...constant(N - 1, 0), 165],
      }),
    );
  }

  it("振动超标但陷波未启用 → 触发并给出启用参数建议", () => {
    const doc = makeDoc({
      series: clipVibe(),
      durationSec: N * DT,
      params: { INS_HNTCH_ENABLE: 0, FFT_ENABLE: 1 },
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.severity).toBe("critical");
    expect(f.status).toBe("fired");
    expect(f.suggestions.some((s) => s.param?.name === "INS_HNTCH_ENABLE")).toBe(true);
  });

  it("负向对照：振动健康且陷波未启用时判通过，且**不得**给参数建议", () => {
    const doc = makeDoc({
      series: healthyVibe(N, DT),
      durationSec: N * DT,
      params: { INS_HNTCH_ENABLE: 0, FFT_ENABLE: 1 },
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.suggestions).toHaveLength(0);
  });

  it("负向对照：振动测不出来时不得声称「无需启用陷波」（不能把未知说成通过）", () => {
    // 只有 10 条 VIBE（低于 50 条门槛）→ 振动不可评估
    const doc = makeDoc({
      series: healthyVibe(10, DT),
      durationSec: 10 * DT,
      params: { INS_HNTCH_ENABLE: 0, FFT_ENABLE: 1 },
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("insufficient_data");
    expect(f.severity).toBe("unknown");
    expect(f.note).toContain("样本不足");
    expect(f.phenomenon).not.toContain("在阈值内");
  });

  it("固件版本低于 4.1 时判不适用并说明原因", () => {
    const doc = makeDoc({
      series: healthyVibe(N, DT),
      durationSec: N * DT,
      firmwareVersion: "3.6.0",
      versionNumeric: 30600,
    });
    const [f] = findingsFor(doc, "filter_notch");
    expect(f.status).toBe("not_applicable");
    expect(f.note).toContain("当前日志");
  });
});

describe("引擎门控与汇总", () => {
  it("PX4 日志：ArduPilot 规则全部判不适用（架构位保留）", () => {
    const doc = makeDoc({
      platform: "px4",
      vehicle: "PX4",
      vehicleKind: "px4-multirotor",
      firmwareVersion: "1.14.3",
      versionNumeric: 11403,
      series: healthyVibe(N, DT),
      durationSec: N * DT,
    });
    const report = analyzeLog(doc);
    expect(report.findings).toHaveLength(3);
    expect(report.findings.every((f) => f.status === "not_applicable")).toBe(true);
    expect(report.summary.unknown).toBe(3);
    expect(report.summary.passed).toBe(0);
  });

  it("结论按严重程度排序，且统计数一致", () => {
    const doc = makeDoc({
      series: [
        ...clipVibeForSort(),
      ],
      durationSec: N * DT,
      params: { INS_HNTCH_ENABLE: 0 },
    });
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
  });

  it("规则抛异常时兜底为无法判断，不拖垮整份报告", () => {
    const doc = makeDoc({ series: healthyVibe(N, DT), durationSec: N * DT });
    const exploding = {
      id: "exploding_rule",
      title: "会抛异常的规则",
      category: "vibration" as const,
      appliesTo: [{ platform: "ardupilot" as const, requires: [] }],
      run() {
        throw new Error("模拟规则崩溃");
      },
    };
    const report = analyzeLog(doc, { rules: [exploding] });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].status).toBe("insufficient_data");
    expect(report.findings[0].severity).toBe("unknown");
    expect(report.findings[0].note).toContain("模拟规则崩溃");
  });
});

function clipVibeForSort() {
  return healthyVibe(N, DT).map((s) =>
    makeSeries("VIBE", s.instance, uniformTime(N, DT), {
      VibeX: Array.from(s.fields.VibeX),
      VibeY: Array.from(s.fields.VibeY),
      VibeZ: Array.from(s.fields.VibeZ),
      Clip: [...constant(N - 1, 0), 62],
    }),
  );
}
