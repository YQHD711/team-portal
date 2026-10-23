import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InvitesTab } from "@/components/admin/organization/InvitesTab";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockPost = vi.mocked(api.post as (url: string, body: unknown) => Promise<unknown>);
const mockDelete = vi.mocked(api.delete as (url: string) => Promise<unknown>);

/** 后端 /api/admin/invite-codes 现在返回计算字段 status / isExpired（revoked > expired > used_up > active）。 */
const invites = [
  { id: 1, code: "ACTIVE01", departmentId: null, departmentName: null, maxUses: 2, usedCount: 0, isRevoked: false, isExpired: false, status: "active", expiresAt: "2099-12-31T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, code: "EXPIRED1", departmentId: 1, departmentName: "飞训部", maxUses: 2, usedCount: 0, isRevoked: false, isExpired: true, status: "expired", expiresAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
  { id: 3, code: "REVOKED1", departmentId: null, departmentName: null, maxUses: 2, usedCount: 0, isRevoked: true, isExpired: false, status: "revoked", expiresAt: "2099-12-31T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
  { id: 4, code: "USEDUP01", departmentId: null, departmentName: null, maxUses: 1, usedCount: 1, isRevoked: false, isExpired: false, status: "used_up", expiresAt: "2099-12-31T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
];

function renderTab() {
  return render(<InvitesTab depts={[]} onChanged={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(invites);
  mockPost.mockResolvedValue({});
  mockDelete.mockResolvedValue({});
});

describe("邀请码状态展示与按钮门禁", () => {
  it("按 status 渲染 有效 / 已过期 / 已作废 / 已用完 四种 badge", async () => {
    renderTab();

    expect(await screen.findByTestId("invite-status-active")).toHaveTextContent("有效");
    expect(screen.getByTestId("invite-status-expired")).toHaveTextContent("已过期");
    expect(screen.getByTestId("invite-status-revoked")).toHaveTextContent("已作废");
    expect(screen.getByTestId("invite-status-used_up")).toHaveTextContent("已用完");
  });

  it("部门列读取后端返回的 departmentName，而不是不存在的嵌套 department", async () => {
    renderTab();
    await screen.findByTestId("invite-status-active");

    // 旧实现读 c.department?.name（后端不返回该字段），所有码都显示「不限」
    expect(screen.getByText(/部门: 飞训部/)).toBeInTheDocument();
    expect(screen.getAllByText(/部门: 不限/)).toHaveLength(3);
  });

  it("只有有效码保留作废按钮；过期/作废/已用完只保留删除", async () => {
    renderTab();

    await screen.findByTestId("invite-status-active");
    // 旧实现里过期码仍然显示「作废」，已作废码的 badge 之外没有状态区分
    expect(screen.getAllByRole("button", { name: "作废" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(3);
  });

  it("作废与删除分别调用对应接口并刷新列表", async () => {
    renderTab();
    await screen.findByTestId("invite-status-active");

    fireEvent.click(screen.getByRole("button", { name: "作废" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/api/admin/invite-codes/1/revoke", {}));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2)); // 初次 + 作废后刷新

    // 第一个「删除」属于过期码（id=2）
    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("/api/admin/invite-codes/2"));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
  });
});
