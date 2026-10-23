import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { LabelData, LabelTemplate } from "@/lib/labelTemplate";
import { NiimbotError } from "@/lib/niimbot/errors";
import NiimbotPrintPanel from "@/components/inventory/NiimbotPrintPanel";

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  connect: vi.fn(),
  preview: vi.fn(),
  print: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/lib/niimbot", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/niimbot")>();
  class MockNiimbotPrinter {
    constructor() { mocks.constructed(); }
    connect = mocks.connect;
    preview = mocks.preview;
    print = mocks.print;
    disconnect = mocks.disconnect;
  }
  return { ...actual, NiimbotPrinter: MockNiimbotPrinter };
});

const data: LabelData = {
  code: "BAT-001", url: "https://team.example.com/i/BAT-001", name: "电池",
  grade: "A", locationCode: "201-A-3-05", category: "电池电源",
};

const template: LabelTemplate = {
  id: 1, name: "K3W 50×30", widthMm: 50, heightMm: 30, dpi: 200, background: "#FFFFFF",
  elements: [{ id: "qr", type: "qr", x: 2, y: 2, w: 20, h: 20 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ name: "NIIMBOT K3W", port: 1 });
  mocks.preview.mockResolvedValue("data:image/png;base64,QUJD");
  mocks.print.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("精臣 K3W 直连打印区块", () => {
  it("渲染时不自动连接（用户必须显式点）", () => {
    render(<NiimbotPrintPanel template={template} data={data} />);

    expect(mocks.constructed).not.toHaveBeenCalled();
    expect(screen.getByTestId("niimbot-status")).toHaveTextContent("未连接");
    expect(screen.getByTestId("niimbot-print")).toBeDisabled();
  });

  it("点击连接 → 显示已连接设备名；随后可打印", async () => {
    render(<NiimbotPrintPanel template={template} data={data} />);

    fireEvent.click(screen.getByTestId("niimbot-connect"));
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("niimbot-status")).toHaveTextContent("已连接"));
    expect(screen.getByTestId("niimbot-status")).toHaveTextContent("NIIMBOT K3W");

    fireEvent.click(screen.getByTestId("niimbot-print"));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("niimbot-progress")).toHaveTextContent("打印完成"));
    const [page, options] = mocks.print.mock.calls[0];
    expect(page.InitDrawingBoardParam).toMatchObject({ width: 50, height: 30 });
    expect(options.copies).toBe(1);
  });

  it("连接失败：显示可执行提示与导出 PDF 退路", async () => {
    mocks.connect.mockRejectedValue(new NiimbotError("service", "无法连接本机打印服务", {
      recovery: "1) 确认打印服务已启动\n2) 或改用「导出 PDF」打印",
    }));
    render(<NiimbotPrintPanel template={template} data={data} />);

    fireEvent.click(screen.getByTestId("niimbot-connect"));

    await waitFor(() => expect(screen.getByTestId("niimbot-error")).toBeInTheDocument());
    expect(screen.getByTestId("niimbot-status")).toHaveTextContent("连接失败");
    expect(screen.getByTestId("niimbot-error")).toHaveTextContent("无法连接本机打印服务");
    expect(screen.getByTestId("niimbot-error")).toHaveTextContent("导出 PDF");
    expect(screen.getByTestId("niimbot-print")).toBeDisabled();
  });

  it("非 50×30 模板给出尺寸提醒", () => {
    render(<NiimbotPrintPanel
      template={{ ...template, widthMm: 80, heightMm: 50, name: "默认 80×50" }} data={data} />);

    expect(screen.getByTestId("niimbot-size-warning")).toHaveTextContent("50×30");
  });
});
