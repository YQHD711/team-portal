/**
 * 速率环调参建议的构造（从 tuningAdvice.ts 拆出：原文件超过 200 行上限）。
 *
 * 取证（采集指标）在 tuningAdvice.ts；这里只负责「指标 + 当前参数 → 六要素建议」。
 *
 * ⚠️ 线上实测抓到的两个坑（务必不要回退）：
 *  ① **参数名前缀必须按机型传进来**：固定翼没有 `ATC_RAT_*`（Plane 用 `RLL2SRV_*`/`PTCH2SRV_*`），
 *     写死 Copter 的参数名会给固定翼推一个**不存在的参数**。
 *  ② **"P 项输出/误差"不等于参数里的 P 增益**：Copter 两者同单位（实测 0.25 ≈ ATC_RAT_RLL_P），
 *     但 Plane 的 P 项输出是另一套单位（实测比值 4.554）→ 拿它当增益会推出 `FF = 0.633` 这种荒谬值。
 *     所以实测比值只在**落在合理增益区间**时才允许当兜底，否则宁可只给方向、不编绝对数值。
 */

import type { Suggestion } from "../types/report";
import { suggestion } from "./finding";
import { PID_TUNING } from "./thresholds";
import type { RateTuningMetrics } from "./tuningAdvice";

export interface RateAdviceParams {
  /** 该机型的参数前缀，如 `ATC_RAT_RLL`（Copter）或 `RLL2SRV`（Plane） */
  prefix: string;
  p: number | null;
  i: number | null;
  d: number | null;
  ff: number | null;
}

/** 实测的"P 项输出/误差"能否当增益用（单位是否自洽） */
function usableMeasuredGain(v: number): boolean {
  return v >= PID_TUNING.measuredGainMin && v <= PID_TUNING.measuredGainMax;
}

export function buildRateAdvice(m: RateTuningMetrics, params: RateAdviceParams): Suggestion[] {
  const out: Suggestion[] = [];
  const tau = m.lagMs / 1000;
  const omega = 2 * Math.PI * m.dominantHz;
  const lagSignificant = m.lagSamples >= PID_TUNING.lagSignificantSamples;

  // 1) 滤波（官方顺序第一步，永远排最前）
  out.push(suggestion(1, "先按「滤波有效性」的结论处理滤波——滤波未确认前，下面的增益建议都不作数"));

  // 2) 滞后主导 → 先加 FF（前馈不引入相位滞后，而加 P 会）
  if (lagSignificant) {
    const pKnown = params.p;
    const gain =
      pKnown ?? (usableMeasuredGain(m.pOverErr) ? m.pOverErr : null);
    if (gain !== null && params.ff !== null) {
      const raw = gain * omega * tau;
      const capped = Math.min(raw, gain * PID_TUNING.ffMaxRatioOfP);
      const target = Math.max(0, Math.round(capped * 0.5 * 1000) / 1000);
      out.push(
        suggestion(
          2,
          `误差是**滞后主导**（实测滞后 ${Math.round(m.lagMs)} ms，指令主频 ${m.dominantHz.toFixed(2)} Hz）：增大前馈 FF（前馈不引入相位滞后，加 P 会）`,
          {
            param: {
              name: `${params.prefix}_FF`,
              from: params.ff,
              to: target,
              reason:
                `按纯延迟近似 FF ≈ P×2πfτ = ${gain.toFixed(3)}×2π×${m.dominantHz.toFixed(2)}×${tau.toFixed(3)} = ${raw.toFixed(3)}，` +
                `取一半作为保守起点并限制在 P 的 ${(PID_TUNING.ffMaxRatioOfP * 100).toFixed(0)}% 以内 ⇒ ${target}。` +
                (pKnown === null
                  ? `（日志里没读到 ${params.prefix}_P，P 用的是**实测有效增益** ${m.pOverErr.toFixed(3)}）`
                  : "") +
                "该式假设：误差由单一主频的纯延迟主导，未做系统辨识",
            },
            verify: `复飞后 rate error RMS 下降 ≥30%，且 Tar→Act 滞后从 ${m.lagMs.toFixed(0)} ms 减小`,
          },
        ),
      );
    } else {
      // 读不到增益或参数名不匹配 → **只给方向，不编绝对数值**（编出来的数会让用户白调一圈）
      out.push(
        suggestion(
          2,
          `误差是**滞后主导**（实测滞后 ${Math.round(m.lagMs)} ms，指令主频 ${m.dominantHz.toFixed(2)} Hz）：应优先增大前馈 FF（前馈不引入相位滞后，加 P 会）`,
          {
            param: null,
            verify: `复飞后 Tar→Act 滞后应小于 ${Math.round(m.lagMs)} ms，rate error RMS 下降 ≥30%`,
          },
        ),
      );
      m.assumptions.push(
        `未能给出 ${params.prefix}_FF 的绝对起点值：日志里读不到 ${params.prefix}_P/_FF 或单位不可判定，` +
          "为避免推出无意义的数值，这里只给调整方向与验证指标",
      );
    }
  }

  // 3) D 项过激 → 降 D 或加重 D 项滤波
  if (m.dOverErr > PID_TUNING.dOverErrWarn) {
    out.push(
      suggestion(3, "D 项输出相对误差偏大（噪声被放大），先加重 D 项滤波，必要时降低 D", {
        param:
          params.d !== null
            ? {
                name: `${params.prefix}_D`,
                from: params.d,
                to: Math.round(params.d * 0.8 * 10000) / 10000,
                reason: `实测 RMS(D 项)/RMS(误差) = ${m.dOverErr.toFixed(2)}（阈值 ${PID_TUNING.dOverErrWarn}），D 项在放大噪声；先降 20% 起步`,
              }
            : null,
        verify: `复飞后 D 项输出/误差降到 ${PID_TUNING.dOverErrWarn} 以下，且 rate error RMS 不恶化`,
      }),
    );
  }

  // 4) I 项单边偏置 → 重心/推力不对称（不要只说"调 I"）
  if (m.iBiasRatio > PID_TUNING.iBiasWarn) {
    out.push(
      suggestion(
        4,
        `I 项长期单边偏置（|均值|/IMAX = ${(m.iBiasRatio * 100).toFixed(1)}%）：**先查重心/推力对称性**，再考虑降 I`,
        {
          param:
            params.i !== null
              ? {
                  name: `${params.prefix}_I`,
                  from: params.i,
                  to: Math.round(params.i * 0.8 * 10000) / 10000,
                  reason:
                    "单边偏置通常是机械原因（重心偏/推力不对称）被 I 项顶住；先排除机械再降 I，否则会掩盖问题",
                }
              : null,
          verify: `复飞后 |I 项均值|/IMAX 降到 ${PID_TUNING.iBiasWarn} 以下，且该轴稳态误差不增大`,
        },
      ),
    );
  }

  // 5) 误差大但几乎无滞后 → 才是 P 不够（方向与 FF 不同，必须区分）
  if (m.grade !== "A" && m.grade !== "B" && !lagSignificant) {
    const gain = params.p ?? (usableMeasuredGain(m.pOverErr) ? m.pOverErr : null);
    out.push(
      suggestion(5, "误差大且**几乎没有滞后**（非滞后主导）：此时才考虑提高 P", {
        param:
          gain !== null
            ? {
                name: `${params.prefix}_P`,
                from: params.p,
                to: Math.round(gain * 1.2 * 10000) / 10000,
                reason:
                  `Err/Tar = ${m.errRatio.toFixed(3)} 但滞后仅 ${m.lagSamples} 个采样（非滞后主导），提高 P 20% 起步` +
                  (params.p === null
                    ? `；日志里没读到 ${params.prefix}_P，基准用的是**实测有效增益** ${m.pOverErr.toFixed(4)}`
                    : ""),
              }
            : null,
        verify: "复飞后 rate error RMS 下降 ≥20%，且不出现新的低频振荡",
      }),
    );
  }

  return out;
}
