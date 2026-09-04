# 代码审查指导

> Agent 审查本项目代码的统一规范。与 `docs/AGENT_GUIDE.md`（开发约束）互补：开发文档管"怎么写"，本文档管"怎么审"。

---

## 一、审查流程

### 1. 界定审查范围

先通过 git 精确划定要看什么，避免审偏：

```powershell
# 已提交但未推送的改动（本地领先 remote）
git log main..origin/main --oneline
git diff origin/main..main --stat

# 工作区未提交改动（本次重点）
git status --short
git diff --stat

# 忽略换行符差异，只看"真实改动"
git diff -w --stat -- <path>
```

**换行符陷阱（Windows 必查）**：仓库 LF，Windows 检出可能变 CRLF，导致 87 个文件出现"假改动"（增删行数相等、数字几乎为 1）。判定方法：

```powershell
# 增删行数完全相等 = 疑似纯换行符噪音
git diff --numstat | ForEach-Object {
  if ($_ -match '^(\d+)\t(\d+)\t(.+)$') {
    if ($matches[1] -eq $matches[2] -and $matches[1] -lt 5) { $matches[3] }
  }
}
```

对疑似噪音文件，用 `git diff -w -- <file>` 复核；若 `-w` 后无输出则为纯噪音，**不参与实质审查**，但要在结论中单独提示，避免污染正常 diff。

### 2. 逐文件审查（按后端 → 前端 → 测试顺序）

- 行为变更先从后端（Services/Endpoints）入手，确认 API 契约
- 再对前端确认消费方是否同步
- 最后看测试是否覆盖了新行为

### 3. 验证（不建环境、不跑服务）

- 语言层语法错误可通过编译/构建发现，审查到可疑处先跑相关检查：
  - C#：`dotnet build src/TeamPortal/TeamPortal.csproj` 或定向单测
  - 前端：`cd web && npx vitest run <相关文件>`
  - Python：`python -m pytest tests/ai/`
- 跑测试以**确认现有功能不被破坏**，新功能行为用代码走查
- 修改过环境配置（如 ConnectionStrings）注意核对相对路径在真实运行目录下是否解析正确

### 4. 输出结论

按严重度分级，每个问题标注 `文件:行号`，最后给出通过/需修改。

---

## 二、通用检查清单

### 正确性
- [ ] 边界条件：空值、空串、`null`、非法枚举值是否有回退/校验
- [ ] 异步：`async/await` 是否完整、异常是否被吞掉（`catch {}` 空捕获要质疑）
- [ ] 状态更新：React `setState` 竞态、受控组件与草稿状态是否错位
- [ ] hooks 规则：`useEffect` 依赖数组是否漏项、是否在早期 `return` 之后调用 hooks

### 安全
- [ ] 路径遍历：文件操作是否校验 `../`（知识库/网盘等）
- [ ] 鉴权：新 Endpoint 是否缺授权策略
- [ ] 敏感配置：密钥是否硬编码，是否走环境变量/配置
- [ ] 输入校验：SQL 注入（应为 EF/参数化）、命令注入

### 项目约定
- [ ] Services 纯逻辑、不依赖 HTTP 上下文
- [ ] 前端 API 调用走 `lib/api.ts`，无直接 `fetch`
- [ ] TypeScript 无 `any`
- [ ] 单文件 ≤ 200 行
- [ ] 风格符合 `.editorconfig`（C# 4 空格 / TS 2 空格 / Python 4 空格）

### 测试覆盖
- [ ] 新增/变更功能是否配套测试
- [ ] C# Services 必须测；前端关键交互必测；Python 路由必测
- [ ] 测试是否真实断言了行为，而非仅"不报错"

### 破坏性与一致性
- [ ] 是否有破坏性 API 变更（应新建 v2 而非改签名）
- [ ] 配置/文档是否同步（`ARCHITECTURE.md` / `ROADMAP.md`）

---

## 三、首次应用：当前品牌主题改动专项清单

先跑以下命令确认改动边界，再逐项核对。

```powershell
git diff -w -- src/TeamPortal/Services/SettingsService.cs
git diff -w -- web/lib/brand.tsx
git diff -w -- web/app/globals.css
git diff -w -- "web/app/(protected)/admin/settings/page.tsx"
git diff -w -- src/TeamPortal/appsettings.json
git diff -w -- web/app/layout.tsx
```

### A. 后端 `SettingsService.cs`
- [ ] 4 套主题默认值入库（indigo/sky/light/warm），非法值是否回退 `indigo`
- [ ] `BrandConfig` 新增 `Theme` 字段是否为非空默认（调用方解构时不会 undefined）
- [ ] `PrimaryColor` 空值语义是否明确（留空随主题）

### B. 前端 `web/lib/brand.tsx`
- [ ] `applyTheme` 是否安全处理 SSR（`typeof document === "undefined"` 提前 return）
- [ ] `data-theme` 非法值是否回退默认；`primaryColor` 空值是否清除 CSS 变量
- [ ] `refresh()` 语义：管理员保存后是否真正让全局配色生效；context 合并是否保持旧消费方兼容
- [ ] 初始加载失败时是否兜底默认主题（不闪白屏/错色）

### C. `globals.css`
- [ ] 4 套 `data-theme` 变量 + 旧 `.dark`/新 `.light` 覆盖优先级是否正确（覆盖块定义在 theme 块之后）
- [ ] Tailwind 4 的 `@theme inline` 是否映射所有语义 token（`--color-*`）
- [ ] 检查组件中是否残留硬编码颜色（`bg-blue-500`/`text-zinc-*`/`dark:` 前缀）导致主题下不一致
- [ ] `color-scheme` 是否按明暗正确设置（影响滚动条/表单控件原生配色）

### D. 设置页 `admin/settings/page.tsx`
- [ ] 主题选中即存的交互是否有竞态（连点多个主题时网络响应乱序 → 以最后一个点击为准还是响应为准）
- [ ] `colorDraft` 受控输入与 `storedColor` 同步的 hooks 依赖是否正确
- [ ] 应用主色/恢复默认是否调用了 `refresh()` 让全局立即生效
- [ ] 敏感字段（key/secret）的显示、保存逻辑未被本次改动破坏

### E. 换行符噪音（已知 84+ 个文件，LF→CRLF）
- [ ] 是否全部为纯噪音（`git diff -w` 无输出），不参与实质审查
- [ ] 提交前是否与真实改动分离（建议噪音文件 `git checkout -- <file>` 还原，避免污染 PR diff）
- [ ] 若无法还原，需在 PR 说明中标注

### F. 环境配置 `appsettings.json`
- [ ] `ConnectionStrings` 从 `data/teamportal.db` 改为 `../../data/teamportal.db`：核对容器化与本地两种运行路径下是否能解析到同一个库
- [ ] 是否与 `docker-compose.yml` 的挂载路径、`quickstart.sh` 一致

### G. 其余文件
- [ ] `AppDbContext.cs.bak` 删除是否合理（若已迁完 Migration，可删）
- [ ] 是否需要为品牌主题补测试（`SettingsServiceTests.cs`、前端 `useBrand`/`applyTheme` 单测）

---

## 四、审查结论格式

```
## 审查结论：需要修改 / 建议合并

### 阻断问题（必须修复才能合并）
- [ ] `web/lib/brand.tsx:45` — applyTheme 在 SSR 下…（失败场景：…）

### 建议（不阻断）
- [ ] `src/...` — …

### 提醒事项
- 84 个文件为 LF→CRLF 换行符噪音，已排除，提交前请单独处理
- 未覆盖的测试缺口：…
```