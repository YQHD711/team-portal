/**
 * 布局元素的复制 / 粘贴 —— **纯逻辑**（不碰 DOM、不碰 React），便于把守卫与偏移规则测透。
 *
 * 设计要点（task-37 B）：
 *  1. `shouldIgnoreClipboard`：焦点在 `input` / `textarea` / `contenteditable`（含 `isContentEditable`）
 *     时**必须**跳过元素快捷键 —— 否则用户在输入框里复制物料名称会被劫持。
 *     Ctrl+C / Ctrl+V / Ctrl+Z **共用**这一个守卫（Z 是同一类错误）。
 *  2. 剪贴板**从第一天就接收 `string[]`**（id 数组），现在通常只传一个：
 *     以后加多选（Shift+点击/框选）只是接线，不用回头改这里和测试。
 *  3. 偏移随**同一份剪贴板内容**的连续粘贴递增（24/18 × (nth+1)），
 *     **重新复制会归零**（`copyBuffer` 返回 `pasteIndex: 0`）——
 *     否则"复制→粘贴→再复制→粘贴"会越偏越远。
 *  4. 按原类型粘贴：`cloneForPaste` 保留 `type`，**禁止跨类型**。
 */

import type { ItemElement, PosElement, RoomLayout } from "./layoutTypes";
import { uid } from "./layoutTypes";


/** 一次粘贴的位移（cm）：与画布单位一致 */
export const PASTE_STEP_X = 24;
export const PASTE_STEP_Y = 18;

/** 焦点在文本输入类元素上时，元素级快捷键必须让路 */
export function shouldIgnoreClipboard(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.hasAttribute?.("contenteditable")) {
    const v = el.getAttribute("contenteditable");
    if (v === "" || v === "true" || v === "plaintext-only") return true;
  }
  // jsdom 不实现 isContentEditable，做属性兜底
  const withEditable = el as Element & { isContentEditable?: boolean };
  if (withEditable.isContentEditable === true) return true;
  return false;
}

type Copyable = PosElement | ItemElement;

/** 剪贴板内容：id 数组的拷贝 + 同类型元素快照 + 本会话已粘贴次数 */
export interface ClipboardBuffer {
  /** 复制会**重置**为 0；连续粘贴时递增 */
  readonly pasteIndex: number;
  readonly elements: readonly Copyable[];
}

/**
 * 复制：接收 **id 数组**（多选将来直接传更长的数组）。
 * 传入的 id 里找不到的会被忽略；一个都没找到返回 null（不产生空剪贴板）。
 */
export function copyBuffer(ids: readonly string[], elements: readonly Copyable[]): ClipboardBuffer | null {
  const picked = elements.filter(el => ids.includes(el.id));
  if (picked.length === 0) return null;
  return { pasteIndex: 0, elements: picked };
}

/**
 * 从剪贴板生成一份新元素：**新 id**、按原类型、同旋转/同尺寸/同格位与库位，
 * 位置偏移 = 步长 × (pasteIndex + 1)。返回新元素与**递增后**的剪贴板。
 */
export function pasteFromBuffer(buf: ClipboardBuffer): { elements: Copyable[]; next: ClipboardBuffer } {
  const nth = buf.pasteIndex + 1;
  const elements = buf.elements.map(el => cloneForPaste(el, nth));
  return { elements, next: { pasteIndex: nth, elements: buf.elements } };
}

/** 单个元素按第 nth 次粘贴克隆（nth 从 1 起） */
export function cloneForPaste<T extends Copyable>(el: T, nth: number): T {
  const dx = PASTE_STEP_X * nth;
  const dy = PASTE_STEP_Y * nth;
  return { ...el, id: `${el.id.split(":")[0]}-${uid()}`, x: (el.x ?? 0) + dx, y: (el.y ?? 0) + dy };
}

/** 两个元素能否互相粘贴：类型必须一致（禁止跨类型粘贴） */
export function samePasteType(a: Copyable, b: Copyable): boolean {
  const ta = "type" in a ? a.type : null;
  const tb = "type" in b ? b.type : null;
  return ta === tb;
}

/**
 * 把剪贴板内容整体贴进布局：**一次调用产出一个新的 layout** ——
 * 调用方只 `commit` 一次，因此"粘贴 N 个元素"在撤销栈里就是**一条**记录（C 的批量生成同理）。
 */
export function applyPaste(
  layout: RoomLayout,
  buf: ClipboardBuffer,
): { layout: RoomLayout; next: ClipboardBuffer; pasted: Copyable[] } {
  const { elements, next } = pasteFromBuffer(buf);
  let out = layout;
  for (const el of elements) out = appendElement(out, el);   // 粘贴是**新增**（withElement 只替换同 id）
  return { layout: out, next, pasted: elements };
}

/** 按元素归属追加到对应集合（items / walls / doors / windows），与 RoomPlanner.addElement 的归类一致 */
function appendElement(layout: RoomLayout, el: Copyable): RoomLayout {
  if ("type" in el) return { ...layout, items: [...layout.items, el] };
  if (el.id.startsWith("wall-")) return { ...layout, walls: [...layout.walls, el] };
  if (el.id.startsWith("door-")) return { ...layout, doors: [...layout.doors, el] };
  return { ...layout, windows: [...layout.windows, el] };
}