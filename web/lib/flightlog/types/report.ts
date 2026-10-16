/**
 * 诊断报告模型 —— UI 与规则引擎之间**唯一**的契约。
 *
 * 设计原则（对应方案「结论优先，证据可展开」）：
 *  - 每条 Finding 五要素齐全：时间定位 / 现象 / 影响 / 建议 / 严重等级；
 *  - 判定过程必须可审计：evidence 写清阈值、样本数、计算结果；
 *  - 数据不足时 status 必须落在 unknown 一侧，**绝不**降级成 "passed"；
 *  - 规则自己决定"该看哪几条曲线"（charts），UI 不做业务判断。
 */

import type { LogMeta, TimeWindow } from "./log";

export type Severity = "critical" | "warning" | "ok" | "unknown";

/**
 * fired                : 规则触发，有问题
 * passed               : 检查执行且通过
 * not_applicable       : 该规则不适用于此平台/固件版本
 * checked_but_not_supported : 机型/版本不支持该检查
 * missing_required     : 缺少必需消息或参数
 * insufficient_data    : 样本数不足，无法判断
 */
export type CheckStatus =
  | "fired"
  | "passed"
  | "not_applicable"
  | "checked_but_not_supported"
  | "missing_required"
  | "insufficient_data";

export interface ParamChange {
  name: string;
  /** 当前生效值；未知为 null */
  from: number | null;
  to: number;
  reason: string;
}

export interface Suggestion {
  /** 官方调参顺序：1 起步。前一步未验证不做后一步 */
  order: number;
  text: string;
  /** 非参数类建议为 null */
  param: ParamChange | null;
  /** 复飞后的验证指标，如 "rate error RMS 下降 ≥30%"；没有则 null */
  verify: string | null;
}

/** 一条可审计的计算过程 */
export interface EvidenceStep {
  label: string;
  detail: string;
}

export interface SignalRef {
  /** 消息名，如 "PIDP" */
  series: string;
  /** 字段名，如 "Err" */
  field: string;
  instance?: number;
  label?: string;
  color?: string;
  /**
   * 派生变换：图表/证据要显示的**物理量**与原始列不是一回事时必须显式声明，避免"拿错通道"。
   *
   * 两个真实教训（task-34 修）：
   *  - PX4 姿态是**四元数**：直接把 `q[0]`（w 分量）当滚转角画出来，平飞时是 0.7 而滚转角是 0°，
   *    量纲完全不对；必须用 `euler-from-quaternion` 走**与规则指标同一份** `quatToEulerDeg`。
   *  - PX4 的 `*_setpoint.roll_body` 是**弧度**：图上标「度」就必须 `rad-to-deg`，否则两条线量纲不同。
   */
  derive?: SignalDerive;
}

export type SignalDerive =
  | { kind: "rad-to-deg" }
  | {
      kind: "euler-from-quaternion";
      axis: "roll" | "pitch" | "yaw";
      /** 四元数列名，顺序固定为 (w, x, y, z) */
      quatFields: readonly [string, string, string, string];
    };

export interface ThresholdLine {
  value: number;
  label: string;
  axis: "x" | "y";
}

export interface SpectrumPoint {
  freqHz: number;
  power: number;
}

export interface SpectrumData {
  ref: SignalRef;
  points: readonly SpectrumPoint[];
  /** 主峰频率 */
  peakHz: number;
}

export interface ChartRequest {
  id: string;
  kind: "timeseries" | "spectrum";
  title: string;
  signals: readonly SignalRef[];
  /** 时间轴显示范围；null 表示全日志 */
  window: TimeWindow | null;
  thresholds: readonly ThresholdLine[];
  /** 谱图标出陷波中心/谐波等参考频率 */
  peakMarkers: readonly { freqHz: number; label: string }[];
  /** 异常时间段高亮 */
  highlightWindow: TimeWindow | null;
  /** kind === "spectrum" 时必填；由规则算出，UI 不重算 */
  spectrum: SpectrumData | null;
}

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  status: CheckStatus;
  /** 时间定位；无时间意义时为 null */
  window: TimeWindow | null;
  /** 分轴结论（PID/滤波类规则必填） */
  axis: "roll" | "pitch" | "yaw" | null;
  /** 现象描述 */
  phenomenon: string;
  /** 影响判断 */
  impact: string;
  evidence: readonly EvidenceStep[];
  /** 供 UI 直接展示的关键量（峰频、RMS、标准差、clipping 计数…） */
  metrics: Readonly<Record<string, number>>;
  suggestions: readonly Suggestion[];
  docLinks: readonly string[];
  charts: readonly ChartRequest[];
  /** 不适用/缺数据时的原因说明，UI 必须展示，不允许静默跳过 */
  note: string | null;
}

export interface DiagnosisSummary {
  critical: number;
  warning: number;
  passed: number;
  unknown: number;
}

export interface DiagnosisReport {
  meta: LogMeta;
  fileName: string;
  sizeBytes: number;
  parseMs: number;
  analyzeMs: number;
  summary: DiagnosisSummary;
  /** 已按 critical → warning → unknown → ok 排序 */
  findings: readonly Finding[];
}
