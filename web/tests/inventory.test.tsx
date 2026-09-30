import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import InventoryPage from "@/app/(protected)/inventory/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: vi.fn(),
}));
// recharts 图表在 jsdom 下不稳定，且非本测试关注点 — mock 掉
vi.mock("@/components/inventory/CategoryDonut", () => ({
  default: () => null,
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedUseCurrentUser = vi.mocked(useCurrentUser);

const items = [
  { id: 1, name: "桨叶", category: "动力系统", quantity: 2, locationCode: "201-01-A-01", status: "available", grade: "B", unitPrice: 45, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 2, name: "飞控板", category: "飞控系统", quantity: 5, locationCode: "201-02-B-03", status: "in_use", grade: "A", unitPrice: 1200, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 3, name: "M3螺丝", category: "耗材", quantity: 7, locationCode: "201-01-C-02", status: "available", grade: "C", unitPrice: 0.5, updatedAt: "2026-09-01T10:00:00Z" },
];

const staffUser = { id: 1, username: "admin", role: "admin", department: null, departmentId: null };
const memberUser = { id: 2, username: "王睿翔", role: "member", department: null, departmentId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint.startsWith("/api/inventory")) return items;
    if (endpoint === "/api/admin/departments") return [];
    if (endpoint === "/api/storage/layouts") return [];
    return {};
  });
});

describe("零件库存页", () => {
  it("渲染库存清单、统计与低库存预警", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<InventoryPage />);

    expect(await screen.findByRole("heading", { name: "零件库存" })).toBeInTheDocument();
    // 统计行：3 种 · 共 14 件
    expect(await screen.findByText(/3 种 · 共 14 件/)).toBeInTheDocument();
    // 桌面表格与移动卡片会重复渲染同一零件名 → 一律用 findAll 断言
    expect((await screen.findAllByText("桨叶")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("飞控板").length).toBeGreaterThan(0);
    expect(screen.getAllByText("M3螺丝").length).toBeGreaterThan(0);
    // 状态标签
    expect(screen.getAllByText("使用中").length).toBeGreaterThan(0);
    // 低库存预警（桨叶 2 < 3）
    expect(await screen.findByText(/种零件库存不足/)).toBeInTheDocument();
  });

  it("staff 可见添加与导入入口", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<InventoryPage />);

    await screen.findAllByText("桨叶");
    expect(screen.getByRole("button", { name: /添加零件/ })).toBeInTheDocument();
    expect(screen.getByText(/导入 Excel/)).toBeInTheDocument();
  });

  it("成员不可见添加与导入入口", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: memberUser, loading: false, refresh: vi.fn() });
    render(<InventoryPage />);

    await screen.findAllByText("桨叶");
    expect(screen.queryByRole("button", { name: /添加零件/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/导入 Excel/)).not.toBeInTheDocument();
  });

  it("成员不可见低库存预警横幅(库存预警仅 staff)", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: memberUser, loading: false, refresh: vi.fn() });
    render(<InventoryPage />);

    await screen.findAllByText("桨叶");
    expect(screen.queryByText(/种零件库存不足/)).not.toBeInTheDocument();
  });

  it("搜索触发带参数的接口请求", async () => {
    const { fireEvent } = await import("@testing-library/react");
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<InventoryPage />);

    await screen.findAllByText("桨叶");
    fireEvent.change(screen.getByPlaceholderText("搜索零件..."), { target: { value: "桨叶" } });

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/inventory?search=%E6%A1%A8%E5%8F%B6")
    );
  });

  // 《物料管理规范》第 3 节的警告内嵌到出错现场：新建表单默认 grade=C、单价为空，
  // 这个组合意味着"无需审批、谁都能自助领走"，必须在填单时就把它说清楚。
  it("单价留空且等级为 C 时，表单内嵌「会被自助领走」警告", async () => {
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<InventoryPage />);
    await screen.findAllByText("桨叶");

    fireEvent.click(screen.getByRole("button", { name: /添加零件/ }));

    const warn = await screen.findByTestId("unit-price-warning");
    expect(warn).toHaveTextContent(/自助领走/);

    // 填上真实单价 → 警告消失
    fireEvent.change(screen.getByPlaceholderText("填写后自动判定等级"), { target: { value: "1500" } });
    await waitFor(() => expect(screen.queryByTestId("unit-price-warning")).not.toBeInTheDocument());
  });

  it("已报损(broken)的物料不能领用", async () => {
    mockedGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/api/inventory")) return [
        { id: 9, name: "烧了的电调", category: "电子元器件", quantity: 3, locationCode: "201-A-1-01", status: "broken", grade: "B", unitPrice: 300, updatedAt: "2026-09-01T10:00:00Z" },
      ];
      if (endpoint === "/api/admin/departments") return [];
      if (endpoint === "/api/storage/layouts") return [];
      return {};
    });
    mockedUseCurrentUser.mockReturnValue({ user: staffUser, loading: false, refresh: vi.fn() });
    render(<InventoryPage />);

    await screen.findAllByText("烧了的电调");
    // 桌面表格与移动卡片各一个，必须全部禁用（报损只改状态不减数量，拦不住就等于没报损）
    const btns = screen.getAllByTitle("已报损，不能领用");
    expect(btns.length).toBeGreaterThan(0);
    for (const b of btns) expect(b).toBeDisabled();
  });
});
