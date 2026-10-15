/**
 * ArduPilot DataFlash 解析器的对外出口（只做导出，不含实现）。
 *
 * 用法（主线程）：
 *   import { parseLogFile } from "@/lib/flightlog/dataflash";
 *   const { doc, warnings, stats } = await parseLogFile(file, { onProgress: p => console.log(p.percent) });
 *
 * 用法（纯函数 / 测试 / 自己管 Worker）：
 *   import { parseDataflash } from "@/lib/flightlog/dataflash";
 *   const { doc, warnings, stats } = parseDataflash(bytes);
 */

export { parseDataflash } from "./parseDataflash";
export type { DataflashParseResult, ParseOptions } from "./parseDataflash";
export { parseLogFile } from "./client";
export type {
  ParseLogOptions,
  ParseLogFileResult,
  ParsePhase,
  ParseProgress,
} from "./client";
export {
  parseFormatHeader, buildLayout, buildLayoutDetailed, applyFmtu, fmtSelfLayout, roundMultiplier,
} from "./fmtLayout";
export type { FormatHeader } from "./fmtLayout";
export { FIELD_SPECS, HEAD_BYTE1, HEAD_BYTE2, LOG_PACKET_HEADER_LEN, FMT_MSG_TYPE, readField, applyMultiplier } from "./layout";
export type { FieldKind, FieldSpec, FormatLayout } from "./layout";
export { DF_LOGGING_FORMAT, blockLogHeaderCrc, isBlockLogPageHeader, looksLikeBlockLog } from "./crc";
export { LOG_EVENT_LABELS, eventKindForCode, eventKindForArmState, classifyMessage } from "./events";
export { DECLARATION_ONLY, isDeclaration } from "./messageKinds";
export { skipWarnings, walk } from "./walk";
export type { WalkResult } from "./walk";
