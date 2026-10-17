/**
 * 布局画布的**坐标换算**（e2e 共享）。别再手算 —— 这个坑已经让人误判三次。
 *
 * ## 四条真机事实（没写下来就会重复踩）
 * 1. **调色板只在「编辑平面图」模式下渲染**；非编辑模式页面上只有
 *    `楼层概览 / 编辑平面图 / 连线关 / 物料清单`，找不到任何元素按钮。
 * 2. **3100 端口可能被残留的 `next start` 占用**，或出现 `Another next build process is already running`
 *    （队友在构建）——两者都会让 Playwright 起不来，先查端口/构建锁，别误判成 spec 或产品问题。
 * 3. ⚠️ **舞台缩放 ≠ canvas宽 / 布局宽**：实测 canvas 534×458、布局 900×600，用 `534/900=0.593`
 *    推算会**高估 39%**（真实 `s≈0.427`）。`s` 是 view 缩放（UI 那个「79%」）× 基准比例，
 *    **必须从权威来源取**，不能用 canvas 宽反推。
 * 4. **舞台双向居中**：`padLeft` 与 `padTop` **都存在**（居中留白）。
 *    （事实 3 的 39% 偏差同时解释了"纵向点偏""横向裁偏"两次误判。）
 *
 * ## 用法（必须自检）
 * ```ts
 * const T = transformFor(box, W, H, zoomPercentFromUi);
 * await verifyMapping(page, box, T, benchEl, async () => await toggle.isVisible());
 * const p = elementCenterPage(box, T, el);
 * ```
 * `verifyMapping` 以"点击后 UI 是否响应"为真值交叉验证换算，不一致就**抛错**（不静默算错）——
 * 这个自检正是当初反查出 39% 偏差的手段，现在固化下来。
 */

import type { Page } from "@playwright/test";

export interface Box { x: number; y: number; width: number; height: number }

export interface Transform {
  /** 每 cm 多少屏幕像素 */
  s: number;
  padLeft: number;
  padTop: number;
  /** s 的来源：权威（UI 缩放读数）还是**退化推断**（canvas 宽） */
  source: "zoom" | "stage" | "fallback-canvasWidth";
}

/** 100% 缩放时每 cm 的屏幕像素（由画布基准决定；该模块实测 ~0.54） */
export const BASE_PX_PER_CM_AT_100 = 0.54;

/**
 * 由**权威来源**构造换算。
 * @param zoomPercent UI 上的缩放读数（如 79）；传 null 时退化为 canvas 宽推断并**标记来源**
 */
export function transformFor(box: Box, layoutWCm: number, layoutHCm: number, zoomPercent: number | null): Transform {
  const s = zoomPercent === null
    ? box.width / layoutWCm                                            // 退化：已知会高估，source 里标明
    : BASE_PX_PER_CM_AT_100 * (zoomPercent / 100);
  return {
    s,
    padLeft: Math.max(0, (box.width - layoutWCm * s) / 2),              // **双向居中**
    padTop: Math.max(0, (box.height - layoutHCm * s) / 2),
    source: zoomPercent === null ? "fallback-canvasWidth" : "zoom",
  };
}

/** cm → 页面像素 */
export function cmToPage(box: Box, t: Transform, cmX: number, cmY: number): { x: number; y: number } {
  return { x: box.x + t.padLeft + cmX * t.s, y: box.y + t.padTop + cmY * t.s };
}

/** 元素矩形中心 → 页面像素 */
export function elementCenterPage(box: Box, t: Transform, el: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return cmToPage(box, t, el.x + el.w / 2, el.y + el.h / 2);
}

/**
 * **自检**：按换算点击元素中心；若 `probe()`（该元素是否被选中的真值，例如选区控件可见）为 false
 * 就**抛错**。不要静默继续——静默算错会让后续断言与截图一起失真。
 */
export async function verifyMapping(
  page: Page,
  box: Box,
  t: Transform,
  el: { x: number; y: number; w: number; h: number },
  probe: () => Promise<boolean>,
): Promise<void> {
  const p = elementCenterPage(box, t, el);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  const ok = await probe().catch(() => false);
  if (ok) return;
  await page.mouse.click(box.x + 4, box.y + box.height - 4);           // 清选中，避免污染后续用例
  throw new Error(
    `坐标换算自检失败（source=${t.source}, s=${t.s.toFixed(4)}, padLeft=${t.padLeft.toFixed(1)}, padTop=${t.padTop.toFixed(1)}）：` +
    `点击 (${p.x.toFixed(0)},${p.y.toFixed(0)}) 没命中元素 —— 换算是错的，别继续断言/截图。`,
  );
}

/** ⚠️ **已废弃**：canvas宽/布局宽（会高估 ~39%）。仅保留用于对比排查，新用例不要用。 */
export function stageScale(box: Box, layoutWCm: number): number {
  return box.width / layoutWCm;
}

/**
 * **权威路线**：读画布发布的真实变换（`PlannerCanvas` 用 Konva 的 stage/layer 实际值写入 `data-stage-transform`）。
 * 比"推导 padLeft/padTop"可靠，也避免"用角标反解偏移"的**循环论证**（角标由同一份 view 算出）。
 * 返回 null 时调用方应**失败**，不要退化猜测。
 */
export async function stageTransformFromDom(page: Page, box: Box): Promise<Transform | null> {
  const raw = await page.locator("[data-stage-transform]").first().getAttribute("data-stage-transform").catch(() => null);
  if (!raw) return null;
  const [ox, oy, s] = raw.split(",").map(Number);
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(s) || s <= 0) return null;
  return { s, padLeft: ox, padTop: oy, source: "stage" };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * **真机事实 · 第五条：查看模式（`PlannerViewer`）里"定位元素"目前不可自动化**
 * ═══════════════════════════════════════════════════════════════════════════
 * 症状（下次遇到"元素中心算出 NaN / dblclick 报 Invalid parameters"先看这里）：
 * `transformFor()` 返回 `padLeft: null, padTop: null` → `elementCenterPage()` 得 NaN。
 *
 * 根因链（按排查顺序）：
 *  1. `data-stage-transform` 只在 **`PlannerCanvas`（编辑模式）** 发布（`useStageTransformPublisher`，PlannerCanvas.tsx:55）；
 *     **`PlannerViewer`（查看模式）没有调用它** → 属性不存在 → pad 为 null。
 *  2. **但直接把那个 hook 加到 `PlannerViewer` 会让 `tests/planner-hidden-panel-lines.test.tsx`
 *     的 3 个用例全红**（jsdom 下新增 hook 调用失败）。所以要补的话必须**同时**处理该测试的 mock，
 *     或让 hook 在"没有真实 stage"时安全退化（先例：其它 hook 的 `if (!stage) return;` 写法）。
 *  3. **即便发布了属性，`transformFor` 的 pad 仍可能为 null** —— 说明本文件的 pad 计算依赖
 *     **编辑模式**的布局假设（stage 居中两轴 / 尺寸关系）；上面"四条真机事实"里"舞台居中两轴"
 *     那条**可能只适用于编辑器**，查看模式需要**单独的 pad 来源或换算分支**（别硬套）。
 *
 * 正确签名（别再猜，我猜错过两次）：
 *  - `elementCenterPage(box, t, el)` —— **box 在前**
 *  - `verifyMapping(page, box, t, el, probeFn)` —— 第 5 参是 **`() => Promise<boolean>` 探针函数**，不是 options
 *
 * 结论：**查看模式"定位元素"目前不可自动化**；因此
 * `e2e/location-label-element.spec.ts`（元素级库位标签导出，走查看模式画布双击）**尚无 e2e**，
 * 该入口目前只有单测覆盖（取码/文件名）。要一次修好：先让 `PlannerViewer` 安全发布变换（含测试 mock），
 * 再给本文件补一条"查看模式 pad"的可靠来源，最后才写那条 spec。
 * ═══════════════════════════════════════════════════════════════════════════ */
