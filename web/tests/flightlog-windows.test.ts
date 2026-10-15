/**
 * arm 窗口识别的回归测试。
 *
 * 线上真实故障：某份 ArduPlane 日志（85 分钟、确实飞过）显示
 * 「没有可用的飞行（arm）时间段」，导致**三条规则全部只能"无法判断"**。
 * 根因是 arm/disarm 事件存在但凑不出 ≥1 秒的窗口时，这里返回了**空集** → 规则集体拒绝分析。
 *
 * 纪律：**能分析就不要拒绝分析**。退化为全日志并如实声明区间不精确，
 * 比返回空集让所有规则闭嘴有用得多；关键是不能假装它精确。
 */

import { describe, expect, it } from "vitest";
import { detectArmedWindows, longestWindow, spanOf } from "@/lib/flightlog/analysis/windows";
import type { LogDocument, LogEvent } from "@/lib/flightlog/types/log";
import { makeDoc } from "./helpers/flightlogFixture";

const ev = (tSec: number, kind: LogEvent["kind"], label: string): LogEvent => ({ tSec, kind, label });

function docWith(events: LogEvent[], durationSec: number): LogDocument {
  return makeDoc({ series: [], durationSec, events });
}

describe("detectArmedWindows", () => {
  it("正常日志：取 arm → disarm 区间", () => {
    const doc = docWith([ev(10, "arm", "ARMED"), ev(70, "disarm", "DISARMED")], 100);
    const r = detectArmedWindows(doc);
    expect(r.source).toBe("events");
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ startSec: 10, endSec: 70 });
    expect(r.note).toBeNull();
  });

  it("多段飞行：每段各一个窗口", () => {
    const doc = docWith(
      [ev(5, "arm", "A"), ev(15, "disarm", "D"), ev(30, "arm", "A"), ev(60, "disarm", "D")],
      100,
    );
    expect(detectArmedWindows(doc).windows).toHaveLength(2);
  });

  it("短于 1 秒的 arm 段被忽略，但不影响有效段", () => {
    const doc = docWith(
      [ev(1, "arm", "A"), ev(1.2, "disarm", "D"), ev(20, "arm", "A"), ev(50, "disarm", "D")],
      100,
    );
    const r = detectArmedWindows(doc);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0].startSec).toBe(20);
  });

  it("⚠️ 线上故障：arm/disarm 有但凑不出有效窗口 → 退化为全日志并声明（**不是空集**）", () => {
    // 时间戳异常：arm 与 disarm 同刻（或间隔 < 1 秒）
    const doc = docWith([ev(42.5, "arm", "ARMED"), ev(42.5, "disarm", "DISARMED")], 5143);
    const r = detectArmedWindows(doc);
    expect(r.windows).toHaveLength(1);                       // 关键：不能是空
    expect(r.windows[0]).toMatchObject({ startSec: 0, endSec: 5143 });
    expect(r.source).toBe("fallback");
    expect(r.note).toContain("地面段");                       // 必须如实说明区间不精确
  });

  it("只有上锁没有解锁（日志在飞行中被切掉）→ 退化为全日志并声明", () => {
    const doc = docWith([ev(9, "disarm", "DISARMED")], 300);
    const r = detectArmedWindows(doc);
    expect(r.windows).toHaveLength(1);
    expect(r.source).toBe("fallback");
    expect(r.note).toContain("地面段");
  });

  it("完全没有 arm/disarm 事件 → 退化为全日志（既有行为）", () => {
    const doc = docWith([ev(1, "mode", "模式切换")], 200);
    const r = detectArmedWindows(doc);
    expect(r.windows).toHaveLength(1);
    expect(r.source).toBe("fallback");
    expect(r.note).toContain("未记录解锁");
  });

  it("连日志时长都拿不到 → 才允许返回空集", () => {
    const doc = docWith([], 0);
    const r = detectArmedWindows(doc);
    expect(r.windows).toHaveLength(0);
    expect(r.note).not.toBeNull();
  });

  it("spanOf / longestWindow 的边界", () => {
    expect(spanOf([])).toBeNull();
    expect(longestWindow([])).toBeNull();
    const windows = [
      { index: 0, startSec: 5, endSec: 15 },
      { index: 1, startSec: 30, endSec: 90 },
    ];
    expect(spanOf(windows)).toEqual({ startSec: 5, endSec: 90 });
    expect(longestWindow(windows)?.index).toBe(1);
  });
});
