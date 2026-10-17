import { test, expect, type Page } from "@playwright/test";
import { mockApi, makeToken } from "./mock-api";

/**
 * 移动端布局回归。
 *
 * 只跑 390×844（iPhone 12/13/14 的 CSS 视口）——这个宽度是"最挤"的主流值：
 * 320 的 SE 已经更少，而 390 上出现的横向溢出、按钮被裁、抽屉点不到，
 * 在更大的手机上也同样存在。所有接口照旧走 mock（见 e2e/mock-api.ts）。
 *
 * 断言刻意选"可量化"的：整页横向溢出、卡片宽度、目标元素是否真的能点到。
 * 截图像素级对比太脆，这里不引入。
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/** 带登录态的页面：先 mock 接口，再把 token 塞进 localStorage（AuthGuard 只认它） */
async function openAs(page: Page, role: string, path: string, opts: { items?: unknown[] } = {}) {
  await mockApi(page, role, opts);
  await page.addInitScript((t) => localStorage.setItem("token", t), makeToken(role));
  await page.goto(path);
}

/** 整页横向溢出量（> 1 就是出现横向滚动条/内容被顶出屏幕） */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("移动端：关键页面不横向溢出", () => {
  const routes = [
    "/",
    "/study",
    "/inventory",
    "/finance",
    "/flightlog",
    "/wiki/t1",
    "/profile",
    "/files",
    "/incidents",
    "/inventory/layout",
    "/inventory/checkout",
    "/inventory/stocktake",
    "/admin/ai-admin",
    "/admin/wiki-settings",
  ];

  for (const path of routes) {
    test(`${path} 在 390px 下无横向滚动`, async ({ page }) => {
      await openAs(page, "admin", path);
      // 等首屏数据渲染完（mock 请求很快，但页面本身有 useEffect 链）。
      // 用 waitForSelector 而不是 expect(locator)：Next 路由切换的过渡帧里可能同时存在
      // 两个 <main>（新旧页面各一个），strict mode 会误报。
      await page.waitForSelector("main", { state: "visible", timeout: 15_000 });
      await page.waitForTimeout(800);
      // 页面不能掉进全局错误边界（mock 缺接口时最典型的表现就是整页"页面加载出错"）
      await expect(page.getByText("页面加载出错")).toHaveCount(0);
      // 个别页面的异步数据（盘点任务/库存）可能晚一帧到 —— 用 poll 等布局落到最终态，
      // 避免偶发的"数据没回来时量到中间态"造成假红（真实溢出会一直溢出，poll 照样失败）。
      await expect
        .poll(() => horizontalOverflow(page), { timeout: 3000, intervals: [150] })
        .toBeLessThanOrEqual(1);
    });
  }
});

test.describe("移动端：侧边栏抽屉", () => {
  test("点菜单键打开、锁住页面滚动、点导航后自动收起", async ({ page }) => {
    await openAs(page, "member", "/");
    const aside = page.locator("aside");

    // 默认收起（translate-x-full），并且不出现在视口里
    await expect(aside).toHaveClass(/-translate-x-full/);

    await page.getByRole("button", { name: "打开菜单" }).click();
    await expect(aside).toHaveClass(/translate-x-0/);
    // 抽屉打开时背景不能跟着滚
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await aside.getByRole("link", { name: "学习库" }).click();
    await expect(page).toHaveURL(/\/study/);
    // 路由变化后自动收起，且解除滚动锁
    await expect(aside).toHaveClass(/-translate-x-full/);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });
});

test.describe("移动端：零件库存卡片", () => {
  test("移动端卡片展示领用/编辑入口，且长物料名不会把布局顶破", async ({ page }) => {
    // 故意给一个超长、无反斜杠的物料名（真实数据里粘进来的英文串/编号就是这样）
    const weirdItem = {
      id: 99, name: "N".repeat(120), category: "动力系统", quantity: 3, locationCode: "201-01-A-01",
      status: "available", grade: "B", unitPrice: 12, updatedAt: "2026-09-01T10:00:00Z",
    };
    await openAs(page, "admin", "/inventory", { items: [weirdItem] });
    await expect(page.getByRole("heading", { name: "零件库存" }).first()).toBeVisible();

    // 移动端卡片上的领用按钮（桌面表格是 sm: 以上才出现的，这里应是卡片里的那个）
    await expect(page.getByRole("button", { name: "领用" }).first()).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    // 卡片不能比视口宽
    const card = page.getByText("N".repeat(120)).locator("xpath=ancestor::div[contains(@class,'p-3')][1]");
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
  });

  test("添加零件弹窗完整落在视口内", async ({ page }) => {
    await openAs(page, "admin", "/inventory");
    await page.getByRole("button", { name: "添加零件" }).click();
    const panel = page.locator("div.fixed.z-50").last().locator("div.rounded-2xl").first();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThanOrEqual(844);
  });
});

test.describe("移动端：AI 运维对话", () => {
  test("超长 Markdown 消息（表格/长串）不撑宽页面", async ({ page }) => {
    // 这条覆盖的正是「消息气泡里的长表格/长串把 grid 列撑到 636px」的回归
    const longContent = [
      "## 健康检查",
      "",
      "| 指标 | 数据 | 评估 |",
      "| --- | --- | --- |",
      `| 24h 错误率 | 163/569 = **28.6%** | 严重偏高，需要立刻处理 |`,
      "",
      "`" + "very-long-token-".repeat(20) + "`",
    ].join("\n");
    await mockApi(page, "admin");
    await page.route("**/api/chat/sessions/admin-agent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ role: "assistant", content: longContent }]),
      }),
    );
    await page.addInitScript((t) => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto("/admin/ai-admin");
    await expect(page.getByText("健康检查").first()).toBeVisible();
    expect(await horizontalOverflow(page), "AI 对话气泡里的长内容把页面撑宽了").toBeLessThanOrEqual(1);
  });
});

test.describe("移动端：Wiki 阅读页", () => {
  test("目录是抽屉、正文可读且不横向溢出", async ({ page }) => {
    await openAs(page, "member", "/wiki/t1");
    await expect(page.getByText("介绍").first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // 手机端有「目录」按钮；点开后目录出现，抽屉里的文档可点
    await page.getByRole("button", { name: "目录" }).click();
    await page.getByRole("button", { name: "返回任务列表" }).first().click();
    await expect(page).toHaveURL(/\/wiki$/);
  });
});
