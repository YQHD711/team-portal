/**
 * 飞行日志的**平台无关**数据模型。
 *
 * 解析器（ArduPilot DataFlash / PX4 ULog）负责把原始字节变成 LogDocument；
 * 诊断规则只依赖这一层，因此新增平台不需要改任何规则。
 *
 * 冻结约定（改动必须同步四个使用方：解析器、规则引擎、UI、测试）：
 *  - 时间一律是**秒**（相对日志起点），解析器负责从 TimeUS 换算；
 *  - 字段值已按 FMTU/MULT 声明换算为标称单位，不做二次加工；
 *  - 数值一律 Float64Array，且与同一 Series 的 timeSec 长度严格相等；
 *  - 缺数据必须显式表达（Series 为 null / 字段不存在），禁止用 0 填充。
 */

export type Platform = "ardupilot" | "px4";

export type VehicleKind =
  | "copter"
  | "plane"
  | "rover"
  | "sub"
  | "tracker"
  | "blimp"
  | "px4-multirotor"
  | "px4-fixedwing"
  | "unknown";

export interface LogMeta {
  platform: Platform;
  vehicleKind: VehicleKind;
  /** 原始机型字符串，如 "ArduCopter" */
  vehicle: string;
  /** 人类可读版本，如 "4.6.2" */
  firmwareVersion: string;
  /** 完整版本横幅，如 "ArduCopter V4.6.2 (1ebd4d99)" */
  firmwareString: string;
  /** 规则 applies_to 比对用的数值版本，major*10000+minor*100+patch，见 version.ts */
  versionNumeric: number;
  /** 硬件/板型，拿不到则 undefined */
  board?: string;
  /** 日志覆盖时长（秒） */
  durationSec: number;
  /** 是否检测到 arm 动作 */
  armed: boolean;
}

export interface Series {
  /** 消息名，如 "VIBE"、"PIDR" */
  name: string;
  /** 多实例消息（IMU/VIBE/GPS）的实例号；无实例概念时为 0 */
  instance: number;
  timeSec: Float64Array;
  /** 字段名 -> 数值。字段名与日志 FMT 声明一致（VibeX / Err / D …） */
  fields: Readonly<Record<string, Float64Array>>;
  /** 字段名 -> 单位（来自 UNIT/FMTU/MULT 声明，拿不到为空字符串） */
  units: Readonly<Record<string, string>>;
}

export type LogEventKind =
  | "arm"
  | "disarm"
  | "mode"
  | "failsafe"
  | "error"
  | "ekf"
  | "info"
  | "other";

export interface LogEvent {
  tSec: number;
  kind: LogEventKind;
  /** 原始事件码（ArduPilot EV.Id），拿不到为 undefined */
  code?: number;
  /** 人类可读标签，必须可直接展示 */
  label: string;
}

export interface TimeWindow {
  startSec: number;
  endSec: number;
}

export interface ArmedWindow extends TimeWindow {
  index: number;
}

/** 参数名 -> 值（只保留最后一次出现的值，即飞控实际生效值） */
export type Params = Readonly<Record<string, number>>;

export interface LogDocument {
  meta: LogMeta;
  /** key = `${name}:${instance}` */
  series: Readonly<Record<string, Series>>;
  /** 按时间升序 */
  events: readonly LogEvent[];
  params: Params;
  /** 消息名 -> 原始记录条数，**包含未解码的消息**，用于缺失判定与覆盖度展示 */
  messageCounts: Readonly<Record<string, number>>;
  /** 消息名 -> 已解码字段清单 */
  decodedFields: Readonly<Record<string, readonly string[]>>;
  /** 解析过程中的非致命问题（未知消息、CRC 不符、截断等），必须向上暴露而非吞掉 */
  warnings: readonly string[];
}
