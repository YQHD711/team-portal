/**
 * 解码白名单：只把规则真正用到的消息解码成 Series（其余只统计条数，见 LogDocument.messageCounts）。
 *
 * 为什么要白名单：日志里有 81 种消息、二十多万条记录，全解一遍既慢又占内存；
 * 规则只需要姿态/PID/振动/滤波/输出/供电/位置/事件这几类。
 */

/** 会被解码成数据的消息。 */
export const WHITELIST: readonly string[] = [
  "FMT", "FMTU", "UNIT", "MULT", "PARM", "VIBE", "PIDR", "PIDP", "PIDY", "RATE", "ATT",
  "IMU", "FTN1", "FTN2", "RCOU", "CTUN", "POWR", "BAT", "GPS", "EV", "MODE", "ARM", "MSG", "VER",
];

/** 只驱动元信息（布局/单位/参数/事件），不产出 Series。 */
export const META_ONLY: ReadonlySet<string> = new Set(["FMT", "FMTU", "UNIT", "MULT", "PARM", "MSG"]);

/** 声明类消息：只提供"格式/单位/倍率/实例"这些事实，必须在解码数据之前全部读完（两遍扫描）。 */
export const DECLARATION_ONLY: ReadonlySet<string> = new Set(["FMT", "FMTU", "UNIT", "MULT"]);

export function isWhitelisted(name: string): boolean {
  return WHITELIST.includes(name);
}

export function isDeclaration(name: string): boolean {
  return DECLARATION_ONLY.has(name);
}
