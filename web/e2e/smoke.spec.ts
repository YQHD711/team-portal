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

const state = { approveCalls: 0, layoutPut: null as null | Record<string, unknown>, itemPost: null as null | Record<string, unknown>, firmwareDownload: null as null | string };

/** 物料布局用数据：一个房间 + 立体货架/柜子（坐标单位 cm） */
const layoutItems = [
  { id: 11, name: "桨叶", category: "动力系统", quantity: 5, locationCode: "201-A-1-01", status: "available", grade: "B", unitPrice: 45, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 12, name: "M3螺丝", category: "耗材", quantity: 2, locationCode: "201-A-3-05", status: "available", grade: "C", unitPrice: 0.5, updatedAt: "2026-09-01T10:00:00Z" },
];

/**
 * 学习库：一个阶段 + 一课，正文里刻意同时放「行内代码」「围栏代码块」
 * 以及一张很宽的表格与一张图片。
 * 代码块里那行超长命令是关键：`white-space: pre` 且不可断行，正是它把阅读区
 * 顶宽（1440 下整页溢出 118px、1280 下 278px），把右侧「本课大纲」挤出屏幕。
 */
const studyMarkdown = [
  "# 认识航模",
  "",
  "调用 `GEH_NEW_TRAJ` 生成轨迹，再交给 `EXEC_TRAJ` 执行。",
  "",
  "```bash",
  "echo hello",
  "sudo apt install --no-install-recommends build-essential cmake gdb git python3-pip libopencv-dev libeigen3-dev",
  "```",
  "",
  "| 部件 | 作用说明（这一列故意写得很长，用来把表格撑宽） | 参考型号 | 预计单价（元） | 备注 |",
  "| --- | --- | --- | --- | --- |",
  "| 飞控 | 负责姿态解算与航点导航，是整机核心计算单元，选型要考虑接口与固件生态 | Pixhawk 6X | 1280 | 队内统一 |",
  "| 电调 | 把飞控输出的 PWM/DShot 信号变成三相驱动电流，需与电机和电池匹配 | T-Motor F45A | 380 | 备件常备 |",
  "",
  "## 选型要点",
  "",
  "![接线示意](接线示意.png)",
  "",
  ...Array.from({ length: 25 }, (_, i) => `第 ${i + 1} 段：把课时正文撑长，用来验证翻页时滚动位置会回到开头。`).flatMap((p) => [p, ""]),
].join("\n");

const studyScope = {
  scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit: true,
  overviewPath: null, overview: null, completedCount: 0, lessonCount: 2,
  stages: [{
    title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit: true, descriptionPath: null,
    completedCount: 0,
    lessons: [
      { title: "认识航模", path: "飞训部/学习库/01-入门筑基/01-认识航模.md", canEdit: true, completed: false },
      { title: "安全规范", path: "飞训部/学习库/01-入门筑基/02-安全规范.md", canEdit: true, completed: false },
    ],
  }],
};

/** Wiki 详情页用的已完成任务（带可见性下拉等管理控件） */
const wikiTask = {
  id: "t1", type: "git", projectName: "ardupilot", status: "completed", errorMessage: null,
  visibility: "public", targetFolder: "公共", userId: 1,
  createdAt: "2026-09-11T02:00:00Z", completedAt: "2026-09-11T02:20:00Z", catalogJson: null,
};

const layoutRoom = {
  id: 1, roomCode: "201", roomName: "库房", floor: 1,
  cabinetCount: 2, shelfCount: 4, positionCount: 8, description: "航模器材库房",
  updatedAt: "2026-09-01T10:00:00Z",
  layoutJson: JSON.stringify({
    width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [],
    items: [
      { id: "it1", type: "shelf", name: "A货架", x: 100, y: 100, w: 300, h: 120, rotation: 0, locCode: "201-A", rows: 4, cols: 8 },
      { id: "it2", type: "cabinet", name: "B柜", x: 500, y: 100, w: 120, h: 80, rotation: 0, locCode: "201-B", rows: 2, cols: 2 },
    ],
  }),
};

/** 统一 mock 所有 /api/* 请求（按路径+方法分发） */
async function mockApi(page: Page, role: string, opts: { layouts?: unknown[]; items?: unknown[] } = {}) {
  const inventory = opts.items ?? items;
  const layouts = opts.layouts ?? [];
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
    if (path === "/api/inventory/meta") return json({ lowStockThreshold: 8, lowStockGrade: "C" });
    if (path === "/api/study/library") return json({ scopes: [studyScope] });
    if (path === "/api/knowledge/content") return json({ content: studyMarkdown });
    // 全局搜索：一条学习库结果 + 一条普通知识库结果（队员点下去要都能打开）
    if (path === "/api/search") {
      return json({
        knowledge: [
          { type: "study", title: "01-认识航模.md", snippet: "多旋翼靠桨叶…", path: "/study?lesson=" + encodeURIComponent("飞训部/学习库/01-入门筑基/01-认识航模.md") },
          { type: "knowledge", title: "公共资料.md", snippet: "公共资料摘要…", path: "/knowledge?path=" + encodeURIComponent("公共/资料/公共资料.md") },
        ],
        inventory: [], wiki: [], files: [],
      });
    }
    // 知识库图片：正文里的 ![](接线示意.png) 会带鉴权取这张图（1x1 PNG）
    if (path === "/api/knowledge/download") {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      return route.fulfill({ status: 200, contentType: "image/png", body: png });
    }
    // Wiki 详情页：任务 + 目录 + 正文
    if (/^\/api\/wiki\/tasks\/[^/]+$/.test(path)) return json(wikiTask);
    if (/^\/api\/wiki\/tasks\/[^/]+\/catalog$/.test(path)) return json([{ path: "getting-started", title: "快速开始" }]);
    if (/^\/api\/wiki\/tasks\/[^/]+\/doc$/.test(path)) return json({ content: "# 文档\n\n正文" });
    if (path === "/api/inventory" && method === "POST") {
      state.itemPost = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      return json({ id: 99, ...state.itemPost });
    }
    if (path.startsWith("/api/inventory")) return json(inventory);
    if (path === "/api/admin/departments") return json([]);
    // AI 系统管理员（只读运维助手）
    if (path === "/api/admin/agent/memory") return json({ total: 0, summaries: 0, byRole: [] });
    if (path === "/api/admin/agent/status") return json({ busy: false });
    if (path === "/api/admin/agent/tools") {
      return json([
        { name: "get_system_health", description: "系统健康总览：数据库连通性、日志写入通道积压。" },
        { name: "read_logs", description: "读取系统日志（默认最近 24 小时）。" },
      ]);
    }
    if (path === "/api/admin/agent/guide") {
      return json([{ topic: "发布与上线", content: "代码变更不走本系统：AI 运维助手不能改代码、不能编译、不能重启服务。" }]);
    }
    if (path.startsWith("/api/chat/sessions/")) return json([]);
    if (path === "/api/storage/layouts") return json(layouts);
    if (path === "/api/flightlogs") {
      return json({ logs: [{ filename: "flight-01.tlog", size: 204800, modified: 1780000000 }] });
    }
    if (path === "/api/wiki/tasks" && method === "GET") {
      return json([
        {
          id: "t1", type: "git", projectName: "ardupilot", status: "documents", errorMessage: null,
          visibility: "public", targetFolder: "公共", createdAt: "2026-09-11T02:00:00Z", completedAt: null,
          progress: { stage: "documents", done: 3, total: 12, note: "飞控驱动", updatedAt: "2026-09-11T02:05:00Z" },
        },
      ]);
    }
    if (path === "/api/wiki/settings") {
      return json({ contentModel: "deepseek-v4-pro", availableModels: ["deepseek-v4-pro", "deepseek-v4-flash"] });
    }
    if (path === "/api/firmware/sources") {
      return json({
        sources: [
          { id: "ardupilot", label: "ArduPilot", hint: "官方 firmware.ardupilot.org 目录", vehicles: [{ id: "Plane", label: "固定翼 Plane" }, { id: "Copter", label: "多旋翼 Copter" }] },
          { id: "px4", label: "PX4", hint: "官方 GitHub Releases", vehicles: [] },
        ],
      });
    }
    if (path === "/api/firmware/versions") {
      return json({ items: [{ id: "stable", label: "稳定版 stable", prerelease: false }, { id: "beta", label: "测试版 beta", prerelease: true }] });
    }
    if (path === "/api/firmware/boards") {
      return json({ items: [{ name: "Pixhawk6X", size: null }, { name: "CubeOrange", size: null }] });
    }
    if (path === "/api/firmware/assets") {
      return json({
        items: [
          { name: "arduplane.apj", kind: "apj", label: "APJ（Mission Planner / QGC 刷写，推荐）", size: 1538295 },
          { name: "arduplane_with_bl.hex", kind: "hex", label: "HEX（含 Bootloader，DFU / 烧录器）", size: 4966108 },
        ],
      });
    }
    if (path === "/api/firmware/download") {
      state.firmwareDownload = req.url();
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from("firmware") });
    }
    if (/\/api\/storage\/layouts\/\d+$/.test(path) && method === "PUT") {
      state.layoutPut = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      return json({});
    }
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
    // 低库存预警：阈值由后端 /api/inventory/meta 下发（mock 为 8），前端不得写死
    await expect(page.getByText(/种零件库存不足/)).toBeVisible();
    await expect(page.getByText(/低于 8 件/)).toBeVisible();
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

  test("物料布局：房间卡片 → 平面图 → 正视细节视图", async ({ page }) => {
    await mockApi(page, "member", { layouts: [layoutRoom], items: layoutItems });
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/inventory/layout");
    await expect(page.getByRole("heading", { name: "物料布局" })).toBeVisible();
    // 房间卡片：cm 尺寸与元素构成（单位统一 cm）
    await expect(page.getByText(/900 × 600 cm/)).toBeVisible();
    await expect(page.getByText(/立体货架×1 柜子×1/)).toBeVisible();

    // 进入房间：Konva 画布与按元素分组的物料面板
    await page.getByRole("button", { name: /库房/ }).click();
    await expect(page.getByTestId("layout-stage").locator("canvas").first()).toBeVisible();
    await expect(page.getByText(/物料挂载（2）/)).toBeVisible();
    await expect(page.getByText("1层01位")).toBeVisible();

    // 打开正视细节视图：层 × 位 网格 + 点格位看该格物料
    await page.getByTitle("正视细节视图").first().click();
    const dialog = page.locator("div.fixed.z-50").last();
    await expect(dialog.getByText("正视（层 × 位）")).toBeVisible();
    await expect(dialog.getByText("4 层 × 8 位")).toBeVisible();
    await dialog.getByTitle(/3层05位/).click();
    await expect(dialog.getByText(/格位明细 · 3层05位/)).toBeVisible();
    await expect(dialog.getByRole("listitem").filter({ hasText: "M3螺丝" })).toBeVisible();
  });

  test("物料布局编辑器：添加元素并保存为 cm 布局", async ({ page }) => {
    const state = await mockApi(page, "admin", { layouts: [layoutRoom], items: layoutItems });
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/inventory/layout");
    await page.getByRole("button", { name: /库房/ }).click();
    await page.getByRole("button", { name: "编辑平面图" }).click();

    // 编辑器元素面板（桌面侧栏）与工具栏
    await expect(page.getByRole("button", { name: "保存" })).toBeVisible();
    await expect(page.getByTitle("房间名称（房间号不可改）")).toHaveValue("库房");
    await expect(page.getByTitle("画布宽度（cm）")).toHaveValue("900");

    // 新增一个立体货架 → 可撤销
    const undo = page.getByTitle("撤销 (Ctrl+Z)");
    await expect(undo).toBeDisabled();
    await page.getByRole("button", { name: "立体货架" }).locator("visible=true").click();
    await expect(undo).toBeEnabled();

    // 保存：请求体为 cm 布局（unit=cm，元素含新增的货架）
    await page.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => state.layoutPut, { timeout: 10_000 }).not.toBeNull();
    const body = state.layoutPut as { layoutJson: string; cabinetCount: number };
    expect(body.layoutJson).toContain('"unit":"cm"');
    expect(JSON.parse(body.layoutJson).items).toHaveLength(3);
    expect(body.cabinetCount).toBe(3);
    // 保存后回到查看模式
    await expect(page.getByRole("button", { name: "编辑平面图" })).toBeVisible();
  });

  test("库存表单：库位编码由「房间 → 货架 → 层 → 位」联动生成", async ({ page }) => {
    const state = await mockApi(page, "admin", { layouts: [layoutRoom], items: layoutItems });
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/inventory");
    await page.getByRole("button", { name: "添加零件" }).click();

    // 名称是表单第一个输入框（该弹窗的 label 尚未与控件关联）
    await page.locator("div.fixed.z-50 form input").first().fill("测试桨叶");
    await page.getByLabel("房间").selectOption("201");
    await page.getByLabel("库位元素").selectOption("201-A");
    await page.getByLabel("层").selectOption("3");
    await page.getByLabel("位", { exact: true }).selectOption("5");
    await expect(page.locator("div.fixed.z-50").getByText("201-A-3-05")).toBeVisible();

    await page.locator("div.fixed.z-50").getByRole("button", { name: "添加零件" }).click();
    await expect.poll(() => state.itemPost?.locationCode, { timeout: 10_000 }).toBe("201-A-3-05");
  });

  test("飞行日志 / 固件：固件级联选择并经服务端代理下载", async ({ page }) => {
    const state = await mockApi(page, "member");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/flightlog");
    // 导航栏与页面标题都已改名：Topbar 横幅标题 + 页面正文标题
    await expect(page.getByRole("link", { name: "飞行日志 / 固件" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("heading", { name: "飞行日志 / 固件" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { name: "飞行日志 / 固件" })).toBeVisible();
    // 默认仍是日志文件 Tab，且日志列表正常渲染
    await expect(page.getByRole("tab", { name: "日志文件" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("flight-01.tlog")).toBeVisible();

    await page.getByRole("tab", { name: "固件下载" }).click();
    await expect(page.getByLabel("机型")).toHaveValue("Plane");
    await expect(page.getByLabel("版本")).toHaveValue("stable");

    // 搜索过滤飞控板（PX4 一个版本有 400+ 块）
    await page.getByLabel("搜索飞控板").fill("cube");
    await expect(page.getByLabel("飞控板", { exact: true }).locator("option")).toHaveCount(2);
    await page.getByLabel("搜索飞控板").fill("");

    await page.getByLabel("飞控板", { exact: true }).selectOption("Pixhawk6X");
    // 默认选中 APJ（最适合 Mission Planner / QGC 刷写）
    await expect(page.getByRole("radio", { name: "arduplane.apj" })).toBeChecked();

    await page.getByRole("button", { name: "下载固件" }).click();
    await expect.poll(() => state.firmwareDownload, { timeout: 10_000 }).not.toBeNull();
    const url = state.firmwareDownload as string;
    expect(url).toContain("asset=arduplane.apj");
    expect(url).toContain("board=Pixhawk6X");
    expect(url).toContain("vehicle=Plane");
    expect(url).toContain("version=stable");
  });

  test("Wiki 导入：任务阶段进度与可自由填写的模型名", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/wiki/import");
    await expect(page.getByRole("heading", { name: "Wiki 导入" })).toBeVisible();

    // 首屏就要有任务（此前只在提交/手动刷新后才拉列表）
    await expect(page.getByText("ardupilot")).toBeVisible();
    // 文档阶段：3/12 + 当前文档名，进度条是确定态
    await expect(
      page.getByRole("progressbar", { name: "ardupilot 生成进度" })
    ).toHaveAttribute("aria-valuenow", "25");
    await expect(page.getByText(/3 \/ 12/)).toBeVisible();
    await expect(page.getByText(/飞控驱动/)).toBeVisible();
    // 阶段条：生成流程任务应出现「审查」阶段
    await expect(page.getByTestId("wiki-task-t1").getByText("审查")).toHaveCount(1);

    // 模型名可自由填写：input + datalist 建议，不是写死的下拉
    const model = page.getByLabel("生成模型");
    await expect(model).toHaveAttribute("list");
    await model.fill("my-own-model-7b");
    await expect(model).toHaveValue("my-own-model-7b");
  });

  /**
   * Markdown 排版回归（真实浏览器 + 真实 CSS，jsdom 测不出来）：
   * 1. typography 默认给行内 code 注入一对反引号（::before/::after content:"`"），
   *    页面上会真的显示出来 —— 必须被去掉
   * 2. 围栏代码块外面不能再套一层 <pre>：SyntaxHighlighter 自带容器，
   *    两层叠加会让背景/内边距加倍、对比度变差
   */
  test("Markdown 排版：行内代码不带反引号、代码块不套两层", async ({ page }) => {
    await mockApi(page, "member");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/study");
    await page.getByRole("button", { name: "认识航模", exact: true }).click();

    const article = page.locator("article");
    await expect(article).toBeVisible();

    const inline = article.locator("p code").first();
    await expect(inline).toHaveText("GEH_NEW_TRAJ");
    const before = await inline.evaluate((el) => getComputedStyle(el, "::before").content);
    const after = await inline.evaluate((el) => getComputedStyle(el, "::after").content);
    expect(before, "行内代码左侧不该出现反引号").not.toContain("`");
    expect(after, "行内代码右侧不该出现反引号").not.toContain("`");

    await expect(article).toContainText("echo hello");
    await expect(article.locator("pre pre")).toHaveCount(0);
  });

  /**
   * 学习库课时页的布局宽度。
   *
   * 回归：阅读区是 `grid-cols-[1fr_180px]`，而 grid 项默认 `min-width:auto`，
   * 正文里一张宽表格就能把 1fr 撑到内容宽度 —— 1440 下整页溢出 118px、
   * 1280 下溢出 278px，右侧「本课大纲」被挤出屏幕外（看起来像被裁掉了）。
   * 这里直接量文档宽度，不看截图。
   */
  for (const width of [1280, 1440]) {
    test(`学习库课时页在 ${width}px 下没有横向溢出`, async ({ page }) => {
      await mockApi(page, "member");
      await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));
      await page.setViewportSize({ width, height: 900 });

      await page.goto("/study");
      await page.getByRole("button", { name: "认识航模", exact: true }).click();
      await expect(page.locator("article .prose")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${width}px 下不该出现横向滚动条（右侧大纲会被挤出屏幕）`).toBeLessThanOrEqual(0);

      // 大纲确实在视口内（而不是被推到屏幕外）
      const toc = await page.getByText("本课大纲").boundingBox();
      expect(toc, "大纲应可见").not.toBeNull();
      expect(toc!.x + toc!.width).toBeLessThanOrEqual(width);
    });
  }

  test("学习库课时页能显示文档里的图片（带鉴权取回）", async ({ page }) => {
    await mockApi(page, "member");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/study");
    await page.getByRole("button", { name: "认识航模", exact: true }).click();

    const img = page.locator("article figure img");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", /^blob:/);
  });

  /**
   * 回归：在课时页点「编辑本库」，无论当前在第几章都固定跳到**学习库根目录**
   * （知识库页再把目录解析成第一份文档 `_学习路径.md`），等于"从哪点都回到根"。
   * 打开着课时时应该直接编辑那一课。
   */
  test("课时页的编辑按钮指向当前课时（而不是学习库根目录）", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/study");
    // 路径总览页：这时才指向库根
    await expect(page.getByRole("link", { name: "编辑本库" }))
      .toHaveAttribute("href", "/admin/knowledge?path=" + encodeURIComponent("飞训部/学习库"));

    await page.getByRole("button", { name: "安全规范", exact: true }).click();

    const edit = page.getByRole("link", { name: "编辑本课" });
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAttribute(
      "href", "/admin/knowledge?path=" + encodeURIComponent("飞训部/学习库/01-入门筑基/02-安全规范.md"));
  });

  /**
   * 回归：上一课读到末尾再点「下一课」，浏览器沿用同一个 scrollY，
   * 新课时更短时会被夹到它的文末 —— 读起来就像"跳到下一篇的结尾"。
   */
  test("翻到下一课时回到正文开头", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/study");
    await page.getByRole("button", { name: "认识航模", exact: true }).click();
    await expect(page.locator("article .prose")).toBeVisible();
    await expect(page.getByText("第 1 / 2 课")).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bottom = await page.evaluate(() => Math.round(window.scrollY));
    expect(bottom, "页面要足够长才测得出翻页滚动").toBeGreaterThan(300);

    await page.locator("button", { hasText: /下一课/ }).first().click();
    await expect(page.getByText("第 2 / 2 课")).toBeVisible();   // 确实翻到了下一课
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 5000 })
      .toBeLessThan(150);
  });

  /**
   * Wiki 详情页的可见性下拉（"修改所属"）。
   * 回归：它和「检查修正」「补齐缺失文档」一起被塞进 256px 宽的左侧栏头部，
   * 总宽超出容器 → 最右边的下拉被挤出/被右侧主面板盖住，**看得见但点不到**。
   * 这里用 Playwright 的 click（会校验元素真的接收到了指针事件）来复现。
   */
  test("Wiki 详情：修改可见性的下拉真的能点到", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/wiki/t1");

    const select = page.locator("select");
    await expect(select).toBeVisible();
    await select.click();
    await select.selectOption("department");
    await expect(select).toHaveValue("department");
  });
});

test.describe("AI 系统管理员（只读运维助手）", () => {
  test("页面不提供代码提案与维护模式入口，且能展示工具清单与手册", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/admin/ai-admin");

    await expect(page.getByRole("heading", { name: "AI 系统管理员" })).toBeVisible();
    // 用 .first()：同一个 <p> 偶尔会被文本引擎匹配两次（strict mode 冲突会让这条
    // 断言随机变红，并连带把 main 上的 CD 卡住 —— 2026-09-25 就因此漏了一次部署）
    await expect(page.getByText(/只读运维助手/).first()).toBeVisible();

    // 被下线的能力不得留任何入口（按钮/文案都不行）
    await expect(page.getByText("代码提案")).toHaveCount(0);
    await expect(page.getByText("维护模式")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /应用（需手动重启）/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /变更历史/ })).toHaveCount(0);

    // 能力与手册 Tab：工具清单与手册从后端取
    await page.getByRole("button", { name: "能力与手册" }).click();
    await expect(page.getByText("get_system_health").first()).toBeVisible();
    await expect(page.getByText("发布与上线").first()).toBeVisible();
  });
});

test.describe("全局搜索", () => {
  /**
   * 知识库本体是管理端内容：编辑器在 /admin 下，非 staff 会被 AuthGuard 踢回首页。
   * 所以队员的搜索结果里**不出现**知识库文档，只保留学习库；点学习库结果直接进那一课。
   * （旧实现把知识库结果也发给队员，还指向 /admin/knowledge —— 点一下就被弹回首页。）
   */
  test("队员搜索：只有学习库结果，点进去落到那一课", async ({ page }) => {
    await mockApi(page, "member");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/");
    await page.getByRole("button", { name: /搜索/ }).first().click();
    await page.getByPlaceholder("搜索知识库、库存、Wiki、文件...").fill("航模");

    const result = page.getByRole("button", { name: /01-认识航模\.md/ });
    await expect(result).toBeVisible();
    await expect(result).toContainText("学习库");   // 标签要看出这是学习库内容
    // 注：「队员拿不到非学习库结果」是后端过滤（SearchEndpoints.ShouldIncludeKnowledgeResult），
    // 由 tests/api/SearchTargetTests.cs 覆盖；这里的 mock 不模拟角色差异。

    await result.click();

    await expect(page).toHaveURL(/\/study\?lesson=/);
    await expect(page.getByText("第 1 / 2 课")).toBeVisible();   // 直接落在那一课
  });

  test("部长搜索：知识库结果照旧进编辑器", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/");
    await page.getByRole("button", { name: /搜索/ }).first().click();
    await page.getByPlaceholder("搜索知识库、库存、Wiki、文件...").fill("公共");

    const kb = page.getByRole("button", { name: /公共资料\.md/ });
    await expect(kb).toBeVisible();
    await expect(kb).toContainText("知识库");
  });
});

test.describe("布局", () => {
  /**
   * 回归：桌面端侧栏原来是 `lg:static` + `h-full`，而 h-full 会撑成**整个文档高度**，
   * 于是页面一长（学习库课时、Wiki 文档这类长正文）导航栏就跟着滚上去消失了。
   * 现在桌面端是 sticky + h-screen，钉在视口里。
   */
  test("左侧导航不随页面滚动滑走", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/study");
    await page.getByRole("button", { name: "认识航模", exact: true }).click();
    await expect(page.locator("article .prose")).toBeVisible();

    const aside = page.locator("aside").first();
    const before = await aside.boundingBox();
    expect(before).not.toBeNull();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrolled = await page.evaluate(() => Math.round(window.scrollY));
    expect(scrolled, "页面要够长才测得出滚动").toBeGreaterThan(300);

    const after = await aside.boundingBox();
    expect(Math.abs((after?.y ?? -999) - (before?.y ?? 0)), "导航栏位置不该随滚动改变").toBeLessThan(5);
    // 导航内容还在视口里（不是滚出屏幕）
    await expect(page.getByRole("link", { name: "学习库" }).first()).toBeInViewport();
  });
});

test.describe("路由完整性守卫", () => {
  // 防止源码被构建遗漏(如被 .gitignore 误伤)导致整页 404
  test("关键路由不存在404", async ({ request }) => {
    for (const route of [
      "/admin/logs", "/admin/users", "/admin/settings", "/admin/backup",
      "/finance", "/inventory", "/inventory/layout", "/profile", "/flightlog",
      "/study",
    ]) {
      const res = await request.get(route);
      expect(res.status(), `${route} 不应是404(路由疑似被构建遗漏)`).not.toBe(404);
    }
  });
});
