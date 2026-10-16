/**
 * PX4 角度环 / 速率环规则单测（task-34 第 1 项）。
 *
 * 合成数据见 `flightlog-px4-fixture.ts`（字段名与真实 ULog 一致）；
 * 另有环境变量门控的真实 `.ulg` 冒烟（`FLIGHTLOG_ULOG_DIR`，未设置则整组 skip）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { constant, makeDoc, makeSeries, uniformTime } from "./helpers/flightlogFixture";
import { px4RateTrackingRule } from "@/lib/flightlog/analysis/rules/px4/px4RateLoop";
import { px4AttitudeTrackingRule } from "@/lib/flightlog/analysis/rules/px4/px4AttitudeLoop";
import { px4FfPolicy } from "@/lib/flightlog/analysis/rules/px4/px4ParamNames";
import { px4SaturationRule } from "@/lib/flightlog/analysis/rules/px4/px4SaturationRule";
import { parseUlog } from "@/lib/flightlog/ulog/parseUlog";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { pickSeries } from "@/components/flightlog/diagnosis/chartData";
import { px4AnglePair } from "@/lib/flightlog/analysis/rules/px4/px4AnglePair";
import { DT, MC_PARAMS, N, gradeOf, px4Doc, px4RateDoc, runRule } from "./flightlog-px4-fixture";

describe("PX4 速率环", () => {
  it("跟踪紧 → A/B 级判通过，且建议里参数名是 MC_*RATE_*", () => {
    const roll = runRule(px4RateTrackingRule, px4RateDoc(0)).find((f) => f.axis === "roll")!;
    expect(["A", "B"]).toContain(gradeOf(roll));
    expect(roll.status).toBe("passed");
    const names = roll.suggestions.map((s) => s.param?.name).filter((n): n is string => typeof n === "string");
    expect(names.every((n) => n.startsWith("MC_"))).toBe(true);
  });

  it("能跟但偏松（C 级）→ fired + warning，现象里写「能跟但偏松」", () => {
    const roll = runRule(px4RateTrackingRule, px4RateDoc(0.6)).find((f) => f.axis === "roll")!;
    expect(gradeOf(roll)).toBe("C");
    expect(roll.status).toBe("fired");
    expect(roll.severity).toBe("warning");
    expect(roll.phenomenon).toContain("能跟但偏松");
    expect(roll.phenomenon).toContain("仍有明显改进空间");
  });

  it("误差达指令量级（D 级）→ critical", () => {
    const roll = runRule(px4RateTrackingRule, px4RateDoc(1.3)).find((f) => f.axis === "roll")!;
    expect(gradeOf(roll)).toBe("D");
    expect(roll.severity).toBe("critical");
  });

  it("⚠️ 缺 vehicle_angular_velocity → missing_required 且原因可读（不静默）", () => {
    const doc = px4Doc({ errRatio: 0.6, withAngularVelocity: false });
    const roll = runRule(px4RateTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(roll.status).toBe("missing_required");
    expect(roll.note).toContain("vehicle_angular_velocity");
    expect(roll.suggestions.length).toBeGreaterThan(0);
  });

  it("⚠️ 指令激励不足 → insufficient_data（不代表通过）", () => {
    const doc = makeDoc({
      platform: "px4", vehicle: "PX4", vehicleKind: "px4-multirotor", durationSec: N * DT,
      series: [
        makeSeries("vehicle_rates_setpoint", 0, uniformTime(N, DT), {
          roll: constant(N, 0), pitch: constant(N, 0), yaw: constant(N, 0),
        }),
        makeSeries("vehicle_angular_velocity", 0, uniformTime(N, DT), {
          "xyz[0]": constant(N, 0), "xyz[1]": constant(N, 0), "xyz[2]": constant(N, 0),
        }),
      ],
      params: MC_PARAMS,
    });
    const roll = runRule(px4RateTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(roll.status).toBe("insufficient_data");
    expect(roll.severity).toBe("unknown");
    expect(roll.suggestions.length).toBeGreaterThan(0);
  });

  it("⚠️ 指令与实际互相关峰值过低 → 判「无法评价」（不给出假的 D 级假红）", () => {
    // 实际用一条**与指令无关**的序列（相位 90°），互相关峰值≈0
    const doc = px4Doc({ errRatio: 0.6, lagSamples: 0, uncorrelatedActual: true });
    const roll = runRule(px4RateTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(roll.status).toBe("insufficient_data");
    expect(roll.severity).toBe("unknown");
    expect(roll.note).toContain("互相关峰值");
    expect(roll.suggestions.length).toBeGreaterThan(0);
  });

  it("FF 建议不得低于当前值；固定翼策略只给方向（本批语料 0 份固定翼）", () => {
    for (const ratio of [0.3, 0.6, 1.3]) {
      const roll = runRule(px4RateTrackingRule, px4RateDoc(ratio)).find((f) => f.axis === "roll")!;
      const ff = roll.suggestions.find((s) => s.param?.name === "MC_ROLLRATE_FF");
      if (ff?.param) expect(ff.param.to).toBeGreaterThanOrEqual(MC_PARAMS.MC_ROLLRATE_FF);
    }
    expect(px4FfPolicy("fw").numeric).toBe(false);
    expect(px4FfPolicy("mc").numeric).toBe(true);
  });
});

describe("PX4 角度环（四元数 → 欧拉角）", () => {
  it("有足够机动 + 误差小 → 通过；建议齐全", () => {
    // 指令有变化（std≈2.1° > 门槛 0.5°）且实际跟得上 → 才允许 passed
    const doc = px4Doc({ errRatio: 0.1, rollDeg: 11.5, cmdDiffDeg: 0, cmdAmpDeg: 3 });
    const roll = runRule(px4AttitudeTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(roll.status).toBe("passed");
    expect(roll.suggestions.length).toBeGreaterThan(0);
  });

  it("⚠️ 没动（指令恒定、误差 0）→ **不得判通过**，必须是「无法评价」并说明缺什么机动", () => {
    const doc = px4Doc({ errRatio: 0.1, rollDeg: 11.5, cmdDiffDeg: 0, cmdAmpDeg: 0 });
    const roll = runRule(px4AttitudeTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(roll.status).toBe("insufficient_data");
    expect(roll.severity).toBe("unknown");
    expect(roll.status).not.toBe("passed");
    expect(roll.note).toContain("没动的时候误差小不代表跟踪好");
    expect(roll.suggestions.length).toBeGreaterThan(0);
  });

  it("⚠️ 激励很小但**误差很大** → 照常 fired（绝对量判据不藏真实误差）", () => {
    const doc = px4Doc({ errRatio: 0.1, rollDeg: 0, cmdDiffDeg: 11.5, cmdAmpDeg: 0 });
    const roll = runRule(px4AttitudeTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(roll.status).toBe("fired");
  });

  it("角度误差超阈值 → fired，并在现象里给出度数（四元数换算生效）", () => {
    const doc = px4Doc({ errRatio: 0.1, rollDeg: 0 });
    const roll = runRule(px4AttitudeTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(roll.status).toBe("fired");
    expect(["warning", "critical"]).toContain(roll.severity);
    expect(roll.phenomenon).toMatch(/误差 RMS 1[01]\.\d/);
  });

  it("⚠️ yaw 环绕：指令 179.9° 与 实际 -179.9° 误差≈0（不是 360）", () => {
    const doc = px4Doc({ errRatio: 0.1, yawDeg: -179.9, cmdDiffDeg: 0, yawAmpDeg: 5 });
    const yaw = runRule(px4AttitudeTrackingRule, doc).find((f) => f.axis === "yaw")!;
    expect(yaw.status).toBe("passed");
    expect(yaw.metrics.errRms).toBeLessThan(0.5);
  });

  it("缺 vehicle_attitude → 判无法判断并说明缺什么", () => {
    const doc = px4Doc({ errRatio: 0.1, withAttitude: false });
    const roll = runRule(px4AttitudeTrackingRule, doc).find((f) => f.axis === "roll")!;
    expect(["missing_required", "insufficient_data"]).toContain(roll.status);
    expect(roll.suggestions.length).toBeGreaterThan(0);
  });
});

describe("⚠️ 取证通道回归（图表 vs 指标必须是同一个物理量）", () => {
  it("图表的「实际」= 欧拉角序列（与指标同源），且**不是** q0；两条线同为度", () => {
    const doc = px4Doc({ errRatio: 0.1, rollDeg: 30, cmdDiffDeg: 0, cmdAmpDeg: 3 });
    const ctx = createRuleContext(doc);
    const window = ctx.armedWindows()[0] ?? { startSec: 0, endSec: N * DT };
    const pair = px4AnglePair(ctx, "roll", window, 100)!;
    const [finding] = runRule(px4AttitudeTrackingRule, doc);
    const [cmdRef, actRef] = finding.charts[0].signals;
    const cmd = pickSeries(doc, cmdRef)!;
    const act = pickSeries(doc, actRef)!;

    // ① 实际序列 == 欧拉角（按时间对齐后的误差 = 指令 − 实际，逐点一致）
    const n = Math.min(pair.error.length, act.values.length);
    let maxDiff = 0;
    for (let i = 0; i < n; i += 1) {
      const cmdDeg = cmd.values[i];
      maxDiff = Math.max(maxDiff, Math.abs(cmdDeg - act.values[i] - pair.error[i]));
    }
    expect(maxDiff).toBeLessThan(1e-6);

    // ② 负向对照：原始 q[0]（w 分量）≈0.97 —— 拿它当滚转角画出来就是"两条线量纲不同"的根源
    const rawQ0 = pickSeries(doc, { series: "vehicle_attitude", field: "q[0]" })!;
    expect(rawQ0.values[0]).toBeGreaterThan(0.9);
    // ③ 30° 滚转：实际线必须是 30° 量级，不是 q0≈cos(15°)≈0.97
    const actMean = act.values.reduce((s: number, v: number) => s + v, 0) / act.values.length;
    expect(actMean).toBeGreaterThan(25);
    expect(actMean).toBeLessThan(35);

    // ③ 指令线是弧度→度：基准角 30°（±3° 正弦）→ 均值也在 30° 量级
    const cmdMean = cmd.values.reduce((s: number, v: number) => s + v, 0) / cmd.values.length;
    expect(cmdMean).toBeGreaterThan(25);
    expect(cmdMean).toBeLessThan(35);

    // ④ 图表标签必须说清单位，不能再出现"四元数 q0"当成实际姿态
    expect(cmd.label).toContain("度");
    expect(act.label).toContain("欧拉角");
  });

  it("三个轴都必须是欧拉角：pitch/yaw 同样不能拿 q 分量顶替", () => {
    // ④ 三个轴都要这样：pitch/yaw 同样不能拿 q 分量顶替（q 分量只会在 [−1,1] 内）
    const multi = px4Doc({ errRatio: 0.1, rollDeg: 20, yawDeg: 40, cmdDiffDeg: 0, cmdAmpDeg: 3 });
    const findings = runRule(px4AttitudeTrackingRule, multi);
    for (const [idx, axis] of [[0, "roll"], [1, "pitch"], [2, "yaw"]] as const) {
      const chart = findings.find((f) => f.charts[0]?.id.endsWith(axis))!.charts[0];
      const actValues = pickSeries(multi, chart.signals[1])!.values;
      expect(Math.abs(actValues[0]), `${axis} 实际线像是 q 分量而不是角度`).toBeGreaterThan(1);
      const rawCol = multi.series["vehicle_attitude:0"].fields[`q[${idx}]`];
      if (rawCol) expect(Math.abs(actValues[0] - rawCol[0])).toBeGreaterThan(1e-9);
    }
  });

  it("绝对量判据的指标里**不得输出 errRatio**（曾经输出 −1 哨兵被当指标展示）", () => {
    const doc = px4Doc({ errRatio: 0.1, rollDeg: 30, cmdDiffDeg: 0, cmdAmpDeg: 3 });
    const [finding] = runRule(px4AttitudeTrackingRule, doc);
    expect(finding.metrics.errRms).toBeDefined();
    expect(finding.metrics.errRatio).toBeUndefined();
  });

  it("卡片文案与实际行为一致：说清「低激励且误差小 → 无法评价」", () => {
    const doc = px4Doc({ errRatio: 0.1, rollDeg: 30, cmdDiffDeg: 0, cmdAmpDeg: 3 });
    const [finding] = runRule(px4AttitudeTrackingRule, doc);
    const text = finding.evidence.map((e) => e.detail).join("\n");
    expect(text).toContain("低激励");
    expect(text).not.toContain("不设激励门槛");
  });
});

describe("PX4 执行器 / 控制量饱和（第 2 项）", () => {
  it("⚠️ 控制量贴边 → 必须指出「不要加增益」（饱和时加增益是错的方向）", () => {
    const doc = px4Doc({ errRatio: 0.6, lagSamples: 2, saturated: true });
    const [f] = runRule(px4SaturationRule, doc);
    expect(f.status).toBe("fired");
    expect(["warning", "critical"]).toContain(f.severity);
    expect(f.phenomenon).toContain("贴边");
    const text = f.suggestions.map((s) => s.text).join("\n");
    expect(text).toContain("不要加增益");
    expect(text).toContain("先解决饱和");   // 交叉引用速率环误差后的结论
    expect(f.impact).toContain("继续加增益");
  });

  it("控制量有余量 → 判通过，且明确写「排除饱和」（误差方向在增益/滤波）", () => {
    const doc = px4Doc({ errRatio: 0.6, lagSamples: 2 });
    const [f] = runRule(px4SaturationRule, doc);
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.phenomenon).toContain("未饱和");
    expect(f.suggestions.map((s) => s.text).join("\n")).toContain("排除饱和");
  });

  it("⚠️ 单边顶住（同号 100%、std=0）→ 先查重心/配平，而不是 PID", () => {
    const doc = px4Doc({ errRatio: 0.6, lagSamples: 2, singleSideBias: true });
    const [f] = runRule(px4SaturationRule, doc);
    expect(f.status).toBe("fired");
    expect(f.suggestions.map((s) => s.text).join("\n")).toContain("重心");
  });

  it("缺 actuator 组 → missing_required 且说明怎么才能采集到", () => {
    const doc = px4Doc({ errRatio: 0.6, withControls: false });
    const [f] = runRule(px4SaturationRule, doc);
    expect(f.status).toBe("missing_required");
    expect(f.note).toContain("actuator");
    expect(f.suggestions.length).toBeGreaterThan(0);
  });
});

// ── 真实 .ulg 冒烟（env 门控；仓库里不出现真实路径） ──────────────────────────
const DIR = process.env.FLIGHTLOG_ULOG_DIR ?? null;
const REAL_LOGS = ["log_11_2026-6-8-10-36-28.ulg", "log_100_2025-8-12-20-30-24.ulg"];
const realFiles = DIR !== null && existsSync(DIR)
  ? REAL_LOGS.map((f) => join(DIR, f)).filter((p) => existsSync(p))
  : [];

describe.skipIf(realFiles.length === 0)("真实 .ulg 冒烟（需 FLIGHTLOG_ULOG_DIR）", () => {
  for (const realFile of realFiles) {
  it(`${realFile.split("\\\\").pop()}：两条规则都产出结论、无空建议，并打印实测分级`, () => {
    const { doc } = parseUlog(new Uint8Array(readFileSync(realFile)));
    expect(doc.meta.platform).toBe("px4");
    const rate = runRule(px4RateTrackingRule, doc);
    const att = runRule(px4AttitudeTrackingRule, doc);
    for (const f of [...rate, ...att]) {
      expect(f.suggestions.length, `${f.title} 无建议`).toBeGreaterThan(0);
    }
    for (const f of rate) {
      console.log(`[px4] ${f.title} → ${f.status}/${f.severity} errRatio=${f.metrics.errRatio?.toFixed(3)} lag=${f.metrics.lagSamples} lagMs=${Math.round(f.metrics.lagMs ?? 0)}`);
    }
    for (const f of att) {
      console.log(`[px4] ${f.title} → ${f.status}/${f.severity} errRms=${f.metrics.errRms?.toFixed(2)}°`);
    }
    for (const f of runRule(px4SaturationRule, doc)) {
      console.log(`[px4] ${f.title} → ${f.status}/${f.severity} 最差贴边=${((f.metrics.worstSaturationRatio ?? 0) * 100).toFixed(1)}% 力矩=${((f.metrics.torqueSaturationRatio ?? 0) * 100).toFixed(1)}%`);
    }
  });
  }
});
