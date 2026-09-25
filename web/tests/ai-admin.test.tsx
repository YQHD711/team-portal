import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AIAdminPage from "@/app/(protected)/admin/ai-admin/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockPost = vi.mocked(api.post as (url: string, body: unknown, timeout?: number) => Promise<unknown>);

const tools = [
  { name: "get_system_health", description: "系统健康总览：数据库连通性、日志写入通道积压。" },
  { name: "read_logs", description: "读取系统日志（默认最近 24 小时）。" },
];

const guide = [
  { topic: "发布与上线", content: "代码变更不走本系统：AI 运维助手不能改代码、不能编译、不能重启服务。" },
  { topic: "备份与恢复", content: "手动备份：/admin/backup → 立即备份。" },
];

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 没有实现 scrollIntoView（页面加载后会自动滚到底部）
  Element.prototype.scrollIntoView = vi.fn();
  mockGet.mockImplementation((url: string) => {
    if (url.includes("/agent/tools")) return Promise.resolve(tools);
    if (url.includes("/agent/guide")) return Promise.resolve(guide);
    if (url.includes("/agent/memory")) return Promise.resolve({ total: 3, summaries: 0, byRole: [] });
    if (url.includes("/chat/sessions/")) return Promise.resolve([]);
    return Promise.resolve({ busy: false });
  });
  mockPost.mockResolvedValue({ result: "系统正常", stats: { total: 4, summaries: 0, byRole: [] } });
});

describe("AI 系统管理员：只读运维助手", () => {
  it("页面明确声明只读边界，且不再出现代码提案/维护模式入口", async () => {
    render(<AIAdminPage />);

    expect(await screen.findByText("AI 系统管理员")).toBeInTheDocument();
    // 副标题与输入框下方各有一处声明，两处都必须出现
    expect(screen.getByText(/只读运维助手 · 系统诊断 · 排障答疑/)).toBeInTheDocument();
    expect(screen.getByText(/只读助手：不修改数据、不改代码、不编译、不重启服务/)).toBeInTheDocument();

    // 被下线的功能不得留任何入口
    expect(screen.queryByText(/代码提案/)).not.toBeInTheDocument();
    expect(screen.queryByText(/维护模式/)).not.toBeInTheDocument();
    expect(screen.queryByText(/应用（需手动重启）/)).not.toBeInTheDocument();
    expect(screen.queryByText(/变更历史/)).not.toBeInTheDocument();
  });

  it("运维对话的预设任务驱动 /analyze，并把任务原文发出去", async () => {
    render(<AIAdminPage />);

    fireEvent.click(await screen.findByText("排查最近报错"));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe("/api/admin/agent/analyze");
    expect(JSON.stringify(body)).toContain("错误与警告日志");

    expect(await screen.findByText("系统正常")).toBeInTheDocument();
  });

  it("能力与手册 Tab 展示后端下发的工具清单与手册章节", async () => {
    render(<AIAdminPage />);

    fireEvent.click(await screen.findByText("能力与手册"));

    expect(await screen.findByText("get_system_health")).toBeInTheDocument();
    expect(screen.getByText("read_logs")).toBeInTheDocument();
    expect(screen.getByText(/全部只读/)).toBeInTheDocument();

    // 手册章节可展开，内容里写明「改代码不走本系统」
    expect(screen.getByText("发布与上线")).toBeInTheDocument();
    expect(screen.getByText(/不能改代码、不能编译、不能重启服务/)).toBeInTheDocument();
  });
});
