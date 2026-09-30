import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AdminProfileDetailPage from "@/app/(protected)/admin/profiles/[slug]/page";
import CheckoutPage from "@/app/(protected)/inventory/checkout/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));
// 档案页的 URL 参数是公开 slug，不是自增 ID
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "u_abc123def456" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/profiles/u_abc123def456",
  useSearchParams: () => new URLSearchParams(),
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedUseCurrentUser = vi.mocked(useCurrentUser);

const admin = { id: 1, username: "admin", role: "admin", department: null, departmentId: null };
const leader = { id: 3, username: "leader", role: "部长", department: "飞训部", departmentId: 1 };

const profile = {
  id: 9, userId: 7, username: "王睿翔", role: "member", department: "飞训部", departmentId: 1,
  slug: "u_abc123def456",
  level: "中级", totalFlightHours: 12, firstFlightDate: null,
  bio: null, emergencyContact: null, emergencyPhone: null, flightTypes: null, skills: null,
  updatedAt: "2026-09-01T00:00:00Z", trainingRecords: [], competitionRecords: [],
};

// 同一个人的两条记录，UserName 不同 —— 模拟"改名前后"
const opLogs = {
  total: 2,
  items: [
    { id: 101, userId: 7, userName: "王睿翔", action: "checkout", targetType: "material", targetId: "12", data: '{"item":"桨叶","quantity":2}', ipAddress: "10.0.0.5", createdAt: "2026-09-20T08:00:00Z" },
    { id: 100, userId: 7, userName: "小王", action: "checkin", targetType: "material", targetId: "12", data: '{"item":"桨叶"}', ipAddress: "10.0.0.5", createdAt: "2026-09-10T08:00:00Z" },
  ],
};

function setupProfileApi() {
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint.startsWith("/api/admin/profiles/u_abc123def456")) return profile;
    if (endpoint.startsWith("/api/admin/logs/operations")) return opLogs;
    if (endpoint === "/api/admin/departments") return [];
    return {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("队员档案 · 操作日志", () => {
  it("管理员能看到该队员的操作日志，且按 userId 查", async () => {
    setupProfileApi();
    mockedUseCurrentUser.mockReturnValue({ user: admin, loading: false, refresh: vi.fn() });
    render(<AdminProfileDetailPage />);

    // 等档案加载完，再切到操作日志 tab
    await screen.findByText("王睿翔");
    fireEvent.click(await screen.findByRole("button", { name: /操作日志/ }));

    // 关键：必须带 userId 而不是用户名（用户名会被改，改名前的记录不能丢）
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/admin/logs/operations?userId=7&size=50")
    );

    expect(await screen.findByText(/共 2 条操作记录/)).toBeInTheDocument();
    // 动作标签走共用话术表
    expect(screen.getAllByText("领用申请").length).toBeGreaterThan(0);
    expect(screen.getAllByText("归还").length).toBeGreaterThan(0);
    // 改名前的记录也要在里面
    expect(screen.getByText(/共 2 条/)).toBeInTheDocument();
  });

  it("部长看不到操作日志 tab（后端是 AdminOnly，放进来只会是空 tab）", async () => {
    setupProfileApi();
    mockedUseCurrentUser.mockReturnValue({ user: leader, loading: false, refresh: vi.fn() });
    render(<AdminProfileDetailPage />);

    await screen.findByText("王睿翔");
    expect(screen.queryByRole("button", { name: /操作日志/ })).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith(expect.stringContaining("/api/admin/logs/operations"));
  });

  it("没有记录时给出空状态而不是空白", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/api/admin/profiles/u_abc123def456")) return profile;
      if (endpoint.startsWith("/api/admin/logs/operations")) return { total: 0, items: [] };
      return {};
    });
    mockedUseCurrentUser.mockReturnValue({ user: admin, loading: false, refresh: vi.fn() });
    render(<AdminProfileDetailPage />);

    await screen.findByText("王睿翔");
    fireEvent.click(await screen.findByRole("button", { name: /操作日志/ }));

    expect(await screen.findByText("这位队员还没有操作记录")).toBeInTheDocument();
  });
});

describe("领用管理 · 借出中", () => {
  const outstanding = [
    {
      id: 55, inventoryItemId: 12, quantity: 2, grade: "B", status: "approved",
      note: "CUADC 备赛", createdAt: "2026-09-01T00:00:00Z", approvedAt: "2026-09-02T00:00:00Z",
      item: { id: 12, name: "桨叶", grade: "B", quantity: 3, category: "动力系统", locationCode: "201-A-3-05" },
      requester: { id: 7, username: "王睿翔", department: { name: "飞训部" } },
    },
  ];

  beforeEach(() => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/api/material/checkout/my")) return [];
      if (endpoint.startsWith("/api/material/checkout/pending")) return [];
      if (endpoint.startsWith("/api/material/checkout/outstanding")) return outstanding;
      if (endpoint.startsWith("/api/inventory")) return [];
      return {};
    });
    mockedUseCurrentUser.mockReturnValue({ user: admin, loading: false, refresh: vi.fn() });
  });

  it("管理员/部长能看到谁借走了什么、借了多久", async () => {
    render(<CheckoutPage />);

    fireEvent.click(await screen.findByRole("button", { name: /借出中/ }));

    // 借用人 + 部门 + 物料 + 数量，催办要用的信息都在
    expect(await screen.findByText("王睿翔")).toBeInTheDocument();
    expect(screen.getByText(/飞训部/)).toBeInTheDocument();
    expect(screen.getByText("桨叶")).toBeInTheDocument();
    expect(screen.getByText(/× 2/)).toBeInTheDocument();
    expect(screen.getByText(/已借 \d+ 天/)).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/material/checkout/outstanding");
  });

  it("搜索走服务端过滤", async () => {
    render(<CheckoutPage />);
    fireEvent.click(await screen.findByRole("button", { name: /借出中/ }));
    await screen.findByText("桨叶");

    fireEvent.change(screen.getByPlaceholderText("按借用人或物料名搜索..."), { target: { value: "王睿翔" } });

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(`/api/material/checkout/outstanding?search=${encodeURIComponent("王睿翔")}`)
    );
  });

  it("普通成员看不到借出中 tab", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: { id: 7, username: "王睿翔", role: "member", department: null, departmentId: null }, loading: false, refresh: vi.fn() });
    render(<CheckoutPage />);

    await screen.findByRole("button", { name: /我的领用/ });
    expect(screen.queryByRole("button", { name: /借出中/ })).not.toBeInTheDocument();
  });
});
