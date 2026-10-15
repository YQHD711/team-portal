/**
 * arm 窗口识别。
 *
 * arm 窗口是所有"只统计飞行中"规则的基础；识别不出来时**必须**如实声明，
 * 因为把地面段混进统计会显著拉低振动/PID 指标的置信度。
 */

import type { ArmedWindow, LogDocument } from "../types/log";

export interface ArmedWindowResult {
  windows: ArmedWindow[];
  /** events = 来自 arm/disarm 事件；fallback = 无事件记录，退化为全日志并需在报告中声明 */
  source: "events" | "fallback";
  note: string | null;
}

/** 短于该时长的 arm 段忽略（多为解锁后立即上锁） */
const MIN_WINDOW_SEC = 1;

export function detectArmedWindows(doc: LogDocument): ArmedWindowResult {
  const events = doc.events.filter(
    (e) => e.kind === "arm" || e.kind === "disarm",
  );
  if (events.length === 0) {
    if (!(doc.meta.durationSec > 0)) {
      return {
        windows: [],
        source: "fallback",
        note: "日志未记录解锁/上锁事件，且无法确定时长，按整个文件统计",
      };
    }
    return {
      windows: [{ index: 0, startSec: 0, endSec: doc.meta.durationSec }],
      source: "fallback",
      note: "日志未记录解锁/上锁事件，统计区间退化为整个日志（含地面段）",
    };
  }

  const windows: ArmedWindow[] = [];
  let start: number | null = null;
  for (const e of events) {
    if (e.kind === "arm") {
      if (start === null) start = e.tSec;
    } else if (start !== null) {
      if (e.tSec - start >= MIN_WINDOW_SEC) {
        windows.push({ index: windows.length, startSec: start, endSec: e.tSec });
      }
      start = null;
    }
  }
  if (start !== null && doc.meta.durationSec - start >= MIN_WINDOW_SEC) {
    windows.push({
      index: windows.length,
      startSec: start,
      endSec: doc.meta.durationSec,
    });
  }

  if (windows.length === 0) {
    // ⚠️ 线上真实故障：某份 ArduPlane 日志（85 分钟、确实飞过）报「没有可用的飞行时间段」，
    // 结果是**三条规则全部只能"无法判断"**。原因是 arm/disarm 事件存在但凑不出 ≥1 秒的窗口
    // （时间戳异常/同刻成对出现），而这里返回空集 → 规则集体拒绝分析。
    //
    // 正确行为：**能分析就不要拒绝分析**——退化为全日志，并在 note 里如实说明区间不精确。
    // 分析一个偏宽的区间远比"什么都不分析"有用；关键是不能假装它精确。
    if (doc.meta.durationSec > 0) {
      return {
        windows: [{ index: 0, startSec: 0, endSec: doc.meta.durationSec }],
        source: "fallback",
        note:
          "有解锁/上锁事件，但无法据此确定有效飞行段（时长不足 1 秒或时间戳异常），" +
          "统计区间已退化为整个日志（含地面段），结论可能被地面段拉偏",
      };
    }
    return {
      windows: [],
      source: "events",
      note: "有解锁/上锁事件，但没有一段有效飞行时长，也无法确定日志时长，无法做飞行段统计",
    };
  }
  return { windows, source: "events", note: null };
}

/** 合并多个 arm 窗口为外接区间，供只支持单窗口的图表使用 */
export function spanOf(windows: readonly ArmedWindow[]): {
  startSec: number;
  endSec: number;
} | null {
  if (windows.length === 0) return null;
  let start = windows[0].startSec;
  let end = windows[0].endSec;
  for (const w of windows) {
    if (w.startSec < start) start = w.startSec;
    if (w.endSec > end) end = w.endSec;
  }
  return { startSec: start, endSec: end };
}

/** 选择用于统计的主窗口：取最长的一段 */
export function longestWindow(windows: readonly ArmedWindow[]): ArmedWindow | null {
  let best: ArmedWindow | null = null;
  for (const w of windows) {
    if (!best || w.endSec - w.startSec > best.endSec - best.startSec) best = w;
  }
  return best;
}
