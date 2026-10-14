/**
 * 陷波规则的判定与文案层：把「证据 → 结论」这一步单独隔离，
 * 便于对每一类结论写独立测试（needsNotch / notNeeded / enabledNoPeak / enabledPeak / enabledUnverified）。
 */

import type { Severity } from "../types/report";
import type { Suggestion } from "../types/report";
import { suggestion } from "./finding";
import type { VibrationIndicator } from "./vibrationIndicators";
import type { FtnSummary, NotchConfig } from "./notchEvidence";
import { FILTER, VIBRATION } from "./thresholds";

export interface NotchEvidence {
  cfg: NotchConfig;
  ftn: FtnSummary | null;
  indicators: VibrationIndicator[];
  vibrationUnavailable: string | null;
  worstStd: number;
  imuFs: number | null;
}

export type NotchDecision =
  | { kind: "needsNotch"; severe: boolean }
  | { kind: "notNeeded" }
  | { kind: "enabledNoPeak"; snrMax: number }
  | { kind: "enabledPeak"; peakHz: number; offset: number }
  | { kind: "enabledUnverified" };

/** 振动是否已达到"需要陷波"的程度 */
export function vibrationBad(indicators: readonly VibrationIndicator[]): boolean {
  return indicators.some(
    (i) =>
      i.worstStd >= FILTER.vibrationNeedsNotchStd ||
      i.clipDelta >= VIBRATION.clipDeltaCritical,
  );
}

export function decideNotch(ev: NotchEvidence): NotchDecision {
  const cfg = ev.cfg;
  if (!cfg.enabled) {
    if (!vibrationBad(ev.indicators)) return { kind: "notNeeded" };
    const severe = ev.indicators.some(
      (i) =>
        i.clipDelta >= VIBRATION.clipDeltaCritical ||
        i.worstStd >= VIBRATION.stdCritical,
    );
    return { kind: "needsNotch", severe };
  }
  if (ev.ftn && ev.ftn.snrDb.length > 0) {
    const snrMax = Math.max(...ev.ftn.snrDb);
    if (snrMax <= cfg.snrRef) return { kind: "enabledNoPeak", snrMax };
    if (cfg.freq !== null && cfg.freq > 0) {
      const peakHz = Math.max(...ev.ftn.peakHz);
      return {
        kind: "enabledPeak",
        peakHz,
        offset: peakHz > 0 ? Math.abs(cfg.freq - peakHz) / peakHz : 0,
      };
    }
  }
  return { kind: "enabledUnverified" };
}

export interface NotchVerdict {
  severity: Severity;
  phenomenon: string;
  impact: string;
  suggestions: Suggestion[];
}

export function verdictFor(d: NotchDecision, ev: NotchEvidence): NotchVerdict {
  const std = ev.worstStd.toFixed(2);
  switch (d.kind) {
    case "needsNotch":
      return {
        severity: d.severe ? "critical" : "warning",
        phenomenon: `振动已超标（最差轴标准差 ${std} m/s²）但谐波陷波未启用（INS_HNTCH_ENABLE=0）`,
        impact:
          "振动会直接进入角速度环与姿态估计；若为窄带共振，未加陷波会持续放大噪声并压缩可用增益",
        suggestions: [
          suggestion(1, "先排除机械原因：螺旋桨动平衡、桨夹间隙、机架与飞控减振"),
          suggestion(
            2,
            "设 INS_LOG_BAT_MASK=1 后复飞一次，取得机上频谱（FTN1/FTN2）再定位频率",
          ),
          suggestion(3, "依据机上 FFT 峰频设置陷波，而不是凭经验填频率", {
            param: {
              name: "INS_HNTCH_ENABLE",
              from: 0,
              to: 1,
              reason:
                "机械处理完成后启用谐波陷波；FREQ 取 FFT 主峰，BW≈50% 中心频率，HMNCS 覆盖检出的谐波",
            },
            verify: "复飞后 VIBE 标准差下降 ≥30%，且 FTN1 的 SNR 低于参考值",
          }),
          suggestion(4, "ATT 不建议超过 20 dB：会削减相位裕度并可能诱发新的振荡"),
        ],
      };
    case "notNeeded":
      return {
        severity: "ok",
        phenomenon: "谐波陷波未启用，但振动水平在阈值内，当前无需启用",
        impact: "振动不构成威胁，保持现状即可",
        suggestions: [],
      };
    case "enabledNoPeak":
      if (vibrationBad(ev.indicators)) {
        return {
          severity: "warning",
          phenomenon: `陷波已启用（FREQ=${ev.cfg.freq ?? "?"} Hz）但振动仍超标，且机上 FFT 未检出显著窄峰（最大 SNR ${d.snrMax.toFixed(1)} dB ≤ ${ev.cfg.snrRef} dB）`,
          impact: "宽谱振动不是陷波能解决的：继续加大陷波只会牺牲相位裕度而不降低振动",
          suggestions: [
            suggestion(1, "优先解决机械振动（动平衡、减振、线束刚性耦合）"),
            suggestion(2, "确认 INS_LOG_BAT_MASK 已开启后依据实测频谱复核陷波设置"),
          ],
        };
      }
      return {
        severity: "ok",
        phenomenon: `陷波已启用且振动在阈值内；机上 FFT 未检出显著窄峰（最大 SNR ${d.snrMax.toFixed(1)} dB）`,
        impact: "滤波配置与实测振动物理量一致",
        suggestions: [],
      };
    case "enabledPeak":
      if (d.offset > 0.2) {
        return {
          severity: "warning",
          phenomenon: `陷波中心频率 ${ev.cfg.freq} Hz 与机上 FFT 主峰 ${d.peakHz.toFixed(1)} Hz 偏离 ${(d.offset * 100).toFixed(0)}%`,
          impact: "陷波没有对准振动峰：既没滤掉主要能量，又仍在削减相位裕度",
          suggestions: [
            suggestion(
              1,
              `将 INS_HNTCH_FREQ 设为实测主峰 ${d.peakHz.toFixed(1)} Hz（或改用 INS_HNTCH_MODE=3 的 FFT 自动跟踪）`,
              {
                param: {
                  name: "INS_HNTCH_FREQ",
                  from: ev.cfg.freq,
                  to: Number(d.peakHz.toFixed(1)),
                  reason: "陷波中心应对准实测振动峰",
                },
                verify: "复飞后 FTN1 主峰处 SNR 降到参考值以下，VIBE 标准差下降",
              },
            ),
          ],
        };
      }
      return {
        severity: "ok",
        phenomenon: `陷波中心 ${ev.cfg.freq} Hz 与机上 FFT 主峰 ${d.peakHz.toFixed(1)} Hz 对齐（偏差 ${(d.offset * 100).toFixed(0)}%）`,
        impact: "陷波对准了实际振动峰，滤波配置有效",
        suggestions: [],
      };
    default:
      return {
        severity: "unknown",
        phenomenon: "陷波已启用，但缺少机上 FFT 结论",
        impact: "无法验证陷波是否对准实际振动峰，不代表通过",
        suggestions: [],
      };
  }
}

export function configText(cfg: NotchConfig): string {
  if (!cfg.enabled) return "INS_HNTCH_ENABLE=0（谐波陷波未启用）";
  return `已启用：FREQ=${cfg.freq ?? "?"} Hz BW=${cfg.bw ?? "?"} Hz ATT=${cfg.att ?? "?"} dB MODE=${cfg.mode ?? "?"} HMNCS=${cfg.hmNcs ?? "?"}`;
}
