import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StudyPage from "@/app/(protected)/study/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
// MarkdownRenderer 会按需动态加载 mermaid/语法高亮，单测里换成纯文本占位
vi.mock("@/components/knowledge/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

const OVERVIEW = "飞训部/学习库/_学习路径.md";
const LESSON = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const contentUrl = (p: string) => `/api/knowledge/content?path=${encodeURIComponent(p)}`;

function scope(canEdit: boolean) {
  return {
    scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit,
    overviewPath: OVERVIEW,
    stages: [
      {
        title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit, descriptionPath: null,
        lessons: [{ title: "认识航模", path: LESSON, canEdit }],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/study/library") return { scopes: [scope(false)] };
    if (endpoint.startsWith("/api/knowledge/content")) return { content: "# 正文内容" };
    return {};
  });
});

describe("学习库页", () => {
  it("渲染阶段与课时，并默认加载「_学习路径」总览", async () => {
    render(<StudyPage />);

    expect(await screen.findByRole("heading", { name: "学习库" })).toBeInTheDocument();
    expect(screen.getByText("入门筑基")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /认识航模/ })).toBeInTheDocument();

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(OVERVIEW)));
    expect(await screen.findByTestId("md")).toHaveTextContent("正文内容");
  });

  it("点击课时加载对应正文（正文仍走知识库接口，权限同一套）", async () => {
    render(<StudyPage />);

    fireEvent.click(await screen.findByRole("button", { name: /认识航模/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON)));
  });

  it("没有编辑权限时不给编辑入口", async () => {
    render(<StudyPage />);

    await screen.findByText("入门筑基");
    expect(screen.queryByRole("link", { name: /编辑/ })).not.toBeInTheDocument();
  });

  it("有编辑权限时跳到知识库编辑器（不重写编辑器）", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/study/library") return { scopes: [scope(true)] };
      if (endpoint.startsWith("/api/knowledge/content")) return { content: "x" };
      return {};
    });
    render(<StudyPage />);

    const edit = await screen.findByRole("link", { name: /编辑/ });

    expect(edit).toHaveAttribute("href", `/admin/knowledge?path=${encodeURIComponent("飞训部/学习库")}`);
  });

  it("还没有学习库时给出目录约定说明", async () => {
    mockedGet.mockImplementation(async () => ({ scopes: [] }));
    render(<StudyPage />);

    expect(await screen.findByText(/还没有学习库内容/)).toBeInTheDocument();
    expect(screen.getByText(/一级子目录 = 阶段/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /去知识库创建/ })).toBeInTheDocument();
  });
});
