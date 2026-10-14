/**
 * DataFlash **块日志页头**校验（事实来源：ArduPilot `libraries/AP_Logger/AP_Logger_Block.cpp`
 * 与 `AP_Logger_Block.h`，仅取格式事实，实现为原创 TS）。
 *
 * 要点（务必别搞混）：
 *  - 现代 ArduPilot 的 **每条记录没有校验和**：记录长度完全由 FMT 记录的 Length 字段自描述
 *    （pymavlink 的 DFReader 也是按 Length 直接切片，不校验记录 CRC）。所以解析器对记录只能做
 *    **结构性**校验（长度、越界、未知类型、签名扫描），不能凭空"验 CRC"。
 *  - 真正存在的 CRC 是 **块日志（LOG_BLOCK 后端）的页头**：
 *      `struct PACKED PageHeader { uint32_t FilePage; uint16_t FileNumber; uint32_t crc; }`
 *      且 `crc == DF_LOGGING_FORMAT + FilePage`（`DF_LOGGING_FORMAT = 0x1901201B`）。
 *      注意 `crc` 字段只在 `BLOCK_LOG_VALIDATE` 打开时写入 → 本模块的检测是**启发式**，
 *      只在启动时判断"这像不像块日志"，用于给用户一句解释，不参与记录解码。
 */

/** ArduPilot `AP_Logger_Block.cpp` 的 `DF_LOGGING_FORMAT`。 */
export const DF_LOGGING_FORMAT = 0x1901201b;

/** 页头字段偏移（LE）：FilePage u32 @0、FileNumber u16 @4、crc u32 @6。 */
export const PAGE_HEADER_SIZE = 10;

/** `crc == DF_LOGGING_FORMAT + FilePage`（无符号 32 位）。 */
export function blockLogHeaderCrc(filePage: number): number {
  return (DF_LOGGING_FORMAT + filePage) >>> 0;
}

/** 判断 offset 处是不是一个合法的块日志页头（FileNumber 为 0xFFFF 表示空页，不算）。 */
export function isBlockLogPageHeader(bytes: Uint8Array, offset = 0): boolean {
  if (offset < 0 || offset + PAGE_HEADER_SIZE > bytes.length) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, PAGE_HEADER_SIZE);
  const filePage = view.getUint32(0, true);
  const fileNumber = view.getUint16(4, true);
  const crc = view.getUint32(6, true);
  if (fileNumber === 0xffff) return false;
  if (filePage === 0) return false;
  return crc === blockLogHeaderCrc(filePage);
}

/**
 * 文件开头是否像块日志（第一页 FilePage=1、FileNumber 非空、crc 对得上）。
 * 只用于给出一句"这是块日志格式"的说明；普通 .bin 直接以 0xA3 0x95 记录开头，会返回 false。
 */
export function looksLikeBlockLog(bytes: Uint8Array): boolean {
  if (bytes.length < PAGE_HEADER_SIZE) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, PAGE_HEADER_SIZE);
  return view.getUint32(0, true) === 1 && isBlockLogPageHeader(bytes, 0);
}
