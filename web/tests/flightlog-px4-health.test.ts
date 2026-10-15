/**
 * PX4 振动/滤波规则（task-35 第 1 项）。
 * 单测用合成 PX4 文档；真实 .ulg 用环境变量门控（默认 QGroundControl 日志目录）。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { parseUlogFile } from "@/lib/flightlog/ulog";
import { px4VibrationFilterRule } from "@/lib/flightlog/analysis/rules/px4/health/vibrationFilter";
import { makeDoc, makeSeries, uniformTime } from "./helpers/flightlogFixture";

const RULE = px4VibrationFilterRule;
const N = 40;

/** 合成 PX4 文档：sensor_combined（200 Hz）+ 可选 vehicle_imu_status 实例 */
function px4Doc(opts: { status?: { instance: number; accelVib: number; gyroVib: number; clip?: number; n?: number }[]; withCombined?: boolean; kind?: "px4-multirotor" | "px4-fixedwing"; dnf?: number } = {}) {
  const series = [];
  if (opts.withCombined !== false) {
    const t = uniformTime(400, 0.005);
    series.push(makeSeries("sensor_combined", 0, t, {
      "gyro_rad[0]": t.map(() => 0.01), "gyro_rad[1]": t.map(() => 0.01), "gyro_rad[2]": t.map(() => 0.01),
      "accelerometer_m_s2[0]": t.map(() => 0.2), "accelerometer_m_s2[1]": t.map(() => 0.1), "accelerometer_m_s2[2]": t.map(() => -9.8),
      accelerometer_clipping: t.map(() => 0),
    }));
  }
  for (const st of opts.status ?? []) {
    const n = st.n ?? N;
    const t = uniformTime(n, 1);
    series.push(makeSeries("vehicle_imu_status", st.instance, t, {
      accel_vibration_metric: t.map((_, i) => (i === 0 ? st.accelVib : st.accelVib * 0.8)),
      gyro_vibration_metric: t.map((_, i) => (i === 0 ? st.gyroVib : st.gyroVib * 0.8)),
      "accel_clipping[0]": t.map((_, i) => (i === 0 ? st.clip ?? 0 : 0)),
      accel_rate_hz: t.map(() => 1000),
    }));
  }
  const doc = makeDoc({ platform: "px4", vehicleKind: opts.kind ?? "px4-multirotor", vehicle: "PX4", firmwareVersion: "1.15.4", versionNumeric: 11504, series });
  const params: Record<string, number> = {};
  if (opts.dnf !== undefined) params.IMU_GYRO_DNF_EN = opts.dnf;
  return { ...doc, params };
}

const run = (doc: ReturnType<typeof px4Doc>) => RULE.run(createRuleContext(doc));

describe("PX4 振动/滤波规则：判定", () => {
  it("健康机架（accel 峰值 10 / gyro 0.1 / 无 clipping）→ passed，且不推参数", () => {
    const [f] = run(px4Doc({ status: [{ instance: 0, accelVib: 10, gyroVib: 0.1 }] }));
    expect(f.status).toBe("passed");
    expect(f.severity).toBe("ok");
    expect(f.suggestions).toHaveLength(0);
    expect(f.note).toContain("起点值");
    expect(f.note).toContain("Nyquist");            // Nyquist 限制逐条声明
    expect(f.note).toContain("降落");                // 降落段排除依据
  });

  it("振动偏高（accel 峰值 25）→ warning/fired，建议启用动态陷波（真实参数名）", () => {
    const [f] = run(px4Doc({ status: [{ instance: 0, accelVib: 25, gyroVib: 0.2 }], dnf: 0 }));
    expect(f.severity).toBe("warning");
    expect(f.status).toBe("fired");
    const dnf = f.suggestions.find(s => s.param?.name === "IMU_GYRO_DNF_EN")!;
    expect(dnf.param).toMatchObject({ from: 0, to: 1 });      // 真名 + 具体数值
    expect(dnf.verify).toBeTruthy();                          // 六要素：复飞验证指标
    expect(f.docLinks.join()).toContain("vibration_analysis");
  });

  it("clipping > 0 → critical，且先给机械检查（不先推滤波）", () => {
    const [f] = run(px4Doc({ status: [{ instance: 0, accelVib: 18, gyroVib: 0.2, clip: 3 }], dnf: 0 }));
    expect(f.severity).toBe("critical");
    expect(f.suggestions[0].text).toContain("机械检查");
    expect(f.suggestions.some(s => s.param?.name === "IMU_GYRO_DNF_EN")).toBe(true);
  });

  it("参数未记录时**不编当前值**：不给 param，只给方向并写明无法确认", () => {
    const [f] = run(px4Doc({ status: [{ instance: 0, accelVib: 25, gyroVib: 0.2 }] }));   // 不给 dnf → 参数表里没有
    const s = f.suggestions.find(x => x.text.includes("IMU_GYRO_DNF_EN"))!;
    expect(s).toBeDefined();
    expect(s.param ?? null).toBeNull();                  // 不许编 from=0
    expect(s.text).toContain("没有记录");
  });

  it("机型未标定（px4-fixedwing）：不套用多旋翼阈值，判 unknown 并摆出实测值", () => {
    const [f] = run(px4Doc({ status: [{ instance: 0, accelVib: 45, gyroVib: 3 }], kind: "px4-fixedwing" }));
    expect(f.status).toBe("insufficient_data");
    expect(f.severity).toBe("unknown");
    expect(f.note).toContain("未标定");
    expect(f.note).toContain("px4-multirotor");
  });

  it("多实例：**按实例分别判定**，不混成一个数组", () => {
    const fs = run(px4Doc({ status: [
      { instance: 0, accelVib: 10, gyroVib: 0.1 },
      { instance: 1, accelVib: 32, gyroVib: 0.1 },
    ] }));
    expect(fs).toHaveLength(2);
    expect(fs.map(f => f.title)).toEqual(["PX4 振动与滤波（IMU0）", "PX4 振动与滤波（IMU1）"]);
    expect(fs[0].status).toBe("passed");
    expect(fs[1].severity).toBe("critical");   // accel 32 > 30
  });

  it("样本不足（vehicle_imu_status 只有 3 条）→ insufficient_data 且给门槛数字", () => {
    const [f] = run(px4Doc({ status: [{ instance: 0, accelVib: 40, gyroVib: 2, n: 3 }] }));
    expect(f.status).toBe("insufficient_data");
    expect(f.note).toContain("门槛 10");
    expect(f.severity).toBe("unknown");
  });

  it("两个主题都缺 → missing_required（不判通过）", () => {
    const [f] = run(px4Doc({ withCombined: false }));
    expect(f.status).toBe("missing_required");
    expect(f.note).toContain("不代表通过");
  });

  it("只有 sensor_combined（缺 vehicle_imu_status）→ unknown/insufficient_data，不用原始峰值硬判", () => {
    const [f] = run(px4Doc({}));
    expect(f.status).toBe("insufficient_data");
    expect(f.severity).toBe("unknown");
    expect(f.note).toContain("不代表通过");
    expect(f.note).toContain("Nyquist");
  });
});

// ── 真实 .ulg（环境变量门控，不硬编码路径） ──────────────────────────────────
const DIR = process.env.FLIGHTLOG_ULOG_DIR ?? "C:\\Users\\asus1\\Documents\\QGroundControl\\Logs";
const FILES = existsSync(DIR) ? readdirSync(DIR, { recursive: true }).map(String).filter(f => f.endsWith(".ulg")).slice(0, 8) : [];

describe.skipIf(FILES.length === 0)("PX4 振动/滤波规则：真实 .ulg（8 份）", () => {
  it("每份都有结论、不抛异常，并打印实测分布", async () => {
    const rows: { file: string; statuses: string[]; accelMax: number; gyroMax: number; rate: number }[] = [];
    for (const rel of FILES) {
      const bytes = new Uint8Array(readFileSync(join(DIR, rel)));
      const { doc } = await parseUlogFile(bytes, { forceMainThread: true });
      const findings = RULE.run(createRuleContext(doc));
      expect(findings.length).toBeGreaterThan(0);
      const accelMax = Math.max(...findings.map(f => Number(f.metrics.accelVibMax ?? 0)));
      const gyroMax = Math.max(...findings.map(f => Number(f.metrics.gyroVibMax ?? 0)));
      rows.push({ file: rel, statuses: findings.map(f => f.status), accelMax, gyroMax, rate: Number(findings[0]?.metrics.rawRateHz ?? 0) });
      console.log(`[px4-vib] ${rel} → ${findings.map(f => `${f.title}=${f.status}/${f.severity}`).join(" | ")}`);
    }
    for (const r of rows) console.log(`[px4-vib] dist ${r.file}: accelMax=${r.accelMax.toFixed(1)} gyroMax=${r.gyroMax.toFixed(3)} rate=${r.rate.toFixed(0)}Hz statuses=${JSON.stringify(r.statuses)}`);
    const fired = rows.filter(r => r.statuses.includes("fired") || r.statuses.includes("critical")).length;
    const unknown = rows.filter(r => r.statuses.includes("insufficient_data") || r.statuses.includes("missing_required")).length;
    console.log(`[px4-vib] 8 份汇总：fired/severe=${fired} unknown 一侧=${unknown} passed=${rows.length - fired - unknown}`);
    expect(rows.length).toBeGreaterThan(0);
  }, 20 * 60 * 1000);
});
