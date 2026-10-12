import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import KnowledgeAdminPage from "@/app/(protected)/admin/knowledge/page";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";

/**
 * 知识库非文本文件下载：必须走 `api.download`（带 Authorization），
 * 而不是 window.open（新标签页发不出 token → 401）。
 */

const saveBlobMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ isStaff: () => true, getToken: () => "t" }));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { role: "admin", username: "u" }, loading: false, refresh: vi.fn() }),
}));
vi.mock("@/lib/download", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/download")>()),
  saveBlob: saveBlobMock,
}));

const mockedGet = vi.mocked(api.get as (e: string) => Promise<unknown>);
const mockedDownload = vi.mocked(api.download as (e: string, o?: unknown) => Promise<Blob>);

const PDF = "公共/Pixhawk标准/DS-009 Pixhawk Connector Standard.pdf";
const tree = [{
  name: "公共", type: "folder", path: "公共", children: [{
    name: "Pixhawk标准", type: "folder", path: "公共/Pixhawk标准", children: [
      { name: "DS-009 Pixhawk Connector Standard", type: "file", path: PDF, extra: { ext: ".pdf" } },
    ],
  }],
}];

const blob = () => new Blob(["pdf-bytes"], { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/knowledge/tree") return tree;
    return {};
  });
  window.history.pushState({}, "", "/admin/knowledge");
});
afterEach(() => vi.restoreAllMocks());

async function openTreeAndClickPdf() {
  render(<KnowledgeAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: "全部展开" }));
  fireEvent.click(screen.getByText("DS-009 Pixhawk Connector Standard"));
}

describe("知识库：PDF 下载走鉴权下载", () => {
  it("点 PDF → api.download 打对端点，并用路径末段当文件名另存", async () => {
    mockedDownload.mockResolvedValue(blob());
    await openTreeAndClickPdf();

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    expect(mockedDownload.mock.calls[0][0]).toBe(`/api/knowledge/download?path=${encodeURIComponent(PDF)}`);
    await waitFor(() => expect(saveBlobMock).toHaveBeenCalledTimes(1));
    expect(saveBlobMock.mock.calls[0][1]).toBe("DS-009 Pixhawk Connector Standard.pdf");
  });

  it("不传会覆盖 idle 的选项（大文件靠 helper 的 idle 超时兜底，页别乱设）", async () => {
    mockedDownload.mockResolvedValue(blob());
    await openTreeAndClickPdf();

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    const options = mockedDownload.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(options)).toEqual(["onProgress"]);   // 没有 timeoutMs / idleMs 覆盖
  });

  it("下载期间显示进度百分比，重复点击不叠加，完成后清空", async () => {
    let release: (b: Blob) => void = () => {};
    mockedDownload.mockImplementation((_endpoint, options) => {
      (options as { onProgress?: (p: { received: number; total: number | null }) => void })
        .onProgress?.({ received: 450, total: 1000 });
      return new Promise<Blob>(resolve => { release = resolve; });
    });

    render(<KnowledgeAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "全部展开" }));
    const node = screen.getByText("DS-009 Pixhawk Connector Standard");
    fireEvent.click(node);
    fireEvent.click(node);   // 重复点击

    await waitFor(() => expect(screen.getByTestId("download-status")).toHaveTextContent("下载中 45%"));
    expect(mockedDownload).toHaveBeenCalledTimes(1);
    expect(saveBlobMock).not.toHaveBeenCalled();

    release(blob());
    await waitFor(() => expect(screen.queryByTestId("download-status")).not.toBeInTheDocument());
    expect(saveBlobMock).toHaveBeenCalledTimes(1);
  });

  it("total 为 null：显示不确定态（已收体积）且不崩", async () => {
    let release: (b: Blob) => void = () => {};
    mockedDownload.mockImplementation((_endpoint, options) => {
      (options as { onProgress?: (p: { received: number; total: number | null }) => void })
        .onProgress?.({ received: 2048, total: null });
      return new Promise<Blob>(resolve => { release = resolve; });
    });
    await openTreeAndClickPdf();

    await waitFor(() => expect(screen.getByTestId("download-status")).toHaveTextContent(/下载中/));
    expect(screen.getByTestId("download-status")).toHaveTextContent("KB");
    release(blob());
    await waitFor(() => expect(screen.queryByTestId("download-status")).not.toBeInTheDocument());
  });

  it("401（登录过期）：api.download 已接管跳登录，页面不再弹「下载失败」", async () => {
    mockedDownload.mockRejectedValue(new Error("登录已过期，请重新登录"));
    await openTreeAndClickPdf();

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("download-status")).not.toBeInTheDocument());
    expect(screen.queryByText(/下载失败/)).not.toBeInTheDocument();
    expect(saveBlobMock).not.toHaveBeenCalled();
    expect(screen.getByText("资料管理")).toBeInTheDocument();   // 页面没崩
  });

  it("其它错误：给可读提示", async () => {
    mockedDownload.mockRejectedValue(new Error("文档不存在"));
    await openTreeAndClickPdf();

    await waitFor(() => expect(screen.getByTestId("download-status")).toHaveTextContent("下载失败：文档不存在"));
  });
});
