import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarkdownRenderer } from "@/components/knowledge/MarkdownRenderer";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockDownload = vi.mocked(api.download as (url: string) => Promise<Blob>);

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 没有 createObjectURL
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
});

const DOC = "电子部/学习库/01-编程语言基础/01-C++入门与实践.md";

describe("Markdown 图片", () => {
  it("相对图片按文档目录解析，并带鉴权取回（<img> 发不出 Authorization）", async () => {
    mockDownload.mockResolvedValue(new Blob(["x"], { type: "image/png" }));

    render(<MarkdownRenderer content={"![接线示意](接线示意.png)"} docPath={DOC} />);

    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    expect(mockDownload.mock.calls[0][0]).toBe(
      "/api/knowledge/download?path=" + encodeURIComponent("电子部/学习库/01-编程语言基础/接线示意.png"),
    );
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", "blob:mock-url");
    expect(img).toHaveAttribute("alt", "接线示意");
    // alt 不是文件名 → 当图注显示
    expect(screen.getByText("接线示意")).toBeInTheDocument();
  });

  it("外链图片直接引用，不走鉴权下载", async () => {
    render(<MarkdownRenderer content={"![外图](https://cdn.example.com/a.png)"} docPath={DOC} />);

    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/a.png");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("读取失败时给可定位的占位（含解析出的知识库路径），不静默空白", async () => {
    mockDownload.mockRejectedValue(new Error("HTTP 404"));

    render(<MarkdownRenderer content={"![丢了](不存在.png)"} docPath={DOC} />);

    expect(await screen.findByText("图片加载失败")).toBeInTheDocument();
    expect(screen.getByText(/知识库路径：电子部\/学习库\/01-编程语言基础\/不存在\.png/)).toBeInTheDocument();
  });

  it("alt 是文件名时不显示图注", async () => {
    mockDownload.mockResolvedValue(new Blob(["x"]));
    render(<MarkdownRenderer content={"![a.png](a.png)"} docPath={DOC} />);

    await screen.findByRole("img");
    expect(screen.queryByText("a.png")).not.toBeInTheDocument();
  });
});

describe("Markdown 链接", () => {
  it("外链标蓝 + 新窗口 + noopener", () => {
    render(<MarkdownRenderer content={"[ArduPilot 文档](https://ardupilot.org/plane/docs/)"} />);

    const a = screen.getByRole("link", { name: /ArduPilot 文档/ });
    expect(a).toHaveAttribute("href", "https://ardupilot.org/plane/docs/");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(a.className).toContain("text-blue-600");
  });

  it("站内锚点不加 target（回到自己页面跳转）", () => {
    render(<MarkdownRenderer content={"[跳到第二节](#第二节)"} />);

    const a = screen.getByRole("link", { name: "跳到第二节" });
    // react-markdown 会做 URL 编码；解码后仍是同一个锚点（浏览器按解码后的片段匹配 id）
    expect(decodeURIComponent(a.getAttribute("href") ?? "")).toBe("#第二节");
    expect(a).not.toHaveAttribute("target");
  });
});
