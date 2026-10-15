/**
 * 速率环调参建议的构造（从 tuningAdvice.ts 拆出：原文件超过 200 行上限）。
 *
 * 取证（采集指标）在 tuningAdvice.ts；这里只负责「指标 + 当前参数 → 六要素建议」。
 */

import type { Suggestion } from "../types/report";
import { suggestion } from "./finding";
import { PID_TUNING } from "./thresholds";
import type { RateTuningMetrics } from "./tuningAdvice";

/**
 * 由实测签名推导调参建议（**每一步都写明算式与假设**）。
 *
 * FF 的起点值推导（本函数的核心）：
 *   纯延迟 τ 在频率 f 下产生的误差幅度 ≈ 2πfτ·Tar；
 *   要用前馈补掉它，需要 FF_out ≈ P·(2πfτ·Tar) ⇒ FF ≈ P_gain · 2π f τ。
 *   取 **一半** 作为保守起点，并限制不超过 P 增益的 60%（再高就是前馈主导，模型误差有风险）。
 *   ⚠️ 这是基于"单一主频 + 纯延迟"的近似，不是系统辨识出来的最优值。
 */
export function buildRateAdvice(
  m: RateTuningMetrics,
  params: { p: number | null; i: number | null; d: number | null; ff: number | null; axis: string },
): Suggestion[] {
  const out: Suggestion[] = [];
  const pGain = params.p ?? m.pOverErr;
  const tau = m.lagMs / 1000;
  const omega = 2 * Math.PI * m.dominantHz;

  // 1) 滤波（官方顺序第一步，永远排最前）
  out.push(
    suggestion(1, "先按「滤波有效性」的结论处理滤波——滤波未确认前，下面的增益建议都不作数"),
  );

  // 2) 滞后主导 → 先加 FF（前馈不引入相位滞后，而加 P 会）
  const lagSignificant = m.lagSamples >= PID_TUNING.lagSignificantSamples;
  if (lagSignificant && pGain > 0) {
    const raw = pGain * omega * tau;
    const capped = Math.min(raw, pGain * PID_TUNING.ffMaxRatioOfP);
    const target = Math.max(0, Math.round((capped * 0.5) * 1000) / 1000);
    const cur = params.ff;
    if (cur === null || target > cur + 1e-9) {
      out.push(
        suggestion(
          2,
          `误差是**滞后主导**（实测滞后 ${Math.round(m.lagMs)} ms，指令主频 ${m.dominantHz.toFixed(2)} Hz）：增大前馈 FF（前馈不引入相位滞后，加 P 会）`,
          {
            param: {
              name: `ATC_RAT_${params.axis}_FF`,
              from: cur,
              to: target,
              reason:
                `按纯延迟近似 FF ≈ P×2πfτ = ${pGain.toFixed(3)}×2π×${m.dominantHz.toFixed(2)}×${tau.toFixed(3)} = ${raw.toFixed(3)}，` +
                `取一半作为保守起点并限制在 P 的 ${(PID_TUNING.ffMaxRatioOfP * 100).toFixed(0)}% 以内 ⇒ ${target}。` +
                "该式假设：误差由单一主频的纯延迟主导，未做系统辨识",
            },
            verify: `复飞后 rate error RMS 下降 ≥30%，且 Tar→Act 滞后从 ${m.lagMs.toFixed(0)} ms 减小`,
          },
        ),
      );
    }
  }

  // 3) D 项过激 → 降 D 或加重 D 项滤波
  if (m.dOverErr > PID_TUNING.dOverErrWarn) {
    out.push(
      suggestion(3, "D 项输出相对误差偏大（噪声被放大），先加重 D 项滤波，必要时降低 D", {
        param: params.d
          ? {
              name: `ATC_RAT_${params.axis}_D`,
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
          param: params.i
            ? {
                name: `ATC_RAT_${params.axis}_I`,
                from: params.i,
                to: Math.round(params.i * 0.8 * 10000) / 10000,
                reason:
                  "单边偏置通常是机械原因（重心偏/电机推力不对称）被 I 项顶住；先排除机械再降 I，否则会掩盖问题",
              }
            : null,
          verify: `复飞后 |I 项均值|/IMAX 降到 ${PID_TUNING.iBiasWarn} 以下，且该轴稳态误差不增大`,
        },
      ),
    );
  }

  // 5) 误差大但几乎无滞后 → 才是 P 不够（方向与 FF 不同，必须区分）
  if (m.grade !== "A" && m.grade !== "B" && !lagSignificant && pGain > 0) {
    // 读不到当前 P 参数时**不要跳过建议**：实测 P 项输出/误差本身就是有效增益，
    // 用它当基准照样能给出具体数值（并注明基准来源）。
    const base = params.p ?? pGain;
    out.push(
      suggestion(5, "误差大且**几乎没有滞后**（非滞后主导）：此时才考虑提高 P", {
        param: {
          name: `ATC_RAT_${params.axis}_P`,
          from: params.p,
          to: Math.round(base * 1.2 * 10000) / 10000,
          reason:
            `Err/Tar = ${m.errRatio.toFixed(3)} 但滞后仅 ${m.lagSamples} 个采样（非滞后主导），提高 P 20% 起步` +
            (params.p === null
              ? `；日志里没读到 ATC_RAT_${params.axis}_P，基准用的是**实测有效增益** RMS(P项)/RMS(误差) = ${pGain.toFixed(4)}`
              : ""),
        },
        verify: "复飞后 rate error RMS 下降 ≥20%，且不出现新的低频振荡",
      }),
    );
  }

  return out;
}