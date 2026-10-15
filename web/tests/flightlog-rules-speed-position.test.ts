/**
 * 速度环 / 位置环跟踪规则（ruleId: speed_position_tracking）测试。
 *
 * 关键纪律（真实语料实测，见 rules/speedPositionChannels.ts 头部）：
 *  ① Plane 没有 PSCN/PSCE（实测 0 条）→ 整条规则不得判 missing_required，必须 not_applicable + 原因；
 *  ② CTUN.AsT 不是有效目标空速 → 空速判据只认 TECS spdem/sp；没有 TECS 判无法判断并说明；
 *  ③ 偏差列（XT/AltE/XTrack）恒为 0 = 没有数据 → insufficient_data，绝不 passed；
 *  ④ 激励不足（悬停）→ insufficient_data，不误报；
 *  ⑤ 米制阈值按机型分档（Copter 0.5/2 m vs Plane 20/45 m），测试按机型取表、不写死数字。
 */

import { describe, expect, it } from "vitest";
import { speedPositionTrackingRule } from "@/lib/flightlog/analysis/rules/speedPositionTracking";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { SPEED_POSITION } from "@/lib/flightlog/analysis/thresholds";
import type { LogDocument } from "@/lib/flightlog/types/log";
import type { Finding } from "@/lib/flightlog/types/report";
import { makeDoc, makeSeries, sineWave, uniformTime } from "./helpers/flightlogFixture";
import {
  COPTER_ALT, COPTER_POS, CRUISE, FAST, PLANE_ALT, PLANE_POS, POS_OK, SLOW, SPEED_DT,
  SPEED_DURATION, SPEED_N, SQRT2, WARN_RATIO_ERR, copterDoc, planeDoc,
} from "./flightlog-rules-speed-fixture";

function run(doc: LogDocument): Finding[] {
  return speedPositionTrackingRule.run(createRuleContext(doc));
}

/** 标题形如 "速度环 / 位置环跟踪（速度环（北向））" → 取括号里的通道名 */
function subjectOf(f: Finding): string {
  const open = f.title.indexOf("（");
  return open < 0 ? f.title : f.title.slice(open + 1, -1);
}

function bySubject(doc: LogDocument, subject: string): Finding | undefined {
  return subjectIn(run(doc), subject);
}

function subjectIn(findings: readonly Finding[], subject: string): Finding | undefined {
  return findings.find((f) => subjectOf(f) === subject);
}
describe("速度环 / 位置环跟踪规则 · Copter", () => {
  it("健康日志：速度环三轴 + 位置环三通道全部通过；空速环按机型判不适用", () => {
    const doc = copterDoc();
    const findings = run(doc);
    // 6 个 PSC 通道 + 1 条"多旋翼没有空速"的结构性不适用
    expect(findings).toHaveLength(7);
    expect(bySubject(doc, "空速环")?.status).toBe("not_applicable");
    for (const f of findings.filter((x) => subjectOf(x) !== "空速环")) {
      expect(f.status).toBe("passed");
      expect(f.charts).toHaveLength(1);
      expect(f.charts[0].signals).toHaveLength(3);
      expect(f.evidence.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("速度跟踪差判 fired（比值判据），位置偏差大判 fired（绝对米判据，按机型取表）", () => {
    const vel = bySubject(copterDoc({ velErrAmp: FAST * WARN_RATIO_ERR }), "速度环（北向）");
    expect(vel?.status).toBe("fired");
    expect(vel?.metrics.errRatio).toBeGreaterThanOrEqual(SPEED_POSITION.errRatioWarning);

    const pos = bySubject(copterDoc({ posErrAmp: COPTER_POS.critM * 2 }), "位置环（北向）");
    expect(pos?.status).toBe("fired");
    expect(pos?.severity).toBe("critical");
    // 米制阈值必须来自**该机型**的表（Copter 0.5/2 m，Plane 20/45 m，差两个数量级）
    expect(pos?.charts[0].thresholds.map((t) => t.value)).toEqual([COPTER_POS.warnM, COPTER_POS.critM]);
  });

  it("悬停：速度环（比值判据）判 insufficient_data，位置/高度环（绝对量）照常判", () => {
    const doc = copterDoc({ targetAmp: SLOW });
    // 比值判据保留激励门槛：小分母会让比值放大 → 不做判定
    const vel = bySubject(doc, "速度环（北向）");
    expect(vel?.status).toBe("insufficient_data");
    expect(vel?.severity).toBe("unknown");
    expect(vel?.note).toContain("不代表通过");
    // 绝对量判据（裁决 2）没有激励门槛：位置/高度照样出结论（这里是 healthy → passed）
    for (const subject of ["位置环（北向）", "高度环（垂向位置）"]) {
      const f = bySubject(doc, subject);
      expect(f?.status, subject).toBe("passed");
      expect(f?.evidence.some((e) => e.detail.includes("不设激励门槛"))).toBe(true);
    }
  });

  it("样本不足时判 insufficient_data 并给出门槛数字", () => {
    const f = bySubject(copterDoc({ count: SPEED_POSITION.minSamples - 1 }), "速度环（北向）");
    expect(f?.status).toBe("insufficient_data");
    expect(f?.note).toContain(String(SPEED_POSITION.minSamples));
  });
});

describe("速度环 / 位置环跟踪规则 · Plane（⚠️ 无 PSC 的回归）", () => {
  it("⚠️ 回归：固定翼没有 PSCN/PSCE 时，整条规则不得判 missing_required", () => {
    const findings = run(planeDoc());

    expect(findings.some((f) => f.status === "missing_required")).toBe(false);
    const psc = subjectIn(findings, "速度环（PSC）");
    expect(psc?.status).toBe("not_applicable");
    expect(psc?.note).toContain("PSCN/PSCE/PSCD");
    // TECS/NTUN 通道照常出结论（这才是本次要实现的外环）
    expect(subjectIn(findings, "空速环")?.status).toBe("passed");
    expect(subjectIn(findings, "航迹横向偏差")?.status).toBe("passed");
    expect(subjectIn(findings, "高度偏差")?.status).toBe("passed");
  });

  it("空速判据用 TECS spdem/sp（≈15 m/s），而不是 CTUN.AsT（≈1）", () => {
    const air = bySubject(planeDoc({ airspeedErrMps: CRUISE * WARN_RATIO_ERR * SQRT2 }), "空速环");
    expect(air?.metrics.targetRms).toBeGreaterThan(10);
    expect(air?.status).toBe("fired");
  });

  it("没有 TECS 时空速判 missing_required，并说明 AsT 不能顶替", () => {
    const air = bySubject(planeDoc({ tecs: false }), "空速环");
    expect(air?.status).toBe("missing_required");
    expect(air?.severity).toBe("unknown");
    expect(air?.note).toContain("TECS");
    expect(air?.note).toContain("AsT");
  });

  it("⚠️ 偏差列恒为 0（没飞航迹）= 没有数据 → insufficient_data，绝不 passed", () => {
    const zero = bySubject(planeDoc({ xtAmp: 0, altAmp: 0 }), "航迹横向偏差");
    expect(zero?.status).toBe("insufficient_data");
    expect(zero?.severity).toBe("unknown");
    expect(zero?.note).toContain("恒为 0");
  });

  it("横向偏差/高度偏差超阈值判 fired（绝对米判据）", () => {
    const xt = bySubject(planeDoc({ xtAmp: PLANE_POS.critM * 2 }), "航迹横向偏差");
    expect(xt?.status).toBe("fired");
    expect(xt?.severity).toBe("critical");
    expect(xt?.charts[0].thresholds.map((t) => t.value)).toEqual([PLANE_POS.warnM, PLANE_POS.critM]);

    const alt = bySubject(planeDoc({ altAmp: PLANE_ALT.critM * 2 }), "高度偏差");
    expect(alt?.status).toBe("fired");
  });
});

describe("速度环 / 位置环跟踪规则 · Rover 与准入", () => {
  it("Rover：空速环与 PSC 通道判 not_applicable，XTrack 照常评估", () => {
    const doc = makeDoc({
      vehicleKind: "rover",
      vehicle: "ArduRover",
      durationSec: SPEED_DURATION,
      series: [makeSeries("NTUN", 0, uniformTime(SPEED_N, SPEED_DT), {
        XTrack: sineWave(SPEED_N, SPEED_DT, 0.1, POS_OK),
      })],
    });
    expect(bySubject(doc, "空速环")?.status).toBe("not_applicable");
    expect(bySubject(doc, "位置环（PSC）")?.status).toBe("not_applicable");
    expect(bySubject(doc, "航迹横向偏差")?.status).toBe("passed");
    expect(run(doc).some((f) => f.status === "missing_required")).toBe(false);
  });

  it("⚠️ 回归：appliesTo.requires 必须为空（机型专有消息不得当整条规则门槛）", () => {
    for (const applies of speedPositionTrackingRule.appliesTo) {
      expect(applies.requires).toEqual([]);
      expect(applies.optional).toContain("PSCN");
    }
  });
  it("缺 arm 窗口时只出一条全局 insufficient_data，不编造分通道结论", () => {
    const findings = run(makeDoc({ series: [], durationSec: 0 }));
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("insufficient_data");
  });
});
