import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useCurrentUser } from "@/lib/hooks";
import { api } from "@/lib/api";
import type { ItemElement, RoomLayout } from "@/components/inventory/layoutTypes";
import { LOCATION_FALLBACK_TEMPLATE } from "@/lib/locationTemplate";
import { ExportLocationLabelsButton, roomLocationCodes } from "@/components/inventory/ExportLocationLabelsButton";
import { ElementLocationExportButton } from "@/components/inventory/ElementLocationExportButton";
import { collectLocationSlots, toLocationLabelData } from "@/lib/locationLabelPdf";

/**
 * 库位标签直连打印入口：仅 staff 渲染；dataList 由 roomLocationCodes → slots → LabelData 生成。
 * PDF 导出按钮仍保持原权限（不在本测试里被角色收紧）。
 */
vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedUseCurrentUser = vi.mocked(useCurrentUser);

const staffUser = { id: 1, username: "admin", role: "admin", department: null, departmentId: null };
const memberUser = { id: 2, username: "member", role: "member", department: null, departmentId: null };

const shelf: ItemElement = {
  id: "el-shelf", type: "shelf", name: "货架A", locCode: "6011-C-2",
  x: 0, y: 0, w: 100, h: 200, rotation: 0, rows: 2, cols: 2,
};
const device: ItemElement = {
  id: "el-device", type: "device", name: "充电器", locCode: "6011-D-1-01",
  x: 0, y: 0, w: 50, h: 50, rotation: 0,
};
const noCode: ItemElement = {
  id: "el-empty", type: "device", name: "未定位设备",
  x: 0, y: 0, w: 50, h: 50, rotation: 0,
};
const layout = { width: 800, height: 600, walls: [], doors: [], windows: [], items: [shelf, device, noCode] } as RoomLayout;

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockResolvedValue([]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("库位标签 · 取码 → dataList", () => {
  it("分格元素展开全部格位，未指定库位的元素不产出标签", () => {
    const { slots, skipped } = collectLocationSlots(roomLocationCodes(layout.items), "6011");
    expect(slots).toHaveLength(5); // 4 格 + 设备 1 个整体码
    // 既有语义：未指定库位的元素压根不产出"空编码条目"，因此 skipped=0
    expect(skipped).toBe(0);
    const dataList = slots.map(toLocationLabelData);
    expect(dataList).toHaveLength(5);
    expect(dataList[0]).toMatchObject({ code: "6011-C-2-1-01", url: "6011-C-2-1-01" });
  });

  it("显式空编码计入 skipped（保持既有 collectLocationSlots 语义）", () => {
    const { slots, skipped } = collectLocationSlots([
      { name: "空位", codes: ["", "6011-A-1-01"] },
    ], "6011");
    expect(slots).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe("库位标签 · 直连打印入口权限", () => {
  it("staff：房间级入口可见，点击后按实际张数打开批量打印面板", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<ExportLocationLabelsButton layout={layout} roomName="6011" template={LOCATION_FALLBACK_TEMPLATE} />);

    fireEvent.click(screen.getByTestId("direct-print-location-labels"));

    await waitFor(() => expect(screen.getByTestId("batch-label-print-modal")).toBeInTheDocument());
    expect(screen.getByTestId("batch-label-count")).toHaveTextContent("共 5 张");
  });

  it("非 staff：房间级直连按钮不渲染，PDF 导出按钮仍在", () => {
    mockedUseCurrentUser.mockReturnValue({ user: memberUser, loading: false, refresh: vi.fn() });
    render(<ExportLocationLabelsButton layout={layout} roomName="6011" template={LOCATION_FALLBACK_TEMPLATE} />);

    expect(screen.queryByTestId("direct-print-location-labels")).not.toBeInTheDocument();
    expect(screen.getByTestId("export-location-labels")).toBeInTheDocument();
  });

  it("staff：元素级入口按该元素格位数打开面板", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<ElementLocationExportButton element={device} roomName="6011" template={LOCATION_FALLBACK_TEMPLATE} />);

    fireEvent.click(screen.getByTestId("direct-print-element-loc-labels"));

    await waitFor(() => expect(screen.getByTestId("batch-label-count")).toHaveTextContent("共 1 张"));
  });

  it("非 staff：元素级直连按钮不渲染，PDF 导出按钮仍在", () => {
    mockedUseCurrentUser.mockReturnValue({ user: memberUser, loading: false, refresh: vi.fn() });
    render(<ElementLocationExportButton element={device} roomName="6011" template={LOCATION_FALLBACK_TEMPLATE} />);

    expect(screen.queryByTestId("direct-print-element-loc-labels")).not.toBeInTheDocument();
    expect(screen.getByTestId("export-element-loc-labels")).toBeInTheDocument();
  });
});
