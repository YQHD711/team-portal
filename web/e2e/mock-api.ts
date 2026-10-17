import type { Page, Route } from "@playwright/test";

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

/** 伪造 JWT（与后端 payload 结构一致，仅前端解析 role 用） */
export const makeToken = (role: string) => {
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

export const items = [
  { id: 1, name: "桨叶", category: "动力系统", quantity: 2, locationCode: "201-01-A-01", status: "available", grade: "B", unitPrice: 45, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 2, name: "飞控板", category: "飞控系统", quantity: 5, locationCode: "201-01-B-02", status: "in_use", grade: "A", unitPrice: 1200, updatedAt: "2026-09-01T10:00:00Z" },
  { id: 3, name: "M3螺丝", category: "耗材", quantity: 7, locationCode: "1012-C-01-03", status: "available", grade: "C", unitPrice: 0.5, updatedAt: "2026-09-01T10:00:00Z" },
];

const state = { approveCalls: 0, layoutPut: null as null | Record<string, unknown>, itemPost: null as null | Record<string, unknown>, firmwareDownload: null as null | string };

/** 物料布局用数据：一个房间 + 立体货架/柜子（坐标单位 cm） */
export const layoutItems = [
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

export const layoutRoom = {
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
export async function mockApi(page: Page, role: string, opts: { layouts?: unknown[]; items?: unknown[] } = {}) {
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
    // 全局搜索：学习库结果（进学习库那课）、wiki 正文（进 wiki 阅读页那篇）、普通知识库文档（进编辑器）
    if (path === "/api/search") {
      return json({
        knowledge: [
          { type: "study", title: "01-认识航模.md", snippet: "多旋翼靠桨叶…", path: "/study?lesson=" + encodeURIComponent("飞训部/学习库/01-入门筑基/01-认识航模.md") },
          { type: "wiki", title: "01-概览.md", snippet: "wiki 正文摘要…", path: "/wiki/t1?doc=" + encodeURIComponent("getting-started/intro") },
          { type: "knowledge", title: "公共资料.md", snippet: "公共资料摘要…", path: "/admin/knowledge?path=" + encodeURIComponent("公共/资料/公共资料.md") },
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
    if (/^\/api\/wiki\/tasks\/[^/]+\/catalog$/.test(path)) {
      return json([{ path: "getting-started", title: "快速开始", children: [{ path: "getting-started/intro", title: "介绍" }] }]);
    }
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
      // 注意：不再返回 `availableModels` —— 那份后端写死的模型列表已删，
      // Wiki 页面的候选统一走 /api/admin/ai/models（与系统设置同源）
      return json({
        catalogModel: "", contentModel: "", maxOutputTokens: 32768, parallelCount: 3,
        maxRetryAttempts: 2, retryDelayMs: 2000, directoryTreeMaxDepth: -1, readmeMaxLength: 10000,
        documentGenerationTimeoutMinutes: 120, temperature: 1, topP: 1, thinkingMode: "thinking", documentLanguage: "zh-CN",
      });
    }
    if (path === "/api/admin/ai/models") {
      return json({ ok: true, error: null, baseUrl: "https://api.deepseek.com", models: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] });
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
    // 列表类接口：页面直接 .map/.length，返回 {} 会渲染崩溃（移动端回归里会跑到这两页）
    if (path === "/api/files") return json([]);
    if (path === "/api/incidents" || path === "/api/batteries") return json([]);
    // 领用 / 盘点：页面把响应当数组直接 .map，默认的 {} 会让整页掉进错误边界
    if (path.startsWith("/api/material/")) return json([]);
    if (path === "/api/admin/users") {
      return json([{ id: 1, username: "admin", role: "admin", department: null, departmentId: null, createdAt: "2026-09-01T10:00:00Z" }]);
    }
    return json({});
  });
  return state;
}
