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

const downloadMocks = vi.hoisted(() => ({ download: vi.fn(), saveBlob: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { download: downloadMocks.download } }));
vi.mock("@/lib/download", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/download")>()),
  saveBlob: downloadMocks.saveBlob,
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

const originalMatchMedia = window.matchMedia;

/** jsdom 没实现 matchMedia；用它模拟「移动端 < md」与「桌面」 */
function setViewportMobile(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }) as unknown as MediaQueryList,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ name: "NIIMBOT K3W", port: 1 });
  mocks.preview.mockResolvedValue("data:image/png;base64,QUJD");
  mocks.print.mockResolvedValue(undefined);
  downloadMocks.download.mockResolvedValue(new Blob(["exe"], { type: "application/octet-stream" }));
});
afterEach(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: originalMatchMedia });
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
  vi.restoreAllMocks();
});

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

describe("精臣 K3W 面板 · 折叠与禁用态", () => {
  it("桌面默认展开；点标题可折叠再展开", () => {
    render(<NiimbotPrintPanel template={template} data={data} />);
    const toggle = screen.getByTestId("niimbot-toggle");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("niimbot-panel-body")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("niimbot-panel-body")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("niimbot-panel-body")).toBeInTheDocument();
  });

  it("移动端（<md）默认折叠，标题仍显示状态", async () => {
    setViewportMobile(true);
    render(<NiimbotPrintPanel template={template} data={data} />);

    await waitFor(() => expect(screen.queryByTestId("niimbot-panel-body")).not.toBeInTheDocument());
    expect(screen.getByTestId("niimbot-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("niimbot-status")).toHaveTextContent("未连接");

    fireEvent.click(screen.getByTestId("niimbot-toggle"));
    expect(screen.getByTestId("niimbot-panel-body")).toBeInTheDocument();
  });

  it("下载打印服务安装包：走 api.download（带 JWT），固定文件名", async () => {
    render(<NiimbotPrintPanel template={template} data={data} />);

    fireEvent.click(screen.getByTestId("niimbot-download-service"));

    await waitFor(() => expect(downloadMocks.download).toHaveBeenCalledWith("/api/downloads/print-service"));
    await waitFor(() => expect(downloadMocks.saveBlob).toHaveBeenCalledTimes(1));
    expect(downloadMocks.saveBlob.mock.calls[0][1]).toBe("jcPrinterSdk_4.2.1_20260902.exe");
  });

  it("安装包下载失败：显示可读提示（不是静默失败）", async () => {
    downloadMocks.download.mockRejectedValue(new Error("HTTP 404"));
    render(<NiimbotPrintPanel template={template} data={data} />);

    fireEvent.click(screen.getByTestId("niimbot-download-service"));

    expect(await screen.findByTestId("niimbot-download-error")).toHaveTextContent("下载失败：HTTP 404");
    expect(downloadMocks.saveBlob).not.toHaveBeenCalled();
  });

  it("说明区含 Wi-Fi 配网与驱动常见问题", () => {
    render(<NiimbotPrintPanel template={template} data={data} />);

    expect(screen.getByTestId("niimbot-panel-body")).toHaveTextContent("2.4GHz");
    expect(screen.getByTestId("niimbot-panel-body")).toHaveTextContent("首次配网必须先用 USB 连接");
    expect(screen.getByTestId("niimbot-panel-body")).toHaveTextContent("Win7 需额外安装 K3W 驱动");
  });

  it("未连接：只有「连接打印机」可点，预览/直连打印禁用；连接后启用", async () => {
    render(<NiimbotPrintPanel template={template} data={data} />);

    expect(screen.getByTestId("niimbot-connect")).toBeEnabled();
    expect(screen.getByTestId("niimbot-preview-button")).toBeDisabled();
    expect(screen.getByTestId("niimbot-print")).toBeDisabled();

    fireEvent.click(screen.getByTestId("niimbot-connect"));
    await waitFor(() => expect(screen.getByTestId("niimbot-preview-button")).toBeEnabled());
    expect(screen.getByTestId("niimbot-print")).toBeEnabled();
    expect(screen.getByTestId("niimbot-connect")).toBeDisabled();
  });
});
