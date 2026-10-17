import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * **标签模板设计器：改「用途」必须真的存下来**（用户实测 bug 回归）
 *
 * 用户原话：「这个我改为库位标签，但是一点保存就自动变回物料标签是怎么回事」
 * 根因两层（都在前端）：
 *  ① `toWritePayload` 漏发 `kind` → 后端 POST 默认 material / PUT 视为"保持原值"
 *  ② `normalizeTemplate` 漏读 `kind` → 后端就算存了 location，前端归一化后又变回 material
 * 另外设计器右侧的「用途」控件曾被脚本复制成 3 份（界面上出现两个"用途"）。
 *
 * 判据（全 mock，不打生产线）：
 *  - 点保存时 **请求体里必须有 kind:"location"**
 *  - 保存后（用后端回显的响应）**下拉值仍是 location**，页面上只有一个「用途」控件
 */
const RC = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const tok = (r: string) => `e2e.${Buffer.from(JSON.stringify({ [RC]: r, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.sig`;
const MM = 72 / 25.4;

const TPL = {
  id: 1, name: "默认 80×50", kind: "material", isDefault: true, widthMm: 80, heightMm: 50,
  dpi: 300, background: "#FFFFFF",
  elements: [{ id: "el1", type: "text", x: 4, y: 6, w: 40, h: 8, field: "code", fontSizePt: 12, fontWeight: 700, fontFamily: "mono", color: "#111111", align: "center", autoShrink: true }],
};

async function setup(page: Page): Promise<{ bodies: Record<string, unknown>[] }> {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/**", async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "admin", role: "admin", department: "管理委员会" });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/label-templates" && req.method() === "GET") return json({ templates: [TPL] });
    if (/^\/api\/label-templates\/\d+$/.test(p) && req.method() === "PUT") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      bodies.push(body);
      return json({ ...TPL, ...body });     // 回显：模拟后端把存下来的原样返回
    }
    return json({});
  });
  await page.addInitScript(t => localStorage.setItem("token", t), tok("admin"));
  await page.goto("/admin/label-templates");
  await expect(page.getByTestId("template-kind")).toBeVisible();
  return { bodies };
}

test("改「用途」为库位标签 → 保存请求带 kind=location，保存后仍是库位标签", async ({ page }) => {
  const { bodies } = await setup(page);

  // 曾经被脚本复制成 3 个重复控件（界面上出现两个"用途"）
  await expect(page.getByTestId("template-kind")).toHaveCount(1);

  await page.getByTestId("template-kind").selectOption("location");
  await page.getByTestId("template-save").click();

  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].kind).toBe("location");
  // 保存后界面不能回退成物料（normalizeTemplate 漏读 kind 时这里会变成 material）
  await expect(page.getByTestId("template-kind")).toHaveValue("location");
});

test("库位标签保存后：导出库位标签会选中它（60×40 尺寸可辨）", async ({ page }) => {
  // 这条用例只需证明「设计器存下来的 kind=location 能被导出链路认出来」
  // ⚠️ 只注册一个 catch-all：Playwright 的 route 是后注册优先，分多条会把先注册的覆盖掉。
  await page.route("**/api/**", async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "admin", role: "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "x", teamSubtitle: "y", systemTitle: "z", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/label-templates") {
      return json({ templates: [{ ...TPL, id: 2, name: "库位 60×40", kind: "location", widthMm: 60, heightMm: 40 }] });
    }
    if (p === "/api/storage/layouts") {
      return json([{ id: 1, roomCode: "6011", roomName: "库房", floor: 1,
        layoutJson: JSON.stringify({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [],
          items: [{ id: "d1", type: "device", name: "图传", x: 100, y: 100, w: 60, h: 60, rotation: 0, locCode: "6011-A-1-01" }] }) }]);
    }
    if (p === "/api/storage/layouts/6011/items") return json([]);
    if (p === "/api/inventory/meta") return json({ lowStockThreshold: 8, lowStockGrade: "C" });
    if (p === "/api/inventory") return json([]);
    return json({});
  });
  await page.addInitScript(t => localStorage.setItem("token", t), tok("admin"));
  page.on("dialog", d => void d.accept());

  await page.goto("/inventory/layout");
  await page.getByRole("button", { name: /库房/ }).click();
  await page.getByRole("button", { name: /编辑平面图/ }).click();
  await expect(page.locator("canvas").first()).toBeVisible();

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-location-labels").click()]);
  const text = readFileSync((await dl.path())!).toString("latin1");
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  const mm = `${(Number(box![1]) / MM).toFixed(1)}×${(Number(box![2]) / MM).toFixed(1)}`;
  console.log(`DESIGNER-KIND 导出页面=${mm}mm（期望 60.0×40.0 —— 说明用的是设计器存下的库位模板）`);
  expect(mm).toBe("60.0×40.0");
});
