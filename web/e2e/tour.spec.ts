import { test, expect } from "@playwright/test";
import { mockApi, makeToken } from "./mock-api";

/**
 * 使用引导 E2E：首次自动弹出 → 跳过后刷新不再出现 → 从用户菜单重看。
 * 后端全部 mock；tours: [] 表示"这个人还没看过任何引导"。
 */
test.describe("使用引导", () => {
  test("首次进入自动引导，跳过后不再自动弹，可从引导中心重看", async ({ page }) => {
    await mockApi(page, "member", { tours: [] });
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/");

    // 自动触发有 600ms 延迟；气泡标题来自 welcome 第一步
    const bubble = page.getByRole("dialog", { name: "功能都在左侧" });
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1 / 6")).toBeVisible();

    // 跳过后记 skipped：刷新页面不应再次自动弹出
    await page.getByRole("button", { name: "跳过不再提示" }).click();
    await expect(bubble).toBeHidden();

    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByRole("dialog", { name: "功能都在左侧" })).toHaveCount(0);

    // 用户菜单 → 功能引导 → 重看
    await page.getByRole("button", { name: /e2e-member/ }).click();
    await page.getByRole("button", { name: "功能引导" }).click();
    await expect(page.getByRole("heading", { name: "使用引导" })).toBeVisible();
    await expect(page.getByText("已跳过")).toBeVisible();
    await page.getByRole("button", { name: "重看" }).first().click();
    await expect(page.getByRole("dialog", { name: "功能都在左侧" })).toBeVisible({ timeout: 10_000 });
  });

  test("在其他页面启动功能引导会先跳转到目标页再开始", async ({ page }) => {
    // 默认三条引导都是已完成：不会自动弹，只能手动从引导中心启动
    await mockApi(page, "member");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/finance");
    await expect(page.getByRole("heading", { name: "采购申请" })).toBeVisible();

    await page.getByRole("button", { name: /e2e-member/ }).click();
    await page.getByRole("button", { name: "功能引导" }).click();
    await page.locator('[data-tour="battery"]').getByRole("button", { name: /重看|开始/ }).click();

    // 先跳到 /batteries，再在目标页拉起引导
    await expect(page).toHaveURL(/\/batteries/, { timeout: 10_000 });
    await expect(page.getByRole("dialog", { name: "入口在物料管理里" })).toBeVisible({ timeout: 15_000 });
  });

  test("引导中心只列当前角色可见的引导", async ({ page }) => {
    await mockApi(page, "member", { tours: [] });
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));
    await page.goto("/");

    // 先把自动弹出的 welcome 引导跳掉，否则遮罩会挡住顶栏按钮
    const bubble = page.getByRole("dialog", { name: "功能都在左侧" });
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "跳过不再提示" }).click();
    await expect(bubble).toBeHidden();

    await page.getByRole("button", { name: /e2e-member/ }).click();
    await page.getByRole("button", { name: "功能引导" }).click();
    await expect(page.getByText("欢迎与全局导航")).toBeVisible();
    await expect(page.getByText("电池借还")).toBeVisible();
    await expect(page.getByText("零件库存", { exact: true })).toBeVisible();
  });
});
