/**
 * ArduPilot DataFlash（.bin）解析器 —— **纯函数**，可在 vitest / 主线程直接调用（不依赖 Worker、不依赖 self）。
 *
 * 本文件只负责：**记录定位与游标推进** + 结果装配（meta / counts / series / events / params）。
 * 布局构建在 fmtLayout.ts，字段解码在 layout.ts，分发在 recordHandlers.ts，
 * 列式累积在 series.ts，事件在 events.ts，块日志页头 CRC 在 crc.ts。
 *
 * 硬性行为：
 *  - `messageCounts` 统计**全部**消息（含未解码的），用于缺失判定；
 *  - 截断 / 未知消息类型 / 坏 FMT 只记 warning 并跳过，**不抛异常中断整个文件**；
 *  - 时间统一为秒（相对日志起点第一条 TimeUS）。
 */

import type { LogDocument, LogMeta } from "../types/log";
import { encodeVersion, parseArduPilotBanner } from "../version";
import { FMT_MSG_TYPE, type FormatLayout } from "./layout";
import { fmtSelfLayout } from "./fmtLayout";
import { applyRecord, type WalkState } from "./recordHandlers";
import { SeriesAccumulator } from "./series";
import { EventCollector, extractBoard } from "./events";
import { looksLikeBlockLog } from "./crc";
import { isDeclaration } from "./whitelist";
import { walk } from "./walk";

/** 白名单（对外再导出一份，方便 UI/测试对照；定义在 whitelist.ts）。 */
export { WHITELIST } from "./whitelist";

const MAX_WARNINGS = 40;

export interface ParseOptions {
  /** 进度回调（0..100）；Worker 与主线程都可选传入。 */
  onProgress?: (percent: number) => void;
}

export interface DataflashParseResult {
  doc: LogDocument;
  warnings: readonly string[];
  /** 诊断用统计（记录数、跳过字节数、日志起点时间、耗时），便于 UI 与测试断言。 */
  stats: { records: number; skippedBytes: number; t0us: number; elapsedMs: number };
}

function createState(): WalkState {
  const fmt = fmtSelfLayout();
  return {
    layouts: new Map([[FMT_MSG_TYPE, fmt]]),
    byName: new Map([["FMT", fmt]]),
    unitLabels: new Map(),
    multValues: new Map(),
    counts: new Map(),
    params: {},
    messages: [],
    banner: null,
    ver: null,
    t0us: null,
    minUs: Number.POSITIVE_INFINITY,
    maxUs: Number.NEGATIVE_INFINITY,
    armed: false,
  };
}

export function parseDataflash(bytes: Uint8Array, options: ParseOptions = {}): DataflashParseResult {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const warn = (message: string): void => {
    if (warnings.length < MAX_WARNINGS) warnings.push(message);
  };

  const state = createState();
  if (looksLikeBlockLog(bytes)) {
    warn("这看起来是 ArduPilot 块日志（页头带 CRC）：仍按 0xA3 0x95 记录流解析，页头字节会被跳过");
  }
  const seriesAcc = new SeriesAccumulator(
    (type) => state.layouts.get(type),
    (name) => state.byName.get(name),
  );
  const events = new EventCollector();

  // ── 第一遍：只读"声明类"消息（FMT/FMTU/UNIT/MULT）────────────────────────────
  // 为什么必须两遍：声明可能出现在**数据之后**（本机样本 FMTU 在 36 KB 处、FMT 在文件头），
  // 单遍会让 FMTU 之前的记录拿不到实例号/单位（pymavlink 是先建索引再解码，口径与本实现一致）。
  walk(bytes, state.layouts, (type, view) => {
    const layout = state.layouts.get(type);
    if (!layout || !isDeclaration(layout.name)) return;
    try {
      applyRecord(type, view, state, seriesAcc, events, warn);
    } catch (error) {
      warn(`解析声明 ${layout.name} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, warn);

  // ── 第二遍：解码数据（声明类已处理，不再重复）并统计全部消息 ────────────────
  let progressMark = 0;
  const second = walk(bytes, state.layouts, (type, view) => {
    const layout = state.layouts.get(type);
    if (!layout) return;
    state.counts.set(layout.name, (state.counts.get(layout.name) ?? 0) + 1);
    if (isDeclaration(layout.name)) return;
    try {
      applyRecord(type, view, state, seriesAcc, events, warn);
    } catch (error) {
      warn(`解码 ${layout.name} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, warn, (offset) => {
    if (options.onProgress && offset - progressMark > 1_000_000) {
      progressMark = offset;
      options.onProgress(Math.min(99, Math.floor((offset / bytes.length) * 100)));
    }
  });
  const records = second.records;
  const skippedBytes = second.skipped;

  if (records === 0) {
    warn("未找到任何 FMT 记录，这段字节可能不是 ArduPilot DataFlash 日志（或已损坏）");
  } else if (skippedBytes > 0) {
    warn(`跳过了 ${skippedBytes} 个无法识别的字节（未知消息类型或坏签名），已尽力继续解析`);
  }

  const t0us = state.t0us ?? 0;
  const built = seriesAcc.build(t0us);
  for (const name of built.skippedNoTime) warn(`消息 ${name} 没有 TimeUS 列，未产出 Series`);

  options.onProgress?.(100);
  const doc: LogDocument = {
    meta: buildMeta(state, records > 0),
    series: built.series,
    events: events.build(),
    params: state.params,
    messageCounts: Object.fromEntries(state.counts),
    decodedFields: built.decodedFields,
    warnings,
  };
  return { doc, warnings, stats: { records, skippedBytes, t0us, elapsedMs: Date.now() - startedAt } };
}

/**
 * 机型/固件/板型/时长/是否解锁。
 *
 * ⚠️ `vehicle`/`vehicleKind` 必须尽量给出**具体机型**（Copter=rad/s、Plane=deg/s，规则靠它换算速率环单位），
 * `ArduPilot`/`unknown` 只是"没解析到横幅"的兜底，绝不能覆盖已解析出来的横幅。
 * 版本口径唯一来源是 `version.ts`（major*10000+minor*100+patch）。
 */
function buildMeta(state: WalkState, sawRecords: boolean): LogMeta {
  const bannerInfo = state.banner ? parseArduPilotBanner(state.banner) : null;
  const ver = state.ver;
  if (bannerInfo) {
    return {
      platform: "ardupilot",
      vehicleKind: bannerInfo.kind,
      vehicle: bannerInfo.vehicle,
      firmwareVersion: bannerInfo.version,
      firmwareString: state.banner ?? "",
      versionNumeric: bannerInfo.numeric,
      board: extractBoard(state.messages),
      durationSec: state.maxUs > state.minUs ? (state.maxUs - state.minUs) / 1e6 : 0,
      armed: state.armed,
    };
  }
  return {
    platform: "ardupilot",
    vehicleKind: "unknown",
    // 连一条记录都没有 ⇒ 这大概率根本不是 DataFlash，如实写 unknown 而不是冒充 ArduPilot
    vehicle: sawRecords ? "ArduPilot" : "unknown",
    firmwareVersion: ver ? `${ver.major}.${ver.minor}.${ver.patch}` : "unknown",
    firmwareString: ver?.firmwareString ?? "",
    versionNumeric: ver ? encodeVersion(ver.major, ver.minor, ver.patch) : 0,
    board: extractBoard(state.messages),
    durationSec: state.maxUs > state.minUs ? (state.maxUs - state.minUs) / 1e6 : 0,
    armed: state.armed,
  };
}
