/**
 * 单条记录 → 内部状态的分发（FMT 布局 / FMTU 单位 / 参数 / 事件 / Series）。
 *
 * task-24 起**没有白名单**：FMT 声明过的类型全部解码。本文件只做**分发**，
 * 具体算法在各自模块（布局 fmtLayout.ts、读值 layout.ts、列式累积 series.ts、事件 events.ts）。
 *
 * 零静默跳过：`decodedFields` 对每一条被定位到的记录都登记一行（字段清单来自 FMT 布局），
 * 因此 `decodedFields` 的键数 == `messageCounts` 的键数；解不出来的只能是不存在的类型
 * （被 walk 计成未知类型并写进 warnings）。
 */

import { FMT_MSG_TYPE, numberField, readTimeUs, stringField, type FormatLayout } from "./layout";
import { applyFmtu, buildLayoutDetailed, parseFormatHeader, roundMultiplier } from "./fmtLayout";
import { isDeclaration } from "./messageKinds";
import type { SeriesAccumulator } from "./series";
import type { EventCollector } from "./events";

/** 解析过程中的可变状态（一次解析一个实例）。 */
export interface WalkState {
  layouts: Map<number, FormatLayout>;
  byName: Map<string, FormatLayout>;
  unitLabels: Map<number, string>;
  multValues: Map<number, number>;
  counts: Map<string, number>;
  /** 消息名 → 已解码字段清单（每条记录都登记，保证"零静默跳过"可被计数验证）。 */
  decodedFields: Map<string, string[]>;
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
  state.decodedFields.set(name, [...layout.columns]);

  if (type === FMT_MSG_TYPE) {
    registerFormat(view, state, warn);
    return;
  }
  if (name === "UNIT") {
    const id = numberField(view, layout, ["Id"], 1);
    const label = stringField(view, layout, ["Label"], 2);
    if (id !== null && label.length > 0) state.unitLabels.set(id, label);
    return;
  }
  if (name === "MULT") {
    const id = numberField(view, layout, ["Id"], 1);
    const mult = numberField(view, layout, ["Mult"], 2);
    // 7 位有效数字取整是 pymavlink 的既定事实（float32 转 double 的脏值否则匹配不到单位前缀）
    if (id !== null && mult !== null) state.multValues.set(id, roundMultiplier(mult));
    return;
  }
  if (name === "FMTU") {
    const target = numberField(view, layout, ["FmtType"], 1);
    const unitIds = stringField(view, layout, ["UnitIds"], 2);
    const multIds = stringField(view, layout, ["MultIds"], 3);
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

  if (name === "PARM") {
    const key = stringField(view, layout, ["Name"], 1).trim();
    const value = numberField(view, layout, ["Value"], 2);
    if (key.length > 0 && value !== null) state.params[key] = value;
  } else if (name === "MSG") {
    // ⚠️ 列名定位：4.8.0-dev 的 MSG 是 [TimeUS, ID, Seq, Message]
    const text = stringField(view, layout, ["Message"], 1);
    if (state.messages.length < 32) state.messages.push(text);
    if (state.banner === null && text.startsWith("Ardu")) state.banner = text;
    events.addMessage(tSec, text);
  } else if (name === "VER") {
    if (state.ver === null) {
      state.ver = {
        major: numberField(view, layout, ["Maj"], 3) ?? 0,
        minor: numberField(view, layout, ["Min"], 4) ?? 0,
        patch: numberField(view, layout, ["Pat"], 5) ?? 0,
        firmwareString: stringField(view, layout, ["FWS"], 8),
      };
    }
  } else if (name === "ARM") {
    const armState = numberField(view, layout, ["ArmState"], 1);
    if (armState !== null) {
      if (armState !== 0) state.armed = true;
      events.addArm(tSec, armState);
    }
  } else if (name === "MODE") {
    // 4.6/4.7 是 [TimeUS, Mode, ModeNum, Rsn]；更老的是 [TimeUS, Mode] 等
    const modeNum = numberField(view, layout, ["ModeNum", "Mode"], 1);
    const reason = numberField(view, layout, ["Rsn"], 3);
    if (modeNum !== null) events.addMode(tSec, modeNum, reason ?? 0);
  } else if (name === "EV") {
    const id = numberField(view, layout, ["Id"], 1);
    if (id !== null) {
      events.addEv(tSec, id);
      if (id === 10 || id === 15) state.armed = true;
    }
  }

  // 声明类之外的消息都进列式 Series（PARM/MSG 也进，只是它们的数值列很少）
  seriesAcc.add(type, view);
}

/** 注册一条 FMT 声明的布局；重复声明时保留已学到的单位/实例信息。 */
function registerFormat(view: DataView, state: WalkState, warn: (message: string) => void): void {
  const header = parseFormatHeader(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  if (!header) {
    warn("FMT 记录内容无法解析（负载不足 86 字节），已跳过");
    return;
  }
  const { layout: built, error } = buildLayoutDetailed(header);
  if (!built) {
    warn(`FMT 声明无法解析：name=${header.name} type=0x${header.type.toString(16)} ${error} —— 该类型的记录会被跳过`);
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
