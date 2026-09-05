import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import FinancePage from "@/app/(protected)/finance/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: vi.fn(),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedPost = vi.mocked(api.post as (endpoint: string, body: unknown) => Promise<unknown>);
const mockedUseCurrentUser = vi.mocked(useCurrentUser);

const pendingReq = {
  id: 1, itemName: "桨叶", quantity: 2, estimatedPrice: 120, actualPrice: null,
  reason: "训练损耗", status: "pending", requester: { username: "张唐智嘉" },
  approver: null, approvedAt: null, purchasedAt: null, receivedAt: null,
  rejectReason: null, createdAt: "2026-09-01T10:00:00Z",
};

const staffUser = { id: 1, username: "admin", role: "admin", department: null, departmentId: null };
const memberUser = { id: 2, username: "王睿翔", role: "member", department: null, departmentId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/finance/requests" || endpoint === "/api/finance/requests/all") return [pendingReq];
    if (endpoint === "/api/finance/stats") return { pending: 1, approved: 0, purchased: 0, received: 0, totalSpent: 360, thisMonth: 120 };
    if (endpoint.startsWith("/api/finance/report")) return { year: 2026, month: 9, totalRequests: 3, approvedCount: 1, receivedCount: 1, rejectedCount: 0, estimatedTotal: 360, actualTotal: 300, requests: [] };
    return {};
  });
  mockedPost.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("采购审批页", () => {
  it("渲染统计卡片与待审批申请", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<FinancePage />);

    expect(await screen.findByRole("heading", { name: "采购申请" })).toBeInTheDocument();
    // 统计卡片、状态徽章都可能含"桨叶/待审批"文案 → 用 findAll
    expect((await screen.findAllByText("桨叶")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("待审批").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("x2")).toBeInTheDocument();
    expect(screen.getByText("预估 ¥120")).toBeInTheDocument();
    // 统计卡片
    expect(screen.getByText("¥360")).toBeInTheDocument();
  });

  it("admin 可见审批操作按钮，批准时调用审批接口", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<FinancePage />);

    const approveBtn = await screen.findByRole("button", { name: /批准采购/ });
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/finance/requests/1/approve", {})
    );
    // 审批后重新拉取列表
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/finance/requests")
    );
  });

  it("拒绝时要求填写原因并调用拒绝接口", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    const stubPrompt = vi.fn(() => "质量不合格");
    vi.stubGlobal("prompt", stubPrompt);
    render(<FinancePage />);

    const rejectBtn = await screen.findByRole("button", { name: /^拒绝/ });
    fireEvent.click(rejectBtn);

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/finance/requests/1/reject", { reason: "质量不合格" })
    );
  });

  it("拒绝弹窗取消则不提交", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    vi.stubGlobal("prompt", vi.fn(() => null));
    render(<FinancePage />);

    const rejectBtn = await screen.findByRole("button", { name: /^拒绝/ });
    fireEvent.click(rejectBtn);

    // prompt 返回 null → 不应发起拒绝请求
    expect(mockedPost).not.toHaveBeenCalledWith("/api/finance/requests/1/reject", expect.anything());
  });

  it("普通成员看不到审批按钮与管理 Tab", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: memberUser, loading: false, refresh: vi.fn() });
    render(<FinancePage />);

    await screen.findByText("桨叶");
    expect(screen.queryByRole("button", { name: /批准采购/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^拒绝/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部申请" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "月度报表" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我的申请" })).toBeInTheDocument();
  });

  it("队员可发起采购申请,且不拉取全队统计", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: memberUser, loading: false, refresh: vi.fn() });
    render(<FinancePage />);

    await screen.findByText("桨叶");
    // 队员可见申请入口;全队统计不对队员请求
    expect(screen.getByRole("button", { name: "申请采购" })).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/finance/stats");

    fireEvent.click(screen.getByRole("button", { name: "申请采购" }));
    fireEvent.change(screen.getByPlaceholderText("如：螺旋桨 1045"), { target: { value: "备用电机" } });
    fireEvent.change(screen.getByPlaceholderText("说明采购原因..."), { target: { value: "备件补充" } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/finance/requests", expect.objectContaining({ itemName: "备用电机", reason: "备件补充" }))
    );
  });

  it("admin 可见全部申请与月度报表 Tab", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<FinancePage />);

    expect(await screen.findByRole("button", { name: "全部申请" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "月度报表" })).toBeInTheDocument();
  });

  it("在“全部申请”tab 审批后直接刷新 all 列表,无需切换 tab", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<FinancePage />);

    // 进入“全部申请”
    fireEvent.click(await screen.findByRole("button", { name: "全部申请" }));
    const allCalls = () => mockedGet.mock.calls.filter(c => c[0] === "/api/finance/requests/all");
    await waitFor(() => expect(allCalls().length).toBe(1));

    // 审批
    const approveBtn = await screen.findByRole("button", { name: /批准采购/ });
    fireEvent.click(approveBtn);
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/finance/requests/1/approve", {}));

    // 应再次刷新 all,而不是卡在“我的申请”数据
    await waitFor(() => expect(allCalls().length).toBe(2));
  });
});
