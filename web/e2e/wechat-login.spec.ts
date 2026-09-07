import { test, expect, type Page, type Route } from "@playwright/test";

/** 微信登录 E2E：入口可见性 + 绑定流程。所有 /api/* 走 mock。 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
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

async function mockApi(page: Page, wechatEnabled: boolean) {
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    if (path === "/api/public/brand") return json(brand);
    if (path === "/api/public/wechat-config") {
      return json(
        wechatEnabled
          ? { enabled: true, authUrl: "https://open.weixin.qq.com/connect/oauth2/authorize?appid=e2e" }
          : { enabled: false, authUrl: null }
      );
    }
    if (path === "/api/auth/wechat/bind" && method === "POST") {
      const body = req.postDataJSON();
      if (body.username !== "e2e-user" || body.password !== "e2e-pass") return json({ detail: "用户名或密码错误" }, 401);
      return json({ token: makeToken("member") });
    }
    if (path === "/api/auth/me") return json({ id: 1, username: "e2e-user", role: "member", department: null });
    return json({});
  });
}

test.describe("微信登录入口", () => {
  test("开关开启时登录页显示微信登录按钮", async ({ page }) => {
    await mockApi(page, true);
    await page.goto("/auth/login");
    await expect(page.getByRole("link", { name: "微信登录" })).toBeVisible();
    await expect(page.getByRole("link", { name: "微信登录" })).toHaveAttribute("href", /open\.weixin\.qq\.com/);
  });

  test("开关关闭时登录页无微信按钮", async ({ page }) => {
    await mockApi(page, false);
    await page.goto("/auth/login");
    await expect(page.getByRole("link", { name: "微信登录" })).toHaveCount(0);
  });
});

test.describe("微信绑定流程", () => {
  test("绑定页凭票据 + 账号密码绑定成功并进入首页", async ({ page }) => {
    await mockApi(page, true);
    await page.goto("/auth/wechat/bind?binding=e2e-binding-token");

    await page.getByPlaceholder("请输入系统用户名").fill("e2e-user");
    await page.getByPlaceholder("请输入系统密码").fill("e2e-pass");
    await page.getByRole("button", { name: "绑定并登录" }).click();

    await expect(page).toHaveURL(/\/$/);
    // 首页（AuthGuard 已放行）渲染，说明 token 已写入 localStorage
    await expect(page.getByText("雏鹰之翼", { exact: true }).first()).toBeVisible();
  });

  test("绑定页缺少票据时提示并跳回登录页", async ({ page }) => {
    await mockApi(page, true);
    await page.goto("/auth/wechat/bind");
    await expect(page.getByText(/票据缺失或已过期/)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
