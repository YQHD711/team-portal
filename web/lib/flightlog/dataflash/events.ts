/**
 * 事件抽取：ARM（解锁/上锁）、MODE（模式切换）、EV（日志事件码）、MSG（文字消息分类）。
 *
 * 事实来源：
 *  - `EV.Id` 是 ArduPilot `AP_Logger/AP_Logger.h` 的 `enum class LogEvent : uint8_t`
 *    （10 ARMED / 11 DISARMED / 15 AUTO_ARMED / 17/18 LAND_COMPLETE / 19 LOST_GPS …），
 *    这里只收一份**常用子集**，未知 id 用「事件 <id>」兜底，不编造名字。
 *  - `ARM.ArmState`：0 = 上锁，1 = 解锁（解锁窗口判定用）。
 *  - MSG 的分类是**启发式**（关键字），仅用于 UI 分组，不参与任何规则判定。
 */

import type { LogEvent, LogEventKind } from "../types/log";

/** 常用 LogEvent id → 展示标签（子集，来源见文件头注释）。 */
export const LOG_EVENT_LABELS: Readonly<Record<number, string>> = {
  10: "解锁",
  11: "上锁",
  15: "自动解锁",
  17: "可能已着陆",
  18: "着陆完成",
  19: "GPS 丢失",
  21: "翻转开始",
  22: "翻转结束",
  25: "设置 Home 点",
  28: "未着陆",
  41: "围栏启用",
  42: "围栏禁用",
  49: "降落伞已禁用",
  50: "降落伞已启用",
  51: "降落伞已释放",
  54: "电机紧急停止",
  55: "电机紧急停止解除",
  56: "电机互锁禁用",
  57: "电机互锁启用",
  60: "EKF 高度重置",
  62: "EKF 偏航重置",
};

/** EV 事件码 → 事件大类。 */
export function eventKindForCode(id: number): LogEventKind {
  if (id === 10 || id === 15) return "arm";
  if (id === 11) return "disarm";
  if (id === 19) return "failsafe";
  if (id === 60 || id === 62) return "ekf";
  return "other";
}

/** ARM.ArmState → 事件大类。 */
export function eventKindForArmState(armState: number): "arm" | "disarm" {
  return armState !== 0 ? "arm" : "disarm";
}

/** MSG 文本 → 事件大类（启发式，仅用于展示分组）。 */
export function classifyMessage(text: string): LogEventKind {
  if (/failsafe|fence/i.test(text)) return "failsafe";
  if (/ekf|kalman/i.test(text)) return "ekf";
  if (/prearm|error|fail|critical|crash|watchdog/i.test(text)) return "error";
  return "info";
}

/** 从 MSG 文本里提取板型（样例：`Pixhawk6X 004A0037 30335101 33383936` 的首个 token）。 */
export function extractBoard(messages: readonly string[]): string | undefined {
  for (const text of messages) {
    const match = /^([A-Za-z][\w-]{2,})\s+[0-9A-F]{6,}/.exec(text.trim());
    if (match) return match[1];
  }
  return undefined;
}

/** 事件收集器：解析过程中追加，最后按时间升序输出（契约要求 events 升序）。 */
export class EventCollector {
  private readonly events: LogEvent[] = [];

  addArm(tSec: number, armState: number): void {
    const kind = eventKindForArmState(armState);
    this.events.push({ tSec, kind, label: kind === "arm" ? "解锁（ARM）" : "上锁（DISARM）" });
  }

  addEv(tSec: number, id: number): void {
    this.events.push({
      tSec,
      kind: eventKindForCode(id),
      code: id,
      label: LOG_EVENT_LABELS[id] ?? `事件 ${id}`,
    });
  }

  addMode(tSec: number, modeNum: number, reason: number): void {
    // 模式名需要按机型查表，解析器不猜名字：给出编号与切换原因码（可直接展示）
    this.events.push({
      tSec,
      kind: "mode",
      code: modeNum,
      label: reason > 0 ? `模式切换 → ${modeNum}（原因 ${reason}）` : `模式切换 → ${modeNum}`,
    });
  }

  addMessage(tSec: number, text: string): void {
    const label = text.trim();
    if (label.length === 0) return;
    this.events.push({ tSec, kind: classifyMessage(label), label });
  }

  build(): LogEvent[] {
    return [...this.events].sort((a, b) => a.tSec - b.tSec);
  }
}
