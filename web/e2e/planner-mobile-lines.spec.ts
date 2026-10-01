import { test, expect, type Page } from "@playwright/test";

/**
 * 移动端物料布局连线：<lg 时桌面物料面板被 `max-lg:hidden` 藏起来、抽屉里另挂一个面板。
 * jsdom 不跑 CSS，只有真浏览器能验证「display:none 的面板 clientWidth 为 0，不得上报锚点」。
 * 所有 /api/* 走 route mock，不依赖后端。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

const makeToken = (role: string) => {
  const payload = Buffer.from(
    JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");
  return `e2e.${payload}.sig`;
};

const roomItems = [
  { id: 11, name: "桨叶", category: "动力系统", quantity: 5, locationCode: "201-A-1-01", status: "available", grade: "B", unitPrice: 45, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 12, name: "M3螺丝", category: "耗材", quantity: 2, locationCode: "201-A-3-05", status: "available", grade: "C", unitPrice: 0.5, updatedAt: "2026-09-01T10:00:00Z" },
];

const layoutRoom = {
  id: 1, roomCode: "201", roomName: "库房", floor: 1,
  cabinetCount: 1, shelfCount: 1, positionCount: 8, description: null,
  updatedAt: "2026-09-01T10:00:00Z",
  layoutJson: JSON.stringify({
    width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [],
    items: [{ id: "it1", type: "shelf", name: "A货架", x: 100, y: 100, w: 300, h: 120, rotation: 0, locCode: "201-A", rows: 4, cols: 8 }],
  }),
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/auth/me") return json({ id: 1, username: "e2e-member", role: "member", department: null });
    if (path.startsWith("/api/notifications")) return json([]);
    if (path === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "雏鹰之翼 · 航模队管理系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (path === "/api/storage/layouts") return json([layoutRoom]);
    if (path === "/api/inventory/meta") return json({ lowStockThreshold: 8, lowStockGrade: "C" });
    if (path === "/api/inventory") return json(roomItems);
    return json({});
  });
}

test.describe("移动端物料布局连线（<lg）", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("抽屉收起时不画错位连线；展开后端点落在可见物料条目上；再收起不留过期连线", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(token => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/inventory/layout");
    await page.getByRole("button", { name: /库房/ }).click();
    await expect(page.getByTestId("layout-stage").locator("canvas").first()).toBeVisible();

    // 打开连线开关（此时物料面板是收起的）
    await page.getByTitle("显示/隐藏物料连线").click();
    await expect(page.getByTitle("显示/隐藏物料连线")).toContainText("连线开");

    const lines = page.locator('[data-testid="connection-line"]');
    // 唯一在 DOM 里的桌面面板是 display:none：它的全 0 rect 不得变成连线端点
    await expect(lines).toHaveCount(0);

    // 展开抽屉 → 可见面板上报真实坐标，连线恢复
    const toggle = page.getByRole("button", { name: /物料清单/ });
    await toggle.click();
    const chip = page.getByTitle(/201-A-1-01/).locator("visible=true").first();
    const svg = page.locator('svg:has([data-testid="connection-dot"])').first();

    // 第一个端点是第一条线（物料 11）的条目端：应落在可见条目中心（容器坐标）
    await expect.poll(async () => {
      if (await lines.count() === 0) return null;
      const chipBox = await chip.boundingBox();
      const svgBox = await svg.boundingBox();
      if (!chipBox || !svgBox) return null;
      const x1 = Number(await lines.first().getAttribute("x1"));
      const y1 = Number(await lines.first().getAttribute("y1"));
      return Math.hypot(x1 - (chipBox.x + chipBox.width / 2 - svgBox.x), y1 - (chipBox.y + chipBox.height / 2 - svgBox.y));
    }, { message: "连线端点应贴住展开后可见的物料条目" }).toBeLessThan(2);

    // 收起抽屉：面板卸载后不得继续用旧坐标画线
    await toggle.click();
    await expect(lines).toHaveCount(0);
  });
});
