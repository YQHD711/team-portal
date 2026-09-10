"use client";

/**
 * 库位编码选择器：室 → 元素（取自该房间平面图）→ 层 → 位，编码由系统生成。
 * - 房间没有平面图元素时给出提示，并允许「手动输入编码」（历史编码 / 未配置平面图的房间）。
 * - 已有编码匹配不上任何元素时自动进入手动模式且**原样保留**，避免静默改写。
 */
import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  axisOptions, composeLocCode, locationOptionsOf, matchLocCode,
  type RoomLayoutOption,
} from "./locationOptions";

interface LocationPickerProps {
  rooms: RoomLayoutOption[];
  /** 当前编码（受控） */
  value: string;
  onChange: (code: string) => void;
  /** 房间下拉为空时的兜底房间号（后端布局接口不可用时） */
  fallbackRooms?: string[];
}

const selectCls = "w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

interface InitialState {
  room: string;
  elementCode: string;
  row: string;
  col: string;
  manual: boolean;
}

/** 挂载时按已有编码回填：匹配得上就定位到元素/层/位，匹配不上进手动模式并保留原值 */
function resolveInitial(rooms: RoomLayoutOption[], value: string): InitialState {
  for (const room of rooms) {
    const hit = matchLocCode(locationOptionsOf(room.layoutJson), value);
    if (hit) return { room: room.roomCode, elementCode: hit.option.locCode, row: hit.row, col: hit.col, manual: false };
  }
  return { room: value.split("-")[0] ?? "", elementCode: "", row: "1", col: "1", manual: Boolean(value) };
}

export function LocationPicker({ rooms, value, onChange, fallbackRooms = [] }: LocationPickerProps) {
  const roomList = useMemo(
    () => (rooms.length > 0
      ? rooms.map(r => ({ roomCode: r.roomCode, roomName: r.roomName, layoutJson: r.layoutJson }))
      : fallbackRooms.map(code => ({ roomCode: code, roomName: undefined, layoutJson: null }))),
    [rooms, fallbackRooms]
  );

  const [initial] = useState(() => resolveInitial(roomList, value));
  const [room, setRoom] = useState(initial.room);
  const [elementCode, setElementCode] = useState(initial.elementCode);
  const [row, setRow] = useState(initial.row);
  const [col, setCol] = useState(initial.col);
  const [manual, setManual] = useState(initial.manual);
  const [manualCode, setManualCode] = useState(value);

  const options = useMemo(() => {
    const found = roomList.find(r => r.roomCode === room);
    return locationOptionsOf(found?.layoutJson);
  }, [roomList, room]);
  const option = options.find(o => o.locCode === elementCode) ?? null;
  const code = manual ? manualCode : composeLocCode(option, row, col);

  const emit = (next: string) => onChange(next);

  const pickRoom = (nextRoom: string) => {
    setRoom(nextRoom);
    setElementCode("");
    setRow("1");
    setCol("1");
    emit("");
  };
  const pickElement = (nextCode: string) => {
    setElementCode(nextCode);
    setRow("1");
    setCol("1");
    const next = options.find(o => o.locCode === nextCode) ?? null;
    emit(composeLocCode(next, "1", "1"));
  };
  const pickRow = (next: string) => { setRow(next); emit(composeLocCode(option, next, col)); };
  const pickCol = (next: string) => { setCol(next); emit(composeLocCode(option, row, next)); };
  const toggleManual = (on: boolean) => {
    setManual(on);
    if (on) { setManualCode(value); emit(value); }
    else { setManualCode(""); emit(composeLocCode(option, row, col)); }
  };

  const roomLabel = (r: { roomCode: string; roomName?: string }) => (r.roomName ? `${r.roomCode} ${r.roomName}` : r.roomCode);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <label className="block">
          <span className="sr-only">房间</span>
          <select aria-label="房间" value={room} onChange={e => pickRoom(e.target.value)} className={selectCls} disabled={manual}>
            <option value="">室</option>
            {roomList.map(r => <option key={r.roomCode} value={r.roomCode}>{roomLabel(r)}</option>)}
          </select>
        </label>

        {manual ? (
          <label className="col-span-1 block sm:col-span-3">
            <span className="sr-only">手动输入库位编码</span>
            <input aria-label="手动输入库位编码" value={manualCode} placeholder="如 1030-01-3-05"
              onChange={e => { setManualCode(e.target.value); emit(e.target.value); }}
              className={selectCls} />
          </label>
        ) : (
          <>
            <label className="col-span-2 block sm:col-span-1">
              <span className="sr-only">库位元素</span>
              <select aria-label="库位元素" value={elementCode}
                onChange={e => pickElement(e.target.value)} className={selectCls} disabled={!room}>
                <option value="">{room ? "选择货架/柜子…" : "请先选择房间"}</option>
                {options.map(o => <option key={o.locCode} value={o.locCode}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">层</span>
              <select aria-label="层" value={row} onChange={e => pickRow(e.target.value)}
                className={selectCls} disabled={!option?.usesCells}>
                {axisOptions(option?.rows ?? 1).map(v => <option key={v} value={v}>{v} 层</option>)}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">位</span>
              <select aria-label="位" value={col} onChange={e => pickCol(e.target.value)}
                className={selectCls} disabled={!option?.usesCells}>
                {axisOptions(option?.cols ?? 1).map(v => <option key={v} value={v}>{v} 位</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-faint">生成编码：</span>
        <span className="font-mono text-muted">{code || "—"}</span>
        {room && !manual && options.length === 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />该房间还没有平面图元素，请先到「物料布局」添加
          </span>
        )}
        <label className="ml-auto inline-flex items-center gap-1 text-faint">
          <input type="checkbox" checked={manual} onChange={e => toggleManual(e.target.checked)} className="h-3.5 w-3.5" />
          手动输入编码
        </label>
      </div>
    </div>
  );
}
