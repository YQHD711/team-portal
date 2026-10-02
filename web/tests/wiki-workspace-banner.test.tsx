import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WikiWorkspaceBanner } from "@/components/wiki/WikiWorkspaceBanner";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockPost = vi.mocked(api.post as (url: string, body: unknown, timeoutMs?: number) => Promise<unknown>);

const lost = { workspaceExists: false, workspacePath: null };
const alive = { workspaceExists: true, workspacePath: "/data/wiki/t1/repo" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("源码工作区丢失提示", () => {
  it("workspaceExists=false 时显示提示与「重新克隆」入口", async () => {
    mockGet.mockResolvedValue(lost);

    render(<WikiWorkspaceBanner taskId="t1" projectName="wiki1" />);

    expect(await screen.findByText(/源码工作区已丢失/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新克隆源码/ })).toBeInTheDocument();
  });

  it("workspaceExists=true 时不打扰用户", async () => {
    mockGet.mockResolvedValue(alive);

    render(<WikiWorkspaceBanner taskId="t1" projectName="wiki1" />);

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/api/wiki/tasks/t1/diagnose"));
    expect(screen.queryByText(/源码工作区已丢失/)).not.toBeInTheDocument();
  });

  it("「重新克隆」走 reclone 接口、确认框说明不花钱，成功后提示消失", async () => {
    mockGet.mockResolvedValueOnce(lost).mockResolvedValueOnce(alive);
    mockPost.mockResolvedValue({ message: "源码已就绪，可浏览目录与文件" });

    render(<WikiWorkspaceBanner taskId="t1" projectName="wiki1" />);
    fireEvent.click(await screen.findByRole("button", { name: /重新克隆源码/ }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/api/wiki/tasks/t1/reclone", {}, 300_000));
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain("不产生任何费用");
    // 诊断再次返回 workspaceExists=true → 提示条消失
    await waitFor(() => expect(screen.queryByText(/源码工作区已丢失/)).not.toBeInTheDocument());
  });

  it("用户取消时不发请求、提示保留", async () => {
    mockGet.mockResolvedValue(lost);
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<WikiWorkspaceBanner taskId="t1" projectName="wiki1" />);
    fireEvent.click(await screen.findByRole("button", { name: /重新克隆源码/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /重新克隆源码/ })).toBeEnabled());
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByText(/源码工作区已丢失/)).toBeInTheDocument();
  });

  it("克隆结束但工作区仍不可用时如实报告，不假报成功", async () => {
    mockGet.mockResolvedValue(lost);
    mockPost.mockResolvedValue({ message: "源码已就绪" });

    render(<WikiWorkspaceBanner taskId="t1" projectName="wiki1" />);
    fireEvent.click(await screen.findByRole("button", { name: /重新克隆源码/ }));

    expect(await screen.findByText(/工作区仍不可用/)).toBeInTheDocument();
  });
});
