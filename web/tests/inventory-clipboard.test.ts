/**
 * 复制/粘贴纯逻辑（task-37 B）—— 重点在**负向**与边界：
 *  - 输入框里的 Ctrl+C/V/Z 必须让路（守卫）
 *  - 偏移在同一份剪贴板内递增、**重新复制后归零**
 *  - 新 id、原类型（禁止跨类型）、同旋转/同尺寸/同格位
 *  - 剪贴板签名接收 **id 数组**（多选将来只是接线）
 */

import { describe, expect, it } from "vitest";
import type { RoomLayout } from "@/components/inventory/layoutTypes";
import { historyReducer } from "@/components/inventory/usePlannerHistory";
import type { ItemElement } from "@/components/inventory/layoutTypes";
import {
  PASTE_STEP_X, PASTE_STEP_Y, applyPaste, cloneForPaste, copyBuffer, pasteFromBuffer, samePasteType, shouldIgnoreClipboard,
} from "@/components/inventory/layoutClipboard";

const shelf = (id: string, x = 100, y = 100): ItemElement => ({
  id, type: "shelf", name: "A货架", x, y, w: 300, h: 120, rotation: 0, locCode: "6011-A", rows: 4, cols: 8,
});
const peg = (id: string): ItemElement => ({
  id, type: "pegboard", name: "洞洞板", x: 10, y: 20, w: 120, h: 80, rotation: 90, locCode: "6011-P", rows: 6, cols: 6,
});

describe("shouldIgnoreClipboard：文本输入不得被劫持", () => {
  it("input / textarea / select → 忽略", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.createElement(tag);
      expect(shouldIgnoreClipboard(el)).toBe(true);
    }
  });

  it("contenteditable（空串 / true / plaintext-only）→ 忽略", () => {
    for (const v of ["", "true", "plaintext-only"]) {
      const div = document.createElement("div");
      div.setAttribute("contenteditable", v);
      expect(shouldIgnoreClipboard(div)).toBe(true);
    }
  });

  it("contenteditable=\"false\" → 不忽略", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "false");
    expect(shouldIgnoreClipboard(div)).toBe(false);
  });

  it("isContentEditable 为 true（浏览器行为 / jsdom 兜底）→ 忽略", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true, configurable: true });
    expect(shouldIgnoreClipboard(div)).toBe(true);
  });

  it("body / button / null → 不忽略（快捷键正常生效）", () => {
    expect(shouldIgnoreClipboard(document.body)).toBe(false);
    expect(shouldIgnoreClipboard(document.createElement("button"))).toBe(false);
    expect(shouldIgnoreClipboard(null)).toBe(false);
  });
});

describe("copyBuffer：接收 id 数组（多选只是将来传更长数组）", () => {
  it("单个 id", () => {
    const buf = copyBuffer(["s1"], [shelf("s1")]);
    expect(buf?.elements.map(e => e.id)).toEqual(["s1"]);
    expect(buf?.pasteIndex).toBe(0);
  });

  it("多个 id（多选形状）按元素顺序返回", () => {
    const buf = copyBuffer(["s2", "s1"], [shelf("s1"), shelf("s2")]);
    expect(buf?.elements.map(e => e.id)).toEqual(["s1", "s2"]);
  });

  it("找不到任何元素 → null（不留空剪贴板）", () => {
    expect(copyBuffer(["nope"], [shelf("s1")])).toBeNull();
    expect(copyBuffer([], [shelf("s1")])).toBeNull();
  });
});

describe("pasteFromBuffer：新 id / 递增偏移 / 原类型", () => {
  it("第一次粘贴偏移 1 步，第二次 2 步（同一份剪贴板递增）", () => {
    const buf = copyBuffer(["s1"], [shelf("s1", 100, 100)])!;
    const first = pasteFromBuffer(buf);
    expect(first.elements[0].x).toBe(100 + PASTE_STEP_X);
    expect(first.elements[0].y).toBe(100 + PASTE_STEP_Y);

    const second = pasteFromBuffer(first.next);
    expect(second.elements[0].x).toBe(100 + PASTE_STEP_X * 2);
    expect(second.elements[0].y).toBe(100 + PASTE_STEP_Y * 2);
  });

  it("**重新复制后偏移归零**（复制→粘贴→再复制→粘贴 不会越偏越远）", () => {
    const buf = copyBuffer(["s1"], [shelf("s1", 0, 0)])!;
    const pasted = pasteFromBuffer(buf).next;          // pasteIndex → 1
    expect(pasted.pasteIndex).toBe(1);

    const fresh = copyBuffer(["s2"], [shelf("s2", 0, 0)])!;
    expect(fresh.pasteIndex).toBe(0);                  // 新会话归零
    expect(pasteFromBuffer(fresh).elements[0].x).toBe(PASTE_STEP_X);
  });

  it("新 id、同旋转/同尺寸/同格位/同库位，type 原样（禁止跨类型）", () => {
    const src = peg("p1");
    const out = pasteFromBuffer(copyBuffer(["p1"], [src])!).elements[0] as ItemElement;

    expect(out.id).not.toBe(src.id);
    expect(out.type).toBe("pegboard");                  // 不会变成别的东西
    expect(out.rotation).toBe(src.rotation);
    expect(out.w).toBe(src.w);
    expect(out.h).toBe(src.h);
    expect(out.rows).toBe(src.rows);
    expect(out.cols).toBe(src.cols);
    expect(out.locCode).toBe(src.locCode);
    expect(out.name).toBe(src.name);
  });

  it("cloneForPaste：nth 直接控制步数（1 起）", () => {
    const out = cloneForPaste(shelf("s1", 5, 5), 3);
    expect(out.x).toBe(5 + PASTE_STEP_X * 3);
    expect(out.y).toBe(5 + PASTE_STEP_Y * 3);
  });

  it("samePasteType：不同类型判定为不可互相粘贴", () => {
    expect(samePasteType(shelf("s1"), shelf("s2"))).toBe(true);
    expect(samePasteType(shelf("s1"), peg("p1"))).toBe(false);
  });
});

describe("applyPaste + 撤销栈：一次粘贴 = 一条撤销记录（C 的批量生成同理）", () => {
  const layout: RoomLayout = {
    width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [],
    items: [{ id: "s1", type: "shelf", name: "A货架", x: 100, y: 100, w: 300, h: 120, rotation: 0, locCode: "6011-A", rows: 4, cols: 8 }],
  };

  it("粘贴把新元素加入布局，且**只产生一条** past 记录（可一次 Ctrl+Z 回退）", () => {
    const buf = copyBuffer(["s1"], layout.items)!;
    const res = applyPaste(layout, buf);
    expect(res.layout.items).toHaveLength(2);
    expect(res.pasted[0].id).not.toBe("s1");

    const after = historyReducer({ layout, past: [], future: [] }, { type: "commit", next: res.layout });
    expect(after.past).toHaveLength(1);                 // 不是 N 条

    const undone = historyReducer(after, { type: "undo" });
    expect(undone.layout.items).toHaveLength(1);        // 一次撤销回到粘贴前
    expect(undone.layout.items[0].id).toBe("s1");
  });

  it("多元素一次粘贴仍然只有一条记录（C 的整批生成按同一粒度）", () => {
    const multi: RoomLayout = { ...layout, items: [...layout.items, { ...layout.items[0], id: "s2", x: 500 }] };
    const buf = copyBuffer(["s1", "s2"], multi.items)!;
    const res = applyPaste(multi, buf);
    expect(res.layout.items).toHaveLength(4);
    const after = historyReducer({ layout: multi, past: [], future: [] }, { type: "commit", next: res.layout });
    expect(after.past).toHaveLength(1);
    expect(historyReducer(after, { type: "undo" }).layout.items).toHaveLength(2);
  });

  it("连续粘贴两次：两条记录、偏移递增（第二次更远）", () => {
    const first = applyPaste(layout, copyBuffer(["s1"], layout.items)!);
    const second = applyPaste(first.layout, first.next);
    const p1 = first.layout.items[1];
    const p2 = second.layout.items[2];
    expect(p2.x - p1.x).toBe(PASTE_STEP_X);
    const after = historyReducer({ layout, past: [], future: [] }, { type: "commit", next: first.layout });
    const after2 = historyReducer(after, { type: "commit", next: second.layout });
    expect(after2.past).toHaveLength(2);
  });
});