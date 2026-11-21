import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { InventoryItem } from "@/components/inventory/inventoryTypes";
import ItemLabelModal from "@/components/inventory/ItemLabelModal";

const BASE = "http://8.137.161.160:3000";
const CODE = "BAT-LIPO-6S3300MAH-2026-0007";
const item: InventoryItem = {
  id: 1, name: "6S 3300mAh 锂电池", category: "电池电源", quantity: 3, code: CODE,
  locationCode: "1012-A-1-01", status: "available", grade: "A", unitPrice: 320, updatedAt: "2026-09-01T10:00:00Z",
};

function renderModal(over: Partial<InventoryItem> = {}, props: { baseLooksLocal?: boolean } = {}) {
  render(<ItemLabelModal item={{ ...item, ...over }} baseUrl={BASE} baseLooksLocal={props.baseLooksLocal} onClose={vi.fn()} />);
}

/** 系统已移除导出 PDF 与浏览器打印：物料标签只保留直连打印（精臣 K3W）。 */
describe("物料标签：只走直连打印", () => {
  it("渲染预览、模板选择、直连打印面板与复制短链", () => {
    renderModal();
    expect(screen.getByTestId("item-label-modal")).toBeInTheDocument();
    expect(screen.getByText(CODE)).toBeInTheDocument();
    expect(screen.getByTestId("label-template-select")).toBeInTheDocument();
    expect(screen.getByTestId("niimbot-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制短链" })).toBeInTheDocument();
  });

  it("不再提供导出 PDF 与浏览器打印按钮", () => {
    renderModal();
    expect(screen.queryByTestId("export-label-pdf")).toBeNull();
    expect(screen.queryByRole("button", { name: "打印" })).toBeNull();
  });

  it("本机地址警告照旧显示", () => {
    renderModal({}, { baseLooksLocal: true });
    expect(screen.getByTestId("local-base-warning")).toBeInTheDocument();
  });
});
