/**
 * ArduPilot DataFlash（.bin）解析器 —— **纯函数**，可在 vitest / 主线程直接调用（不依赖 Worker、不依赖 self）。
 *
 * 本文件只负责：**记录定位与游标推进** + 结果装配（meta / counts / series / events / params / warnings）。
 * 布局构建在 fmtLayout.ts，字段解码在 layout.ts，分发在 recordHandlers.ts，
 * 列式累积在 series.ts，事件在 events.ts，块日志页头 CRC 在 crc.ts，跳过归因在 walk.ts。
 *
 * task-24 起**解码全部 FMT 声明的消息类型**（没有白名单），并**零静默跳过**：
 *  - `decodedFields` 键数必须等于 `messageCounts` 键数（覆盖度判据，契约 §0.5.3）；
 *  - 任何跳过（未声明类型 / 截断尾部 / 坏 FMT / 字段解码异常）都写进 `warnings` 并计入 `skippedBytes`，
 *    并指名消息类型与格式字符；
 *  - 截断/异常仍然**不抛**，只跳过该记录继续。
 *
 * ⚠️ **不要按固定下标读字段**（recordHandlers.ts 里已全部改为按列名 + 旧固件位置兜底）：
 * 真实语料实测到同一消息在不同固件版本列顺序会变 —— 4.8.0-dev 的 `MSG` 是
 * `[TimeUS, ID, Seq, Message]`，而 4.6.2 是 `[TimeUS, Message]`；照旧写死下标 1 会把 `ID`
 * 当成横幅文字，导致 10 个 4.8.0-dev 日志的 `meta.vehicle` 退化成兜底值、`MSG` 事件标签变成数字。
 * 新增字段读取一律走 `resolveIndex/numberField/stringField`，位置兜底只作为老固件兼容位。
 */

import type { LogDocument, LogMeta } from "../types/log";
import { encodeVersion, parseArduPilotBanner } from "../version";
import { FMT_MSG_TYPE } from "./layout";
import { fmtSelfLayout } from "./fmtLayout";
import { applyRecord, type WalkState } from "./recordHandlers";
import { SeriesAccumulator } from "./series";
import { EventCollector, extractBoard } from "./events";
import { looksLikeBlockLog } from "./crc";
import { isDeclaration } from "./messageKinds";
import { skipWarnings, walk } from "./walk";

const MAX_WARNINGS = 60;

export interface ParseOptions {
  /** 进度回调（0..100）；Worker 与主线程都可选传入。 */
  onProgress?: (percent: number) => void;
}

export interface DataflashParseResult {
  doc: LogDocument;
  warnings: readonly string[];
  /** 诊断用统计（记录数、跳过字节数、日志起点时间、耗时、末尾不完整字节数）。 */
  stats: {
    records: number;
    skippedBytes: number;
    t0us: number;
    elapsedMs: number;
    /** 其中属于"文件末尾半条记录"的字节数（= skippedBytes 时说明跳过全部来自截断尾巴）。 */
    truncatedBytes: number;
  };
}

function createState(): WalkState {
  const fmt = fmtSelfLayout();
  return {
    layouts: new Map([[FMT_MSG_TYPE, fmt]]),
    byName: new Map([["FMT", fmt]]),
    unitLabels: new Map(),
    multValues: new Map(),
    counts: new Map(),
    decodedFields: new Map(),
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
  // 为什么必须两遍：声明可能出现在**数据之后**（真实样本 FMTU 在 36 KB 处、FMT 在文件头），
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

  // ── 第二遍：解码全部消息（声明类再走一遍是幂等的，同时也保证 decodedFields 覆盖所有类型）──
  let progressMark = 0;
  const second = walk(bytes, state.layouts, (type, view) => {
    const layout = state.layouts.get(type);
    if (!layout) return;
    state.counts.set(layout.name, (state.counts.get(layout.name) ?? 0) + 1);
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

  // ── 跳过归因：未声明类型 / 截断尾部 / 总计（零静默跳过）──────────────────────
  for (const message of skipWarnings(second)) warn(message);
  if (second.records === 0) {
    warn("未找到任何 FMT 记录，这段字节可能不是 ArduPilot DataFlash 日志（或已损坏）");
  } else if (second.skippedBytes > 0) {
    warn(`本次解析共跳过 ${second.skippedBytes} 字节（日志共 ${bytes.length} 字节，`
      + `成功率 ${(100 * (1 - second.skippedBytes / bytes.length)).toFixed(3)}%）`);
  }

  const t0us = state.t0us ?? 0;
  const built = seriesAcc.build(t0us);
  for (const name of built.skippedNoTime) warn(`消息 ${name} 没有 TimeUS 列，未产出 Series（字段仍已解码）`);

  // 覆盖度：完整解析后两个键数必须相等，不等就是"只计数没解码"，必须能被看到
  if (state.decodedFields.size !== state.counts.size) {
    warn(`覆盖度不一致：解码 ${state.decodedFields.size} 种 / 出现 ${state.counts.size} 种消息类型，`
      + "缺失的解码路径需要排查");
  }

  options.onProgress?.(100);
  const doc: LogDocument = {
    meta: buildMeta(state, second.records > 0),
    series: built.series,
    events: events.build(),
    params: state.params,
    messageCounts: Object.fromEntries(state.counts),
    decodedFields: Object.fromEntries(state.decodedFields),
    warnings,
  };
  return {
    doc,
    warnings,
    stats: {
      records: second.records,
      skippedBytes: second.skippedBytes,
      t0us,
      elapsedMs: Date.now() - startedAt,
      truncatedBytes: second.truncatedBytes,
    },
  };
}

/**
 * 机型/固件/板型/时长/是否解锁。
 *
 * ⚠️ `vehicle`/`vehicleKind` 必须尽量给出**具体机型**（Copter=rad/s、Plane=deg/s，规则靠它换算速率环单位），
 * `ArduPilot`/`unknown` 只是"没解析到横幅"的兜底，绝不能覆盖已解析出来的横幅。
 */
function buildMeta(state: WalkState, sawRecords: boolean): LogMeta {
  const bannerInfo = state.banner ? parseArduPilotBanner(state.banner) : null;
  const ver = state.ver;
  const durationSec = state.maxUs > state.minUs ? (state.maxUs - state.minUs) / 1e6 : 0;
  if (bannerInfo) {
    return {
      platform: "ardupilot",
      vehicleKind: bannerInfo.kind,
      vehicle: bannerInfo.vehicle,
      firmwareVersion: bannerInfo.version,
      firmwareString: state.banner ?? "",
      versionNumeric: bannerInfo.numeric,
      board: extractBoard(state.messages),
      durationSec,
      armed: state.armed,
    };
  }
  return {
    platform: "ardupilot",
    vehicleKind: "unknown",
    vehicle: sawRecords ? "ArduPilot" : "unknown",
    firmwareVersion: ver ? `${ver.major}.${ver.minor}.${ver.patch}` : "unknown",
    firmwareString: ver?.firmwareString ?? "",
    versionNumeric: ver ? encodeVersion(ver.major, ver.minor, ver.patch) : 0,
    board: extractBoard(state.messages),
    durationSec,
    armed: state.armed,
  };
}
