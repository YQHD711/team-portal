/**
 * PX4 规则：振动 / 滤波（task-35 第 1 项）。
 * 数据口径（**实测 8 份真实 .ulg** 探测确认，参数名不照抄 ArduPilot）：
 * 数据口径（**实测 8 份真实 .ulg** 探测确认，参数名不照抄 ArduPilot）：
 *  - `vehicle_imu_status:<i>`：`accel_vibration_metric`、`gyro_vibration_metric`、
 *    `accel_clipping[0..2]`（每 IMU 实例一条）
 *  - `sensor_combined:0`：`gyro_rad[0..2]`、`accelerometer_m_s2[0..2]`、
 *    `accelerometer_clipping`（回退口径 + 采样率来源）
 *  - PX4 陷波/滤波**真名**：`IMU_GYRO_NF0_FRQ/NF0_BW`、`IMU_GYRO_DNF_EN/BW/HMC/MIN`、
 *    `IMU_GYRO_CUTOFF`、`IMU_DGYRO_CUTOFF`、`IMU_ACCEL_CUTOFF`、`IMU_GYRO_FFT_*`（无 `INS_HNTCH_*`）
 * 阈值依据：`accel_vibration_metric` < 30 m/s² 为 PX4 官方口径（取 warning 20 / critical 30）；
 * `gyro_vibration_metric` 官方无单值 → 用**实测分布**（8 份 max 0.078–0.591 rad/s）设 0.6/1.0；
 * `clipping > 0` 直接 critical。⚠️ 这些绝对阈值只在 **px4-multirotor** 上标定，其他机型判 unknown。
 * Nyquist 纪律：实测采样 136–221 Hz（Nyquist 68–110 Hz），结构共振常见 50–300 Hz → 不手填 IMU_GYRO_NF0_FRQ，改为建议 FFT 驱动的动态陷波（IMU_GYRO_DNF_EN）。
 */

import type { Finding, Severity } from "../../../../types/report";
import type { Rule, RuleContext } from "../../../../types/rule";
import type { TimeWindow } from "../../../../types/log";
import { makeFinding, step, suggestion, unknownFinding } from "../../../finding";
import { longestWindow } from "../../../windows";
import { detectLanding } from "../../../landingSegment";

const RULE_ID = "px4_vibration_filter";
const TITLE = "PX4 振动与滤波";
const DOC_VIB = "https://docs.px4.io/main/en/debug/vibration_analysis.html";
const DOC_FILTER = "https://docs.px4.io/main/en/config/imu.html";
const STRUCT_BAND: readonly [number, number] = [50, 300];
const ACCEL_VIB_WARN = 20;
const ACCEL_VIB_CRITICAL = 30;
const GYRO_VIB_WARN = 0.6;
const GYRO_VIB_CRITICAL = 1.0;
const MIN_SAMPLES = 10;

type Stats = { n: number; mean: number; max: number };

function statsOf(v: Float64Array | undefined, skip?: TimeWindow | null, time?: Float64Array): Stats | null {
  if (!v || v.length === 0) return null;
  let n = 0, sum = 0, max = -Infinity;
  for (let i = 0; i < v.length; i++) {
    if (skip && time && time[i] >= skip.startSec && time[i] <= skip.endSec) continue;
    const x = v[i];
    if (!Number.isFinite(x)) continue;
    n++; sum += x; if (x > max) max = x;
  }
  return n === 0 ? null : { n, mean: sum / n, max };
}

/** 采样率（Hz）：窗口内 sensor_combined 平均步长的倒数 */
function sampleRate(ctx: RuleContext, w: TimeWindow): number | null {
  const t = ctx.series("sensor_combined", 0)?.timeSec ?? null;
  if (!t || t.length < 2) return null;
  const dts: number[] = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i] < w.startSec || t[i] > w.endSec) continue;
    const dt = t[i] - t[i - 1];
    if (dt > 0) dts.push(dt);
  }
  if (dts.length === 0) return null;
  const meanDt = dts.reduce((a, b) => a + b, 0) / dts.length;
  return meanDt > 0 ? 1 / meanDt : null;
}

function instanceFinding(
  instance: number, accelVib: Stats, gyroVib: Stats, clipMax: number,
  rawHz: number | null, window: TimeWindow, landingBasis: string, nyquist: number | null,
  dnfCurrent: number | null,
): Finding {
  const fired = clipMax > 0 || accelVib.max > ACCEL_VIB_WARN || gyroVib.max > GYRO_VIB_WARN;
  const severity: Severity = !fired ? "ok"
    : clipMax > 0 || accelVib.max > ACCEL_VIB_CRITICAL || gyroVib.max > GYRO_VIB_CRITICAL ? "critical" : "warning";

  return makeFinding({
    ruleId: RULE_ID,
    title: `${TITLE}（IMU${instance}）`,
    severity,
    status: fired ? "fired" : "passed",
    window,
    phenomenon: fired
      ? `IMU${instance} 振动偏高：accel_vibration_metric 峰值 ${accelVib.max.toFixed(1)} m/s²（阈值 ${ACCEL_VIB_WARN}/${ACCEL_VIB_CRITICAL}）、gyro_vibration_metric 峰值 ${gyroVib.max.toFixed(3)} rad/s（阈值 ${GYRO_VIB_WARN}/${GYRO_VIB_CRITICAL}）${clipMax > 0 ? `、clipping ${clipMax} 次` : ""}`
      : `IMU${instance} 振动在阈值内：accel 峰值 ${accelVib.max.toFixed(1)} m/s²、gyro 峰值 ${gyroVib.max.toFixed(3)} rad/s，无 clipping`,
    impact: fired
      ? "振动会污染姿态估计与角速率环，导致姿态抖动、D 项噪声放大（严重时 clipping 会丢数据）"
      : "未发现振动层面的明显问题",
    evidence: [
      step("accel_vibration_metric", `均值 ${accelVib.mean.toFixed(2)} / 峰值 ${accelVib.max.toFixed(2)} m/s²（样本 ${accelVib.n}）`),
      step("gyro_vibration_metric", `均值 ${gyroVib.mean.toFixed(3)} / 峰值 ${gyroVib.max.toFixed(3)} rad/s`),
      step("clipping", `${clipMax} 次（>0 即 critical）`),
      step("采样率 / Nyquist", rawHz === null ? "无法推定采样率" : `${rawHz.toFixed(0)} Hz → Nyquist ${(rawHz / 2).toFixed(0)} Hz；结构共振常见 ${STRUCT_BAND[0]}–${STRUCT_BAND[1]} Hz`),
      step("降落/触地段", landingBasis),
      step("阈值依据", "accel<30 m/s² 为 PX4 官方口径（本切片 20/30）；gyro 官方无单值，取 8 份实测分布（max ≤0.591）设 0.6/1.0；仅在 px4-multirotor 标定"),
    ],
    metrics: { accelVibMax: accelVib.max, gyroVibMax: gyroVib.max, clipping: clipMax, rawRateHz: rawHz ?? 0 },
    suggestions: fired
      ? [
          suggestion(1, "先做机械检查（桨/桨夹/电机座/减震）；clipping > 0 时必须先解决机械问题再谈滤波", {
            verify: "复飞后 accel_vibration_metric 峰值下降 ≥30% 且 clipping 为 0",
          }),
          suggestion(2, dnfCurrent === null
            // 参数名必须**探测存在性**：日志没记录就不能编一个"当前值=0"
            ? "动态陷波开关 IMU_GYRO_DNF_EN 在本日志参数表里**没有记录**，无法确认是否启用 —— 请先在参数表确认；若未启用，建议启用（起点值：启用，由机上 FFT 自动跟踪基频）"
            : `启用飞控动态陷波：IMU_GYRO_DNF_EN ${dnfCurrent} → 1（由机上 FFT 自动跟踪基频，**不需要手填频率**）`, {
            param: dnfCurrent === null ? null : { name: "IMU_GYRO_DNF_EN", from: dnfCurrent, to: 1, reason: "PX4 动态陷波用 FFT 实测峰自动跟随，避免手填频率猜错" },
            verify: "复飞后 gyro_vibration_metric 峰值下降，角速率环 D 项噪声减小",
          }),
          suggestion(3, nyquist === null
            ? "静态陷波频率（IMU_GYRO_NF0_FRQ）必须来自机上 FFT 实测主峰，本次日志无法确认"
            : `静态陷波频率（IMU_GYRO_NF0_FRQ）只能填飞控 FFT 实测主峰（范围见 IMU_GYRO_FFT_MIN/MAX，Nyquist ${nyquist.toFixed(0)} Hz）；**不要**用低频段的峰顶替结构共振峰`, {
            verify: "复飞后频谱上主峰被压低，且无新增低频振荡",
          }),
        ]
      : [],
    docLinks: [DOC_VIB, DOC_FILTER],
    charts: [],
    note: [
      "数值口径为**起点值**：由 PX4 自身振动指标 + 实测分布推得，不是系统辨识出的最优值。",
      landingBasis,
      rawHz !== null && rawHz / 2 < STRUCT_BAND[1]
        ? `⚠️ Nyquist 限制：采样 ${rawHz.toFixed(0)} Hz 只能看到 ≤${(rawHz / 2).toFixed(0)} Hz，${(rawHz / 2).toFixed(0)}–${STRUCT_BAND[1]} Hz 的结构共振**看不见**；需飞控 FFT（IMU_GYRO_FFT_EN=1 且范围覆盖目标频段）判定后再填静态陷波。`
        : "采样率足以覆盖结构共振频段，可用飞控 FFT 判定主峰。",
    ].join(" "),
  });
}

export const px4VibrationFilterRule: Rule = {
  id: RULE_ID,
  title: TITLE,
  category: "vibration",
  appliesTo: [{ platform: "px4", requires: [], optional: ["vehicle_imu_status", "sensor_combined"], note: "PX4：振动指标来自 vehicle_imu_status；陷波/滤波参数是 IMU_GYRO_*（不是 ArduPilot 的 INS_HNTCH_*）" }],
  run(ctx: RuleContext) {
    const w = longestWindow(ctx.armedWindows()) ?? { startSec: 0, endSec: ctx.doc.meta.durationSec };
    const landing = detectLanding(ctx, w);
    const skip = landing.window;
    const rate = sampleRate(ctx, w);
    const nyquist = rate === null ? null : rate / 2;
    const vul = `已排除降落/触地段 ${skip ? `${skip.startSec.toFixed(1)}s–${skip.endSec.toFixed(1)}s` : "（未识别出降落段，常规统计包含落地冲击）"}（依据 ${landing.confidence}）：${landing.basis}`;
    // 参数**探测**：日志没记录就不能编当前值
    const dnfCurrent = ctx.param("IMU_GYRO_DNF_EN");
    // 绝对阈值只在 px4-multirotor 的 8 份实测上标定过；其他机型只给方向，不硬判
    const rated = ctx.doc.meta.vehicleKind === "px4-multirotor";

    const imuKeys = Object.keys(ctx.doc.series).filter(k => k.startsWith("vehicle_imu_status")).sort();
    if (imuKeys.length > 0) {
      const findings: Finding[] = [];
      for (const key of imuKeys) {
        const s = ctx.doc.series[key];
        const instance = Number(key.split(":")[1] ?? 0);
        const accelVib = statsOf(s.fields["accel_vibration_metric"], skip, s.timeSec);
        const gyroVib = statsOf(s.fields["gyro_vibration_metric"], skip, s.timeSec);
        const clip = statsOf(s.fields["accel_clipping[0]"], skip, s.timeSec)?.max ?? 0;
        if (!accelVib || !gyroVib || accelVib.n < MIN_SAMPLES) {
          findings.push(unknownFinding({
            ruleId: RULE_ID, title: `${TITLE}（IMU${instance}）`, status: "insufficient_data",
            note: `IMU${instance} 的 vehicle_imu_status 可用样本不足（门槛 ${MIN_SAMPLES} 条；实测该主题在部分日志里只有 1~15 条）—— 无法给出振动结论，不代表通过。${vul}`,
          }));
          continue;
        }
        if (!rated) {
          findings.push(unknownFinding({
            ruleId: RULE_ID, title: `${TITLE}（IMU${instance}）`, status: "insufficient_data",
            note: `绝对阈值只在 **px4-multirotor**（8 份实测：accel 峰值 3.6–17.3 m/s²、gyro 0.078–0.591 rad/s）上标定；当前机型 ${ctx.doc.meta.vehicleKind} 未标定，**不硬判** —— 请自查：accel 峰值 ${accelVib.max.toFixed(1)} m/s²、gyro ${gyroVib.max.toFixed(3)} rad/s、clipping ${clip}，并确认是否随转速单调上升；主峰判定需飞控 FFT。${vul}`,
          }));
          continue;
        }
        findings.push(instanceFinding(instance, accelVib, gyroVib, clip, rate, w, vul, nyquist, dnfCurrent));
      }
      return findings;
    }

    // 回退口径：只有 sensor_combined（原始峰值只能做定性参考 → 判 unknown）
    const sc = ctx.series("sensor_combined", 0);
    if (!sc) {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "missing_required",
        note: "日志里既没有 vehicle_imu_status 也没有 sensor_combined，无法评估振动（不代表通过）。",
      })];
    }
    const axes = ["0", "1", "2"].map(i => statsOf(sc.fields[`accelerometer_m_s2[${i}]`], skip, sc.timeSec));
    if (axes.every(a => a === null) || (axes[0]?.n ?? 0) < MIN_SAMPLES) {
      return [unknownFinding({
        ruleId: RULE_ID, title: TITLE, status: "insufficient_data",
        note: `sensor_combined 窗口内可用样本不足（门槛 ${MIN_SAMPLES}）—— 无法给出振动结论，**不代表通过**。采样率 ${rate === null ? "未知" : `${rate.toFixed(0)} Hz → Nyquist ${(rate / 2).toFixed(0)} Hz`}。${vul}`,
      })];
    }
    return [makeFinding({
      ruleId: RULE_ID, title: TITLE, severity: "unknown", status: "insufficient_data",
      window: w,
      phenomenon: "只有 sensor_combined（缺 vehicle_imu_status），无法使用 PX4 自身的振动指标",
      impact: "无法据此判断是否超标，也不应据此填写陷波频率",
      evidence: [
        step("加速度峰值", axes.map((a, i) => `轴${i}=${a ? a.max.toFixed(1) : "—"}`).join(" / ") + " m/s²"),
        step("采样率 / Nyquist", rate === null ? "未知" : `${rate.toFixed(0)} Hz → Nyquist ${(rate / 2).toFixed(0)} Hz`),
        step("降落/触地段", vul),
      ],
      metrics: Object.fromEntries(axes.map((a, i) => [`accelMax${i}`, a?.max ?? 0])),
      docLinks: [DOC_VIB],
      note: `缺 vehicle_imu_status，只能用原始加速度峰值做定性参考 —— 判 unknown，**不代表通过**。${vul}`,
    })];
  },
};
