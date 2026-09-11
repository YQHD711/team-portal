import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TaskQueue, isActiveTask, type WikiTaskInfo } from "@/components/wiki/TaskQueue";
import WikiImportPage from "@/app/(protected)/wiki/import/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);

const baseTask: WikiTaskInfo = {
  id: "t1", type: "git", projectName: "ardupilot", status: "documents", visibility: "public",
  errorMessage: null, createdAt: new Date(Date.now() - 65_000).toISOString(), completedAt: null,
  progress: { stage: "documents", done: 3, total: 12, note: "飞控驱动", updatedAt: new Date().toISOString() },
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockGet.mockResolvedValue([]);
});

// 失败路径也要还原真实定时器，否则后续用例会一起挂住
afterEach(() => {
  vi.useRealTimers();
});

describe("Wiki 任务进度", () => {
  it("文档阶段显示确定态进度：完成数/总数 + 当前文档", () => {
    render(<TaskQueue tasks={[baseTask]} isStaff={false} onRefresh={() => {}} onDelete={() => {}} />);

    const bar = screen.getByRole("progressbar", { name: "ardupilot 生成进度" });
    expect(bar).toHaveAttribute("aria-valuenow", "25"); // 3/12
    expect(screen.getByText(/3 \/ 12/)).toBeInTheDocument();
    expect(screen.getByText(/飞控驱动/)).toBeInTheDocument();
  });

  it("展示阶段步骤条，当前阶段高亮", () => {
    render(<TaskQueue tasks={[baseTask]} isStaff={false} onRefresh={() => {}} onDelete={() => {}} />);

    for (const label of ["准备", "目录", "文档", "审查", "完成"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 当前阶段「文档」带高亮态，已走过的「准备/目录」用成功色
    expect(screen.getByText("文档").className).toContain("text-sky-600");
    expect(screen.getByText("准备").className).toContain("text-success");
  });

  it("没有可数单元的阶段（如目录生成）显示不确定态，不假装有百分比", () => {
    const catalogTask: WikiTaskInfo = {
      ...baseTask, status: "catalog",
      progress: { stage: "catalog", done: 0, total: 0, note: "AI 正在规划目录结构", updatedAt: "" },
    };
    render(<TaskQueue tasks={[catalogTask]} isStaff={false} onRefresh={() => {}} onDelete={() => {}} />);

    const bar = screen.getByRole("progressbar", { name: "ardupilot 生成进度" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText(/AI 正在规划目录结构/)).toBeInTheDocument();
  });

  it("已完成任务显示 100%，翻译任务用翻译阶段条", () => {
    const done: WikiTaskInfo = {
      ...baseTask, type: "translate", status: "completed", completedAt: new Date().toISOString(),
      progress: { stage: "completed", done: 8, total: 8, note: null, updatedAt: "" },
    };
    render(<TaskQueue tasks={[done]} isStaff={false} onRefresh={() => {}} onDelete={() => {}} />);

    expect(screen.getByRole("progressbar", { name: "ardupilot 生成进度" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("翻译")).toBeInTheDocument();
    expect(screen.queryByText("审查")).not.toBeInTheDocument();
  });

  it("失败任务保留错误信息并标红当前阶段", () => {
    const failed: WikiTaskInfo = {
      ...baseTask, status: "failed", errorMessage: "AI 调用失败",
      progress: { stage: "documents", done: 3, total: 12, note: null, updatedAt: "" },
    };
    render(<TaskQueue tasks={[failed]} isStaff={false} onRefresh={() => {}} onDelete={() => {}} />);

    expect(screen.getByText("AI 调用失败")).toBeInTheDocument();
    expect(screen.getByText("文档").className).toContain("text-danger");
  });

  it("isActiveTask 只把进行中的状态算作活跃（决定要不要轮询）", () => {
    expect(isActiveTask("pending")).toBe(true);
    expect(isActiveTask("documents")).toBe(true);
    expect(isActiveTask("translating")).toBe(true);
    expect(isActiveTask("completed")).toBe(false);
    expect(isActiveTask("failed")).toBe(false);
  });
});

describe("Wiki 导入页", () => {
  it("有进行中的任务时自动轮询（此前必须手点刷新）", async () => {
    vi.useFakeTimers();
    mockGet.mockImplementation((url: string) => {
      if (url === "/api/wiki/tasks") return Promise.resolve([baseTask]);
      return Promise.resolve({});
    });

    render(<WikiImportPage />);
    // 首屏请求：用 advance(0) 把微任务刷干净（fake timers 下 waitFor 不工作）
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const initial = mockGet.mock.calls.filter(c => c[0] === "/api/wiki/tasks").length;
    expect(initial).toBeGreaterThan(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    const after = mockGet.mock.calls.filter(c => c[0] === "/api/wiki/tasks").length;
    expect(after).toBeGreaterThan(initial);
  });

  it("生成模型是可自由填写的输入框（不是下拉），且提示常用名", async () => {
    render(<WikiImportPage />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    const input = screen.getByLabelText("生成模型");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("list"); // datalist 建议

    fireEvent.change(input, { target: { value: "my-custom-model-7b" } });
    expect(input).toHaveValue("my-custom-model-7b");
  });
});
