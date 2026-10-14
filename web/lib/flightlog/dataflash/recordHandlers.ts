/**
 * 单条记录 → 内部状态的分发（FMT 布局 / FMTU 单位 / 参数 / 事件 / Series）。
 *
 * 这里只做**分发**，具体解码算法在各自模块：布局见 fmtLayout.ts，读值与倍率见 layout.ts，
 * 列式累积见 series.ts，事件见 events.ts。任何字段缺失都只记 warning，不抛异常。
 */

import { FMT_MSG_TYPE, readField, readTimeUs, type FormatLayout } from "./layout";
import { applyFmtu, buildLayout, parseFormatHeader, roundMultiplier } from "./fmtLayout";
import { META_ONLY, isWhitelisted } from "./whitelist";
import type { SeriesAccumulator } from "./series";
import type { EventCollector } from "./events";

/** 解析过程中的可变状态（一次解析一个实例）。 */
export interface WalkState {
  layouts: Map<number, FormatLayout>;
  byName: Map<string, FormatLayout>;
  unitLabels: Map<number, string>;
  multValues: Map<number, number>;
  counts: Map<string, number>;
  params: Record<string, number>;
  messages: string[];
  banner: string | null;
  ver: { major: number; minor: number; patch: number; firmwareString: string } | null;
  t0us: number | null;
  minUs: number;
  maxUs: number;
  armed: boolean;
}

/** 处理一条已定位的记录。`view` 是 payload 视图（3 字节头之后）。 */
export function applyRecord(
  type: number,
  view: DataView,
  state: WalkState,
  seriesAcc: SeriesAccumulator,
  events: EventCollector,
  warn: (message: string) => void,
): void {
  const layout = state.layouts.get(type);
  if (!layout) return;
  const name = layout.name;

  if (type === FMT_MSG_TYPE) {
    registerFormat(view, state, warn);
    return;
  }
  if (name === "UNIT") {
    const id = numberAt(view, layout, 1);
    const label = readField(view, layout.offsets[2], layout.specs[2]);
    if (id !== null && typeof label === "string") state.unitLabels.set(id, label);
    return;
  }
  if (name === "MULT") {
    const id = numberAt(view, layout, 1);
    const mult = numberAt(view, layout, 2);
    // 7 位有效数字取整是 pymavlink 的既定事实（float32 转 double 的脏值否则匹配不到单位前缀）
    if (id !== null && mult !== null) state.multValues.set(id, roundMultiplier(mult));
    return;
  }
  if (name === "FMTU") {
    const target = numberAt(view, layout, 1);
    const unitIds = String(readField(view, layout.offsets[2], layout.specs[2]));
    const multIds = String(readField(view, layout.offsets[3], layout.specs[3]));
    const targetLayout = target === null ? undefined : state.layouts.get(target);
    if (targetLayout) applyFmtu(targetLayout, unitIds, multIds, state.unitLabels, state.multValues);
    return;
  }

  const timeUs = readTimeUs(view, layout);
  if (timeUs !== null) {
    if (state.t0us === null) state.t0us = timeUs;
    if (timeUs < state.minUs) state.minUs = timeUs;
    if (timeUs > state.maxUs) state.maxUs = timeUs;
  }
  const tSec = timeUs === null ? 0 : (timeUs - (state.t0us ?? timeUs)) / 1e6;

  // 白名单之外的消息：只统计条数（messageCounts 在 walk 里做），不解码
  if (!isWhitelisted(name)) return;

  if (name === "PARM") {
    const key = String(readField(view, layout.offsets[1], layout.specs[1])).trim();
    const value = numberAt(view, layout, 2);
    if (key.length > 0 && value !== null) state.params[key] = value;
    return;
  }
  if (name === "MSG") {
    const text = String(readField(view, layout.offsets[1], layout.specs[1]));
    if (state.messages.length < 32) state.messages.push(text);
    if (state.banner === null && text.startsWith("Ardu")) state.banner = text;
    events.addMessage(tSec, text);
    return;
  }
  if (name === "VER") {
    if (state.ver === null) {
      state.ver = {
        major: numberAt(view, layout, columnIndex(layout, "Maj")) ?? 0,
        minor: numberAt(view, layout, columnIndex(layout, "Min")) ?? 0,
        patch: numberAt(view, layout, columnIndex(layout, "Pat")) ?? 0,
        firmwareString: stringAt(view, layout, columnIndex(layout, "FWS")),
      };
    }
    seriesAcc.add(type, view);
    return;
  }
  if (name === "ARM") {
    const armState = numberAt(view, layout, 1);
    if (armState !== null) {
      if (armState !== 0) state.armed = true;
      events.addArm(tSec, armState);
    }
    seriesAcc.add(type, view);
    return;
  }
  if (name === "MODE") {
    const modeNum = numberAt(view, layout, 1);
    const reason = numberAt(view, layout, 3);
    if (modeNum !== null) events.addMode(tSec, modeNum, reason ?? 0);
    seriesAcc.add(type, view);
    return;
  }
  if (name === "EV") {
    const id = numberAt(view, layout, 1);
    if (id !== null) {
      events.addEv(tSec, id);
      if (id === 10 || id === 15) state.armed = true;
    }
    seriesAcc.add(type, view);
    return;
  }

  // 白名单里的数据消息：直接进列式 Series（metadata-only 的消息在上面已经 return）
  if (META_ONLY.has(name)) return;
  seriesAcc.add(type, view);
}

/** 注册一条 FMT 声明的布局；重复声明时保留已学到的单位/实例信息。 */
function registerFormat(view: DataView, state: WalkState, warn: (message: string) => void): void {
  const header = parseFormatHeader(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  if (!header) {
    warn("FMT 记录内容无法解析，已跳过");
    return;
  }
  const built = buildLayout(header);
  if (!built) {
    warn(`FMT 声明无法解析（name=${header.name} format=${header.format} len=${header.length}），该消息将被跳过`);
    return;
  }
  const existing = state.layouts.get(header.type);
  if (existing) {
    built.units = [...existing.units];
    built.instanceField = existing.instanceField;
    built.instanceOffset = existing.instanceOffset;
    built.instanceSize = existing.instanceSize;
  }
  state.layouts.set(header.type, built);
  state.byName.set(built.name, built);
}

function columnIndex(layout: FormatLayout, name: string): number {
  return layout.columns.indexOf(name);
}

function numberAt(view: DataView, layout: FormatLayout, index: number): number | null {
  if (index < 0 || index >= layout.specs.length) return null;
  const value = readField(view, layout.offsets[index], layout.specs[index]);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringAt(view: DataView, layout: FormatLayout, index: number): string {
  if (index < 0) return "";
  const value = readField(view, layout.offsets[index], layout.specs[index]);
  return typeof value === "string" ? value : "";
}
