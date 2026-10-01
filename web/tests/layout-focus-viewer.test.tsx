import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
const items: MaterialItem[] = [
  { id: 1, name: "桨叶", quantity: 5, locationCode: "1012-A-1-01" },
  { id: 2, name: "螺丝", quantity: 2, locationCode: "1012-A-3-05" },
];

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 没有实现 scrollIntoView（定位卡片挂载后会调用它把卡片滚进视野）
  Element.prototype.scrollIntoView = vi.fn();
});

describe("平面图查看器：受控的初始选中与高亮", () => {
  it("不带定位参数时行为与改动前一致：没有选中卡片，点了格位才出现", () => {
    render(<PlannerViewer layout={layout} roomCode="1012" items={items} />);

    expect(screen.queryByTestId("layout-focus-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("layout-selection-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cell-focus-0-0")).not.toBeInTheDocument();

    // 点第一格（桨叶所在）→ 出现原有的格位卡片，并列出该格物料
    fireEvent.click(screen.getByTestId("cell-0-0"));
    const card = screen.getByTestId("layout-selection-card");
    expect(card).toHaveTextContent("A货架");
    expect(card).toHaveTextContent("1层01位");
    expect(within(card).getByTestId("cell-item-1")).toHaveTextContent("桨叶");
    expect(within(card).queryByTestId("cell-item-2")).not.toBeInTheDocument();
  });

  it("带 element+item 进入：直接选中该元素、选中所查物料所在格位并高亮它", () => {
    render(
      <PlannerViewer layout={layout} roomCode="1012" items={items}
        initialElementId="1012-A" focusElementId="e1" focusItem={items[1]} />
    );

    // 定位卡片明确说明查的是哪件、在哪个格位
    const banner = screen.getByTestId("layout-focus-card");
    expect(banner).toHaveTextContent("已定位");
    expect(screen.getByTestId("layout-focus-item")).toHaveTextContent("螺丝");
    expect(banner).toHaveTextContent("A货架");
    expect(banner).toHaveTextContent("3层05位");
    expect(banner).toHaveTextContent("1012-A-3-05");

    // 画布上「所查物料所在的格位」被单独圈出来（库位 3层05位 → 下标 2-4）
    expect(screen.getByTestId("cell-focus-2-4")).toBeInTheDocument();
    expect(screen.queryByTestId("cell-focus-0-0")).not.toBeInTheDocument();

    // 已选中该元素（自动带出它那一格），而不是默认第一格
    const card = screen.getByTestId("layout-selection-card");
    expect(card).toHaveTextContent("A货架");
    expect(card).toHaveTextContent("3层05位");
    expect(within(card).getByTestId("cell-item-2")).toHaveTextContent("螺丝");
    expect(within(card).queryByTestId("cell-item-1")).not.toBeInTheDocument();
  });

  it("从正视细节视图进入时把所查物料在明细里标出来", () => {
    render(
      <PlannerViewer layout={layout} roomCode="1012" items={items}
        initialElementId="e1" focusElementId="e1" focusItem={items[1]} />
    );
    fireEvent.click(within(screen.getByTestId("layout-selection-card")).getByRole("button", { name: /正视细节视图/ }));

    const row = screen.getByTestId("detail-item-2");
    expect(row).toHaveTextContent("螺丝");
    expect(row).toHaveTextContent("所查物料");
    expect(screen.queryByTestId("detail-item-1")).not.toBeInTheDocument();
  });

  it("定位参数对不上时不选中任何元素，也不显示定位卡片", () => {
    render(
      <PlannerViewer layout={layout} roomCode="1012" items={items}
        initialElementId="不存在" focusElementId="不存在" focusItem={items[0]} />
    );

    expect(screen.queryByTestId("layout-focus-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("layout-selection-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cell-focus-0-0")).not.toBeInTheDocument();
  });
});
