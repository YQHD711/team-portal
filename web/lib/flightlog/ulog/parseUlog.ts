/**
 * PX4 ULog（.ulg）解析器 —— **纯函数**，可在 vitest / 主线程 / Worker 里跑。
 *
 * ULog 是**自描述**格式：文件头 16 字节（`ULog` 魔术 + 版本 + 起始时间戳）之后，
 * 全是 `3 字节消息头（size:u16 + type:u8）+ payload`。字段布局来自日志自己的 `F` 消息，
 * 因此整个 ulog/ 目录**没有任何 topic/字段硬编码表**（这是 ULog 相对 DataFlash 的核心优势）。
 *
 * 覆盖消息类型见 `ulogScan.ts`；本文件只负责：文件头校验、扫描循环、
 * 损坏重同步、警告/统计装配。**截断与跳过一律写 warning，不允许静默。**
 */

import type { LogDocument } from "../types/log";
import { UlogScanner } from "./ulogScan";
import type { UlogMessageFormat } from "./ulogFormat";

const HEADER_LEN = 16;
const HEADER_BYTES: readonly number[] = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35];
const SYNC_BYTES: readonly number[] = [0x53, 0x79, 0x6e, 0x63]; // "Sync"
const MAX_WARNINGS = 60;
const MAX_MESSAGE_SIZE = 10_000;

export interface UlogParseOptions {
  onProgress?: (percent: number) => void;
}

export interface UlogParseResult {
  doc: LogDocument;
  warnings: readonly string[];
  /** 自描述格式表（黄金对照 / 覆盖度） */
  formats: ReadonlyMap<string, UlogMessageFormat>;
  /** (topic, multi_id) 记录数（黄金对照用） */
  datasets: readonly { name: string; multiId: number; records: number }[];
  /** 日志自述信息（ver_sw_release / ver_hw / sys_name …） */
  info: ReadonlyMap<string, number | string | Uint8Array>;
  stats: {
    records: number;
    skippedBytes: number;
    t0us: number;
    elapsedMs: number;
    /** 文件末尾不足一条完整消息的字节数（截断不允许静默） */
    truncatedBytes: number;
  };
}

/** 内容嗅探：ULog 魔术头（供按格式路由使用） */
export function looksLikeUlog(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_LEN) return false;
  return HEADER_BYTES.every((b, i) => bytes[i] === b);
}

function findSync(bytes: Uint8Array, from: number): number {
  outer: for (let i = from; i + SYNC_BYTES.length <= bytes.length; i += 1) {
    for (let j = 0; j < SYNC_BYTES.length; j += 1) {
      if (bytes[i + j] !== SYNC_BYTES[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function parseUlog(bytes: Uint8Array, options: UlogParseOptions = {}): UlogParseResult {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const warn = (message: string): void => {
    if (warnings.length < MAX_WARNINGS && !warnings.includes(message)) warnings.push(message);
  };

  if (bytes.length < HEADER_LEN) {
    throw new Error(`不是 ULog 文件：长度只有 ${bytes.length} 字节（文件头需要 ${HEADER_LEN} 字节）`);
  }
  if (!looksLikeUlog(bytes)) {
    throw new Error("不是 ULog 文件：文件头魔术不匹配（应为 55 4C 6F 67 01 12 35）");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileVersion = bytes[7];
  if (fileVersion > 1) warn(`ULog 文件版本 ${fileVersion} 高于已知版本 1，按现有规则尽力解析`);

  const scanner = new UlogScanner(warn);
  scanner.setHeaderStartUs(Number(view.getBigUint64(8, true)));
  let skippedBytes = 0;
  let truncatedBytes = 0;
  let recovered = false;
  let offset = HEADER_LEN;

  while (offset + 3 <= bytes.length) {
    const msgSize = view.getUint16(offset, true);
    const msgType = String.fromCharCode(view.getUint8(offset + 2));
    const payloadStart = offset + 3;
    const payloadEnd = payloadStart + msgSize;

    // 明显不可能的头部 = 损坏：退 1 字节并按 Sync 标记重同步（与 pyulog 同思路）
    if (msgSize === 0 || msgSize > MAX_MESSAGE_SIZE) {
      const syncAt = findSync(bytes, offset + 1);
      if (syncAt < 0) {
        warn(`解析在 offset ${offset} 处遇到损坏头部（size=${msgSize}）且找不到同步标记，停止解析`);
        break;
      }
      skippedBytes += syncAt - offset;
      recovered = true;
      offset = syncAt + SYNC_BYTES.length;
      continue;
    }
    if (payloadEnd > bytes.length) {
      truncatedBytes = bytes.length - offset;
      warn(`文件末尾截断：offset ${offset} 起只剩 ${bytes.length - offset} 字节，不足一条完整消息（size=${msgSize}，类型 ${msgType}）`);
      break;
    }

    try {
      scanner.handle(msgType, bytes, view, payloadStart, payloadEnd, offset);
    } catch (error) {
      if (error instanceof RangeError) {
        // payload 越界 = 文件在记录中间结束：把剩余字节记成截断，而不是只写一条警告
        truncatedBytes = Math.max(truncatedBytes, bytes.length - offset);
        warn(`offset ${offset} 的消息（类型 ${msgType}）payload 不足（文件可能被截断）：${error.message}`);
      } else {
        throw error;
      }
    }
    offset = payloadEnd;
  }

  // 循环结束后若还剩 1–2 字节（不足一个消息头），也必须记成截断，不能静默
  if (offset < bytes.length) {
    truncatedBytes = Math.max(truncatedBytes, bytes.length - offset);
    warn(`文件末尾剩余 ${bytes.length - offset} 字节不足一条消息头（offset ${offset}），已计入截断`);
  }
  const doc = scanner.finish();
  if (scanner.zeroTimestamps > 0) {
    warn(`有 ${scanner.zeroTimestamps} 条记录的时间戳为 0（PX4 未初始化值）：已保留在数据里，但不参与日志起点/时长计算`);
  }
  if (recovered) warn(`解析中检测到数据损坏，已按 Sync 标记重同步（跳过 ${skippedBytes} 字节）`);
  const withWarnings: LogDocument = { ...doc, warnings };
  options.onProgress?.(100);

  return {
    doc: withWarnings,
    warnings,
    formats: scanner.formatsTable,
    datasets: scanner.datasetCounts,
    info: scanner.infoEntries,
    stats: {
      records: scanner.records,
      // 与 DataFlash 同口径：截断尾巴也算"被跳过的字节"（UI 的醒目告警只看这个数字）
      skippedBytes: skippedBytes + truncatedBytes,
      // t0 = 第一帧数据的时间戳（µs）；没有数据时退化到文件头时间戳
      t0us: scanner.t0us || Number(view.getBigUint64(8, true)),
      elapsedMs: Date.now() - startedAt,
      truncatedBytes,
    },
  };
}
