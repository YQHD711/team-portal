import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import KnowledgeAdminPage from "@/app/(protected)/admin/knowledge/page";
import { api } from "@/lib/api";

/**
 * `?path=` 深链接分流（全局搜索跳知识库走的就是这条）：
 * 文本 → 编辑器；非文本文件 → 鉴权下载；目录 → 展开并打开首个可编辑文档；找不到 → 明确提示（不静默）。
 *
 * 回归背景：非文本深链接以前也走 openFileAt（当文本去 GET content）→ PDF 既不下载也不报错，**毫无反应**。
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
const MD = "公共/Pixhawk标准/README.md";
const DIR = "公共/Pixhawk标准";
const EMPTY_DIR = "公共/空目录";
const tree = [{
  name: "公共", type: "folder", path: "公共", children: [
    {
      name: "Pixhawk标准", type: "folder", path: DIR, children: [
        { name: "DS-009 Pixhawk Connector Standard", type: "file", path: PDF, extra: { ext: ".pdf" } },
        { name: "README", type: "file", path: MD, extra: { ext: ".md" } },
      ],
    },
    { name: "空目录", type: "folder", path: EMPTY_DIR, children: [] },
  ],
}];

const contentCalls = () => mockedGet.mock.calls.filter(c => String(c[0]).includes("/api/knowledge/content"));
const goto = (path: string) => window.history.pushState({}, "", `/admin/knowledge?path=${encodeURIComponent(path)}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockedDownload.mockResolvedValue(new Blob(["%PDF-"], { type: "application/pdf" }));
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/knowledge/tree") return tree;
    if (endpoint.startsWith("/api/knowledge/content")) return { content: "# 文档" };
    return {};
  });
  window.history.pushState({}, "", "/admin/knowledge");
});
afterEach(() => vi.restoreAllMocks());

describe("?path= 深链接：非文本文件走下载", () => {
  it("?path=<pdf> → api.download 打对端点、文件名 = path 末段，且**不**去读 content", async () => {
    goto(PDF);
    render(<KnowledgeAdminPage />);

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    expect(mockedDownload.mock.calls[0][0]).toBe(`/api/knowledge/download?path=${encodeURIComponent(PDF)}`);
    await waitFor(() => expect(saveBlobMock).toHaveBeenCalledTimes(1));
    expect(saveBlobMock.mock.calls[0][1]).toBe("DS-009 Pixhawk Connector Standard.pdf");
    expect(contentCalls()).toHaveLength(0);   // 别把 PDF 当文本读
  });

  it("下载用的是**完整真实 path**（树里显示名不带扩展名）", async () => {
    goto(PDF);
    render(<KnowledgeAdminPage />);

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    expect(String(mockedDownload.mock.calls[0][0])).toContain(encodeURIComponent(".pdf"));
    expect(String(mockedDownload.mock.calls[0][0])).not.toContain(encodeURIComponent("DS-009 Pixhawk Connector Standard&"));
  });
});

describe("?path= 深链接：文本文件照旧进编辑器", () => {
  it("?path=<.md> → 读 content、不下载（回归）", async () => {
    goto(MD);
    render(<KnowledgeAdminPage />);

    await waitFor(() => expect(contentCalls()).toHaveLength(1));
    expect(String(contentCalls()[0][0])).toBe(`/api/knowledge/content?path=${encodeURIComponent(MD)}`);
    expect(mockedDownload).not.toHaveBeenCalled();
    expect(saveBlobMock).not.toHaveBeenCalled();
  });
});

describe("?path= 深链接：目录保留旧行为（展开 + 打开首个可编辑文档，不下载）", () => {
  it("?path=<目录> → 展开并把里面第一个可编辑文档读进编辑器", async () => {
    goto(DIR);
    render(<KnowledgeAdminPage />);

    await waitFor(() => expect(contentCalls()).toHaveLength(1));
    expect(String(contentCalls()[0][0])).toContain(encodeURIComponent(MD));
    expect(mockedDownload).not.toHaveBeenCalled();
    // 展开：目录下的文件节点出现在树里
    expect(await screen.findByText("README")).toBeInTheDocument();
  });

  it("?path=<空目录> → 提示「下还没有文档」，不下载", async () => {
    goto(EMPTY_DIR);
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText(/下还没有文档/)).toBeInTheDocument();
    expect(mockedDownload).not.toHaveBeenCalled();
    expect(contentCalls()).toHaveLength(0);
  });
});

describe("?path= 深链接：找不到时不静默", () => {
  it("树里不存在的 .pdf → 可读提示、不下载、不崩", async () => {
    goto("公共/Pixhawk标准/已经被删掉的.pdf");
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText(/没找到「公共\/Pixhawk标准\/已经被删掉的.pdf」/)).toBeInTheDocument();
    expect(screen.getByText(/可能已被移动或删除/)).toBeInTheDocument();
    expect(mockedDownload).not.toHaveBeenCalled();
    expect(screen.getByText("资料管理")).toBeInTheDocument();
  });

  it("树里不存在的目录路径（不带扩展名）→ 也有可读提示", async () => {
    goto("公共/不存在的目录");
    render(<KnowledgeAdminPage />);

    expect(await screen.findByText(/没找到「公共\/不存在的目录」/)).toBeInTheDocument();
    expect(mockedDownload).not.toHaveBeenCalled();
  });
});
