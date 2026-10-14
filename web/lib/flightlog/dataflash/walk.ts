/**
 * 记录定位与游标推进（**只负责找记录、不负责解码**）。
 *
 * 事实来源：ArduPilot `LogStructure.h`（`HEAD_BYTE1/2`、`LOG_PACKET_HEADER_LEN = 3`）
 * 与 pymavlink `DFReader` 的行为——按 `0xA3 0x95 + msgType` 扫描，命中已知布局就整条前进，
 * 否则只跳 1 字节（日志尾部坏块/传输缺口会产生垃圾字节，跳过而不是放弃整个文件）。
 *
 * 记录总长取自 FMT 声明的 Length（**没有记录级校验和**，见 crc.ts 的说明），
 * 所以"记录越界/截断"是唯一可用的结构性完整性检查。
 */

import { HEAD_BYTE1, HEAD_BYTE2, LOG_PACKET_HEADER_LEN, type FormatLayout } from "./layout";

export interface WalkResult {
  records: number;
  /** 为重新同步而跳过的字节数（未知消息类型或坏签名）。 */
  skipped: number;
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
  while (offset + LOG_PACKET_HEADER_LEN <= bytes.length) {
    if (bytes[offset] !== HEAD_BYTE1 || bytes[offset + 1] !== HEAD_BYTE2) {
      offset += 1;
      skipped += 1;
      continue;
    }
    const type = bytes[offset + 2];
    const layout = layouts.get(type);
    if (!layout) {
      offset += 1;
      skipped += 1;
      continue;
    }
    if (offset + layout.length > bytes.length) {
      warn(`记录被截断：offset=${offset} type=${type} 需要 ${layout.length} 字节，仅剩 ${bytes.length - offset} 字节`);
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
  return { records, skipped };
}
