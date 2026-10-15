/**
 * 角度环跟踪规则（ruleId: attitude_tracking）测试。
 *
 * 这里**不注册规则**（`analysis/rules/index.ts` 由 Lead 统一登记），直接
 * `rule.run(createRuleContext(doc))`，与生产路径共用同一份上下文实现。
 *
 * 断言口径按阈值常量推导（不写死数字）：Lead 标定后改 thresholds.ts，测试仍然成立。
 * ⚠️ 关键回归：**适用性按轴判断** —— 缺某一对列/缺 ATT 只允许影响该轴，
 *   整条规则绝不能被判成 missing_required（上一轮 PID 规则在固定翼日志上的线上事故）。
 */

import { describe, expect, it } from "vitest";
import { attitudeTrackingRule } from "@/lib/flightlog/analysis/rules/attitudeTracking";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { ATTITUDE, thresholdsFor } from "@/lib/flightlog/analysis/thresholds";
import type { LogDocument, VehicleKind } from "@/lib/flightlog/types/log";
import type { Finding } from "@/lib/flightlog/types/report";
import { makeDoc } from "./helpers/flightlogFixture";
import { ATT_N, attDoc } from "./flightlog-rules-attitude-fixture";

const DURATION = ATT_N * 0.1;
const SQRT2 = Math.SQRT2;

function run(doc: LogDocument): Finding[] {
  return attitudeTrackingRule.run(createRuleContext(doc));
}

function forAxis(doc: LogDocument, axis: "roll" | "pitch" | "yaw"): Finding | undefined {
  return run(doc).find((f) => f.axis === axis);
}

/**
 * 指令幅值（度，正弦幅值）：角度环**已无激励门槛**（Lead 裁决 2），
 * 这个幅值只是让信号像真实机动，不参与任何判定。
 */
const EXCITED = 20 * SQRT2;
/** 极小的指令幅值（0.1° RMS）：用来验证"指令小也照样按绝对误差判" */
const TINY_COMMAND = 0.1 * SQRT2;
/** 阈值按机型 + 轴取（thresholds.ts 已按机型分档）——测试跟着分档走，不写死数字 */
function limits(kind: VehicleKind, axis: "roll" | "pitch" | "yaw"): { warn: number; crit: number } {
  return {
    warn: thresholdsFor(ATTITUDE.warnDeg, kind)[axis],
    crit: thresholdsFor(ATTITUDE.critDeg, kind)[axis],
  };
}
/** 落在"警告档"的误差幅值（正弦幅值 = 阈值中值 × √2） */
function warningErrAmp(kind: VehicleKind, axis: "roll" | "pitch" | "yaw"): number {
  const { warn, crit } = limits(kind, axis);
  return ((warn + crit) / 2) * SQRT2;
}
/** 落在"严重档"的误差幅值 */
function criticalErrAmp(kind: VehicleKind, axis: "roll" | "pitch" | "yaw"): number {
  return limits(kind, axis).crit * 2 * SQRT2;
}

describe("角度环跟踪规则", () => {
  it("健康数据：roll/pitch/yaw 三轴都判通过，且证据、指标、曲线齐全", () => {
    const kind = "copter" as const;
    const healthy = { desAmp: EXCITED, errAmp: 0.01 };
    const findings = run(attDoc({ roll: healthy, pitch: healthy, yaw: healthy }));

    expect(findings).toHaveLength(3);
    const axes = ["roll", "pitch", "yaw"] as const;
    findings.forEach((f, index) => {
      const axis = axes[index];
      expect(f.axis).toBe(axis);
      expect(f.status).toBe("passed");
      expect(f.severity).toBe("ok");
      expect(f.evidence.length).toBeGreaterThanOrEqual(4);
      expect(f.metrics.errRms).toBeGreaterThanOrEqual(0);
      expect(f.charts).toHaveLength(1);
      expect(f.charts[0].signals).toHaveLength(3);
      // 曲线阈值线必须与**该机型该轴**的档位一致（分档改错会在这里立刻暴露）
      expect(f.charts[0].thresholds.map((t) => t.value)).toEqual([
        limits(kind, axis).warn, limits(kind, axis).crit,
      ]);
    });
  });

  it("误差超过警告阈值判 warning、超过严重阈值判 critical（分档按阈值常量推导）", () => {
    const warnAmp = warningErrAmp("copter", "roll");
    const warn = forAxis(attDoc({ roll: { desAmp: EXCITED, errAmp: warnAmp } }), "roll");
    expect(warn?.severity).toBe("warning");
    expect(warn?.status).toBe("fired");
    expect(warn?.suggestions.some((s) => (s.verify ?? "").includes("RMS"))).toBe(true);

    const critical = forAxis(attDoc({ roll: { desAmp: EXCITED, errAmp: criticalErrAmp("copter", "roll") } }), "roll");
    expect(critical?.severity).toBe("critical");
    expect(critical?.charts[0].highlightWindow).not.toBeNull();
  });

  it("⚠️ 裁决 2 验证：指令很小但绝对误差大 → 仍然 fired，绝不被激励门槛挡成 unknown", () => {
    // 语料里正是这种情况：Copter 有 5 份日志 roll 绝对误差 14.95–30.04°，却因"指令 < 2°"被判 insufficient_data
    const tiny = forAxis(attDoc({ roll: { desAmp: TINY_COMMAND, errAmp: warningErrAmp("copter", "roll") } }), "roll");
    expect(tiny?.status).toBe("fired");
    expect(tiny?.severity).toBe("warning");
    expect(tiny?.metrics.errRms).toBeGreaterThanOrEqual(limits("copter", "roll").warn);
    expect(tiny?.evidence.some((e) => e.detail.includes("绝对量判据"))).toBe(true);

    const huge = forAxis(attDoc({ roll: { desAmp: TINY_COMMAND, errAmp: criticalErrAmp("copter", "roll") } }), "roll");
    expect(huge?.status).toBe("fired");
    expect(huge?.severity).toBe("critical");
  });

  it("样本不足判 insufficient_data 并给出门槛数字", () => {
    const f = forAxis(
      attDoc({ roll: { desAmp: EXCITED, errAmp: 1 }, count: ATTITUDE.minSamples - 1 }),
      "roll",
    );
    expect(f?.status).toBe("insufficient_data");
    expect(f?.note).toContain(String(ATTITUDE.minSamples));
  });

  it("⚠️ 航向环绕：DesYaw 与 Yaw 跨 0/360 时误差按 ±180 计算", () => {
    const exc = { desAmp: EXCITED, errAmp: 0.01 };
    // 实际航向整体 +359°（等价于 −1°）：不环绕的话误差会被算成 −359° 而误判严重
    const f = forAxis(attDoc({ roll: exc, pitch: exc, yaw: { desAmp: EXCITED, errAmp: 0 }, yawOffsetDeg: 359 }), "yaw");
    expect(f?.metrics.errRms).toBeCloseTo(1, 1);
    expect(f?.status).toBe("passed");
  });

  it("⚠️ 适用性按轴：缺 DesYaw/Yaw 只让 yaw 轴不可判，roll/pitch 照常出结论", () => {
    const warned = { desAmp: EXCITED, errAmp: warningErrAmp("copter", "roll") };
    const findings = run(attDoc({
      roll: warned,
      pitch: warned,
      yaw: { desAmp: EXCITED, errAmp: 1 },
      omitFields: ["DesYaw", "Yaw"],
    }));

    expect(findings).toHaveLength(3);
    expect(findings.find((f) => f.axis === "roll")?.status).toBe("fired");
    expect(findings.find((f) => f.axis === "pitch")?.status).toBe("fired");
    const yaw = findings.find((f) => f.axis === "yaw");
    expect(yaw?.status).toBe("missing_required");   // 缺列落 unknown 一侧，绝不 passed
    expect(yaw?.severity).toBe("unknown");
  });

  it("⚠️ 回归：appliesTo.requires 必须为空（机型专有消息不得当整条规则门槛）", () => {
    for (const applies of attitudeTrackingRule.appliesTo) {
      expect(applies.requires).toEqual([]);
    }
  });

  it("缺 ATT 消息：三轴都判 missing_required 且带 axis，绝不 passed", () => {
    const findings = run(makeDoc({ series: [], durationSec: DURATION }));
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.axis).sort()).toEqual(["pitch", "roll", "yaw"]);
    for (const f of findings) {
      expect(f.status).toBe("missing_required");
      expect(f.severity).toBe("unknown");
      expect(f.note).toContain("ATT");
    }
  });

  it("固定翼平飞（roll/pitch 指令很小）：也按绝对误差判，不因指令小落 unknown", () => {
    const findings = run(attDoc({
      vehicleKind: "plane",
      roll: { desAmp: TINY_COMMAND, errAmp: warningErrAmp("plane", "roll") },
      pitch: { desAmp: TINY_COMMAND, errAmp: warningErrAmp("plane", "pitch") },
    }));
    for (const axis of ["roll", "pitch"]) {
      const f = findings.find((x) => x.axis === axis);
      expect(f?.status, axis).toBe("fired");
      expect(f?.severity, axis).toBe("warning");
    }
  });

  it("⚠️ Plane/Rover 的 yaw 没有航向角指令 → not_applicable；Copter 恒 0 照常按绝对误差判", () => {
    for (const kind of ["plane", "rover"] as const) {
      const yaw = forAxis(attDoc({
        vehicleKind: kind,
        roll: { desAmp: EXCITED, errAmp: 0.01 },
        yaw: { desAmp: 0, errAmp: 0 },        // DesYaw 恒 0 = 机型没有航向角指令
      }), "yaw");
      expect(yaw?.status, kind).toBe("not_applicable");
      expect(yaw?.note).toContain("航向角指令");
      expect(yaw?.note).toContain("不是缺数据");
      expect(yaw?.severity).toBe("unknown");
    }
    // 多旋翼本该有航向指令：现在没有激励门槛了，恒 0 也照常判（跟踪好就 passed）
    const tracked = forAxis(attDoc({ roll: { desAmp: EXCITED, errAmp: 0.01 }, yaw: { desAmp: 0, errAmp: 0.01 } }), "yaw");
    expect(tracked?.status).toBe("passed");
    // 恒 0 指令但航向跟不上 → 必须显形（这正是裁决 2 要的：别再挡成 unknown）
    const missed = forAxis(attDoc({ roll: { desAmp: EXCITED, errAmp: 0.01 }, yaw: { desAmp: 0, errAmp: criticalErrAmp("copter", "yaw") } }), "yaw");
    expect(missed?.status).toBe("fired");
    expect(missed?.severity).toBe("critical");
  });
});
