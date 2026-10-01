import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ItemElement, MaterialItem, RoomLayout } from "@/components/inventory/layoutTypes";

// react-konva 需要真实 Canvas，jsdom 里跑不了 —— 用 DOM 替身跑组件逻辑
vi.mock("react-konva", async () => (await import("./support/konvaStub")).stubs);

import { PlannerViewer } from "@/components/inventory/PlannerViewer";

const shelf: ItemElement = {
  id: "e1", type: "shelf", name: "A货架", locCode: "1012-A",
  x: 100, y: 100, w: 200, h: 60, rotation: 0, rows: 4, cols: 8,
};
const layout: RoomLayout = { width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items: [shelf] };
const items: MaterialItem[] = [{ id: 1, name: "桨叶", quantity: 5, locationCode: "1012-A-1-01" }];

function rect(top: number, height: number, left = 0, width = 100): DOMRect {
  return {
    x: left, y: top, top, left, width, height,
    right: left + width, bottom: top + height,
    toJSON: () => ({}),
  };
}

/** 桌面面板在 <lg 由 `max-lg:hidden` 变成 display:none；jsdom 不跑 CSS，用开关模拟断点切换 */
let desktopHidden = true;

function inHiddenDesktopPanel(el: Element): boolean {
  return el.closest('[class~="max-lg:hidden"]') !== null;
}

/** 面板此刻是否被 CSS 藏起来（真实浏览器里就是 display:none → clientWidth/clientHeight 为 0） */
function isHidden(el: Element): boolean {
  return inHiddenDesktopPanel(el) && desktopHidden;
}

/**
 * 模拟移动端真实布局：
 * - 桌面面板被藏起来 → 里面条目的 getBoundingClientRect() 全 0（bug 的零尺寸 rect）
 * - 抽屉展开后，可见条目的中心是 (480, 270)；连线容器原点为 (0, 0)
 */
function installMobileRects() {
  desktopHidden = true;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if ((el.getAttribute("title") ?? "").includes("1012-A-1-01")) {
      return isHidden(el) ? rect(0, 0, 0, 0) : rect(260, 20, 420, 120);
    }
    if (el.dataset.konva === "Stage") return rect(120, 300, 0, 400);
    return rect(0, 400, 0, 600);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return isHidden(this) ? 0 : 600;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isHidden(this) ? 0 : 400;
  });
}

const lineQuery = '[data-testid="connection-line"]';

function renderViewer() {
  const utils = render(<PlannerViewer layout={layout} roomCode="1012" items={items} />);
  fireEvent.click(screen.getByTitle("显示/隐藏物料连线"));
  return utils;
}

function assertLineEnds(container: HTMLElement, x1: number, y1: number) {
  const lines = container.querySelectorAll(lineQuery);
  expect(lines.length).toBeGreaterThan(0);
  for (const el of lines) {
    expect(Number(el.getAttribute("x1"))).toBeCloseTo(x1, 3);
    expect(Number(el.getAttribute("y1"))).toBeCloseTo(y1, 3);
  }
}

describe("移动端物料布局连线：隐藏面板不得污染锚点", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("抽屉关闭时不画连线（不指向容器左上角），展开后端点落在可见条目上，收起后清掉过期锚点", () => {
    installMobileRects();
    const { container } = renderViewer();

    // 抽屉未展开：DOM 里只有 display:none 的桌面面板，其 rect 全 0 —— 不能拿来当连线端点
    expect(container.querySelectorAll(lineQuery)).toHaveLength(0);

    // 展开抽屉：可见面板上报真实中心 → 连线恢复，端点就是 (480, 270)
    const toggle = screen.getByRole("button", { name: /物料清单/ });
    fireEvent.click(toggle);
    assertLineEnds(container, 480, 270);

    // 收起抽屉：面板消失后不得继续用它的旧坐标画线
    fireEvent.click(toggle);
    expect(container.querySelectorAll(lineQuery)).toHaveLength(0);
  });

  it("抽屉展开时隐藏面板同时上报（滚动重测）也不会把端点带偏", () => {
    installMobileRects();
    const { container } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /物料清单/ }));
    assertLineEnds(container, 480, 270);

    act(() => { document.dispatchEvent(new Event("scroll")); });
    assertLineEnds(container, 480, 270);
  });

  it("面板从可见变成不可见（跨断点变窄）时清掉旧锚点，不留下过期连线", () => {
    installMobileRects();
    desktopHidden = false; // 先在 ≥lg：桌面面板可见并上报真实坐标
    const { container } = renderViewer();
    assertLineEnds(container, 480, 270);

    act(() => {
      desktopHidden = true; // 视口变窄 → max-lg:hidden 生效，桌面面板被藏起来
      window.dispatchEvent(new Event("resize"));
    });
    expect(container.querySelectorAll(lineQuery)).toHaveLength(0);
  });
});
