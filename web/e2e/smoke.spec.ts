import { test, expect } from "@playwright/test";
import { mockApi, makeToken, items, layoutItems, layoutRoom } from "./mock-api";

/**
 * E2E 冒烟：登录 → 仪表盘 → 采购审批 → 零件库存。
 * 所有 /api/* 请求走 route mock（无真实后端），验证前端路由守卫、页面渲染与交互闭环。
 */
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
    // 日志上传功能已删除：不再有「日志文件」Tab；默认落在「诊断」
    await expect(page.getByRole("tab", { name: "日志文件" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "诊断" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("diagnosis-dropzone")).toBeVisible();

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

  test("Wiki 导入（已并入 Wiki 设置）：任务阶段进度与可自由填写的模型名", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    // 用户要求「wiki导入和wiki设置合并」：导入现在是 Wiki 设置页的「导入仓库」页签
    await page.goto("/admin/wiki-settings?tab=import");
    await expect(page.getByRole("heading", { name: "Wiki 设置" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "导入仓库" })).toHaveAttribute("aria-selected", "true");

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

    // 模型名可自由填写：input + 自己画的下拉建议（原生 datalist 点箭头不可靠，见 ModelInput），不是写死的 select
    const model = page.getByLabel("生成模型");
    await page.getByTestId("model-input-toggle").first().click();
    await expect(page.locator('[data-testid="model-input-options"] [role="option"]')).toHaveCount(2);
    await page.getByTestId("model-option-deepseek-v4-flash").click();
    await expect(model).toHaveValue("deepseek-v4-flash");
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

  /**
   * wiki 正文存在知识库目录里，但要能搜到并跳回 wiki 阅读页（而不是知识库编辑器）。
   * 旧实现只按**项目名**匹配 wiki，正文完全搜不到。
   */
  test("搜索能搜到 wiki 正文并直接打开那一篇", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    const docRequests: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/doc?")) docRequests.push(decodeURIComponent(r.url())); });

    await page.goto("/");
    await page.getByRole("button", { name: /搜索/ }).first().click();
    await page.getByPlaceholder("搜索知识库、库存、Wiki、文件...").fill("概览");

    const result = page.getByRole("button", { name: /01-概览\.md/ });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Wiki");
    await result.click();

    await expect(page).toHaveURL(/\/wiki\/t1\?doc=getting-started(%2F|\/)intro/);
    // 打开的是结果里那一篇，而不是默认的第一篇
    await expect.poll(() => docRequests.some(u => u.includes("path=getting-started/intro"))).toBe(true);
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

test.describe("删除按钮可见性", () => {
  /**
   * 回归：wiki 列表卡片上那个是 `text-zinc-300 + opacity-0`，不 hover **完全看不见**；
   * 任务队列里那个是 `text-faint`（浅到几乎看不见）。
   * 注意 Playwright 的 toBeVisible 会把 opacity:0 当成可见，所以必须读计算样式。
   */
  test("删除按钮默认可见、且是危险色", async ({ page }) => {
    await mockApi(page, "admin");
    await page.addInitScript((token) => localStorage.setItem("token", token), makeToken("admin"));

    await page.goto("/admin/wiki-settings?tab=import");

    const del = page.locator('button[title="删除任务"]').first();
    await expect(del).toBeVisible();
    // 危险色 token 真的挂在按钮上
    await expect(del).toHaveClass(/text-danger/);
    const style = await del.evaluate((el) => {
      const s = getComputedStyle(el);
      return { opacity: s.opacity, color: s.color };
    });

    expect(style.opacity, "删除按钮不该默认透明").toBe("1");

    // 关键断言：不能再用 text-faint 那个浅灰。
    // 注意 Tailwind 4 对带透明度的主题色会算成 oklab()，所以这里不解析具体色值，
    // 而是拿一个探针元素取 text-faint 的实际颜色来对比 —— 与颜色空间无关。
    const faint = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "text-faint";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(style.color, "删除按钮不该用 text-faint 那种浅灰").not.toBe(faint);
  });
});

test.describe("登录页全屏背景与缩放", () => {
  /**
   * 回归：auth 布局是 flex 居中但没给子节点 w-full，子节点作为 flex item 只缩到
   * 卡片宽度（~384px）。登录页里那些 `absolute inset-0` 的渐变/光斑铺的是这个节点的范围，
   * 于是大屏上只铺成中间一条竖带，两边留大片纯色 —— 看着像半成品。
   */
  test("大屏下背景铺满视口", async ({ page }) => {
    await mockApi(page, "member");
    await page.setViewportSize({ width: 1600, height: 900 });

    // 登录页与注册页是同一套结构，一起守
    for (const route of ["/auth/login", "/auth/register"]) {
      await page.goto(route);

      const box = await page.getByTestId("auth-page").boundingBox();
      expect(box, `${route}: 找不到根容器`).not.toBeNull();
      expect(box!.width, `${route}: 背景容器宽度应铺满视口`).toBeGreaterThanOrEqual(1599);
      expect(box!.height, `${route}: 背景容器高度应铺满视口`).toBeGreaterThanOrEqual(899);
    }
  });

  test("没禁用双指缩放", async ({ page }) => {
    await mockApi(page, "member");
    await page.goto("/auth/login");

    const content = (await page.locator('meta[name="viewport"]').getAttribute("content")) ?? "";
    expect(content, "maximum-scale 会禁掉缩放，对视力不佳的用户不友好").not.toMatch(/maximum-scale/i);
    expect(content).not.toMatch(/user-scalable\s*=\s*no/i);
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
