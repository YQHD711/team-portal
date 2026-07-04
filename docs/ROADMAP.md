# 开发路线图

> 每个 Phase 由独立 Agent 完成，完成后跑 `make test` 验证

---

## Phase 0: 环境搭建（预计 0.5 天）

### 0.1 脚手架初始化 ✅ (2026-07-04)
- [x] `web/`: `npx create-next-app@latest . --typescript --tailwind --app --src-dir=false`
- [x] `src/TeamPortal/`: `dotnet new webapi --use-minimal-apis`
- [x] `ai-service/`: 手动建 `main.py` + `requirements.txt`
- [x] `docker-compose.yml`: 3 容器编排
- [x] `Makefile`: build / test / dev / deploy
- [x] `.github/workflows/ci.yml`: 自动测试流水线
- [x] `README.md`: 项目说明 + 快速开始

**验证:** `make build` 三端编译通过 ✅

### 0.2 组件库 + 主题 ✅ (2026-07-04)
- [x] Radix UI 组件安装 + Tailwind CSS 配置
- [x] 全局布局: 侧边栏导航 + 顶栏
- [x] 暗色/亮色主题切换
- [x] 响应式适配

**验证:** `npm run dev` 能看到带导航的空白首页 ✅

---

## Phase 1: 认证系统 ✅ (2026-07-04)

### 1.1 后端认证
- [x] User 模型 (EF Core): Id, Username, PasswordHash, Role
- [x] POST /api/auth/register
- [x] POST /api/auth/login → JWT Token
- [x] 中间件: JWT Bearer 验证
- [x] 种子数据: admin 账号

### 1.2 前端登录页
- [x] 登录/注册表单
- [x] Token 存储 (LocalStorage)
- [x] 路由守卫: 未登录跳转登录页
- [x] 用户下拉菜单 (退出)

**验证:** 注册 → 登录 → 看到仪表盘 ✅

---

## Phase 2: 知识库 ✅ (2026-07-04)

### 2.1 后端 API
- [x] GET /api/knowledge/tree: 遍历 data/knowledge/ 目录
- [x] GET /api/knowledge/content?path=...: 读取 .md 文件内容
- [x] 路径遍历安全防护

### 2.2 前端知识库页
- [x] 左侧目录树 (递归渲染)
- [x] 右侧 MDX 内容渲染
  - react-markdown + remark-gfm (表格)
  - react-syntax-highlighter (代码高亮)
  - mermaid (流程图)
- [x] 响应式: 可折叠目录树

**验证:** 往 data/knowledge/ 放一个 .md → 页面能看到格式化渲染 ✅

---

## Phase 3: 零件库存 ✅ (2026-07-04)

### 3.1 Excel 读取
- [x] ai-service: /api/parse/excel → openpyxl 读 Excel → JSON
- [x] C# InventoryService: 调 Python API 获取数据
- [x] GET /api/inventory: 返回零件列表
- [x] POST /api/inventory: 新增零件
- [x] PUT /api/inventory/{id}: 更新数量/位置

### 3.2 前端库存页
- [x] 搜索框 + 分类筛选
- [x] 表格: 名称 / 类别 / 数量 / 位置 / 状态
- [x] recharts: 各类别零件数量饼图
- [x] 数量低于阈值高亮警告

**验证:** data/inventory.xlsx → API 返回 JSON → 前端展示 ✅

---

## Phase 4: AI 问答（预计 0.5 天）

### 4.1 AI 服务
- [ ] ai-service: POST /api/ai/chat → DeepSeek API (SSE)
- [ ] ai-service: POST /api/ai/search → 全文检索 + RAG prompt
- [ ] C# AiProxyService: HttpClient 转调

### 4.2 前端 AI 对话
- [ ] 仪表盘聊天面板
- [ ] SSE 流式打字效果
- [ ] 对话历史 (仅会话级，不持久化)

**验证:** 问 "CUADC 报名截止日期" → 从知识库检索 → 返回答案

---

## Phase 5: 飞行日志（预计 1 天）

### 5.1 日志解析
- [ ] ai-service: POST /api/logs/parse → pymavlink 解析 .tlog
- [ ] GET /api/flightlogs: 扫描目录 + 摘要列表
- [ ] GET /api/flightlogs/{filename}: 完整解析数据 JSON

### 5.2 前端日志页
- [ ] 日志文件列表 (日期 / 机型 / 时长)
- [ ] recharts: 高度/速度/姿态 时间序列图
- [ ] 单条日志详情: 起降时间、最大高度、GPS 轨迹

**验证:** 放一个 .tlog → 能看到飞行轨迹图

---

## Phase 6: 部署上线（预计 0.5 天）

- [ ] 服务器 Docker 安装 (如未装)
- [ ] `git clone` + `docker compose up -d`
- [ ] Nginx 反向代理 + HTTPS
- [ ] 数据目录备份 cron
- [ ] 健康检查: `make health`

**验证:** https://team.yourdomain.com 可访问

---

## 总计

| Phase | 内容 | 预计 |
|---|---|---|
| 0 | 环境搭建 | 0.5 天 |
| 1 | 认证 | 0.5 天 |
| 2 | 知识库 | 1 天 |
| 3 | 零件库存 | 1 天 |
| 4 | AI 问答 | 0.5 天 |
| 5 | 飞行日志 | 1 天 |
| 6 | 部署 | 0.5 天 |
| **合计** | | **5 天** (Agent 并行时 3 天) |
