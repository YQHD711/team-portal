/**
 * PX4 参数名与量级（task-34）。**与 ArduPilot 完全不同，必须探测存在性，不许猜**。
 *
 * 实测（本机 27 份真实 `.ulg`，全部为多旋翼）：
 *  - `MC_ROLLRATE_P/I/D/FF/K/MAX`、`MC_PITCHRATE_*`、`MC_YAWRATE_*` 存在；
 *    `MC_ROLLRATE_P` p50 **0.15**（min 0.13 / max 0.15）、`I=0.2`、`D=0.003`、**`FF=0.0`（27/27）**
 *    → 与 ArduPilot Copter 一致：默认无前馈，所以 MC 可以给数值（并保留"不得低于当前值"硬约束）。
 *  - 角度环是 `MC_ROLL_P`（实测 2.5–6.5）、`MC_PITCH_P`、`MC_YAW_P`（0.2）。
 *  - 积分限幅 `MC_RR_INT_LIM=0.3`（另有 `MC_PR_INT_LIM`/`MC_YR_INT_LIM`）。
 *  - 固定翼 `FW_RR_*`/`FW_PR_*`/`FW_YR_*`、`FW_R_TC`/`FW_P_TC` 在**这批语料里一份都没有** →
 *    固定翼只能"探到才用"，探不到就判 unknown/not_applicable 并说明（**不做任何量级假设**）。
 */

import type { RuleContext } from "../../../types/rule";

export type Px4Axis = "roll" | "pitch" | "yaw";
export type Px4Kind = "mc" | "fw" | "unknown";

/** 从 vehicleKind 收敛到 MC/FW 两族（推不出就不猜） */
export function px4Family(vehicleKind: string): Px4Kind {
  if (vehicleKind === "px4-multirotor" || vehicleKind === "copter") return "mc";
  if (vehicleKind === "px4-fixedwing" || vehicleKind === "plane") return "fw";
  return "unknown";
}

const AXIS_SUFFIX: Readonly<Record<Px4Axis, string>> = { roll: "ROLL", pitch: "PITCH", yaw: "YAW" };
const FW_SUFFIX: Readonly<Record<Px4Axis, string>> = { roll: "R", pitch: "P", yaw: "Y" };

export function px4RatePrefixes(family: Px4Kind, axis: Px4Axis): string[] {
  const out: string[] = [];
  if (family === "mc" || family === "unknown") out.push(`MC_${AXIS_SUFFIX[axis]}RATE`);
  if (family === "fw" || family === "unknown") out.push(`FW_${FW_SUFFIX[axis]}R`);
  return out;
}

export interface Px4RateParams {
  /** 实际命中的前缀；null = 该轴速率环参数组不存在 */
  prefix: string | null;
  p: number | null;
  i: number | null;
  d: number | null;
  ff: number | null;
  /** D 项前馈（PX4 多旋翼没有；固定翼可能为 FW_*R_D_FF） */
  dff: number | null;
  /** 积分项限幅（用于判断 I 项是否接近饱和） */
  intLimit: number | null;
  unavailableReason: string | null;
}

/** 积分限幅参数的候选名（MC 实测 `MC_RR_INT_LIM=0.3`；FW 未标定，只做探测） */
export function px4IntLimitCandidates(family: Px4Kind, axis: Px4Axis): string[] {
  const mc = `MC_${axis === "roll" ? "RR" : axis === "pitch" ? "PR" : "YR"}_INT_LIM`;
  const fw = `FW_${FW_SUFFIX[axis]}R_INT_LIM`;
  if (family === "mc") return [mc];
  if (family === "fw") return [fw];
  return [mc, fw];
}

/** 按机型族探测速率环参数；探测不到返回 `prefix=null` + 原因（调用方判 unknown/not_applicable） */
export function resolvePx4RateParams(ctx: RuleContext, family: Px4Kind, axis: Px4Axis): Px4RateParams {
  for (const prefix of px4RatePrefixes(family, axis)) {
    const p = ctx.param(`${prefix}_P`);
    const ff = ctx.param(`${prefix}_FF`);
    const i = ctx.param(`${prefix}_I`);
    const d = ctx.param(`${prefix}_D`);
    if (p === null && ff === null && i === null && d === null) continue;
    let intLimit: number | null = null;
    for (const name of px4IntLimitCandidates(family, axis)) {
      const value = ctx.param(name);
      if (value !== null) {
        intLimit = value;
        break;
      }
    }
    return {
      prefix,
      p,
      i,
      d,
      ff,
      dff: ctx.param(`${prefix}_D_FF`),
      intLimit,
      unavailableReason: null,
    };
  }
  return {
    prefix: null,
    p: null,
    i: null,
    d: null,
    ff: null,
    dff: null,
    intLimit: null,
    unavailableReason:
      `日志里没有探测到该轴速率环参数（尝试过 ${px4RatePrefixes(family, axis).join("、")}）——`
      + "PX4 的参数名按机型族完全不同，测不到就不给数值建议",
  };
}

/** 角度环增益参数（MC 是 P；FW 是时间常数；探测不到就说明） */
export function resolvePx4AngleGain(ctx: RuleContext, family: Px4Kind, axis: Px4Axis): {
  name: string | null; value: number | null; kind: "p" | "timeConstant";
} {
  const candidates: { name: string; kind: "p" | "timeConstant" }[] =
    family === "fw"
      ? [{ name: `FW_${FW_SUFFIX[axis]}_TC`, kind: "timeConstant" }]
      : [{ name: `MC_${AXIS_SUFFIX[axis]}_P`, kind: "p" }];
  for (const candidate of candidates) {
    const value = ctx.param(candidate.name);
    if (value !== null) return { name: candidate.name, value, kind: candidate.kind };
  }
  return { name: null, value: null, kind: family === "fw" ? "timeConstant" : "p" };
}

/**
 * FF 建议策略（按机型实测标定）：
 *  - `mc`：**给数值**。实测 27/27 份 `MC_*RATE_FF = 0`（默认无前馈），与 ArduPilot Copter 同量级；
 *    仍保留硬约束「建议值不得低于当前 FF」。
 *  - `fw` / `unknown`：**只给方向**。这批语料没有一份固定翼 `.ulg`（`FW_RR_*` 一条都没有）
 *    → 量级关系未标定，照抄 MC 的归一化公式正是我们在 ArduPilot Plane 上踩过的坑。
 */
export function px4FfPolicy(family: Px4Kind): { numeric: boolean; basis: string } {
  if (family === "mc") {
    return {
      numeric: true,
      basis: "MC 语料 27/27 份 MC_*RATE_FF=0（默认无前馈），与 ArduPilot Copter 同量级；数值仍受「不低于当前 FF」约束",
    };
  }
  return {
    numeric: false,
    basis: family === "fw"
      ? "固定翼 .ulg 样本 0 份（FW_RR_* 未出现在任何真实日志里），FF 与 P 的量级关系**未标定** → 只给方向"
      : "机型族未识别（既非多旋翼也非固定翼）→ 只给方向",
  };
}
