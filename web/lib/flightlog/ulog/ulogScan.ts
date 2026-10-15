/**
 * ULog 数据段扫描：把「一条消息 → 状态更新」的逻辑从 parseUlog.ts 拆出来
 * （原文件超过 200 行上限）。
 *
 * 这里持有全部扫描期状态：格式表、订阅表、参数、信息、日志字符串、列式累积器，
 * 以及各类"跳过/未知"计数——**任何跳过都通过 `warn` 上报，不允许静默**。
 */

import type { LogDocument, LogEvent } from "../types/log";
import { UlogReader } from "./ulogReader";
import { flattenFormat, parseFormatString, type FlatField, type UlogMessageFormat } from "./ulogFormat";
import { parseAddLogged, parseDropout, parseFlagBits, parseInfoMessage, parseLogging } from "./ulogMessages";
import { UlogSeriesBuilder } from "./ulogSeries";
import { armEventsFrom, buildUlogMeta } from "./ulogMeta";
import { emitCoverageWarnings } from "./ulogAssemble";

interface LoggingEntry {
  tUs: number;
  event: LogEvent;
}

export class UlogScanner {
  private readonly formats = new Map<string, UlogMessageFormat>();
  private readonly flatCache = new Map<string, FlatField[]>();
  private readonly subscriptions = new Map<number, { name: string; multiId: number }>();
  private readonly info = new Map<string, number | string | Uint8Array>();
  private readonly params: Record<string, number> = {};
  private readonly logging: LoggingEntry[] = [];
  private readonly unknownTypes = new Map<string, number>();
  private readonly droppedParams = new Set<string>();
  private readonly builder = new UlogSeriesBuilder();
  private headerStartUs = 0;
  dropouts = 0;
  syncCount = 0;
  records = 0;

  constructor(private readonly warn: (message: string) => void) {}

  /** 第一帧数据时间戳（µs）；无数据时为 0 */
  get t0us(): number {
    return this.builder.t0us;
  }
  /** 自描述格式表（黄金对照与覆盖度展示用） */
  get formatsTable(): ReadonlyMap<string, UlogMessageFormat> { return this.formats; }
  /** (topic, multi_id) → 记录数（黄金对照用；messageCounts 是按名汇总） */
  get datasetCounts(): readonly { name: string; multiId: number; records: number }[] { return this.builder.datasetCounts; }
  /** 信息键值（ver_sw_release / ver_hw / sys_name …） */
  get infoEntries(): ReadonlyMap<string, number | string | Uint8Array> { return this.info; }

  get zeroTimestamps(): number { return this.builder.zeroTimestamps; }
  get lastUs(): number {
    return this.builder.lastUs;
  }

  setHeaderStartUs(value: number): void {
    this.headerStartUs = value;
  }

  /**
   * 处理一条消息。前提：`payloadEnd` 已确认在文件范围内。
   * 抛错只用于"文件本身不可安全解析"（未知不兼容标志）；payload 越界由调用方按坏记录处理。
   */
  handle(
    msgType: string,
    bytes: Uint8Array,
    view: DataView,
    payloadStart: number,
    payloadEnd: number,
    offset: number,
  ): void {
    const payload = bytes.subarray(payloadStart, payloadEnd);
    const reader = new UlogReader(view, payloadStart);
    switch (msgType) {
      case "F": {
        const format = parseFormatString(payload);
        this.formats.set(format.name, format);
        return;
      }
      case "A": {
        const sub = parseAddLogged(payload);
        this.subscriptions.set(sub.msgId, { name: sub.name, multiId: sub.multiId });
        return;
      }
      case "D": {
        const msgId = view.getUint16(payloadStart, true);
        reader.offset = payloadStart + 2;
        const sub = this.subscriptions.get(msgId);
        if (!sub) {
          this.warn(`数据消息引用了未订阅的 msg_id=${msgId}（offset ${offset}），该记录无法解码`);
          return;
        }
        let flat = this.flatCache.get(sub.name);
        if (!flat) {
          const format = this.formats.get(sub.name);
          if (!format) {
            this.warn(`订阅 ${sub.name} 没有对应的 F 格式定义，无法解码（offset ${offset}）`);
            return;
          }
          flat = flattenFormat(format, this.formats);
          this.flatCache.set(sub.name, flat);
        }
        this.records += 1;
        this.builder.addRecord(sub.name, sub.multiId, flat, reader, payloadEnd);
        return;
      }
      case "I":
      case "M": {
        const message = parseInfoMessage(payload, msgType === "M");
        if (message.key.length > 0) this.info.set(message.key, message.value);
        return;
      }
      case "P": {
        const message = parseInfoMessage(payload);
        if (typeof message.value === "number") this.params[message.key] = message.value;
        else this.droppedParams.add(`${message.key}(${message.type})`);
        return;
      }
      case "Q":
        return; // 参数默认值不是飞控实际生效值，按契约不并入 params
      case "L":
      case "C": {
        const message = parseLogging(payload, msgType === "C");
        this.logging.push({
          tUs: message.timestampUs,
          event: {
            tSec: 0,
            kind: message.levelLabel === "ERROR" || message.levelLabel === "CRITICAL" ? "error" : "info",
            code: message.level,
            label: `[${message.levelLabel}] ${message.message}`,
          },
        });
        return;
      }
      case "O":
        this.dropouts += 1;
        parseDropout(payload);
        return;
      case "S":
        this.syncCount += 1;
        return;
      case "B": {
        const flags = parseFlagBits(payload);
        const bad = flags.incompat.some((v, i) => (i === 0 ? (v & ~1) !== 0 : v !== 0));
        if (bad) {
          throw new Error(`ULog 设置了未知的不兼容标志（compat=${flags.compat.join(",")} incompat=${flags.incompat.join(",")}）：无法安全解析，拒绝给出可能错误的诊断`);
        }
        return;
      }
      case "R":
        this.warn("遇到已废弃的 `R`（移除订阅）消息，已跳过（不影响数据段解码）");
        return;
      default: {
        const key = msgType.charCodeAt(0) < 32 ? `0x${msgType.charCodeAt(0).toString(16)}` : msgType;
        this.unknownTypes.set(key, (this.unknownTypes.get(key) ?? 0) + 1);
      }
    }
  }

  /** 扫描结束：装配 LogDocument（meta / series / events / params / counts / warnings） */
  finish(): LogDocument {
    const built = this.builder.build();
    const t0us = this.builder.t0us || this.headerStartUs;
    const logged: LogEvent[] = this.logging.map((entry) => ({
      ...entry.event,
      tSec: (entry.tUs - t0us) / 1e6,
    }));
    const armed = built.series["actuator_armed:0"];
    const events = [
      ...armEventsFrom(armed?.timeSec ?? null, armed?.fields.armed ?? null),
      ...logged,
    ].sort((a, b) => a.tSec - b.tSec);

    const topics = [...built.counts.keys()];
    emitCoverageWarnings(
      { built, unknownTypes: this.unknownTypes, droppedParams: this.droppedParams, dropouts: this.dropouts },
      this.warn,
    );

    return {
      meta: buildUlogMeta({
        info: this.info,
        topics,
        t0us,
        lastUs: this.builder.lastUs,
        events,
      }),
      series: built.series,
      events,
      params: this.params,
      messageCounts: Object.fromEntries(built.counts),
      decodedFields: Object.fromEntries(built.decodedFields),
      warnings: [],
    };
  }
}
