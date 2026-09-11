import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WikiDocRecovery } from "@/components/wiki/WikiDocRecovery";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockPost = vi.mocked(api.post as (url: string, body: unknown) => Promise<unknown>);

const diagnostics = {
  targetFolder: "公共",
  projectName: "wiki1",
  projectDir: "公共/wiki1",
  kbRoot: "/data/knowledge",
  workspacePath: "/tmp/teamportal-wiki/abc/repo",
  workspaceExists: true,
  documents: [
    { path: "getting-started/installation", relativeFile: "公共/wiki1/getting-started/installation.md", exists: false, historyVersions: 2 },
    { path: "api/reference", relativeFile: "公共/wiki1/api/reference.md", exists: true, historyVersions: 0 },
  ],
  missing: ["getting-started/installation"],
  recoverableFromHistory: ["getting-started/installation"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(diagnostics);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("Wiki 文档恢复面板", () => {
  it("显示文档在服务器上的确切位置与可恢复信息", async () => {
    render(<WikiDocRecovery taskId="t1" projectName="wiki1" docPath="getting-started/installation" onRecovered={() => {}} />);

    expect(await screen.findByText("/data/knowledge/公共/wiki1/getting-started/installation.md")).toBeInTheDocument();
    expect(screen.getByText("公共/wiki1")).toBeInTheDocument();
    expect(screen.getByText(/缺失 1 篇，其中 1 篇可零成本恢复/)).toBeInTheDocument();
    expect(screen.getByText(/源码工作区仍在/)).toBeInTheDocument();
  });

  it("「从历史版本恢复」走 restore-from-history 且说明不花钱", async () => {
    mockPost.mockResolvedValue({ message: "已从历史版本恢复 1 篇文档（未调用 AI，无费用）" });
    const onRecovered = vi.fn();
    render(<WikiDocRecovery taskId="t1" projectName="wiki1" docPath="getting-started/installation" onRecovered={onRecovered} />);
    await screen.findByText(/\/data\/knowledge/);

    fireEvent.click(screen.getByRole("button", { name: /从历史版本恢复/ }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/api/wiki/tasks/t1/restore-from-history", {})
    );
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain("不产生任何费用");
    expect(onRecovered).toHaveBeenCalled();
  });

  it("「补齐缺失文档」走 retry-missing（只补缺失，不重跑）", async () => {
    mockPost.mockResolvedValue({ message: "已补齐 1 篇文档" });
    render(<WikiDocRecovery taskId="t1" projectName="wiki1" docPath="getting-started/installation" onRecovered={() => {}} />);
    await screen.findByText(/\/data\/knowledge/);

    fireEvent.click(screen.getByRole("button", { name: /补齐缺失文档/ }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/api/wiki/tasks/t1/retry-missing", {})
    );
    const text = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(text).toContain("不需要重新下载源码");
  });

  it("没有历史版本时给出可执行的提示，而不是空按钮", async () => {
    mockGet.mockResolvedValue({ ...diagnostics, recoverableFromHistory: [] });
    render(<WikiDocRecovery taskId="t1" projectName="wiki1" docPath="getting-started/installation" onRecovered={() => {}} />);
    await screen.findByText(/\/data\/knowledge/);

    fireEvent.click(screen.getByRole("button", { name: /从历史版本恢复/ }));

    expect(await screen.findByText(/没有可从历史版本恢复的文档/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
