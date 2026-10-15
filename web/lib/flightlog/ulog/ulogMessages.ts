/**
 * ULog 定义类消息的 payload 解析（纯函数）。
 *
 * 语义与 pyulog（`pyulog/core.py` 的 `_MessageInfo` / `_MessageFlagBits` /
 * `_MessageAddLogged` / `MessageLogging` / `MessageDropout`）逐条对齐，
 * 这样黄金对照才有意义。
 */

import { TYPE_INFO, isBasicType, readCString } from "./ulogFormat";

export interface UlogInfoMessage {
  /** 声明的类型串（如 `char[10]`、`float`、`uint8_t[3]`） */
  type: string;
  key: string;
  /** 数值或字符串；数组/复合类型返回原始字节 */
  value: number | string | Uint8Array;
}

/** `I`（以及 `P`/`Q` 复用）：key_len:u8 + "type key" + value */
export function parseInfoMessage(payload: Uint8Array, isMultiple = false, skip = 0): UlogInfoMessage {
  let offset = skip;
  if (isMultiple) offset += 1; // is_continued:u8
  const keyLen = payload[offset] ?? 0;
  offset += 1;
  // ⚠️ "type key" 是**长度前缀**字段（pyulog：`data[1:1+key_len]`），**不是** NUL 结尾；
  //    按 NUL 扫描会把 value 一起读进 key（实测：ver_sw 与哈希值粘成一个键）。
  const typeKeyText = new TextDecoder("utf-8", { fatal: false }).decode(
    payload.subarray(offset, Math.min(payload.length, offset + keyLen)),
  );
  offset += keyLen;
  const space = typeKeyText.indexOf(" ");
  const type = space < 0 ? typeKeyText : typeKeyText.slice(0, space);
  const key = space < 0 ? "" : typeKeyText.slice(space + 1);
  const rest = payload.subarray(offset);

  if (type.startsWith("char")) return { type, key, value: readCString(payload, offset).text };
  if (isBasicType(type) && TYPE_INFO[type] !== undefined) {
    const view = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
    const size = TYPE_INFO[type].bytes;
    if (rest.byteLength < size) return { type, key, value: 0 };
    switch (type) {
      case "int8_t": return { type, key, value: view.getInt8(0) };
      case "uint8_t": return { type, key, value: view.getUint8(0) };
      case "int16_t": return { type, key, value: view.getInt16(0, true) };
      case "uint16_t": return { type, key, value: view.getUint16(0, true) };
      case "int32_t": return { type, key, value: view.getInt32(0, true) };
      case "uint32_t": return { type, key, value: view.getUint32(0, true) };
      case "int64_t": return { type, key, value: Number(view.getBigInt64(0, true)) };
      case "uint64_t": return { type, key, value: Number(view.getBigUint64(0, true)) };
      case "float": return { type, key, value: view.getFloat32(0, true) };
      case "double": return { type, key, value: view.getFloat64(0, true) };
      default: return { type, key, value: view.getUint8(0) };
    }
  }
  return { type, key, value: rest };
}

export interface UlogFlagBits {
  compat: number[];
  incompat: number[];
  appendedOffsets: number[];
}

/** `B`：compat[8] + incompat[8] + appended_offsets[3×u64] */
export function parseFlagBits(payload: Uint8Array): UlogFlagBits {
  const compat: number[] = [];
  const incompat: number[] = [];
  for (let i = 0; i < 8; i += 1) compat.push(payload[i] ?? 0);
  for (let i = 0; i < 8; i += 1) incompat.push(payload[8 + i] ?? 0);
  const appendedOffsets: number[] = [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (let i = 0; i < 3; i += 1) {
    const at = 16 + i * 8;
    if (at + 8 <= payload.byteLength) {
      const value = Number(view.getBigUint64(at, true));
      if (value > 0) appendedOffsets.push(value);
    }
  }
  return { compat, incompat, appendedOffsets };
}

export interface UlogAddLogged {
  multiId: number;
  msgId: number;
  name: string;
}

/** `A`：multi_id:u8 + msg_id:u16 + 消息名 */
export function parseAddLogged(payload: Uint8Array): UlogAddLogged {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const multiId = payload.byteLength > 0 ? view.getUint8(0) : 0;
  const msgId = payload.byteLength >= 3 ? view.getUint16(1, true) : 0;
  return { multiId, msgId, name: readCString(payload, 3).text };
}

export interface UlogLoggingMessage {
  level: number;
  levelLabel: string;
  tag: number | null;
  timestampUs: number;
  message: string;
}

export const LOG_LEVEL_LABEL: Readonly<Record<number, string>> = {
  0x30: "EMERGENCY",
  0x31: "ALERT",
  0x32: "CRITICAL",
  0x33: "ERROR",
  0x34: "WARNING",
  0x35: "NOTICE",
  0x36: "INFO",
  0x37: "DEBUG",
};

/** `L`（level+timestamp+string）/ `C`（再加 tag:u16） */
export function parseLogging(payload: Uint8Array, tagged: boolean): UlogLoggingMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const level = payload.byteLength > 0 ? view.getUint8(0) : 0;
  const tag = tagged && payload.byteLength >= 3 ? view.getUint16(1, true) : null;
  const tsOffset = tagged ? 3 : 1;
  const timestampUs = payload.byteLength >= tsOffset + 8 ? Number(view.getBigUint64(tsOffset, true)) : 0;
  const message = readCString(payload, tsOffset + 8).text;
  return { level, levelLabel: LOG_LEVEL_LABEL[level] ?? "UNKNOWN", tag, timestampUs, message };
}

/** `O`：dropout 持续时长（ms） */
export function parseDropout(payload: Uint8Array): number {
  if (payload.byteLength < 2) return 0;
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0, true);
}
