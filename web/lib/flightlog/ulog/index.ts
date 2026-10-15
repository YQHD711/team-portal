/**
 * PX4 ULog 解析器的对外出口（只做导出）。
 *
 * 用法（主线程）：
 *   import { parseUlogFile } from "@/lib/flightlog/ulog";
 *   const { doc, warnings, stats } = await parseUlogFile(file, { onProgress: p => … });
 *
 * 用法（纯函数 / 测试 / 自己管 Worker）：
 *   import { parseUlog } from "@/lib/flightlog/ulog";
 *   const { doc, warnings, stats } = parseUlog(bytes);
 *
 * PX4 姿态是四元数：`quatToEulerDeg` / `quatColumnsToEulerDeg` 供规则把
 * `vehicle_attitude.q[0..3]` 转成 roll/pitch/yaw（度，yaw ∈ ±180°）。
 */

export { parseUlog, looksLikeUlog } from "./parseUlog";
export type { UlogParseOptions, UlogParseResult } from "./parseUlog";
export { parseUlogFile } from "./client";
export type { ParseLogFileResult } from "./client";
export { quatToEulerDeg, quatColumnsToEulerDeg, wrap180Deg, RAD_TO_DEG } from "./quaternion";
export type { EulerDeg } from "./quaternion";
export { parseFormatString, flattenFormat, readCString, TYPE_INFO, fieldByteSize } from "./ulogFormat";
export type { FlatField, UlogFieldSpec, UlogMessageFormat } from "./ulogFormat";
export { vehicleKindFromTopics, decodeSwRelease, formatVersion } from "./ulogMeta";
