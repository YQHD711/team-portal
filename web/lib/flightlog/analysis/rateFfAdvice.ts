/**
 * 速率环**前馈（FF）建议**：数值型与方向型两种口径，从 rateTuningAdvice.ts 拆出（原文件超过 200 行）。
 *
 * ⚠️ 核心纪律（task-36）：**FF 的数值建议只对已按机型实测标定的机型给出**。
 * 实测：Copter 语料 66/66 份 FF=0（默认无前馈、P 为归一化增益）；固定翼 9/9 份 FF=0.345 / P=0.08（FF/P=4.31，出厂默认），
 * 量纲不同 ⇒ 固定翼只给方向。任何情况下**建议值都不得低于当前 FF**（否则就是把用户带反）。
 */

import type { Suggestion } from "../types/report";
import { suggestion } from "./finding";
import { PID_TUNING } from "./thresholds";
import type { RateTuningMetrics } from "./tuningAdvice";

export interface RateAdviceParams {
  /** 该机型的参数前缀，如 `ATC_RAT_RLL`（Copter）或 `RLL_RATE`（Plane，**不是** RLL2SRV） */
  prefix: string;
  /** 机型，决定 FF 建议策略（Copter 可给数值；固定翼只给方向——量纲不同，见 rateParamNames.ts） */
  vehicleKind: string;
  p: number | null;
  i: number | null;
  d: number | null;
  ff: number | null;
  /** D 项前馈（4.5+：Copter `ATC_RAT_*_D_FF` / Plane `*_RATE_D_FF`） */
  dff: number | null;
}

/** 实测的"P 项输出/误差"能否当增益用（单位是否自洽） */
export function usableMeasuredGain(v: number): boolean {
  return v >= PID_TUNING.measuredGainMin && v <= PID_TUNING.measuredGainMax;
}

/** 数值型 FF 建议：① 只按公式给起点值；② **绝不给出低于当前值的建议**（Lead 回归要求） */
export function ffNumericAdvice(
  m: RateTuningMetrics,
  params: RateAdviceParams,
  gain: number,
  raw: number,
  cap: number,
): Suggestion {
  const current = params.ff as number;
  const half = Math.round(Math.min(raw, cap) * 0.5 * 1000) / 1000;
  if (half <= current) {
    // 公式给不出比现状更高的起点值 → 不编数值，只给方向（并把实测值摆出来）
    return suggestion(
      2,
      `误差是**滞后主导**（实测滞后 ${Math.round(m.lagMs)} ms、指令主频 ${m.dominantHz.toFixed(2)} Hz）：方向是**增大前馈 FF**；`
      + `本次不给数值——按纯延迟近似算得 ${half}，并**不高于**当前 ${params.prefix}_FF=${current}（实测 FF/P=${(current / gain).toFixed(2)}），`
      + "给数值会让你把前馈改小，方向是错的",
      {
        param: null,
        verify: `复飞后 Tar→Act 滞后应小于 ${Math.round(m.lagMs)} ms，且 rate error RMS 下降 ≥30%；若滞后未减，优先查滤波与舵机/电调响应`,
      },
    );
  }
  return suggestion(
    2,
    `误差是**滞后主导**（实测滞后 ${Math.round(m.lagMs)} ms，指令主频 ${m.dominantHz.toFixed(2)} Hz）：增大前馈 FF（前馈不引入相位滞后，加 P 会）`,
    {
      param: {
        name: `${params.prefix}_FF`,
        from: current,
        to: half,
        reason:
          `按纯延迟近似 FF ≈ P×2πfτ = ${gain.toFixed(3)}×2π×${m.dominantHz.toFixed(2)}×${(m.lagMs / 1000).toFixed(3)} = ${raw.toFixed(3)}，`
          + `取一半作保守起点、并限制在 P 的 ${(PID_TUNING.ffMaxRatioOfP * 100).toFixed(0)}% 以内 ⇒ ${half}；`
          + `**硬约束：不低于当前 ${current}**（当前 FF/P=${(current / gain).toFixed(2)}）。`
          + "该式假设：误差由单一主频的纯延迟主导，未做系统辨识",
      },
      verify: `复飞后 rate error RMS 下降 ≥30%，且 Tar→Act 滞后从 ${m.lagMs.toFixed(0)} ms 减小`,
    },
  );
}

/** 方向型 FF 建议（固定翼 / 未标定机型）：给实测 FF/P 与方向，不编数值 */
export function ffDirectionAdvice(m: RateTuningMetrics, params: RateAdviceParams, basis: string): Suggestion {
  const current = params.ff;
  const ratio =
    params.p !== null && params.p > 0 && current !== null
      ? `（当前 ${params.prefix}_FF=${current} / ${params.prefix}_P=${params.p} → FF/P=${(current / params.p).toFixed(2)}）`
      : current !== null
        ? `（当前 ${params.prefix}_FF=${current}，但日志里没读到 ${params.prefix}_P）`
        : "";
  return suggestion(
    2,
    `误差是**滞后主导**（实测滞后 ${Math.round(m.lagMs)} ms、指令主频 ${m.dominantHz.toFixed(2)} Hz）：方向是**增大前馈 FF**；`
    + `**不给绝对数值** —— ${basis}${ratio}`,
    {
      param: null,
      verify: `复飞后 Tar→Act 滞后应小于 ${Math.round(m.lagMs)} ms、rate error RMS 下降 ≥30%；若方向无效，回到滤波与机械（舵面间隙/电机响应）`,
    },
  );
}
