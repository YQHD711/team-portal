import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Home from "@/app/(protected)/page";
import { api } from "@/lib/api";
import { isStaff as checkIsStaff } from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({
  isStaff: vi.fn(),
}));
vi.mock("@/components/ai/ChatPanel", () => ({
  ChatPanel: () => null,
}));

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);
const mockedIsStaff = vi.mocked(checkIsStaff);

const dashData = {
  users: 10,
  inventory: 5,
  inventoryTotal: 42,
  departments: 6,
  monthNewItems: 3,
  lowStock: [{ id: 1, name: "螺旋桨", quantity: 2, category: "动力" }],
  activeWiki: [],
  recentIncidents: [],
  completedWiki: 5,
  pendingPurchases: 2,
  monthSpent: 1200,
  inventoryValue: 9999,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/notifications") return [];
    return dashData;
  });
});

describe("仪表盘", () => {
  it("渲染基础统计卡片", async () => {
    mockedIsStaff.mockReturnValue(false);
    render(<Home />);

    expect(await screen.findByText("团队人数")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("零件库存")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("本月新增零件")).toBeInTheDocument();
  });

  it("普通成员不显示财务卡片", async () => {
    mockedIsStaff.mockReturnValue(false);
    render(<Home />);

    await screen.findByText("团队人数");
    expect(screen.queryByText("库存总价值")).not.toBeInTheDocument();
    expect(screen.queryByText("本月支出")).not.toBeInTheDocument();
  });

  it("staff 显示财务卡片与金额", async () => {
    mockedIsStaff.mockReturnValue(true);
    render(<Home />);

    await screen.findByText("团队人数");
    expect(screen.getByText("库存总价值")).toBeInTheDocument();
    expect(screen.getByText("¥9,999")).toBeInTheDocument();
    expect(screen.getByText("本月支出")).toBeInTheDocument();
    expect(screen.getByText("¥1200")).toBeInTheDocument();
  });

  it("低库存警告显示零件名与补货链接", async () => {
    mockedIsStaff.mockReturnValue(false);
    render(<Home />);

    expect(await screen.findByText("库存不足警告")).toBeInTheDocument();
    expect(screen.getByText(/螺旋桨/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "补货" })).toHaveAttribute("href", "/inventory");
  });

  it("无团队动态时显示空状态", async () => {
    mockedIsStaff.mockReturnValue(false);
    render(<Home />);

    expect(await screen.findByText("暂无团队动态")).toBeInTheDocument();
  });
});
