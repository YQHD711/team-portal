/**
 * PX4 控制环测试夹具（非 test 文件，不会被 vitest 收集）。
 *
 * 字段名与**真实 ULog 完全一致**：`vehicle_rates_setpoint.roll`、
 * `vehicle_angular_velocity.xyz[0..2]`、`vehicle_attitude.q[0..3]`、
 * `vehicle_attitude_setpoint.roll_body`（弧度）、`rate_ctrl_status.rollspeed_integ`。
 * 参数默认值取真实语料实测值（`MC_ROLLRATE_P=0.15`、`I=0.2`、`D=0.003`、`FF=0`、`MC_*_INT_LIM=0.3`）。
 */

import type { LogDocument, Series } from "@/lib/flightlog/types/log";
import type { Rule } from "@/lib/flightlog/types/rule";
import { createRuleContext } from "@/lib/flightlog/analysis/context";
import { makeDoc, makeSeries, uniformTime, sineWave, constant } from "./helpers/flightlogFixture";

export const DT = 0.01;
export const N = 3000;

export const MC_PARAMS: Record<string, number> = {
  MC_ROLLRATE_P: 0.15, MC_ROLLRATE_I: 0.2, MC_ROLLRATE_D: 0.003, MC_ROLLRATE_FF: 0, MC_ROLLRATE_K: 0.87,
  MC_PITCHRATE_P: 0.15, MC_PITCHRATE_I: 0.2, MC_PITCHRATE_D: 0.003, MC_PITCHRATE_FF: 0,
  MC_YAWRATE_P: 0.2, MC_YAWRATE_I: 0.1, MC_YAWRATE_D: 0, MC_YAWRATE_FF: 0,
  MC_ROLL_P: 6.5, MC_PITCH_P: 6.5, MC_YAW_P: 2.5,
  MC_RR_INT_LIM: 0.3, MC_PR_INT_LIM: 0.3, MC_YR_INT_LIM: 0.3,
};

export interface Px4DocOptions {
  /** 误差/指令比值（误差用另一频率的正弦叠在指令上） */
  errRatio: number;
  /** 实际滞后指令的采样数 */
  lagSamples?: number;
  /** 让实际角速率与指令**不相关**（用于验证可信度门槛） */
  uncorrelatedActual?: boolean;
  /** 实际滚转角（度） */
  rollDeg?: number;
  /** 实际偏航角（度） */
  yawDeg?: number;
  /** 指令与实际的角度差（度）；0 = 完全跟踪 */
  cmdDiffDeg?: number;
  /** 角度指令的**变化幅度**（度，正弦）；0 = 指令恒定（"没动"） */
  cmdAmpDeg?: number;
  /** yaw 指令与实际**同步**变化的幅度（度）——用于验证 ±180° 环绕 */
  yawAmpDeg?: number;
  withAngularVelocity?: boolean;
  /** 是否记录 actuator 组（控制量） */
  withControls?: boolean;
  /** 制造饱和：control[0] 有 30% 样本贴到 1.0（其余通道常态 0.3） */
  saturated?: boolean;
  /** 制造单边顶住：control[1] 恒 0.45（同号 100%、std=0） */
  singleSideBias?: boolean;
  withAttitude?: boolean;
  params?: Record<string, number>;
  extra?: Series[];
}

/** 造一份 PX4 文档 */
export function px4Doc(options: Px4DocOptions): LogDocument {
  const lag = options.lagSamples ?? 0;
  const time = uniformTime(N, DT);
  const tar = Array.from(sineWave(N, DT, 0.5, 4)) as number[];
  const act = tar.map((_, i) => (i >= lag ? tar[i - lag] : 0));
  const err = Array.from(sineWave(N, DT, 2.5, options.errRatio * 4)) as number[];
  // 不相关：确定性伪随机序列（在 ±0.3 s 搜索范围内与任何正弦都不相关，用于验证可信度门槛）
  const actFinal = options.uncorrelatedActual
    ? Array.from({ length: N }, (_, i) => {
        const x = Math.sin(i * 12.9898) * 43758.5453;
        return ((x - Math.floor(x)) * 2 - 1) * 3;
      })
    : act;

  const series: Series[] = [
    makeSeries("vehicle_rates_setpoint", 0, time, {
      roll: tar.map((v, i) => v + err[i]),
      pitch: tar.map((v, i) => v + err[i]),
      yaw: tar.map((v, i) => v + err[i] * 0.5),
      "thrust_body[0]": constant(N, 0), "thrust_body[1]": constant(N, 0), "thrust_body[2]": constant(N, -0.5),
    }),
    makeSeries("rate_ctrl_status", 0, time, {
      rollspeed_integ: constant(N, 0.01), pitchspeed_integ: constant(N, 0), yawspeed_integ: constant(N, 0),
    }),
  ];
  if (options.withAngularVelocity !== false) {
    series.push(
      makeSeries("vehicle_angular_velocity", 0, time, {
        "xyz[0]": actFinal, "xyz[1]": actFinal, "xyz[2]": actFinal,
        "xyz_derivative[0]": constant(N, 0), "xyz_derivative[1]": constant(N, 0), "xyz_derivative[2]": constant(N, 0),
      }),
    );
  }

  if (options.withControls !== false) {
    const controls: Record<string, number[]> = {};
    for (let ch = 0; ch < 8; ch += 1) {
      const base = 0.3;
      if (options.saturated === true && ch === 0) {
        controls[`control[${ch}]`] = Array.from({ length: N }, (_, i) => (i < N * 0.3 ? 1.0 : 0.4));
      } else if (options.singleSideBias === true && ch === 1) {
        controls[`control[${ch}]`] = constant(N, 0.85) as number[];
      } else {
        controls[`control[${ch}]`] = constant(N, base) as number[];
      }
    }
    series.push(makeSeries("actuator_controls_0", 0, time, controls));
    series.push(
      makeSeries("vehicle_torque_setpoint", 0, time, {
        "xyz[0]": constant(N, options.saturated === true ? 0.97 : 0.1),
        "xyz[1]": constant(N, 0.1), "xyz[2]": constant(N, 0.1),
      }),
    );
  }

  if (options.withAttitude !== false) {
    const deg2rad = Math.PI / 180;
    const rollRad = (options.rollDeg ?? 0) * deg2rad;
    const yawRad = (options.yawDeg ?? 0) * deg2rad;
    const cmdRoll = rollRad - (options.cmdDiffDeg ?? 11.5) * deg2rad;
    // 绕 X 再绕 Z 的四元数（Hamilton，body→NED）
    const q = (r: number, y: number): [number, number, number, number] => [
      Math.cos(r / 2) * Math.cos(y / 2), Math.sin(r / 2) * Math.cos(y / 2),
      -Math.sin(r / 2) * Math.sin(y / 2), Math.cos(r / 2) * Math.sin(y / 2),
    ];
    // yaw 可同步变化：实际（四元数）与指令用同一序列 → 误差应恒为 0，即使跨越 ±180°
    const yawAmpRad = (options.yawAmpDeg ?? 0) * deg2rad;
    const yawSeries = Array.from({ length: N }, (_, i) =>
      yawRad + yawAmpRad * Math.sin(2 * Math.PI * 0.05 * i * DT),
    );
    const identityYaw = Math.abs(yawAmpRad) < 1e-12;
    const qa = q(rollRad, yawRad);
    series.push(
      makeSeries("vehicle_attitude", 0, time, {
        "q[0]": identityYaw ? constant(N, qa[0]) : yawSeries.map((y) => q(rollRad, y)[0]),
        "q[1]": identityYaw ? constant(N, qa[1]) : yawSeries.map((y) => q(rollRad, y)[1]),
        "q[2]": identityYaw ? constant(N, qa[2]) : yawSeries.map((y) => q(rollRad, y)[2]),
        "q[3]": identityYaw ? constant(N, qa[3]) : yawSeries.map((y) => q(rollRad, y)[3]),
      }),
      makeSeries("vehicle_attitude_setpoint", 0, time, {
        // 指令 = 基准角 + 缓慢正弦变化（std>0 才算"有激励"；恒定指令是"没动"）
        roll_body: sineWave(N, DT, 0.05, (options.cmdAmpDeg ?? 0) * deg2rad).map((v) => v + cmdRoll),
        pitch_body: sineWave(N, DT, 0.05, (options.cmdAmpDeg ?? 0) * deg2rad).map((v) => v),
        yaw_body: identityYaw
          ? sineWave(N, DT, 0.05, (options.cmdAmpDeg ?? 0) * deg2rad).map((v) => v + yawRad)
          : yawSeries,
        "thrust_body[0]": constant(N, 0), "thrust_body[1]": constant(N, 0), "thrust_body[2]": constant(N, -0.5),
      }),
    );
  }

  return makeDoc({
    platform: "px4",
    vehicle: "PX4",
    vehicleKind: "px4-multirotor",
    firmwareVersion: "1.15.4",
    versionNumeric: 11504,
    series: [...series, ...(options.extra ?? [])],
    durationSec: N * DT,
    params: options.params ?? MC_PARAMS,
  });
}

/** 带"实际滞后 2 采样"的默认速率环场景 */
export function px4RateDoc(errRatio: number): LogDocument {
  return px4Doc({ errRatio, lagSamples: 2 });
}

/** PX4 规则还没在 rules/index.ts 注册（归 Lead），测试直接调 run(ctx) */
export function runRule(rule: Rule, doc: LogDocument) {
  return rule.run(createRuleContext(doc));
}

/** 从标题里取分级（`（Roll · C 级）` → C） */
export function gradeOf(f: { title: string }): string {
  return f.title.match(/· ([A-D]) 级/)?.[1] ?? "?";
}
