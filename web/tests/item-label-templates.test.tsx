import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { InventoryItem } from "@/components/inventory/inventoryTypes";
import { api } from "@/lib/api";
import { installFakeCanvas } from "./support/labelCanvas";

/**
 * 标签弹窗的模板下拉与**降级**：接口挂了也必须能导出（用内置默认模板）。
 */

const pdfMock = vi.hoisted(() => ({ format: [] as unknown[], saved: [] as string[] }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(opts: { format?: unknown }) { pdfMock.format.push(opts?.format); }
    addImage() {}
    save(name: string) { pdfMock.saved.push(name); return this; }
  },
}));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import ItemLabelModal from "@/components/inventory/ItemLabelModal";

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const CODE = "EL-MOTOR-2212-2026-0001";
const item: InventoryItem = {
  id: 1, name: "测试电机", category: "动力系统", quantity: 1, code: CODE,
  locationCode: "1030-A-1-01", status: "available", grade: "B", unitPrice: 88, updatedAt: "2026-09-01T10:00:00Z",
};

const smallTemplate = {
  id: 9, name: "小标签 60×40", isDefault: true, widthMm: 60, heightMm: 40, dpi: 300, background: "#FFFFFF",
  elements: [{ id: "qr", type: "qr", x: 2, y: 2, w: 20, h: 20, quietMm: 2 }],
};
const otherTemplate = {
  id: 10, name: "备选 80×50", widthMm: 80, heightMm: 50, dpi: 600, background: "#FFFFFF",
  elements: [{ id: "qr", type: "qr", x: 3, y: 10, w: 30, h: 30, quietMm: 3 }],
};

const renderModal = () => render(<ItemLabelModal item={item} baseUrl="http://x" onClose={vi.fn()} />);
const select = () => screen.getByTestId("label-template-select");
const exportBtn = () => screen.getByTestId("export-label-pdf");

beforeEach(() => {
  pdfMock.format.length = 0;
  pdfMock.saved.length = 0;
  installFakeCanvas();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("标签弹窗：模板下拉", () => {
  it("接口返回两个模板：默认那个被选中，导出用它的尺寸", async () => {
    mockedGet.mockResolvedValue({ templates: [otherTemplate, smallTemplate] });
    renderModal();

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getByRole("option", { name: /小标签 60×40（默认）/ })).toBeInTheDocument();
    expect(select()).toHaveValue("9");

    fireEvent.click(exportBtn());
    await waitFor(() => expect(pdfMock.saved).toEqual([`${CODE}.pdf`]));
    expect(pdfMock.format[0]).toEqual([60, 40]);
  });

  it("临时换成另一个模板再导：用选中的那个", async () => {
    mockedGet.mockResolvedValue({ templates: [smallTemplate, otherTemplate] });
    renderModal();
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    fireEvent.change(select(), { target: { value: "10" } });
    fireEvent.click(exportBtn());

    await waitFor(() => expect(pdfMock.saved).toEqual([`${CODE}.pdf`]));
    expect(pdfMock.format[0]).toEqual([80, 50]);
  });

  it("接口 404/500：只剩内置兜底模板，导出照旧成功（不退化）", async () => {
    mockedGet.mockRejectedValue(new Error("HTTP 404"));
    renderModal();

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("默认 80×50");
    expect(exportBtn()).toBeEnabled();

    fireEvent.click(exportBtn());
    await waitFor(() => expect(pdfMock.saved).toEqual([`${CODE}.pdf`]));
    expect(pdfMock.format[0]).toEqual([80, 50]);
  });

  it("接口返回空列表 / 非法结构：同样用内置兜底模板导出", async () => {
    mockedGet.mockResolvedValue({ templates: [] });
    const first = renderModal();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(exportBtn());
    await waitFor(() => expect(pdfMock.saved).toEqual([`${CODE}.pdf`]));
    first.unmount();

    mockedGet.mockResolvedValue({ nonsense: true });
    renderModal();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
