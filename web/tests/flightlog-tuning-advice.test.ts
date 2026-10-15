/**
 * 速率环调参取证与建议的测试（用户要求：**给具体数值，不是"通过"就算了**）。
 *
 * 三条核心：
 *  ① **C 级不算"通过"** —— 二元判断会把"能跟但很松"显示成通过；
 *  ② **通过也带建议** —— "不是说通过就行了"，A/B 级同样要给出可继续优化的空间与数值；
 *  ③ **滞后主导 → 先加 FF，而不是加 P** —— 前馈不引入相位滞后，加 P 会。
 */

import { describe, expect, it } from "vitest";
import { analyzeLog } from "@/lib/flightlog/analysis/engine";
import { collectRateTuning, gradeOf } from "@/lib/flightlog/analysis/tuningAdvice";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { constant, makeDoc, makeSeries, sineWave, uniformTime } from "./helpers/flightlogFixture";
import type { RateAxisSpec } from "@/lib/flightlog/analysis/rateAxisEvidence";

const DT = 0.1;
const N = 600;
const SPEC: RateAxisSpec = { axis: "roll", message: "PIDR", label: "Roll", paramName: "ATC_RAT_RLL_P" };
const PARAMS = {
  ATC_RAT_RLL_P: 0.25,
  ATC_RAT_RLL_I: 0.12,
  ATC_RAT_RLL_D: 0.005,
  ATC_RAT_RLL_FF: 0,
  ATC_RAT_RLL_IMAX: 0.5,
};

/**
 * 造一个速率轴：指令 → 实际带 lagSamples 个采样滞后，再叠加一个**与指令无关**的误差分量
 * （用不同频率表示）。这样"滞后"和"误差大小"可以独立控制——
 * 这是区分"滞后主导（该加 FF）"与"误差大但无滞后（该加 P）"的关键。
 */
function axisDoc(opts: {
  lagSamples: number;
  tarAmp: number;
  errAmp: number;
  errFreq?: number;
  iConst?: number;
  dAmp?: number;
}) {
  const tar = sineWave(N, DT, 0.5, opts.tarAmp);
  const indep = sineWave(N, DT, opts.errFreq ?? 2.5, opts.errAmp);
  const lagged = tar.map((_, i) => tar[Math.max(0, i - opts.lagSamples)]);
  const err = tar.map((v, i) => v - lagged[i] + indep[i]);
  const act = tar.map((v, i) => v - err[i]);
  const mk = (name: string) =>
    makeSeries(
      name,
      0,
      uniformTime(N, DT),
      {
        Tar: tar,
        Act: act,
        Err: err,
        P: err.map((e) => 0.25 * e),
        I: constant(N, opts.iConst ?? 0),
        D: constant(N, opts.dAmp ?? 0),
        FF: constant(N, 0),
      },
      { Tar: "rad/s", Act: "rad/s", Err: "rad/s" },
    );
  // 必须有 PIDR 与 PIDP：规则的 requires 是这两条，缺 PIDP 会被整条门控掉
  return makeDoc({
    vehicleKind: "copter",
    series: [mk("PIDR"), mk("PIDP")],
    params: PARAMS,
    durationSec: N * DT,
  });
}

const rollOf = (doc: ReturnType<typeof axisDoc>) =>
  analyzeLog(doc).findings.find((f) => f.ruleId === "pid_rate_tracking" && f.axis === "roll");

describe("分级门槛", () => {
  it("A/B/C/D 按实测分位数分档", () => {
    expect(gradeOf(0.05)).toBe("A");
    expect(gradeOf(0.199)).toBe("A");
    expect(gradeOf(0.2)).toBe("B");
    expect(gradeOf(0.39)).toBe("B");
    expect(gradeOf(0.4)).toBe("C");
    expect(gradeOf(0.69)).toBe("C");
    expect(gradeOf(0.7)).toBe("D");
    expect(gradeOf(1.5)).toBe("D");
  });
});

describe("⚠️ C 级不再算「通过」", () => {
  it("误差偏大（C/D 档）→ fired 且标题带等级，现象写明改进空间", () => {
    const roll = rollOf(axisDoc({ lagSamples: 2, tarAmp: 70, errAmp: 32 }))!;
    expect(roll.title).toContain("级");
    expect(roll.status).toBe("fired");
    expect(["warning", "critical"]).toContain(roll.severity);
  });

  it("跟踪紧（A 档）→ passed，但**仍然带建议**（用户：不是说通过就行了）", () => {
    const roll = rollOf(axisDoc({ lagSamples: 0, tarAmp: 70, errAmp: 1.4 }))!;
    expect(roll.status).toBe("passed");
    expect(roll.title).toContain("A 级");
    expect(roll.suggestions.length).toBeGreaterThan(0);
    expect(roll.note).toContain("起点值");
  });
});

describe("⚠️ 滞后主导 → 先加 FF 而不是加 P", () => {
  const lagged = () => rollOf(axisDoc({ lagSamples: 3, tarAmp: 70, errAmp: 20 }))!;

  it("给出 ATC_RAT_RLL_FF 建议，reason 里有算式与「未做系统辨识」的声明", () => {
    const ff = lagged().suggestions.find((s) => s.param?.name === "ATC_RAT_RLL_FF");
    expect(ff).toBeDefined();
    expect(ff!.param!.to).toBeGreaterThan(0);
    expect(ff!.param!.reason).toContain("2π");
    expect(ff!.param!.reason).toContain("未做系统辨识");
    expect(ff!.verify).toContain("滞后");
  });

  it("有滞后时**不该**同时建议加 P（方向相反，会误导）", () => {
    expect(lagged().suggestions.some((s) => s.param?.name === "ATC_RAT_RLL_P")).toBe(false);
  });

  it("误差大但几乎无滞后 → 才建议加 P（且给具体数值）", () => {
    const roll = rollOf(axisDoc({ lagSamples: 0, tarAmp: 70, errAmp: 60 }))!;
    const p = roll.suggestions.find((s) => s.param?.name === "ATC_RAT_RLL_P");
    expect(p).toBeDefined();
    expect(p!.param!.from).toBe(0.25);
    expect(p!.param!.to).toBeCloseTo(0.3, 3);
    expect(roll.suggestions.some((s) => s.param?.name === "ATC_RAT_RLL_FF")).toBe(false);
  });
});

describe("其它签名与纪律", () => {
  it("I 项单边偏置 → 先要求查重心，再给降 I 的建议", () => {
    const i = rollOf(axisDoc({ lagSamples: 0, tarAmp: 70, errAmp: 60, iConst: 0.4 }))!
      .suggestions.find((s) => s.param?.name === "ATC_RAT_RLL_I");
    expect(i).toBeDefined();
    expect(i!.text).toContain("重心");
  });

  it("D 项输出远大于误差 → 建议降 D", () => {
    const d = rollOf(axisDoc({ lagSamples: 0, tarAmp: 70, errAmp: 60, dAmp: 60 }))!
      .suggestions.find((s) => s.param?.name === "ATC_RAT_RLL_D");
    expect(d).toBeDefined();
    expect(d!.param!.to).toBeLessThan(0.005);
  });

  it("样本不足 → 取证返回 null（由规则判 insufficient_data，而不是编数字）", () => {
    const doc = makeDoc({
      vehicleKind: "copter",
      series: [
        makeSeries("PIDR", 0, uniformTime(20, DT), {
          Tar: sineWave(20, DT, 0.5, 70),
          Act: sineWave(20, DT, 0.5, 70),
          Err: constant(20, 0),
          P: constant(20, 0),
          I: constant(20, 0),
          D: constant(20, 0),
          FF: constant(20, 0),
        }),
      ],
      params: PARAMS,
      durationSec: 20 * DT,
    });
    expect(collectRateTuning(createRuleContext(doc), SPEC, { startSec: 0, endSec: 2 })).toBeNull();
  });
});
