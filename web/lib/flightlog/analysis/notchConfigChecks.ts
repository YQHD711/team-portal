/**
 * 陷波配置自检的**逐项检查**（每条都产出六要素建议）。
 *
 * 独立于「振动/FFT 结论」的原因：用户贴出的报告里，结论判「通过」，证据里却写着
 * 「ATT 超过 20 dB 会削减相位裕度」——自己的判据自己没执行。配置层面的自相矛盾
 * 必须有一层可单测的检查，否则每次改文案都可能再漏一次。
 *
 * 官方依据（NOTCH_DOC）：MODE 的 0/1/2/3/4 五种频率控制方式、HMNCS 谐波数量与 CPU 代价、
 * 滤波相位滞后会限制可达到的调参激进程度。**数值边界是自检/起点值**，非官方硬指标。
 */

import type { Severity, Suggestion } from "../types/report";
import { suggestion } from "./finding";
import type { NotchConfig } from "./notchEvidence";

export const NOTCH_DOC = "https://ardupilot.org/copter/docs/common-imu-notch-filtering.html";

/** 自检边界（起点值；依据见上方注释） */
export const NOTCH_LIMITS = {
  attTooDeepDb: 20,
  attSuggestedMinDb: 15,
  attSuggestedMaxDb: 20,
  /** FREQ 与实测主峰允许偏差；判据用 **>=**（实测被 20.0% 的浮点边界放过过） */
  freqOffsetMax: 0.2,
  bwRatioMin: 0.3,
  bwRatioMax: 0.6,
} as const;

const L = NOTCH_LIMITS;

export interface NotchConfigIssue {
  id: "att" | "freq" | "bw" | "mode" | "hmncs" | "modeUnknown";
  severity: Severity;
  text: string;
  suggestion: Suggestion;
}

/** 六要素文本拼装（避免每条检查各写一遍前缀） */
function six(args: {
  signature: string; current: string; suggested: string; basis: string; verify: string;
  param?: { name: string; from: number | null; to: number; reason: string } | null;
}): Suggestion {
  return suggestion(
    1,
    `①触发签名：${args.signature}；②当前值：${args.current}；③建议值：${args.suggested}；` +
      `④推导依据：${args.basis}；⑤复飞验证：${args.verify}；⑥官方文档：${NOTCH_DOC}`,
    { param: args.param ?? null, verify: args.verify },
  );
}

function attIssue(cfg: NotchConfig): NotchConfigIssue | null {
  if (cfg.att === null || cfg.att <= L.attTooDeepDb) return null;
  return {
    id: "att",
    severity: "warning",
    text: `陷波衰减 ATT=${cfg.att} dB 超过自检上限 ${L.attTooDeepDb} dB：陷波越深相位损失越大，压缩可用调参空间`,
    suggestion: six({
      signature: `notchAttDb=${cfg.att} > ${L.attTooDeepDb}`,
      current: `INS_HNTCH_ATT=${cfg.att} dB`,
      suggested: `降到 ${L.attSuggestedMinDb}–${L.attSuggestedMaxDb} dB 起步（起点值，非最优；副作用：衰减不足则峰会回升，故先保证 FREQ 对准与机械正常）`,
      basis: "官方：滤波相位滞后会限制可达到的调参激进程度，故取刚好压住峰的最小深度",
      verify: "FTN1 主峰 SNR 仍低于参考值，VIBE 标准差未回升且无新的姿态振荡",
      param: {
        name: "INS_HNTCH_ATT", from: cfg.att, to: L.attSuggestedMaxDb,
        reason: `ATT=${cfg.att} dB 超过 ${L.attTooDeepDb} dB 自检上限：过深会削减相位裕度并可能诱发振荡`,
      },
    }),
  };
}

function freqIssue(cfg: NotchConfig, peakHz: number | null): NotchConfigIssue | null {
  if (peakHz === null || peakHz <= 0 || cfg.freq === null || cfg.freq <= 0) return null;
  const offset = Math.abs(cfg.freq - peakHz) / peakHz;
  if (offset < L.freqOffsetMax) return null;   // >= 才告警：20.0% 不能判"对齐"
  const target = Number(peakHz.toFixed(1));
  return {
    id: "freq",
    severity: "warning",
    text: `陷波中心 ${cfg.freq} Hz 与机上 FFT 主峰 ${peakHz.toFixed(1)} Hz 偏差 ${(offset * 100).toFixed(1)}%（≥${(L.freqOffsetMax * 100).toFixed(0)}%）：没对准主要能量，却仍在削减相位裕度`,
    suggestion: six({
      signature: `FREQ 与 FFT 主峰偏差 ${(offset * 100).toFixed(1)}% ≥ ${(L.freqOffsetMax * 100).toFixed(0)}%`,
      current: `INS_HNTCH_FREQ=${cfg.freq} Hz（主峰 ${peakHz.toFixed(1)} Hz）`,
      suggested: `FREQ → ${target} Hz（起点值，非最优）；或改 MODE=3/4 让频率自动跟踪`,
      basis: "陷波只在中心附近有效，偏差越大越无效且仍付相位代价",
      verify: "FTN1 主峰 SNR 低于参考值，VIBE 标准差下降 ≥30%",
      param: { name: "INS_HNTCH_FREQ", from: cfg.freq, to: target, reason: "陷波中心应对准实测振动峰（偏差 ≥20%）" },
    }),
  };
}

function bwIssue(cfg: NotchConfig): NotchConfigIssue | null {
  if (cfg.bw === null || cfg.freq === null || cfg.freq <= 0) return null;
  const ratio = cfg.bw / cfg.freq;
  if (ratio >= L.bwRatioMin && ratio <= L.bwRatioMax) return null;
  const target = Number((cfg.freq * 0.5).toFixed(1));
  return {
    id: "bw",
    severity: "ok",
    text: `陷波带宽 BW=${cfg.bw} Hz（=中心频率的 ${(ratio * 100).toFixed(0)}%）落在建议起步区间 ${(L.bwRatioMin * 100).toFixed(0)}–${(L.bwRatioMax * 100).toFixed(0)}% 之外`,
    suggestion: six({
      signature: `BW/FREQ=${(ratio * 100).toFixed(0)}%`,
      current: `INS_HNTCH_BW=${cfg.bw} Hz（FREQ=${cfg.freq} Hz）`,
      suggested: `BW ≈ ${target} Hz（=50% 中心频率，起点值；MODE=4 动态 FFT 下带宽由该模式决定，以官方 FFT 页为准）`,
      basis: "官方 throttle-based 起步口径 BW≈中心频率 50%：过窄压不住转速漂移，过宽损失相位",
      verify: "全转速段 FTN1 主峰 SNR 均低于参考值且振动不回升",
      param: { name: "INS_HNTCH_BW", from: cfg.bw, to: target, reason: "官方 throttle-based 起步 BW≈50% 中心频率" },
    }),
  };
}

function modeIssue(cfg: NotchConfig): NotchConfigIssue | null {
  if (cfg.mode === null) {
    return {
      id: "modeUnknown",
      severity: "unknown",
      text: "日志里没有 INS_HNTCH_MODE，无法校验频率控制方式是否与硬件/日志配置匹配",
      suggestion: six({
        signature: "缺少 INS_HNTCH_MODE",
        current: "未知",
        suggested: "先补齐该参数；若是 MODE=4 必须同时确认 FFT_ENABLE=1 与硬件支持 FFT",
        basis: "官方给出五种控制方式（0 静态/1 油门/2 RPM/3 ESC 遥测/4 机上 FFT），正确性依赖它",
        verify: "补齐后本条从「无法校验」变为有依据的通过/警告",
      }),
    };
  }
  if (cfg.mode === 4 && !cfg.fftEnabled) {
    return {
      id: "mode",
      severity: "warning",
      text: "INS_HNTCH_MODE=4（机上 FFT 动态跟踪）但 FFT_ENABLE=0：飞控没有运行 FFT，动态跟踪无从生效",
      suggestion: six({
        signature: "MODE=4 且 FFT_ENABLE=0",
        current: "INS_HNTCH_MODE=4、FFT_ENABLE=0",
        suggested: "二选一（方向，不含数值）：开 FFT_ENABLE=1（需 F7/H7 且固件支持）或改 MODE=1/3",
        basis: "官方：MODE=4 为 In-Flight FFT，依赖 FFT 特性与算力",
        verify: "FTN1/FTN2 出现有效主峰，且主峰随转速跟踪",
        param: { name: "FFT_ENABLE", from: 0, to: 1, reason: "MODE=4 依赖机上 FFT；硬件不支持则改 MODE=1/3" },
      }),
    };
  }
  return null;
}

function hmncsIssue(cfg: NotchConfig): NotchConfigIssue | null {
  if (cfg.hmNcs === null) return null;
  const mask = Math.round(cfg.hmNcs);
  if (mask === 0) {
    return {
      id: "hmncs",
      severity: "ok",
      text: "INS_HNTCH_HMNCS=0：只用了基频陷波，未覆盖谐波",
      suggestion: six({
        signature: "HMNCS=0",
        current: "INS_HNTCH_HMNCS=0",
        suggested: "若 FFT 显示 2×/3× 基频处仍有峰，再启用对应谐波（不给掩码值以免与机型不符）",
        basis: "官方：电机噪声在基频整数倍有峰；三次谐波通常安全",
        verify: "2×/3× 基频处 SNR 降到参考值以下",
      }),
    };
  }
  if (mask > 0b111) {
    return {
      id: "hmncs",
      severity: "warning",
      text: `INS_HNTCH_HMNCS=${mask}（二进制 ${mask.toString(2)}）启用的谐波超过官方"三次谐波通常安全"的口径`,
      suggestion: six({
        signature: `HMNCS=${mask} > 3 次谐波`,
        current: `INS_HNTCH_HMNCS=${mask}`,
        suggested: "只保留实测有峰的谐波（方向，不硬给掩码）",
        basis: "官方：ESC 遥测模式下谐波×电机数会成倍增加陷波数量，过多会耗尽 CPU",
        verify: "CPU 负载/日志丢帧恢复正常且 1×/2× 峰仍被压住",
        param: { name: "INS_HNTCH_HMNCS", from: mask, to: 0b11, reason: "官方：只需开启实际有峰的谐波" },
      }),
    };
  }
  return null;
}

/** 全部命中的配置问题，warning → unknown → ok 排序 */
export function notchConfigIssues(cfg: NotchConfig, ftnPeakHz: number | null): NotchConfigIssue[] {
  const rank: Record<Severity, number> = { critical: 0, warning: 1, unknown: 2, ok: 3 };
  return [attIssue(cfg), freqIssue(cfg, ftnPeakHz), modeIssue(cfg), bwIssue(cfg), hmncsIssue(cfg)]
    .filter((x): x is NotchConfigIssue => x !== null)
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}
