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

const LESSON1 = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const LESSON2 = "飞训部/学习库/01-入门筑基/02-安全规范.md";
const contentUrl = (p: string) => `/api/knowledge/content?path=${encodeURIComponent(p)}`;

function scope(canEdit: boolean) {
  return {
    scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit,
    overviewPath: "飞训部/学习库/_学习路径.md",
    overview: "从零开始，学完能自己飞。",
    duration: "2-3 周", goal: "能独立完成一次起降",
    stages: [
      {
        title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit,
        descriptionPath: "飞训部/学习库/01-入门筑基/_阶段说明.md",
        description: "本阶段把术语和原理过一遍。", duration: "1 周", goal: "知道机翼为什么产生升力",
        lessons: [
          { title: "认识航模", path: LESSON1, canEdit },
          { title: "安全规范", path: LESSON2, canEdit },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/study/library") return { scopes: [scope(false)] };
    if (endpoint.startsWith("/api/knowledge/content")) return { content: "## 正文\n\n内容" };
    return {};
  });
});

describe("学习库页", () => {
  it("默认展示学习路径：阶段卡片带时长/目标/课时清单", async () => {
    render(<StudyPage />);

    expect(await screen.findByRole("heading", { name: "学习库" })).toBeInTheDocument();
    expect(screen.getByText("入门筑基")).toBeInTheDocument();
    expect(screen.getByText("1 周")).toBeInTheDocument();                   // 阶段时长
    expect(screen.getByText("2-3 周")).toBeInTheDocument();                 // 总览时长
    expect(screen.getByText("知道机翼为什么产生升力")).toBeInTheDocument();   // 阶段目标
    expect(screen.getByText(/能独立完成一次起降/)).toBeInTheDocument();       // 总览目标
    expect(screen.getByRole("button", { name: /认识航模/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /安全规范/ })).toBeInTheDocument();
    // 总览不再逐份拉正文（阶段说明随结构一起下发）
    expect(mockedGet).not.toHaveBeenCalledWith(expect.stringContaining("/api/knowledge/content"));
  });

  it("阶段说明真的被渲染出来（此前只有路径、没有正文）", async () => {
    render(<StudyPage />);

    await screen.findByText("入门筑基");
    const rendered = screen.getAllByTestId("md").map(n => n.textContent).join("|");
    expect(rendered).toContain("本阶段把术语和原理过一遍");
  });

  it("点击课时进入阅读页：调正文接口并显示进度与下一课", async () => {
    render(<StudyPage />);

    fireEvent.click(await screen.findByRole("button", { name: /认识航模/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON1)));
    expect(await screen.findByText(/第 1 \/ 2 课/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下一课/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /上一课/ })).not.toBeInTheDocument();   // 第一课没有上一课
  });

  it("下一课按学习路径顺序前进", async () => {
    render(<StudyPage />);

    fireEvent.click(await screen.findByRole("button", { name: /认识航模/ }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON1)));

    fireEvent.click(screen.getByRole("button", { name: /下一课/ }));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(contentUrl(LESSON2)));
    expect(await screen.findByText(/第 2 \/ 2 课/)).toBeInTheDocument();
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

    const edit = await screen.findByRole("link", { name: /编辑本库/ });

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
