import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RagStatsCard } from "@/components/admin/RagStatsCard";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);

const statsPayload = {
  days: 7,
  searchCount: 20,
  emptyCount: 9,
  emptyRatePct: 45,
  returnedTotal: 31,
  recentEmpty: [
    { query: "量子纠缠推进器", at: "2026-10-10T02:00:00Z" },
    { query: "工程部怎么学", at: "2026-10-09T02:00:00Z" },
  ],
  contextCount: 20,
  avgContextChars: 812.5,
  avgUsedDocs: 2.5,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(statsPayload);
});

describe("AI 检索统计卡片", () => {
  it("显示空转率、检索次数与最近空结果提问", async () => {
    render(<RagStatsCard />);

    expect(await screen.findByTestId("rag-empty-rate")).toHaveTextContent("45.0");
    expect(screen.getByText("检索次数")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("空结果次数")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getAllByTestId("rag-recent-empty")[0]).toHaveTextContent("量子纠缠推进器");
    expect(screen.getByText("2.5")).toBeInTheDocument();   // 平均注入文档数
  });

  it("近 7 天没有检索记录时给出说明，而不是显示 0.0% 骗自己", async () => {
    mockGet.mockResolvedValue({ ...statsPayload, searchCount: 0, emptyCount: 0, emptyRatePct: 0, recentEmpty: [] });

    render(<RagStatsCard />);

    expect(await screen.findByText(/暂无检索记录/)).toBeInTheDocument();
    expect(screen.queryByTestId("rag-empty-rate")).not.toBeInTheDocument();
  });

  it("有空结果但最近没有时，明确说都命中了", async () => {
    mockGet.mockResolvedValue({ ...statsPayload, recentEmpty: [] });

    render(<RagStatsCard />);

    expect(await screen.findByText(/中文提问都命中到了资料/)).toBeInTheDocument();
  });

  it("接口失败时显示错误而不是空白", async () => {
    mockGet.mockRejectedValue(new Error("HTTP 403"));

    render(<RagStatsCard />);

    expect(await screen.findByText(/无法获取检索统计：HTTP 403/)).toBeInTheDocument();
  });
});
