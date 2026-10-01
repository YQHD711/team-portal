import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>,
}));

import LocationLink from "@/components/inventory/LocationLink";
import InventoryTable from "@/components/inventory/InventoryTable";
import ScanQueryModal from "@/components/inventory/ScanQueryModal";
import type { InventoryItem } from "@/components/inventory/inventoryTypes";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

const item: InventoryItem = {
  id: 12, name: "3S 3300mAh 25C 锂聚合物电池", category: "电池电源", quantity: 4,
  code: "BAT-LIPO-6S3300MAH-2026-0007", locationCode: "201-A-3-05", status: "available",
  grade: "A", unitPrice: 1200, updatedAt: "2026-09-01T10:00:00Z",
};

beforeEach(() => { vi.clearAllMocks(); });

describe("可点击库位（LocationLink）", () => {
  it("四段编码 → 房间 + 元素 + 物料，跳到布局页", () => {
    render(<LocationLink locationCode="1012-A-3-05" item="BAT-2026-0007" testId="loc" />);
    expect(screen.getByTestId("loc"))
      .toHaveAttribute("href", "/inventory/layout?room=1012&element=1012-A&item=BAT-2026-0007");
  });

  it("两段编码（整体挂载）也能跳，只带 room/element", () => {
    render(<LocationLink locationCode="1012-C" item={7} testId="loc" />);
    expect(screen.getByTestId("loc")).toHaveAttribute("href", "/inventory/layout?room=1012&element=1012-C&item=7");
  });

  it("没有库位时是纯文本，不是坏链接", () => {
    render(<LocationLink locationCode="" fallback="库位未指定" testId="loc" />);
    expect(screen.getByTestId("loc-empty")).toHaveTextContent("库位未指定");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("库存表格的库位列", () => {
  const noop = () => {};
  const renderTable = (items: InventoryItem[]) => render(
    <InventoryTable items={items} loading={false} role="member"
      onTake={noop} onLabel={noop} onReturn={noop} onHistory={noop} onEdit={noop} onDelete={noop} />
  );

  it("有库位的行给出可点链接，链接指到该物料所在的布局位置", () => {
    renderTable([item]);
    // 桌面表格与移动卡片各一个入口
    for (const id of [`item-location-${item.id}`, `item-location-m-${item.id}`]) {
      expect(screen.getByTestId(id))
        .toHaveAttribute("href", "/inventory/layout?room=201&element=201-A&item=BAT-LIPO-6S3300MAH-2026-0007");
    }
  });

  it("库位为空时不渲染链接", () => {
    renderTable([{ ...item, locationCode: "" }]);
    expect(screen.queryByTestId(`item-location-${item.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`item-location-m-${item.id}`)).not.toBeInTheDocument();
  });
});

describe("扫码查询结果里的库位", () => {
  it("查到物料后，库位是可点的跳转链接", async () => {
    mockGet.mockResolvedValue(item);
    render(<ScanQueryModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("物料编码"), { target: { value: item.code ?? "" } });
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    expect(await screen.findByTestId("scan-result-location"))
      .toHaveAttribute("href", "/inventory/layout?room=201&element=201-A&item=BAT-LIPO-6S3300MAH-2026-0007");
  });

  it("物料没有库位时只提示未指定，不给链接", async () => {
    mockGet.mockResolvedValue({ ...item, locationCode: null });
    render(<ScanQueryModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("物料编码"), { target: { value: item.code ?? "" } });
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    expect(await screen.findByTestId("scan-result-location-empty")).toHaveTextContent("库位未指定");
  });
});
