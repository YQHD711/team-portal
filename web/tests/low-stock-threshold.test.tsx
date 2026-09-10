import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { api } from "@/lib/api";
import {
  DEFAULT_LOW_STOCK_THRESHOLD, LowStockProvider, useLowStock,
} from "@/components/inventory/LowStockProvider";
import { RoomCard } from "@/components/inventory/RoomCard";
import InventoryTable from "@/components/inventory/InventoryTable";
import { cellFill, LOW_FILL, FULL_FILL } from "@/components/inventory/cellColors";
import type { InventoryItem } from "@/components/inventory/inventoryTypes";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

/** 用一句话读出当前上下文里的阈值，便于断言来源 */
function ThresholdProbe() {
  const { threshold, grade, loaded } = useLowStock();
  return <div data-testid="probe">{`${threshold}|${grade}|${loaded}`}</div>;
}

const row = {
  id: 1, roomCode: "1030", roomName: "库房", floor: 1,
  cabinetCount: 1, shelfCount: 4, positionCount: 8, updatedAt: "",
  layoutJson: JSON.stringify({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items: [] }),
};

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 1, name: "桨叶", category: "动力系统", quantity: 6, locationCode: "1030-A-1-01",
  status: "available", grade: "C", unitPrice: 10, updatedAt: "2026-09-01T10:00:00Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockResolvedValue({ lowStockThreshold: 10, lowStockGrade: "B" });
});

describe("低库存阈值：后端设置为唯一来源", () => {
  it("没有 Provider 时使用兜底阈值（保证组件可独立测试/首帧不闪烁）", () => {
    render(<ThresholdProbe />);
    expect(screen.getByTestId("probe")).toHaveTextContent(`${DEFAULT_LOW_STOCK_THRESHOLD}|C|false`);
  });

  it("Provider 拉取 /api/inventory/meta 并把阈值与等级下发", async () => {
    render(<LowStockProvider><ThresholdProbe /></LowStockProvider>);

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("10|B|true"));
    expect(mockedGet).toHaveBeenCalledWith("/api/inventory/meta");
  });

  it("接口返回非法值/失败时退回兜底阈值，不阻塞界面", async () => {
    mockedGet.mockResolvedValueOnce({ lowStockThreshold: 0, lowStockGrade: "" });
    const { unmount } = render(<LowStockProvider><ThresholdProbe /></LowStockProvider>);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(`${DEFAULT_LOW_STOCK_THRESHOLD}|C|true`));
    unmount();

    mockedGet.mockRejectedValueOnce(new Error("network"));
    render(<LowStockProvider><ThresholdProbe /></LowStockProvider>);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(`${DEFAULT_LOW_STOCK_THRESHOLD}|C|false`));
  });

  it("房间卡片的预警数量随阈值变化（6 件：阈值 10 算低，阈值 3 不算）", async () => {
    const items = [item({ id: 1, quantity: 6 }), item({ id: 2, quantity: 2 })];

    mockedGet.mockResolvedValue({ lowStockThreshold: 3, lowStockGrade: "C" });
    const first = render(<LowStockProvider><RoomCard isStaff onOpen={vi.fn()} row={row} items={items} /></LowStockProvider>);
    await waitFor(() => expect(screen.getByText("1 预警")).toBeInTheDocument());
    first.unmount();

    mockedGet.mockResolvedValue({ lowStockThreshold: 10, lowStockGrade: "C" });
    render(<LowStockProvider><RoomCard isStaff onOpen={vi.fn()} row={row} items={items} /></LowStockProvider>);
    await waitFor(() => expect(screen.getByText("2 预警")).toBeInTheDocument());
  });

  it("库存表格的高亮走同一阈值", async () => {
    mockedGet.mockResolvedValue({ lowStockThreshold: 10, lowStockGrade: "C" });
    render(<LowStockProvider><InventoryTable items={[item({ quantity: 6 })]} loading={false} role="admin"
      onTake={vi.fn()} onReturn={vi.fn()} onHistory={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} /></LowStockProvider>);

    // 6 < 10 → 数量以 warning 色显示（阈值 3 时同样的数量不会高亮）
    await waitFor(() => expect(document.querySelectorAll("tr.bg-amber-50\\/50").length).toBeGreaterThan(0));
  });

  it("格位配色函数按传入阈值判定（颜色是阈值的纯函数）", () => {
    expect(cellFill("shelf", 6, 10)).toBe(LOW_FILL);
    expect(cellFill("shelf", 6, 3)).toBe(FULL_FILL.shelf);
    expect(cellFill("shelf", 10, 10)).toBe(FULL_FILL.shelf);   // 等于阈值不算低
  });
});
