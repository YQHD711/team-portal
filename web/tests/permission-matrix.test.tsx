import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PermissionMatrix } from "@/components/admin/permissions/PermissionMatrix";
import { api } from "@/lib/api";

// 只 mock 组件真正会用的三个方法：get/put/delete 的调用形态就是被测契约。
// 组件挂载后由 useEffect 触发加载；若走真实 api 会依赖 fetch/localStorage，测试无从断言请求体。
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);
const mockPut = vi.mocked(api.put as (url: string, body: unknown) => Promise<unknown>);
const mockDelete = vi.mocked(api.delete as (url: string) => Promise<unknown>);

interface Payload {
  roles: string[];
  groups: { group: string; items: { key: string; label: string; desc: string | null }[] }[];
  matrix: Record<string, Record<string, boolean>>;
  defaults: Record<string, string[]>;
  overrides: { role: string; permission: string; allowed: boolean }[];
}

const PERM = "material.inventory.view";

/**
 * 最小载荷：三个角色 + 一个权限点。
 * 矩阵刻意设成「member 有、部长 无、admin 有」，这样勾选/取消都能造出差异，
 * 且未动的 admin 列可用来验证保存时不会把全量矩阵一起提交。
 */
function payload(): Payload {
  return {
    roles: ["member", "部长", "admin"],
    groups: [
      { group: "物料", items: [{ key: PERM, label: "查看零件库存", desc: null }] },
    ],
    matrix: {
      member: { [PERM]: true },
      部长: { [PERM]: false },
      admin: { [PERM]: true },
    },
    defaults: { member: [PERM], 部长: [], admin: [PERM] },
    overrides: [],
  };
}

const saveButton = () => screen.getByRole("button", { name: "保存" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(payload());
  mockPut.mockResolvedValue({});
  mockDelete.mockResolvedValue({});
});

describe("可配置权限矩阵：渲染与保存", () => {
  it("加载完成后渲染角色表头（成员/部长/管理员）与权限行", async () => {
    render(<PermissionMatrix />);

    // 等待加载态结束：权限行出现即代表 api.get 已 resolve 且表格已渲染
    expect(await screen.findByText("查看零件库存")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/api/admin/permissions");

    expect(screen.getByText("成员")).toBeInTheDocument();
    expect(screen.getByText("部长")).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();
    expect(screen.getByText(/共 3 个角色 · 改动 0 项/)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("保存时 api.put 只提交发生变化的格子（role/permission/allowed）", async () => {
    render(<PermissionMatrix />);

    const memberBox = await screen.findByRole("checkbox", { name: `member 查看零件库存` });
    const leadBox = screen.getByRole("checkbox", { name: `部长 查看零件库存` });

    fireEvent.click(memberBox); // true -> false
    fireEvent.click(leadBox); // false -> true
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
    const [url, body] = mockPut.mock.calls[0];
    expect(url).toBe("/api/admin/permissions");
    // 用 toEqual 精确比对：既证明 admin 列没被带上，也证明元素只有这三个字段
    expect(body).toEqual([
      { role: "member", permission: PERM, allowed: false },
      { role: "部长", permission: PERM, allowed: true },
    ]);

    // 保存成功后会重新拉取矩阵；等提示出现，确保后续异步状态更新已 flush
    expect(await screen.findByText(/已保存，权限立即生效/)).toBeInTheDocument();
  });

  it("没有改动时保存按钮 disabled，改动后启用、改回后又禁用", async () => {
    render(<PermissionMatrix />);

    const memberBox = await screen.findByRole("checkbox", { name: `member 查看零件库存` });
    expect(saveButton()).toBeDisabled();

    fireEvent.click(memberBox);
    expect(saveButton()).toBeEnabled();

    fireEvent.click(memberBox); // 改回原值 → 差异归零
    expect(saveButton()).toBeDisabled();
  });

  it("api.get 抛错时显示可读错误提示，不白屏", async () => {
    mockGet.mockRejectedValueOnce(new Error("403 forbidden"));
    render(<PermissionMatrix />);

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument();
    // 提示要告诉用户「为什么看不到」，而不是只回显后端错误码
    expect(screen.getByText(/仅具备「权限管理」权限的人可访问/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("查看零件库存")).not.toBeInTheDocument();
  });
});

describe("可配置权限矩阵：恢复默认", () => {
  it("恢复某个角色时按角色名调用 delete，中文角色名必须编码", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PermissionMatrix />);

    await screen.findByText("查看零件库存");
    // 表头每个角色各有一个「恢复该角色默认」按钮，顺序与 roles 一致 → 第二个是部长
    fireEvent.click(screen.getAllByTitle("恢复该角色默认")[1]);

    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    // 中文角色名不做 encodeURIComponent 会拼出非法 URL
    expect(mockDelete).toHaveBeenCalledWith(`/api/admin/permissions/${encodeURIComponent("部长")}`);

    // 同样等一个完成态提示，避免用例结束时还有未 flush 的 load() 状态更新
    expect(await screen.findByText(/已恢复默认/)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
