/**
 * 库位选项：从房间平面图元素派生「元素 → 层 → 位」可选项，让库存表单不再手填编码。
 * 编码格式与画布格位完全一致（四段 室-元素-层-位），因此物料必然能挂到平面图上。
 */
import type { ItemElement, ItemType } from "./layoutTypes";
import { ELEMENT_DEFS, cellSummary, colsOf, rowsOf, usesCells } from "./layoutTypes";
import { parseLayout } from "./layoutCodec";
import { pad2 } from "./elementGeometry";

export interface LocationOption {
  /** 元素编码（库位前缀），如 1030-A */
  locCode: string;
  name: string;
  type: ItemType;
  rows: number;
  cols: number;
  /** false = 1×1 整体挂载，编码到元素为止 */
  usesCells: boolean;
  /** 下拉显示文案：A货架（1030-A）· 4 层 × 8 位 */
  label: string;
}

/** 房间记录（/api/storage/layouts 返回项的最小字段集） */
export interface RoomLayoutOption {
  roomCode: string;
  roomName?: string;
  layoutJson?: string | null;
}

function toOption(el: ItemElement): LocationOption | null {
  const locCode = (el.locCode || "").trim();
  if (!locCode) return null;   // 没有编码的元素挂不上物料，不作为选项
  const splits = usesCells(el);
  return {
    locCode,
    name: el.name,
    type: el.type,
    rows: splits ? rowsOf(el) : 1,
    cols: splits ? colsOf(el) : 1,
    usesCells: splits,
    label: `${el.name}（${locCode}）· ${ELEMENT_DEFS[el.type].label} / ${cellSummary(el)}`,
  };
}

/** 某房间的库位选项（按编码排序；无平面图或元素无编码时返回空） */
export function locationOptionsOf(layoutJson?: string | null): LocationOption[] {
  const layout = parseLayout(layoutJson);
  if (!layout) return [];
  return layout.items
    .map(toOption)
    .filter((o): o is LocationOption => o !== null)
    .sort((a, b) => a.locCode.localeCompare(b.locCode, "zh-CN", { numeric: true }));
}

/** 元素 + 层位 → 编码；整体挂载元素忽略层位；越界/缺参数返回空串 */
export function composeLocCode(option: LocationOption | null, row: string, col: string): string {
  if (!option) return "";
  if (!option.usesCells) return option.locCode;
  const r = parseInt(row, 10);
  const c = parseInt(col, 10);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return "";
  if (r < 1 || r > option.rows || c < 1 || c > option.cols) return "";
  return `${option.locCode}-${r}-${pad2(c)}`;
}

export interface MatchedLocation {
  option: LocationOption;
  row: string;
  col: string;
}

/**
 * 已有编码 → 元素与层位。匹配不上返回 null：调用方必须回退「手动输入」，
 * 绝不能把无法识别的历史编码静默改写成别的值。
 */
export function matchLocCode(options: LocationOption[], code?: string | null): MatchedLocation | null {
  const raw = (code || "").trim();
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length >= 4) {
    const elementCode = `${parts[0]}-${parts[1]}`;
    const option = options.find(o => o.locCode.toUpperCase() === elementCode.toUpperCase());
    if (!option || !option.usesCells) return null;
    const r = parseInt(parts[2], 10);
    const c = parseInt(parts[3], 10);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
    if (r < 1 || r > option.rows || c < 1 || c > option.cols) return null;
    return { option, row: String(r), col: String(c) };
  }
  const option = options.find(o => o.locCode.toUpperCase() === raw.toUpperCase());
  return option ? { option, row: "1", col: "1" } : null;
}

/** 层/位的可选项（1..n） */
export function axisOptions(n: number): string[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => String(i + 1));
}
