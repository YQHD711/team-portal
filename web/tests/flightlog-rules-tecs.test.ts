/**
 * 固定翼 TECS 规则：适用性、四个量、unknown 一侧纪律，以及 9 份真实 Plane 日志的**阈值标定**。
 *
 * 语料门控：读文件必须在 `it` 体内惰性执行（describe 回调在收集阶段也会跑）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { parseDataflash } from "@/lib/flightlog/dataflash";
import { tecsTrackingRule } from "@/lib/flightlog/analysis/rules/tecsTracking";
import { TECS } from "@/lib/flightlog/analysis/thresholds";
import { makeDoc, makeSeries, uniformTime } from "./helpers/flightlogFixture";
import { corpusRoot, manifest } from "./flightlog-corpus-fixture";

const RULE = tecsTrackingRule;
const N = 120;
const DT = 0.2;

/** 造 Plane 日志：sp/h 在目标附近抖动；th/ph 可控 */
function planeDoc(opts: { airErr?: number; altErr?: number; th?: (i: number) => number; ph?: (i: number) => number; count?: number } = {}) {
  const count = opts.count ?? N;
  const time = uniformTime(count, DT);
  const sp = Array.from({ length: count }, (_, i) => 20 + Math.sin(i / 5) * 0.4);
  const spdem = sp.map((v, i) => v + (opts.airErr ? Math.sin(i) * opts.airErr : 0));
  const h = Array.from({ length: count }, (_, i) => 100 + Math.cos(i / 7) * 1.0);
  const hdem = h.map((v, i) => v + (opts.altErr ? Math.cos(i) * opts.altErr : 0));
  const series = makeSeries("TECS", 0, time, {
    sp, spdem, h, hdem,
    th: Array.from({ length: count }, (_, i) => (opts.th ? opts.th(i) : 0.5)),
    ph: Array.from({ length: count }, (_, i) => (opts.ph ? opts.ph(i) : 5)),
    pmin: Array.from({ length: count }, () => -20),
    pmax: Array.from({ length: count }, () => 20),
  });
  return { ...makeDoc({ vehicleKind: "plane", vehicle: "ArduPlane", series: [series] }), params: {} };
}

describe("TECS 规则：适用性", () => {
  it("Copter/Sub/Rover → not_applicable（不是 missing_required），并说明原因", () => {
    for (const kind of ["copter", "sub", "rover"] as const) {
      const doc = makeDoc({ vehicleKind: kind, vehicle: `Ardu${kind}` });
      const [f] = RULE.run(createRuleContext(doc));
      expect(f.status).toBe("not_applicable");
      expect(f.severity).toBe("unknown");
      expect(f.note).toContain("固定翼专用");
      expect(f.status).not.toBe("missing_required");
      expect(f.status).not.toBe("passed");
    }
  });

  it("Plane 但没有 TECS 序列 → missing_required（不判 passed）", () => {
    const [f] = RULE.run(createRuleContext(makeDoc({ vehicleKind: "plane", vehicle: "ArduPlane" })));
    expect(f.status).toBe("missing_required");
    expect(f.note).toContain("TECS");
  });

  it("样本不足 → insufficient_data 且给出门槛数字", () => {
    const doc = planeDoc({ count: TECS.minSamples - 10 });
    const [f] = RULE.run(createRuleContext(doc));
    expect(f.status).toBe("insufficient_data");
    expect(f.note).toContain(String(TECS.minSamples));
  });
});

describe("TECS 规则：四个量与判定", () => {
  it("跟踪良好 → passed，四个量齐全、每项都有 evidence 与 charts", () => {
    const [f] = RULE.run(createRuleContext(planeDoc()));
    expect(f.status).toBe("passed");
    expect(Object.keys(f.metrics).sort()).toEqual(["airspeedErrRmsMps", "heightErrRmsM", "pitchSatRatio", "throttleSatRatio"]);
    expect(f.metrics.airspeedErrRmsMps).toBeLessThan(TECS.airspeedErrWarningMps);
    expect(f.evidence.length).toBeGreaterThanOrEqual(5);
    expect(f.charts).toHaveLength(4);                     // 空速/高度/油门/俯仰
    expect(f.charts.every(c => c.kind === "timeseries")).toBe(true);
    expect(f.window).not.toBeNull();
  });

  it("空速跟踪误差大 → fired + critical（越过严重阈值）", () => {
    // 正弦误差幅度 A 的 RMS ≈ A/√2，注入留 20% 余量保证明确越过严重阈值
    const [f] = RULE.run(createRuleContext(planeDoc({ airErr: TECS.airspeedErrCriticalMps * 1.2 * Math.SQRT2 })));
    expect(f.status).toBe("fired");
    expect(f.severity).toBe("critical");
    expect(f.phenomenon).toContain("空速跟踪误差 RMS");
    expect(f.suggestions.some(s => s.param?.name === "TECS_TIME_CONST")).toBe(true);
  });

  it("油门饱和占比：按实测分位数重定档后，一半样本顶到 1 只算 warning", () => {
    // ⚠️ 阈值已按 7 份真实 Plane 日志标定：实测双峰分布（0–0.44 与 0.98–1.0 之间没有中间值），
    // 所以 warn=0.8 / crit=0.95。0.5 落在"正常簇"上，**不该**判 critical —— 否则一半真实日志都报警。
    const [f] = RULE.run(createRuleContext(planeDoc({ th: i => (i % 2 === 0 ? 0.995 : 0.5) })));
    expect(f.metrics.throttleSatRatio).toBeCloseTo(0.5, 2);
    expect(f.severity).not.toBe("critical");   // 不再误报
  });

  it("油门饱和占比：几乎全程顶在极限（实测双峰的上半支）→ critical + 高亮窗口", () => {
    const [f] = RULE.run(createRuleContext(planeDoc({ th: () => 0.995 })));
    expect(f.metrics.throttleSatRatio).toBeGreaterThan(0.95);
    expect(f.severity).toBe("critical");
    expect(f.charts.some(c => c.highlightWindow !== null)).toBe(true);
  });

  it("俯仰饱和占比：触及 pmin/pmax → 计入；阈值只有 warning 档", () => {
    const [f] = RULE.run(createRuleContext(planeDoc({ ph: i => (i % 4 === 0 ? -20 : 5) })));
    expect(f.metrics.pitchSatRatio).toBeCloseTo(0.25, 2);
    expect(f.severity).toBe("warning");
  });

  it("高度跟踪误差大 → 至少 warning", () => {
    const [f] = RULE.run(createRuleContext(planeDoc({ altErr: (TECS.heightErrWarningM + 1) * Math.SQRT2 })));
    expect(f.status).toBe("fired");
    expect(f.metrics.heightErrRmsM).toBeGreaterThan(TECS.heightErrWarningM);
  });

  it("俯仰限幅未记录（pmin/pmax 恒为 0）→ 该项单独落 unknown，不混进「通过」", () => {
    const count = N;
    const time = uniformTime(count, DT);
    const series = makeSeries("TECS", 0, time, {
      sp: Array.from({ length: count }, () => 20),
      spdem: Array.from({ length: count }, () => 20),
      h: Array.from({ length: count }, () => 100),
      hdem: Array.from({ length: count }, () => 100),
      th: Array.from({ length: count }, () => 0.5),
      ph: Array.from({ length: count }, () => 3),
      pmin: Array.from({ length: count }, () => 0),
      pmax: Array.from({ length: count }, () => 0),
    });
    const doc = { ...makeDoc({ vehicleKind: "plane", vehicle: "ArduPlane", series: [series] }), params: {} };

    const fs = RULE.run(createRuleContext(doc));
    const main = fs[0];
    expect(main.status).toBe("passed");                     // 三个能量量都正常
    expect(main.metrics.pitchSatRatio).toBeUndefined();     // 俯仰饱和不参与
    const unknown = fs.find(x => x.title.includes("俯仰饱和占比"))!;
    expect(unknown.status).toBe("insufficient_data");
    expect(unknown.note).toContain("pmin/pmax");
  });
});

// ── 阈值标定：9 份真实 Plane 日志 ────────────────────────────────────────────
const ROOT = corpusRoot();
const HAS_CORPUS = ROOT !== null && existsSync(ROOT);

describe.skipIf(!HAS_CORPUS)("TECS 阈值标定：9 份真实 Plane 日志", () => {
  it("跑通每份 Plane 日志并打印四个量的实测值（供分位数标定）", () => {
    const rows: Record<string, number>[] = [];
    const planeFiles = manifest.files.filter(e => e.banner.startsWith("ArduPlane"));
    expect(planeFiles.length).toBeGreaterThan(0);

    for (const entry of planeFiles) {
      const bytes = new Uint8Array(readFileSync(join(ROOT, entry.file)));
      const { doc } = parseDataflash(bytes);
      const findings = RULE.run(createRuleContext(doc));
      expect(findings.length).toBeGreaterThanOrEqual(1);   // 主结论（+ 可能有"某项无法计算"的 unknown 结论）
      const f = findings[0];
      console.log(`[tecs] ${entry.file} → ${f.status}/${f.severity} air=${(f.metrics.airspeedErrRmsMps ?? 0).toFixed(3)} alt=${(f.metrics.heightErrRmsM ?? 0).toFixed(3)} thrSat=${(f.metrics.throttleSatRatio ?? 0).toFixed(4)} pitSat=${(f.metrics.pitchSatRatio ?? 0).toFixed(4)} samples=${f.evidence[0]?.detail ?? ""}`);
      if (f.status === "passed" || f.status === "fired") rows.push(f.metrics as Record<string, number>);
    }

    for (const key of ["airspeedErrRmsMps", "heightErrRmsM", "throttleSatRatio", "pitchSatRatio"]) {
      const values = rows.map(r => r[key]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      if (values.length === 0) continue;
      const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
      console.log(`[tecs] ${key}: n=${values.length} min=${values[0]} p50=${q(0.5)} p90=${q(0.9)} max=${values[values.length - 1]}`);
    }

    // 只是"能跑出结论"，不做通过/触发的期望（真值应由标定后的阈值决定）
    expect(rows.length).toBeGreaterThan(0);
  }, 20 * 60 * 1000);
});
