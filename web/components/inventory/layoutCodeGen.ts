/**
 * 未指定库位元素的**自动编码**（task-37 C）—— 纯逻辑，可预览、可整批撤销（一次 commit）。
 *
 * 硬规则（现场标签已打印，改一个就和系统对不上）：
 *  1. **只填空的**：`locCode` 非空的元素一律不进入候选，绝不改动已有编码。
 *  2. 生成前收集**全屋已用编码**：元素既有 `locCode` + **物料的 `locationCode`**（后者最容易漏，
 *     只收元素会撞上已贴标签的物料位）；物料码还会拆出它的元素基码（`6011-A-3-05` → `6011-A`）。
 *  3. 冲突**跳过并顺延**（不许覆盖），并把跳过的号记录在 `skipped` 里供预览展示。
 *  4. 室号取不到 → **不生成**，只留下"需显式输入"的 warning（不瞎编）。
 *  5. 一次调用产出一个新 layout（调用方 `commit` 一次 = 一条撤销记录）。
 *
 * ⚠️ 验证边界（task-37）：本模块有 12 条单测（含"已有编码一字不改""物料码占用""室号缺失不瞎编""往返解析"）。
 * **"把物料挂到洞洞板格位后其库位编码指向该格位"未在真机验证**（机制与货架共用同一套 usesCells/四段编码，
 * 但真机交互没走通）：线上补验前不要当作已验证。
 */

import type { ItemElement, MaterialItem, RoomLayout } from "./layoutTypes";

export interface CodeAssignment {
  elementId: string;
  name: string;
  code: string;
}

export interface CodePlan {
  /** 室号缺失时为 null，此时 assignments 为空 */
  roomCode: string | null;
  assignments: CodeAssignment[];
  /** 因被占用而跳过的号（预览里展示给用户看） */
  skipped: string[];
  warnings: string[];
}

/** 元素基码：`${室号}-${字母}`（与既有 autoLoc/四段编码一致） */
export function baseCode(roomCode: string, index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${roomCode}-${letters}`;
}

/** 从任意库位码里拆出元素基码：`6011-A-3-05` → `6011-A`；拆不出返回 null */
export function baseOfLoc(loc: string): string | null {
  const m = /^([^-]+-[A-Za-z]+)(?:-|$)/.exec(loc.trim());
  return m ? m[1].toUpperCase() : null;
}

/** 全屋已用编码：元素既有 locCode + 物料 locationCode + 物料码拆出的元素基码 */
export function usedCodes(layout: RoomLayout, materials: readonly MaterialItem[]): Set<string> {
  const used = new Set<string>();
  for (const el of layout.items) {
    const code = el.locCode?.trim();
    if (code) used.add(code.toUpperCase());
  }
  for (const it of materials) {
    const loc = it.locationCode?.trim();
    if (!loc) continue;
    used.add(loc.toUpperCase());
    const base = baseOfLoc(loc);
    if (base) used.add(base);
  }
  return used;
}

/** 需要补码的元素（**只含 locCode 为空的**） */
export function missingCodeElements(layout: RoomLayout): ItemElement[] {
  return layout.items.filter(el => !el.locCode?.trim());
}

/**
 * 生成计划：候选元素按顺序取下一个未占用基码，冲突跳过并顺延。
 * 室号缺失 → 不生成任何编码，只给 warning（要求用户显式输入）。
 */
export function planCodes(
  layout: RoomLayout,
  materials: readonly MaterialItem[],
  roomCode: string | null | undefined,
): CodePlan {
  const room = roomCode?.trim();
  const warnings: string[] = [];
  if (!room) {
    return {
      roomCode: null,
      assignments: [],
      skipped: [],
      warnings: ["缺少室号：请先显式输入室号（不会自动编造），再生成库位编码。"],
    };
  }

  const used = usedCodes(layout, materials);
  const candidates = missingCodeElements(layout);
  const assignments: CodeAssignment[] = [];
  const skipped: string[] = [];
  let index = 0;

  for (const el of candidates) {
    let code = baseCode(room, index);
    while (used.has(code.toUpperCase())) {
      skipped.push(code);                       // 已被占用 → 记录后顺延，绝不覆盖
      index += 1;
      code = baseCode(room, index);
    }
    used.add(code.toUpperCase());               // 同批内也不再重复
    assignments.push({ elementId: el.id, name: el.name, code });
    index += 1;
  }

  if (candidates.length === 0) warnings.push("没有未指定库位的元素，无需生成。");
  return { roomCode: room, assignments, skipped, warnings };
}

/** 把计划落到布局上（**只改候选元素**；已有 locCode 的元素原样保留） */
export function applyCodePlan(layout: RoomLayout, plan: CodePlan): RoomLayout {
  if (plan.assignments.length === 0) return layout;
  const byId = new Map(plan.assignments.map(a => [a.elementId, a.code]));
  return {
    ...layout,
    items: layout.items.map(el => {
      const code = byId.get(el.id);
      if (!code) return el;                     // 非候选：一字不改
      if (el.locCode?.trim()) return el;        // 双保险：已有编码绝不覆盖
      return { ...el, locCode: code };
    }),
  };
}

/** 预览文案（给 confirm/面板用；含跳过说明） */
export function planSummary(plan: CodePlan): string {
  const lines = plan.assignments.map(a => `${a.name} → ${a.code}`);
  if (plan.skipped.length > 0) lines.push(`（跳过的已占用号：${plan.skipped.join("、")}）`);
  if (plan.warnings.length > 0) lines.push(...plan.warnings);
  return lines.join("\n");
}
