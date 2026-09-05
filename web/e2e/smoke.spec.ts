import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E 冒烟：登录 → 仪表盘 → 采购审批 → 零件库存。
 * 所有 /api/* 请求走 route mock（无真实后端），验证前端路由守卫、页面渲染与交互闭环。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

/** 伪造 JWT（与后端 payload 结构一致，仅前端解析 role 用） */
const makeToken = (role: string) => {
  const payload = Buffer.from(
    JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");
  return `e2e.${payload}.sig`;
};

const brand = {
  teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "雏鹰之翼 · 航模队管理系统",
  description: "E2E", logoUrl: null, primaryColor: null, theme: "indigo",
};

const dashData = {
  users: 4, inventory: 3, inventoryTotal: 14, departments: 2, monthNewItems: 1,
  lowStock: [{ id: 1, name: "桨叶", quantity: 2, category: "动力系统" }],
  activeWiki: [], recentIncidents: [], completedWiki: 5,
  pendingPurchases: 1, monthSpent: 1200, inventoryValue: 9999,
};

const pendingReq = {
  id: 1, itemName: "桨叶", quantity: 2, estimatedPrice: 120, actualPrice: null,
  reason: "训练损耗", status: "pending", requester: { username: "张唐智嘉" },
  approver: null, approvedAt: null, purchasedAt: null, receivedAt: null,
  rejectReason: null, createdAt: "2026-09-05T10:00:00Z",
};

const stats = { pending: 1, approved: 0, purchased: 0, received: 0, totalSpent: 360, thisMonth: 1200 };

const items = [
  { id: 1, name: "桨叶", category: "动力系统", quantity: 2, locationCode: "201-01-A-01", status: "available", grade: "B", unitPrice: 45, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 2, name: "飞控板", category: "飞控系统", quantity: 5, locationCode: "201-01-B-02", status: "in_use", grade: "A", unitPrice: 1200, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 3, name: "M3螺丝", category: "耗材", quantity: 7, locationCode: "1012-C-01-03", status: "available", grade: "C", unitPrice: 0.5, updatedAt: "2026-09-01T10:00:00Z" },
];

const state = { approveCalls: 0 };

/** 统一 mock 所有 /api/* 请求（按路径+方法分发） */
async function mockApi(page: Page, role: string) {
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    if (path === "/api/auth/login" && method === "POST") return json({ token: makeToken(role) });
    if (path === "/api/auth/me") return json({ id: 1, username: "e2e-" + role, role, department: null });
    if (path.startsWith("/api/notifications")) return json([]);
    if (path === "/api/public/brand") return json(brand);
    if (path === "/api/dashboard") return json(dashData);
    if (path === "/api/finance/requests" || path === "/api/finance/requests/all") return json([pendingReq]);
    if (path === "/api/finance/stats") return json(stats);
    if (/\/api\/finance\/requests\/\d+\/approve$/.test(path) && method === "POST") {
      state.approveCalls += 1;
      return json({});
    }
    if (/\/api\/finance\/requests\/\d+\/reject$/.test(path) && method === "POST") return json({});
    if (path.startsWith("/api/inventory")) return json(items);
    if (path === "/api/admin/departments") return json([]);
    if (path === "/api/storage/layouts") return json([]);
    return json({});
  });
  return state;
}

test.describe("冒烟流程", () => {
  test("登录成功跳转仪表盘", async ({ page }) => {
    await mockApi(page, "admin");

    await page.goto("/auth/login");
    await expect(page.getByText("雏鹰之翼", { exact: true })).toBeVisible();

    await page.getByPlaceholder("请输入用户名").fill("e2e-admin");
    await page.getByPlaceholder("请输入密码").fill("e2e-pass");
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("团队成员")).toBeVisible();
    await expect(page.getByText("库存物料")).toBeVisible();
  });

  test("未登录访问受保护页被重定向到登录页", async ({ page }) => {
    await mockApi(page, "member");
    await page.goto("/finance");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("admin 审批采购申请", async ({ page }) => {
    const state = await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/finance");
    await expect(page.getByRole("heading", { name: "采购申请" })).toBeVisible();
    await expect(page.getByText("桨叶").first()).toBeVisible();

    await page.getByRole("button", { name: "批准采购" }).click();
    await expect.poll(() => state.approveCalls, { timeout: 10_000 }).toBe(1);
  });

  test("库存页渲染与 staff 权限入口", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "零件库存" }).first()).toBeVisible();
    await expect(page.getByText(/3 种 · 共 14 件/)).toBeVisible();
    // 移动端卡片(hidden)与桌面表格重复渲染 → 只匹配可见元素
    await expect(page.getByText("桨叶").locator("visible=true").first()).toBeVisible();
    await expect(page.getByText("M3螺丝").locator("visible=true").first()).toBeVisible();
    // 低库存预警（桨叶 2 < 3）
    await expect(page.getByText(/种零件库存不足/)).toBeVisible();
    // staff 专属入口
    await expect(page.getByRole("button", { name: "添加零件" })).toBeVisible();
    await expect(page.getByText(/导入 Excel/)).toBeVisible();
  });

  test("成员不可见库存管理入口", async ({ page }) => {
    await mockApi(page, "member");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "零件库存" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "添加零件" })).toHaveCount(0);
    await expect(page.getByText(/导入 Excel/)).toHaveCount(0);
  });
});

test.describe("路由完整性守卫", () => {
  // 防止源码被构建遗漏(如被 .gitignore 误伤)导致整页 404
  test("关键路由不存在404", async ({ request }) => {
    for (const route of [
      "/admin/logs", "/admin/users", "/admin/settings", "/admin/backup",
      "/finance", "/inventory", "/profile", "/flightlog",
    ]) {
      const res = await request.get(route);
      expect(res.status(), `${route} 不应是404(路由疑似被构建遗漏)`).not.toBe(404);
    }
  });
});
