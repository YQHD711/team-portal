import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TrashPage from "@/app/(protected)/admin/trash/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("confirm", vi.fn(() => true)); });

/**
 * 回收站里每一条都要能一眼看出「这是什么」。
 * 新加的删除类型（知识库文档/目录、wiki 项目、共享文件）如果不登记标签，
 * badge 会直接显示英文表名（KnowledgePath / WikiTask），管理员看不懂。
 */
describe("回收站 · 类型标签", () => {
  it("新增的删除类型显示中文标签，而不是英文表名", async () => {
    mockedGet.mockResolvedValue({
      items: [
        { id: 1, originalTable: "KnowledgePath", originalId: 0, title: "知识库：公共/资料/说明.md", dataJson: "{}", deletedByName: "admin", deletedAt: "2026-09-27T10:00:00Z" },
        { id: 2, originalTable: "WikiTask", originalId: 0, title: "Wiki 项目：ardupilot", dataJson: "{}", deletedByName: "admin", deletedAt: "2026-09-27T10:01:00Z" },
      ],
      total: 2,
    });

    render(<TrashPage />);

    expect(await screen.findByText("知识库文档")).toBeInTheDocument();
    expect(screen.getByText("Wiki 项目")).toBeInTheDocument();
    expect(screen.getByText("知识库：公共/资料/说明.md")).toBeInTheDocument();
    expect(screen.queryByText("KnowledgePath")).not.toBeInTheDocument();
  });
});
