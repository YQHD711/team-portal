/**
 * 陷波各决策分支的**基准文案**（从 notchVerdicts.ts 拆出：原文件超过 200 行上限）。
 *
 * 这里只产出"与振动/FFT 结论一致"的基准结论；配置自检（ATT/FREQ/BW/MODE/HMNCS）与
 * 严重度合并留在 `notchVerdicts.ts`。**每条分支都必须带建议**（用户：「每一项都有建议」）：
 * 数值给不出时给方向 + 说明缺什么数据，绝不编数。
 */

import { suggestion } from "./finding";
import { NOTCH_DOC } from "./notchConfigChecks";
import { dataGapStep, improvementStep, tuningStep } from "./rules/tuningSteps";
import { vibrationBad } from "./vibrationIndicators";
import type { NotchDecision, NotchEvidence, NotchVerdict } from "./notchVerdicts";

export function buildBase(d: NotchDecision, ev: NotchEvidence, std: string, clipTotal: number): NotchVerdict {
  switch (d.kind) {
    case "needsNotch":
      return {
        severity: d.severe ? "critical" : "warning",
        phenomenon: `振动已超标（最差轴标准差 ${std} m/s²）但谐波陷波未启用（INS_HNTCH_ENABLE=0）`,
        impact: "振动会直接进入角速度环与姿态估计；若为窄带共振，未加陷波会持续放大噪声并压缩可用增益",
        suggestions: [
          // 官方顺序：先机械 → 再取频谱 → 最后才谈陷波参数（第一条必须是机械，别让用户一上来填频率）
          improvementStep({
            order: 1,
            signature: `振动超标（最差轴 std ${std} m/s²）且未启用陷波`,
            current: "INS_HNTCH_ENABLE=0",
            direction: "先做机械处理（螺旋桨动平衡、桨夹间隙、飞控减振），再设 INS_LOG_BAT_MASK=1 复飞取机上频谱",
            missing: "没有机上 FFT 主峰数据时不能给出 FREQ/BW 的数值起点",
            verify: "机械处理后复飞：VIBE 标准差下降，FTN1 出现可用主峰",
            doc: NOTCH_DOC,
          }),
          tuningStep({
            order: 2,
            signature: `振动超标且未启用陷波（最差轴 std ${std} m/s²）`,
            current: "INS_HNTCH_ENABLE=0",
            suggested: "启用谐波陷波（0→1）；FREQ 取机上 FFT 主峰、BW≈50% 中心频率、ATT 从 15–20 dB 起步",
            basis: "官方：FREQ 必须来自机上实测频谱，不能凭经验填；机械未处理完启用陷波只是掩盖问题",
            verify: "复飞后 VIBE 标准差下降 ≥30%，FTN1 的 SNR 低于参考值",
            doc: NOTCH_DOC,
            param: {
              name: "INS_HNTCH_ENABLE",
              from: 0,
              to: 1,
              reason: "振动已超标且未启用陷波；启用前先完成机械处理，FREQ/BW/ATT 按实测频谱设定",
            },
          }),
          suggestion(3, "启用后 ATT 从 15–20 dB 起步（不要一上来就 40 dB）：陷波越深相位损失越大"),
        ],
      };
    case "notNeeded":
      return {
        severity: "ok",
        phenomenon: `谐波陷波未启用，但振动在阈值内（最差轴标准差 ${std} m/s²，clip 增量 ${clipTotal}），当前无需启用`,
        impact: "振动不构成威胁，保持现状即可",
        suggestions: [
          improvementStep({
            signature: `振动在阈值内（最差轴 std ${std} m/s²，clip 增量 ${clipTotal}）`,
            current: "INS_HNTCH_ENABLE=0",
            direction: "保持不启用；若要为将来换桨预留余量，可先设 INS_LOG_BAT_MASK=1 采集一次机上频谱作为基线",
            missing: "没有机上 FFT 数据时无法给出具体陷波频率/带宽起点值",
            verify: "复飞后 VIBE 仍低于阈值，且 FTN1 未出现显著窄峰（SNR ≤ 参考值）",
            doc: NOTCH_DOC,
          }),
        ],
      };
    case "vibrationUnmeasurable":
      return {
        severity: "unknown",
        status: "insufficient_data",
        phenomenon: "谐波陷波未启用；本次日志无法测出振动水平，因此无法判断是否需要启用陷波",
        impact: "无法判断滤波配置是否够用，不代表通过",
        suggestions: [
          dataGapStep({
            signature: "缺少可用的 VIBE 数据，无法判断是否需要陷波",
            missing: ev.vibrationUnavailable ?? "VIBE 不可用",
            howToFix: "确认日志含 VIBE 且有一段有效飞行（arm）窗口后复飞重采",
            doc: NOTCH_DOC,
          }),
        ],
      };
    case "enabledNoPeak":
      if (vibrationBad(ev.indicators)) {
        return {
          severity: "warning",
          phenomenon: `陷波已启用（FREQ=${ev.cfg.freq ?? "?"} Hz）但振动仍超标，且机上 FFT 未检出显著窄峰（最大 SNR ${d.snrMax.toFixed(1)} dB ≤ 参考值 ${ev.cfg.snrRef} dB）`,
          impact: "宽谱振动不是陷波能解决的：继续加大陷波只会牺牲相位裕度而不降低振动",
          suggestions: [
            improvementStep({
              signature: `振动超标但 FFT 无显著窄峰（最大 SNR ${d.snrMax.toFixed(1)} dB ≤ ${ev.cfg.snrRef} dB）`,
              current: `INS_HNTCH_ENABLE=1，FREQ=${ev.cfg.freq ?? "?"} Hz`,
              direction: "优先解决机械振动（动平衡、减振、线束刚性耦合）；不要继续加大陷波深度",
              missing: "宽谱振动没有单一峰频，无法给出陷波中心/深度的数值起点",
              verify: "VIBE 标准差下降 ≥30% 且 FTN1 仍无显著窄峰",
              doc: NOTCH_DOC,
            }),
          ],
        };
      }
      return {
        severity: "ok",
        phenomenon: `陷波已启用且振动在阈值内；机上 FFT 未检出显著窄峰（最大 SNR ${d.snrMax.toFixed(1)} dB ≤ 参考值 ${ev.cfg.snrRef} dB）`,
        impact: "滤波配置与实测振动物理量一致",
        suggestions: [
          improvementStep({
            signature: `振动在阈值内且 FFT 无显著窄峰（最大 SNR ${d.snrMax.toFixed(1)} dB）`,
            current: `INS_HNTCH_ENABLE=1，FREQ=${ev.cfg.freq ?? "?"} Hz，ATT=${ev.cfg.att ?? "?"} dB`,
            direction: "维持现状；换桨/改载后按本规则重新核对 FREQ/ATT",
            missing: "没有更高转速段 FFT 数据时无法给出新的频率起点值",
            verify: "复飞后 VIBE 与 FTN1 结论保持在本档",
            doc: NOTCH_DOC,
          }),
        ],
      };
    case "enabledPeak": {
      // ⚠️ 边界用 >=：偏差恰好 20.0% 也必须给建议；频率建议由配置自检的 freq 检查给出（避免重复文案）
      const aligned = d.offset < 0.2;
      return {
        severity: aligned ? "ok" : "warning",
        phenomenon: aligned
          ? `陷波中心 ${ev.cfg.freq} Hz 与机上 FFT 主峰 ${d.peakHz.toFixed(1)} Hz 偏差 ${(d.offset * 100).toFixed(1)}%（< 20% 判据，在建议范围内）`
          : `陷波中心 ${ev.cfg.freq} Hz 与机上 FFT 主峰 ${d.peakHz.toFixed(1)} Hz 偏差 ${(d.offset * 100).toFixed(1)}%（判据 ≥20%）：没对准主要能量，却仍在削减相位裕度`,
        impact: aligned
          ? "陷波中心与实测主峰接近，滤波配置与实测振动物理量一致"
          : "陷波没有对准振动峰：既没滤掉主要能量，又仍在削减相位裕度",
        suggestions: aligned
          ? [
              improvementStep({
                signature: `陷波中心与 FFT 主峰偏差 ${(d.offset * 100).toFixed(1)}%（判据 ≥20% 才告警）`,
                current: `INS_HNTCH_FREQ=${ev.cfg.freq} Hz（主峰 ${d.peakHz.toFixed(1)} Hz）`,
                direction: "可把 FREQ 微调到实测主峰以减少残差（偏差小时收益有限）",
                missing: "没有多转速段 FFT 数据时无法给出跟踪带宽的数值起点",
                verify: "复飞后 FTN1 主峰 SNR 进一步下降且振动不回升",
                doc: NOTCH_DOC,
              }),
            ]
          : [],
      };
    }
    default:
      return {
        severity: "unknown",
        status: "insufficient_data",
        phenomenon: "陷波已启用，但缺少机上 FFT 结论",
        impact: "无法验证陷波是否对准实际振动峰，不代表通过",
        suggestions: [
          dataGapStep({
            signature: "缺少 FTN1/FTN2（机上 FFT）结论，无法核对陷波频率是否对准",
            missing: "没有有效 FTN1 结论（可能未设 INS_LOG_BAT_MASK=1 或 FFT_ENABLE=0）",
            howToFix: "设 INS_LOG_BAT_MASK=1（必要时 FFT_ENABLE=1）后复飞一次，取得主峰后再核对 FREQ/ATT",
            doc: NOTCH_DOC,
          }),
        ],
      };
  }
}
