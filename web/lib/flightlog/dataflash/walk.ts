/**
 * 记录定位与游标推进（**只负责找记录、不负责解码**）。
 *
 * 事实来源：ArduPilot `LogStructure.h`（`HEAD_BYTE1/2`、`LOG_PACKET_HEADER_LEN = 3`）
 * 与 pymavlink `DFReader` 的行为——按 `0xA3 0x95 + msgType` 扫描，命中已知布局就整条前进，
 * 否则只跳 1 字节（日志尾部坏块/传输缺口会产生垃圾字节，跳过而不是放弃整个文件）。
 *
 * 记录总长取自 FMT 声明的 Length（**没有记录级校验和**，见 crc.ts 的说明），
 * 所以"记录越界/截断"是唯一可用的结构性完整性检查。
 *
 * task-24「零静默跳过」：所有跳过的字节都要能说清来源 —— 除总数外还回报
 * **每种未声明消息类型出现的次数**与**截断尾部字节数**。
 */

import { HEAD_BYTE1, HEAD_BYTE2, LOG_PACKET_HEADER_LEN, type FormatLayout } from "./layout";

export interface UnknownTypeStat {
  count: number;
}

export interface WalkResult {
  records: number;
  /** 总计跳过的字节：重同步 + 未声明类型 + 截断尾部。 */
  skippedBytes: number;
  /** 未在 FMT 表里的消息类型 → 出现次数（用于指名报告）。 */
  unknownTypes: Map<number, UnknownTypeStat>;
  /** 因文件末尾不完整而被丢弃的字节数。 */
  truncatedBytes: number;
}

export function walk(
  bytes: Uint8Array,
  layouts: Map<number, FormatLayout>,
  onRecord: (type: number, view: DataView) => void,
  warn: (message: string) => void,
  onAdvance?: (offset: number) => void,
): WalkResult {
  let offset = 0;
  let records = 0;
  let skipped = 0;
  let truncated = 0;
  const unknownTypes = new Map<number, UnknownTypeStat>();

  while (offset + LOG_PACKET_HEADER_LEN <= bytes.length) {
    if (bytes[offset] !== HEAD_BYTE1 || bytes[offset + 1] !== HEAD_BYTE2) {
      offset += 1;
      skipped += 1;
      continue;
    }
    const type = bytes[offset + 2];
    const layout = layouts.get(type);
    if (!layout) {
      // 签名对但类型没声明过：记下类型再跳 1 字节（长度未知，只能重新扫描同步）
      const stat = unknownTypes.get(type);
      if (stat) stat.count += 1;
      else unknownTypes.set(type, { count: 1 });
      offset += 1;
      skipped += 1;
      continue;
    }
    if (offset + layout.length > bytes.length) {
      truncated = bytes.length - offset;
      skipped += truncated;
      warn(`记录被截断：offset=${offset} type=0x${type.toString(16)}(${layout.name}) 需要 ${layout.length} 字节，`
        + `仅剩 ${truncated} 字节 —— 尾部 ${truncated} 字节按跳过处理`);
      break;
    }
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + LOG_PACKET_HEADER_LEN,
      layout.length - LOG_PACKET_HEADER_LEN,
    );
    onRecord(type, view);
    records += 1;
    offset += layout.length;
    onAdvance?.(offset);
  }
  return { records, skippedBytes: skipped, unknownTypes, truncatedBytes: truncated };
}

/**
 * 把跳过情况翻成**可读 warning**（零静默跳过的最后一环）：
 * 逐条列出出现过的未声明类型（按出现次数降序，最多 `maxPerType` 条）与截断尾部。
 */
export function skipWarnings(result: WalkResult, maxPerType = 10): string[] {
  const messages: string[] = [];
  const unknown = [...result.unknownTypes.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [type, stat] of unknown.slice(0, maxPerType)) {
    messages.push(`跳过未声明的消息类型 0x${type.toString(16)}：出现 ${stat.count} 处（FMT 里没有它，长度未知）`);
  }
  if (unknown.length > maxPerType) {
    const rest = unknown.slice(maxPerType);
    const restCount = rest.reduce((sum, [, stat]) => sum + stat.count, 0);
    messages.push(`另有 ${rest.length} 种未声明消息类型被跳过（合计 ${restCount} 处），例如 0x${rest[0][0].toString(16)}`);
  }
  if (result.truncatedBytes > 0) {
    messages.push(`文件末尾有 ${result.truncatedBytes} 字节的不完整记录，已按跳过计入 skippedBytes`);
  }
  return messages;
}
