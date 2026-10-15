/**
 * PX4 速率环的**六要素建议**（复用 `rules/tuningSteps.ts` 的格式，不另起炉灶）。
 *
 * 数值纪律（Lead 在 ArduPilot 侧踩过的坑，PX4 同样适用）：
 *  - FF 只对已按机型实测标定的机型给数值（MC：27/27 份 `MC_*RATE_FF=0`）；固定翼样本 0 份 → 只给方向；
 *  - **任何数值都不得低于当前值**（低于当前值时降级为方向型）；
 *  - 测不到参数就只给方向 + 说明缺什么。
 */

import type { Suggestion } from "../../../types/report";
import { improvementStep, tuningStep } from "../tuningSteps";
import type { Px4RateMetrics } from "./px4RateMetrics";
import type { Px4RateParams } from "./px4ParamNames";

export interface Px4RateAdviceInput {
  m: Px4RateMetrics;
  params: Px4RateParams;
  family: "mc" | "fw" | "unknown";
  ffPolicy: { numeric: boolean; basis: string };
  doc: string;
  /** 该轴的中文名（Roll/Pitch/Yaw），只用于文案 */
  label: string;
  /** 实测滞后是否落在速率环的合理范围（否则更像记录/时间戳错位，不给 FF 数值） */
  lagPlausible: boolean;
}

export function buildPx4RateAdvice(input: Px4RateAdviceInput): Suggestion[] {
  const { m, params, ffPolicy, doc, label, lagPlausible } = input;
  const out: Suggestion[] = [];
  const lagDominant = m.lagSamples >= 1;
  const prefix = params.prefix ?? "未知参数组";

  out.push(
    improvementStep({
      order: 1,
      signature: `PX4 ${label} 速率环实测：Err/Tar=${m.errRatio.toFixed(3)}、滞后 ${m.lagSamples} 采样（≈${Math.round(m.lagMs)} ms）、指令主频 ${m.dominantHz.toFixed(2)} Hz`,
      current: `实际角速率 RMS ${m.actRms.toFixed(3)} rad/s（样本 ${m.samples}）`,
      direction: "先按滤波（IMU_GYRO_CUTOFF / IMU_GYRO_NF*）与机体机械状态确认再调增益——滤波未确认前下面的增益建议都不作数",
      missing: "需要机上 FFT/频谱结论（IMU_GYRO_FFT_EN=1）才能给出陷波频率的数值起点",
      verify: `复飞后 ${label} 轴 Err RMS 不劣于本次（${m.errRatio.toFixed(3)} 的比值口径）`,
      doc,
    }),
  );

  if (lagDominant && !lagPlausible) {
    out.push(
      tuningStep({
        order: 2,
        signature: `互相关峰值滞后 ${Math.round(m.lagMs)} ms（超过速率环合理范围 ±60 ms）`,
        current: `峰值相关 ${m.peakCorr.toFixed(2)}、Err/Tar=${m.errRatio.toFixed(3)}`,
        suggested: "**不给 FF 数值**：这个滞后更像两条 topic 的记录率/时间基准错位，而不是真实相位滞后；"
          + "先人工核对一段曲线、确认时间基准后再谈前馈",
        basis: "速率环的真实相位滞后是毫秒级；把记录错位当滞后会推出错误的前馈值",
        verify: "人工核对曲线后滞后落在几十毫秒内，再评估 FF",
        doc,
      }),
    );
  } else if (lagDominant) {
    const gain = params.p;
    const currentFf = params.ff;
    if (ffPolicy.numeric && gain !== null && gain > 0 && currentFf !== null) {
      const raw = gain * 2 * Math.PI * m.dominantHz * (m.lagMs / 1000);
      const half = Math.round(Math.min(raw, gain * 0.6) * 0.5 * 1000) / 1000;
      if (half > currentFf) {
        out.push(
          tuningStep({
            order: 2,
            signature: `误差滞后主导（滞后 ${m.lagSamples} 采样 ≈${Math.round(m.lagMs)} ms，主频 ${m.dominantHz.toFixed(2)} Hz）`,
            current: `${prefix}_FF=${currentFf}（${prefix}_P=${gain}，FF/P=${(currentFf / gain).toFixed(2)}）`,
            suggested: `${prefix}_FF → ${half}（起点值，非最优）`,
            basis: `按纯延迟近似 FF ≈ P·2πfτ = ${gain}×2π×${m.dominantHz.toFixed(2)}×${(m.lagMs / 1000).toFixed(3)} = ${raw.toFixed(3)}，取一半并限制在 P 的 60% 以内；`
              + "硬约束：不低于当前值（前馈不引入相位滞后，加 P 会）",
            verify: `复飞后 ${label} 轴滞后小于 ${Math.round(m.lagMs)} ms，Err/Tar 下降 ≥30%`,
            doc,
            param: { name: `${prefix}_FF`, from: currentFf, to: half, reason: "滞后主导时前馈比继续加 P 更安全（不引入相位滞后）" },
          }),
        );
      } else {
        out.push(
          tuningStep({
            order: 2,
            signature: `误差滞后主导（滞后 ${Math.round(m.lagMs)} ms）`,
            current: `${prefix}_FF=${currentFf}、${prefix}_P=${gain}（FF/P=${(currentFf / gain).toFixed(2)}）`,
            suggested: `方向：增大 ${prefix}_FF；**本次不给数值**——按公式算得 ${half} 不高于当前值，给数值会把你带反`,
            basis: "前馈用于消相位滞后；公式在量纲可比的机型上才成立（本机型已按实测确认 FF 为 0 默认）",
            verify: `复飞后滞后小于 ${Math.round(m.lagMs)} ms`,
            doc,
          }),
        );
      }
    } else {
      out.push(
        tuningStep({
          order: 2,
          signature: `误差滞后主导（滞后 ${Math.round(m.lagMs)} ms，主频 ${m.dominantHz.toFixed(2)} Hz）`,
          current: params.ff === null ? `未读到 ${prefix}_FF` : `${prefix}_FF=${params.ff}`,
          suggested: `方向：增大前馈 FF（${prefix}_FF）；**不给绝对值** —— ${ffPolicy.basis}`,
          basis: "前馈不引入相位滞后；量级未标定时照搬其它机型会给出反向建议（ArduPilot Plane 实测 FF/P=4.31）",
          verify: `复飞后 ${label} 轴滞后减小、Err/Tar 下降 ≥30%`,
          doc,
        }),
      );
    }

    if (params.dff !== null && params.dff === 0 && (params.d === null || params.d < 0.01)) {
      out.push(
        tuningStep({
          order: 3,
          signature: `D 项前馈未启用（${prefix}_D_FF=0）且 ${prefix}_D≈${params.d ?? "未读到"}`,
          current: `${prefix}_D_FF=0、${prefix}_D=${params.d ?? "未读到"}`,
          suggested: "方向：滞后主导时可考虑启用 D 项前馈；**不给数值**（本批语料无一处启用，无法标定起点值）",
          basis: "D_FF 是误差变化率的前馈，比继续加大 P 更不易放大噪声",
          verify: "复飞后误差 RMS 下降且不出现高频抖动",
          doc,
        }),
      );
    }
  }

  if (m.integralBiasRatio > 0.5) {
    const currentI = params.i;
    out.push(
      tuningStep({
        order: 4,
        signature: `积分项长期单边偏置（|均值|/限幅 = ${(m.integralBiasRatio * 100).toFixed(0)}%）`,
        current: currentI === null ? "未读到 I 增益" : `${prefix}_I=${currentI}`,
        suggested: currentI !== null
          ? `先查重心/配平（不要先动参数）；确认机械正常后再考虑 ${prefix}_I → ${Math.round(currentI * 0.8 * 10000) / 10000}（−20% 起点值）`
          : "先查重心/配平与机架对称性，再考虑降 I（日志里没读到 I 增益，不给数值）",
        basis: "持续单边积分量通常由重心偏/推力不对称顶住；先降 I 会掩盖机械问题",
        verify: "复飞后 |积分均值|/限幅降到 50% 以下，且稳态误差不增大",
        doc,
        param: currentI !== null
          ? { name: `${prefix}_I`, from: currentI, to: Math.round(currentI * 0.8 * 10000) / 10000, reason: "单边偏置：先机械后参数" }
          : undefined,
      }),
    );
  }

  if ((m.grade === "C" || m.grade === "D") && !lagDominant) {
    const currentP = params.p;
    out.push(
      tuningStep({
        order: 5,
        signature: `误差大（Err/Tar=${m.errRatio.toFixed(3)}）但**几乎没有滞后**`,
        current: currentP === null ? "未读到 P 增益" : `${prefix}_P=${currentP}`,
        suggested: currentP !== null ? `${prefix}_P → ${Math.round(currentP * 1.2 * 10000) / 10000}（+20% 起点值）` : "方向：提高 P（未读到 P 增益，不给数值）",
        basis: "非滞后主导说明不是相位问题，才轮到提高比例增益（滞后主导时应先加 FF）",
        verify: "复飞后 Err/Tar 下降且不出现新的振荡",
        doc,
        param: currentP !== null
          ? { name: `${prefix}_P`, from: currentP, to: Math.round(currentP * 1.2 * 10000) / 10000, reason: "误差大但无滞后：提高 P" }
          : undefined,
      }),
    );
  }

  if (out.length === 1 && m.grade !== "A" && m.grade !== "B") {
    out.push(
      improvementStep({
        order: 2,
        signature: `Err/Tar=${m.errRatio.toFixed(3)}（${m.grade} 级）未命中任何可测签名`,
        current: "本次没有滞后/积分偏置/参数可读的签名",
        direction: "保持参数不变，先补齐诊断数据（参数表、FFT）后复飞重采",
        missing: "缺签名意味着缺数据，不是'没有问题'",
        verify: "重采后本轴从「无法定位」变成有依据的结论",
        doc,
      }),
    );
  }
  return out;
}
