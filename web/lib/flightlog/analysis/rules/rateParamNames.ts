/**
 * 速率环参数的**机型命名与量级**（task-36：由 Lead 从真实 ArduPlane 4.6.1 日志 + 76 份语料实测确认）。
 *
 * ⚠️ 两条都踩过坑，必须按机型区分：
 *  ① **参数名**：Copter 是 `ATC_RAT_RLL_*`；固定翼是 `RLL_RATE_*`/`PTCH_RATE_*`
 *     （**不是** `RLL2SRV_*` —— 那套只剩 `RMAX/TCONST` 这类外环量；固定翼上**完全没有** `ATC_RAT_*`）。
 *     固定翼的 yaw 速率环连参数组都不存在，只有开关 `YAW_RATE_ENABLE`。
 *  ② **数值量级**：Copter 语料 66/66 份 `ATC_RAT_RLL_FF = 0`；固定翼 9/9 份 `RLL_RATE_FF = 0.345`、
 *     `RLL_RATE_P = 0.08` → **FF/P ≈ 4.31（出厂默认值）**。所以任何"FF 不超过 P 的 60%"这类
 *     **绝对上限都只对 Copter 成立**，用在固定翼上会把 FF 从 0.345 建议到 0.048（方向完全相反）。
 *
 * 因此本模块提供：① 按机型声明 + `ctx.param` **存在性探测**（测不到就明说，不猜名字）；
 * ② 按机型的 FF 建议**策略**（数值 / 只给方向），策略里写清实测依据。
 */

import type { RuleContext } from "../../types/rule";

export type RateAxisName = "roll" | "pitch" | "yaw";

interface AxisParams {
  /** 参数组前缀；`null` = 该机型该轴没有速率环参数组 */
  prefix: string | null;
  /** 该轴参数组缺失/被禁用时写进结论的原因 */
  note?: string;
}

/** 机型 → 轴 → 参数组前缀（**只声明名字，能否用由存在性探测决定**） */
const PREFIXES: Readonly<Record<string, Readonly<Record<RateAxisName, AxisParams>>>> = {
  copter: {
    roll: { prefix: "ATC_RAT_RLL" },
    pitch: { prefix: "ATC_RAT_PIT" },
    yaw: { prefix: "ATC_RAT_YAW" },
  },
  plane: {
    roll: { prefix: "RLL_RATE" },
    pitch: { prefix: "PTCH_RATE" },
    // 实测 ArduPlane 4.6.1：没有任何 YAW_RATE_P/I/D/FF，只有 YAW_RATE_ENABLE
    yaw: { prefix: null, note: "ArduPlane 没有 yaw 速率环参数组（实测只有 YAW_RATE_ENABLE 开关），yaw 轴不适用" },
  },
  rover: {
    roll: { prefix: "ATC_STR_RAT" },
    pitch: { prefix: "ATC_STR_RAT" },
    yaw: { prefix: "ATC_STR_RAT" },
  },
};

export interface ResolvedRateParams {
  /** 实际探测到的前缀；null = 该轴没有可用参数组 */
  prefix: string | null;
  p: number | null;
  i: number | null;
  d: number | null;
  ff: number | null;
  /** D 项前馈（4.5+ 新增，Copter `ATC_RAT_*_D_FF` / Plane `*_RATE_D_FF`） */
  dff: number | null;
  /** 参数组缺失/不适用时的原因（可直接写进 note） */
  unavailableReason: string | null;
  /** 探测到的字段名（供建议里原样引用，避免再猜一次） */
  names: { p: string; i: string; d: string; ff: string; dff: string } | null;
}

/** 按机型 + 轴取前缀声明（未知机型落到 default：Copter 口径，但**必须靠探测兜底**） */
export function declaredPrefix(vehicleKind: string, axis: RateAxisName): AxisParams {
  const table = PREFIXES[vehicleKind] ?? PREFIXES.copter;
  return table[axis] ?? { prefix: null, note: `机型 ${vehicleKind} 的 ${axis} 轴速率环参数未收录` };
}

/**
 * 解析某轴可用的速率环参数：**先按机型声明的名字探测存在性**，全部探不到时
 * 再退回另一套已知命名（Copter ↔ Plane），避免因机型识别不准而把整条结论打空。
 * 返回 `prefix=null` 时调用方应判不适用/无法判断，并把 `unavailableReason` 写进 note。
 */
export function resolveRateParams(ctx: RuleContext, vehicleKind: string, axis: RateAxisName): ResolvedRateParams {
  const declared = declaredPrefix(vehicleKind, axis);
  const candidates = [declared.prefix, "ATC_RAT_RLL", "RLL_RATE", "ATC_RAT_PIT", "PTCH_RATE", "ATC_RAT_YAW"].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  // 该轴优先用自己的名字；跨轴名只用于"机型识别不准"的兜底
  const axisSuffix = axis === "roll" ? ["RLL", "RLL"] : axis === "pitch" ? ["PIT", "PTCH"] : ["YAW", "YAW"];
  const ordered = [
    ...(declared.prefix ? [declared.prefix] : []),
    ...candidates.filter((c) => axisSuffix.some((s) => c.endsWith(`_${s}`) || c.includes(s))),
  ];
  for (const prefix of ordered) {
    const p = ctx.param(`${prefix}_P`);
    const ff = ctx.param(`${prefix}_FF`);
    const i = ctx.param(`${prefix}_I`);
    const d = ctx.param(`${prefix}_D`);
    const dff = ctx.param(`${prefix}_D_FF`);
    if (p !== null || ff !== null || i !== null || d !== null) {
      return {
        prefix,
        p,
        i,
        d,
        ff,
        dff,
        unavailableReason: null,
        names: {
          p: `${prefix}_P`, i: `${prefix}_I`, d: `${prefix}_D`, ff: `${prefix}_FF`, dff: `${prefix}_D_FF`,
        },
      };
    }
  }
  return {
    prefix: null,
    p: null,
    i: null,
    d: null,
    ff: null,
    dff: null,
    unavailableReason: declared.note
      ?? `日志里没有探测到 ${axis} 轴速率环参数（尝试过 ${ordered.join("、")}）——无法给出数值建议`,
    names: null,
  };
}

/**
 * FF 建议策略（**按机型实测标定**）：
 *  - `copter`：可以用数值。上限取 P 增益的 **0.6 倍**（原口径；实测 66/66 份语料 FF=0，
 *    该上限只是防"前馈主导"的护栏，不会触发砍值）。
 *  - `plane`：**只给方向，不给数值**。依据：实测 9/9 份语料 `RLL_RATE_FF=0.345`、`RLL_RATE_P=0.08`
 *    → FF/P=4.31 是**出厂默认**，说明固定翼的 FF 与 P 不是同一量纲（P 项输出/误差实测也是另一套单位），
 *    Copter 的 `FF≈P·2πfτ` 归一化公式在固定翼上不成立；给数值只会给出反向建议。
 *  - 其它机型（rover/default）：只给方向（同理，未标定）。
 */
export type FfPolicy = "numeric" | "direction-only";

export function ffPolicyFor(vehicleKind: string): { policy: FfPolicy; basis: string } {
  if (vehicleKind === "copter") {
    return {
      policy: "numeric",
      basis: "Copter 语料 66/66 份 ATC_RAT_RLL_FF=0（默认无前馈），P 为归一化增益，FF≈P·2πfτ 成立；上限取 P 的 0.6 倍防前馈主导",
    };
  }
  if (vehicleKind === "plane") {
    return {
      policy: "direction-only",
      basis: "固定翼实测 RLL_RATE_FF=0.345 / RLL_RATE_P=0.08（FF/P=4.31 为出厂默认），FF 与 P 不同量纲，归一化公式不成立 → 只给方向",
    };
  }
  return {
    policy: "direction-only",
    basis: `机型 ${vehicleKind} 的 FF/P 量级关系未按实测标定（不猜数值）`,
  };
}
