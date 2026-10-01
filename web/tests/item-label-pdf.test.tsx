import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { InventoryItem } from "@/components/inventory/inventoryTypes";
import { PX_PER_MM, QR_RECT_MM } from "@/lib/labelPdf";
import { installFakeCanvas, decodeQr, type FakeCanvas } from "./support/labelCanvas";

// 只把「PDF 库落盘」这一步换成替身：文件名/是否真的调用 save 由它记录；
// 其余（二维码矩阵、canvas 绘制）都跑真实实现。
const pdfMock = vi.hoisted(() => ({ saved: [] as string[], images: [] as string[] }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    addImage(image: string) { pdfMock.images.push(image); }
    save(name: string) { pdfMock.saved.push(name); return this; }
  },
}));

import ItemLabelModal from "@/components/inventory/ItemLabelModal";

const BASE = "http://8.137.161.160:3000";
const CODE = "BAT-LIPO-6S3300MAH-2026-0007";
const item: InventoryItem = {
  id: 1, name: "6S 3300mAh 锂电池", category: "电池电源", quantity: 3, code: CODE,
  locationCode: "1012-A-1-01", status: "available", grade: "A", unitPrice: 320, updatedAt: "2026-09-01T10:00:00Z",
};

let canvases: FakeCanvas[] = [];

function renderModal(over: Partial<InventoryItem> = {}, props: { baseLooksLocal?: boolean } = {}) {
  render(<ItemLabelModal item={{ ...item, ...over }} baseUrl={BASE} baseLooksLocal={props.baseLooksLocal} onClose={vi.fn()} />);
}

const exportBtn = () => screen.getByTestId("export-label-pdf");

describe("物料标签：导出 PDF", () => {
  beforeEach(() => {
    pdfMock.saved.length = 0;
    pdfMock.images.length = 0;
    canvases = installFakeCanvas();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("点击导出会调 PDF 库的 save，文件名 = {code}.pdf，并画入短链二维码", async () => {
    renderModal();
    fireEvent.click(exportBtn());

    await waitFor(() => { expect(pdfMock.saved).toEqual([`${CODE}.pdf`]); });
    // 嵌进 PDF 的是 canvas 出的 PNG（url 满版图）
    expect(pdfMock.images[0]).toMatch(/^data:image\/png/);

    // 二维码 payload 必须是弹窗里那条短链（扫码直接进系统看这件物料）
    const painted = canvases.at(-1);
    expect(painted).not.toBeNull();
    expect(decodeQr(painted!, {
      x: QR_RECT_MM.x * PX_PER_MM, y: QR_RECT_MM.y * PX_PER_MM, size: QR_RECT_MM.size * PX_PER_MM,
    })).toBe(`${BASE}/i/${CODE}`);
  });

  it("没有编码的物料：导出按钮禁用，点了也不会下载", async () => {
    renderModal({ code: undefined });
    expect(exportBtn()).toBeDisabled();
    fireEvent.click(exportBtn());
    await waitFor(() => { expect(pdfMock.saved).toHaveLength(0); });
  });

  it("不影响原有打印路径：打印按钮仍在且仍调用 window.print()", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /打印/ }));
    expect(print).toHaveBeenCalledTimes(1);
    // 导出按钮与打印按钮并存
    expect(exportBtn()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制短链" })).toBeInTheDocument();
  });

  it("本机地址警告照旧显示，导出不会削弱它", () => {
    renderModal({}, { baseLooksLocal: true });
    expect(screen.getByTestId("local-base-warning")).toBeInTheDocument();
    expect(exportBtn()).toBeInTheDocument();
  });
});
