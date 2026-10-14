/**
 * DataFlash 解析的**负向对照**：截断、伪造未知消息类型、完全不是 DataFlash、块日志页头 CRC。
 *
 * 依据（任务描述）：截断/CRC 异常必须记入 warnings、跳过该记录，**不得抛异常中断整个文件**，
 * 也不得静默 —— 用户必须能看到"这段日志有问题"。
 */

import { describe, expect, it } from "vitest";

import { parseDataflash } from "@/lib/flightlog/dataflash/parseDataflash";
import { blockLogHeaderCrc, isBlockLogPageHeader, looksLikeBlockLog } from "@/lib/flightlog/dataflash/crc";
import { sliceBytes } from "./flightlog-dataflash-fixture";

const full = parseDataflash(sliceBytes);

describe("flightlog dataflash 负向对照（不崩、记 warning）", () => {
  it("截断到半条记录：跳过并记 warning，已解析部分照常产出", () => {
    const truncated = sliceBytes.subarray(0, 90_000);   // 结束时大概率落在记录中间
    const result = parseDataflash(truncated);

    expect(result.doc.meta.vehicle).toBe("ArduCopter");
    expect(result.stats.records).toBeGreaterThan(100);
    expect(result.stats.records).toBeLessThan(full.stats.records);
    expect(result.warnings.join("|")).toMatch(/截断|跳过/);
    expect(result.doc.series["ATT:0"]).toBeDefined();
  });

  it("伪造未知消息类型：只跳过该字节，不中断整个文件", () => {
    const forged = Uint8Array.from(sliceBytes.subarray(0, 40_000));
    let idx = -1;
    for (let i = 20_000; i + 2 < forged.length; i += 1) {
      if (forged[i] === 0xa3 && forged[i + 1] === 0x95) {
        idx = i;   // 第一条真实记录头，把 msgType 改成未知类型
        break;
      }
    }
    expect(idx).toBeGreaterThan(0);
    forged[idx + 2] = 0x7f;
    const result = parseDataflash(forged);

    expect(result.stats.records).toBeGreaterThan(50);
    expect(result.stats.skippedBytes).toBeGreaterThan(0);
    expect(result.warnings.join("|")).toMatch(/跳过|未知/);
    expect(Object.keys(result.doc.series).length).toBeGreaterThan(0);
    // 这段前缀里还没有 MSG 横幅（本样本第一条 MSG 在 68 KB 处）→ 只能是兜底名，且不得冒充具体机型
    expect(["ArduPilot", "ArduCopter"]).toContain(result.doc.meta.vehicle);
  });

  it("完全不是 DataFlash：返回空文档 + 至少一条可读 warning，不抛异常", () => {
    const result = parseDataflash(new Uint8Array(1024));

    expect(result.stats.records).toBe(0);
    expect(result.doc.series).toEqual({});
    expect(result.doc.messageCounts).toEqual({});
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join("|")).toMatch(/不是 ArduPilot DataFlash|未找到/);
    // 一条记录都没解析出来 → 不冒充具体机型（规则会据此拒绝做单位换算）
    expect(result.doc.meta.vehicleKind).toBe("unknown");
    expect(result.doc.meta.vehicle).toBe("unknown");
    expect(result.doc.meta.firmwareVersion).toBe("unknown");
    expect(result.doc.meta.versionNumeric).toBe(0);
  });

  it("块日志页头 CRC（事实：crc == DF_LOGGING_FORMAT + FilePage）", () => {
    expect(blockLogHeaderCrc(1)).toBe((0x1901201b + 1) >>> 0);
    const page = new Uint8Array(10);
    const view = new DataView(page.buffer);
    view.setUint32(0, 1, true);                        // FilePage
    view.setUint16(4, 7, true);                        // FileNumber
    view.setUint32(6, blockLogHeaderCrc(1), true);     // crc
    expect(isBlockLogPageHeader(page, 0)).toBe(true);
    expect(looksLikeBlockLog(page)).toBe(true);
    view.setUint32(6, blockLogHeaderCrc(2), true);     // crc 与页号不匹配
    expect(isBlockLogPageHeader(page, 0)).toBe(false);
    expect(looksLikeBlockLog(sliceBytes)).toBe(false);
  });
});
