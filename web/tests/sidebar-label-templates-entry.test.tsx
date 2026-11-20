import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useCurrentUser } from "@/lib/hooks";

/** 「标签模板」入口只给管理员：普通成员/部长在侧边栏里看不到它（不只是页面内 403）。 */

vi.mock("@/components/layout/SidebarContext", () => ({ useSidebar: () => ({ open: true, setOpen: vi.fn() }) }));
vi.mock("@/lib/brand", () => ({ useBrand: () => ({ teamName: "雏鹰之翼", teamSubtitle: "航模队" }) }));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory/layout",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** 侧栏现在按权限矩阵过滤；测试里用 canFn 模拟不同角色的权限集合 */
let canFn: (permission: string) => boolean = () => true;
vi.mock("@/components/permissions/PermissionsProvider", () => ({
  usePermissions: () => ({
    role: null,
    permissions: new Set<string>(),
    ready: true,
    can: (permission: string) => canFn(permission),
    refresh: async () => {},
  }),
}));

const mockedUser = vi.mocked(useCurrentUser);
const asRole = (role: string) => mockedUser.mockReturnValue({
  user: { id: 1, username: "u", role, department: null, departmentId: null }, loading: false, refresh: vi.fn(),
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { Sidebar } = await import("@/components/layout/Sidebar");
  void Sidebar;
});

const renderSidebar = async () => {
  const { Sidebar } = await import("@/components/layout/Sidebar");
  render(<Sidebar />);
  // 侧边栏是 client 组件，等它渲染出管理分组
  await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThan(3));
};

/** 「管理」分组默认折叠（staff 才存在），展开后才有 adminNavOnly 里的链接 */
const expandAdminGroup = () => {
  const toggle = screen.queryByRole("button", { name: "管理" });
  if (toggle) fireEvent.click(toggle);
};

describe("标签模板入口的可见性", () => {
  it("管理员：展开「管理」后有「标签模板」链接", async () => {
    canFn = () => true;
    asRole("admin");
    await renderSidebar();
    expandAdminGroup();

    const link = screen.getByRole("link", { name: /标签模板/ });
    expect(link).toHaveAttribute("href", "/admin/label-templates");
  });

  it("部长：管理分组里有别的入口，但没有「标签模板」（系统级只给管理员）", async () => {
    // 部长：能看组织架构与考核，但没有系统级（设置/日志/权限等）
    canFn = (p) => !p.startsWith("admin.") || p === "admin.users.view" || p === "admin.exams.manage";
    asRole("部长");
    await renderSidebar();
    expandAdminGroup();

    expect(screen.queryByRole("link", { name: /标签模板/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /系统设置|组织架构/ })).toBeInTheDocument();
  });

  it("普通成员：连管理分组都没有，更看不到入口", async () => {
    // 成员：只有物料/内容阅读等基础权限，没有任何管理端权限
    canFn = (p) => p.startsWith("material.")
      || ["content.study.view", "content.wiki.view", "content.files.view", "team.incidents.view", "team.profile.self"].includes(p);
    asRole("member");
    await renderSidebar();
    expandAdminGroup();   // 没有这个按钮，等于什么都没做

    expect(screen.queryByRole("button", { name: "管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /标签模板/ })).not.toBeInTheDocument();
    // 但其它入口照旧（没有把整个侧边栏弄坏）
    expect(screen.getByRole("link", { name: /物料布局/ })).toBeInTheDocument();
  });
});
