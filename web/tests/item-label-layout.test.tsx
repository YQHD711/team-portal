import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { InventoryItem } from "@/components/inventory/inventoryTypes";
import { api } from "@/lib/api";

/**
 * 标签弹窗响应式布局的契约（jsdom 不排版，只锁 class/结构）：
 * - 移动端单列（预览在上、操作在下），lg 起双栏；
 * - 底部 4 个按钮 2×2，触摸高度 ≥ 40px；
 * - 只有一个主操作：「打印」是主色，「直连打印」是面板内的次强调色；
 * - 关闭按钮在右上角固定头部。
 * e2e 依赖精确文案「打印」与 niimbot-* testid，这里一并锁住。
 */
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), download: vi.fn() } }));

import ItemLabelModal from "@/components/inventory/ItemLabelModal";

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const item: InventoryItem = {
  id: 1, name: "6S 3300mAh 锂电池", category: "电池电源", quantity: 3,
  code: "BAT-LIPO-6S3300MAH-2026-0007", locationCode: "1012-A-1-01",
  status: "available", grade: "A", unitPrice: 320, updatedAt: "2026-09-01T10:00:00Z",
};

function renderModal() {
  render(<ItemLabelModal item={item} baseUrl="https://team.example.com" onClose={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockResolvedValue({ templates: [] }); // 只用内置兜底模板
});

describe("物料标签弹窗 · 响应式布局", () => {
  it("弹窗宽度分档：移动 max-w-sm / 平板 md / 桌面 lg 加宽", () => {
    renderModal();
    const modal = screen.getByTestId("item-label-modal");
    expect(modal.className).toContain("max-w-sm");
    expect(modal.className).toContain("md:max-w-2xl");
    expect(modal.className).toContain("lg:max-w-3xl");
    // 弹窗自身滚动，低矮屏幕不会把底部按钮顶出视野
    expect(modal.className).toContain("max-h-[90dvh]");
  });

  it("桌面两栏、移动单列：grid 只在 lg 起生效", () => {
    renderModal();
    const grid = screen.getByTestId("label-layout-grid");
    expect(grid.className).toContain("flex-col");
    expect(grid.className).toContain("lg:grid");
    expect(grid.className).toContain("lg:grid-cols-[");
    expect(screen.getByTestId("label-actions-column").className).toContain("lg:border-l");
  });

  it("预览与模板下拉在左栏，打印方式在右栏", () => {
    renderModal();
    const preview = screen.getByTestId("label-preview-column");
    const actions = screen.getByTestId("label-actions-column");
    expect(within(preview).getByTestId("label-template-select")).toBeInTheDocument();
    expect(within(actions).getByTestId("niimbot-panel")).toBeInTheDocument();
    expect(within(actions).getByTestId("label-action-buttons")).toBeInTheDocument();
  });

  it("底部 4 个操作 2×2 排布，触摸高度 ≥ 40px", () => {
    renderModal();
    const actions = screen.getByTestId("label-action-buttons");
    expect(actions.className).toContain("grid-cols-2");

    const printBtn = screen.getByRole("button", { name: "打印" });
    const exportBtn = screen.getByTestId("export-label-pdf");
    const copyBtn = screen.getByRole("button", { name: "复制短链" });
    const closeBtns = screen.getAllByRole("button", { name: "关闭" });
    expect(closeBtns).toHaveLength(2); // 右上角 X + 底部「关闭」
    for (const button of [printBtn, exportBtn, copyBtn, closeBtns[1]]) {
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("w-full");
    }
    // e2e 依赖精确文案「打印」：不能被「直连打印/连接打印机」命中
    expect(printBtn).toBeInTheDocument();
  });

  it("只有一个主操作：打印主色，直连打印为面板内次强调", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "打印" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "打印" }).className).toContain("text-white");
    const niimbotPrint = screen.getByTestId("niimbot-print");
    expect(niimbotPrint.className).toContain("bg-primary/10");
    expect(niimbotPrint.className).not.toContain("text-white");
    // 导出/复制是描边次要按钮
    expect(screen.getByTestId("export-label-pdf").className).toContain("border");
    expect(screen.getByRole("button", { name: "复制短链" }).className).toContain("border");
  });

  it("关闭按钮在固定头部右上角，且触摸区域 ≥ 40px", () => {
    renderModal();
    const headerClose = screen.getAllByRole("button", { name: "关闭" })[0];
    expect(headerClose.className).toContain("min-h-10");
    expect(headerClose.className).toContain("min-w-10");
    expect(headerClose.closest("div")?.className).toContain("justify-between");
  });
});
