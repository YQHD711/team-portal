# 雏鹰之翼航模队管理系统 — 架构设计文档

> 创建: 2026-06-22 | 更新: 2026-09-06 | 状态: 已上线 v1.0

---

## 一、产品定位

"雏鹰之翼"航模队管理与运营系统，独立于 OpenDeepWiki（参考其文档处理模式）。

**核心功能:**
- 知识库: 队员手册、调参指南、竞赛规则（MDX 渲染 + 代码高亮 + Mermaid 流程图）
- 零件库存: 零件索引、借用归还、用量统计
- 飞行日志: .tlog 解析 + recharts 可视化
- AI 助手: 问答搜索（DeepSeek API SSE 流式）
- 管理后台: 用户/部门/资料 CRUD + 权限系统
- 文档上传: PDF/DOCX/MD 自动提取文本入库

**角色系统（2026-09 更新）:**
| 角色 | 权限范围 |
|---|---|
| admin | 全部功能。另独享：系统设置 / 系统日志 / 回收站 / 备份恢复 / 云存储 / AI 管理员、部门增删改、添加/删除队员、邀请码全量、领用管理员终审 |
| 部长（按部门） | 组织架构/盘点/档案等**只在本部门内自主**：可编辑本部门任何非 admin（含同部门部长、自己）的账号（角色 member↔部长、可调部门）、盘点管理权（仅自己发起的）；可生成并管理自己发出的邀请码。**不可**：见/动其它部门与未分配成员、触碰 admin、授予 admin、进 6 个 admin-only 管理页 |
| member | 查看公共仪表盘/库存、发起领用与采购申请（走审批）、提交自己的盘点任务（仅进行中）、编辑自己档案的自填字段 |

> 前端 `/admin` 导航按角色收敛；`/api/admin/logs`、`/api/admin/trash`、部门写接口、users 增/删为 AdminOnly，users 改由后端按“部长本部门内、不可 admin”校验。

---

## 二、技术架构

```
浏览器
  │
  ▼
Next.js 前端 (web/)           Python 辅助服务 (ai-service/)
  │ 独立项目                      │ FastAPI :9001
  │ Tailwind CSS 4 + Radix UI    ├── /api/ai/chat
  │ recharts + mermaid            ├── /api/ai/search
  │ MDX 渲染                      └── /api/logs/{file}
  │                              │
  ▼                              │ pymavlink / openpyxl / httpx
ASP.NET Core 后端 (src/TeamPortal/)
  │ Minimal API :8080
  │ EF Core + SQLite
  │ JWT 认证
  │
  ▼
服务器文件系统 (data/)
  ├── knowledge/*.md
  ├── inventory.xlsx
  └── flightlogs/*.tlog
```

### 三容器 Docker Compose

| 容器 | 镜像 | 端口 | 职责 |
|---|---|---|---|
| frontend | node:24-alpine | 3000 | Next.js SSR |
| backend | mcr.microsoft.com/dotnet/aspnet:10.0 | 8080 | ASP.NET Core API |
| ai-service | python:3.11-slim | 9001 | FastAPI 辅助 |

---

## 三、目录结构

```
team-portal/
├── web/                        # Next.js 前端
│   ├── app/
│   │   ├── layout.tsx          # 全局布局 + 导航
│   │   ├── page.tsx            # 仪表盘首页
│   │   ├── knowledge/          # 知识库 (MDX)
│   │   │   └── [...slug]/page.tsx
│   │   ├── inventory/          # 零件库存
│   │   │   └── page.tsx
│   │   └── flightlog/          # 飞行日志
│   │       └── page.tsx
│   ├── components/
│   │   ├── ui/                 # 原子组件
│   │   └── layout/             # 布局组件
│   └── lib/
│       └── api.ts              # 后端 API 类型定义
│
├── src/TeamPortal/             # ASP.NET Core 后端
│   ├── Program.cs              # 入口 (Minimal API)
│   ├── Endpoints/
│   │   ├── AuthEndpoints.cs    # POST /api/auth/register, /api/auth/login
│   │   ├── InventoryEndpoints.cs   # GET/POST /api/inventory
│   │   ├── KnowledgeEndpoints.cs   # GET /api/knowledge/*
│   │   └── FlightLogEndpoints.cs   # GET /api/flightlogs
│   ├── Services/
│   │   ├── InventoryService.cs     # openpyxl 读 Excel
│   │   ├── KnowledgeService.cs     # 读本地 .md 文件
│   │   ├── FlightLogService.cs     # 调 Python 解析 .tlog
│   │   └── AiProxyService.cs       # 转调 ai-service
│   ├── Data/
│   │   ├── AppDbContext.cs         # EF Core SQLite
│   │   └── Models/                 # User, InventoryItem
│   └── TeamPortal.csproj
│
├── ai-service/                 # Python FastAPI 辅助
│   ├── main.py                 # 入口
│   ├── routes/
│   │   ├── chat.py             # /api/ai/chat
│   │   ├── search.py           # /api/ai/search
│   │   └── logs.py             # /api/logs/{file}
│   ├── requirements.txt
│   └── Dockerfile
│
├── data/                       # 数据 (Git 忽略)
│   ├── knowledge/              # Markdown 知识库文件
│   ├── inventory.xlsx          # 零件索引表
│   └── flightlogs/             # .tlog 飞行日志
│
├── tests/
│   ├── api/                    # xUnit (C#)
│   ├── web/                    # Vitest (前端)
│   └── ai/                     # pytest (Python)
│
├── docs/
│   ├── ARCHITECTURE.md         # 本文档
│   ├── ROADMAP.md              # 开发路线图
│   └── AGENT_GUIDE.md          # Agent 开发指南
│
├── docker-compose.yml
├── Makefile
├── .gitignore
├── .editorconfig
└── README.md
```

---

## 四、API 设计 (v1)

### 认证

```
POST /api/auth/register  { username, password, role }  → { token }
POST /api/auth/login     { username, password }        → { token }
```

### 微信公众号登录（OAuth2.0 网页授权 snsapi_userinfo，默认关闭）

```
GET  /api/public/wechat-config                          → { enabled, authUrl|null }   // 公开探测，不暴露 AppSecret
GET  /api/auth/wechat/callback?code=&state=             // 微信授权回调：302 到前端
     // 已绑定 → /?token=<JWT>；未绑定 → /auth/wechat/bind?binding=<票据>；失败 → /auth/login?error=wechat_*
POST /api/auth/wechat/bind   { bindingToken, username, password } → { token }   // 首次绑定现有账号（限流）
POST /api/auth/wechat/unbind { password }               → { success }   // 需登录 + 当前密码
```

- 绑定模型：`Users.WeChatOpenId`（唯一索引）/ `WeChatUnionId` / `WeChatBoundAt`；openid 永不暴露给前端，仅后端内部使用。
- 中间态：未绑定签发 5 分钟、audience=`wechat-bind`、`purpose=wechat_bind` 的短效 JWT（绑定票据），与正式 token（audience=`TeamPortal`）天然隔离。
- 配置来源：`WeChat:Enabled` / `WeChat:RedirectUri` / `WeChat:FrontBaseUrl` 为系统设置（DB，管理员可改）；`WeChat:AppId` / `WeChat:AppSecret` 为环境变量（AppSecret 禁存 DB / git）。

### 知识库

```
GET  /api/knowledge/tree                               → ["队员手册.md", "CUADC规则.md", ...]
GET  /api/knowledge/content?path=队员手册.md             → "# 队员手册\n\n..."
```

### 零件库存

```
GET  /api/inventory                                    → [{ id, name, category, qty, location, ... }]
POST /api/inventory                                    → 新增零件
PUT  /api/inventory/{id}                               → 更新数量
```

### 盘点 (Stocktake · /api/material)

流程与状态机：

```
发起(staff) → in_progress
   ├ pause ⇄ resume(暂停=成员停提,发起者可继续编辑)
   ├ cancel → cancelled(作废留痕,不改库存)
   └ delete → 硬删(任何未合并状态含作废可删)
全部项有实盘 → finalize → pending_merge(结果冻结)
复核       → merge   → completed(差异一次性写回库存,终态)
```

管理权：**发起者 + admin** 全权（编辑单行实盘/备注纠错、改派核查人[清空该行需重核]、增/删盘点项、暂停/恢复/取消/删除/两步合并）；其它部长只读；成员仅提交自己的任务（仅 in_progress，暂停即拒）。

关键端点：

```
POST   /api/material/stocktake/start  { type, grade }
POST   /api/material/stocktake/{id}/finalize          # 完成盘点(冻结结果)
POST   /api/material/stocktake/{id}/merge             # 合并入库(差异入账)
POST   /api/material/stocktake/{id}/pause|resume|cancel
DELETE /api/material/stocktake/{id}
POST   /api/material/stocktake/{id}/items  { inventoryItemId }        # 补项
DELETE /api/material/stocktake/{id}/items/{inventoryItemId}           # 移除项
POST   /api/material/stocktake/{id}/items/{inventoryItemId}/assign { userId }
PUT    /api/material/stocktake/{id}/item/{itemId} { actualQty, note } # 发起者纠错
POST   /api/material/stocktake/{id}/batch-check                        # 成员提交
GET    /api/material/stocktake/my-tasks                                # 我的任务
```

### 飞行日志

```
GET  /api/flightlogs                                   → [{ filename, date, vehicle, duration, ... }]
GET  /api/flightlogs/{filename}                        → pymavlink 解析结果 JSON
```

### AI

```
POST /api/ai/chat     { question }                     → { answer } (SSE 流式)
POST /api/ai/search   { query }                       → [{ source, snippet, ... }]
```

### 管理 (Admin)

```
GET    /api/admin/stats                                → 系统统计
GET    /api/admin/users                                → 用户列表
POST   /api/admin/users        { username, password, role, departmentId }  # AdminOnly(部长用邀请码)
PUT    /api/admin/users/{id}   { role, departmentId, password }             # 部长可改本部门非admin(不可admin)
DELETE /api/admin/users/{id}                                                # AdminOnly
GET    /api/admin/departments                          → 部门列表
POST   /api/admin/departments  { name, description }                        # AdminOnly
PUT    /api/admin/departments/{id}                                          # AdminOnly
DELETE /api/admin/departments/{id}                                          # AdminOnly
POST   /api/admin/invite-codes { departmentId,maxUses,daysValid }           # staff;部长仅本部门或不限
GET    /api/admin/invite-codes                                              # admin 全部;部长仅自己的
POST   /api/admin/knowledge/write  { path, content }   → 写入文档
DELETE /api/admin/knowledge/delete?path=...             → 删除文档
POST   /api/admin/documents/upload (multipart/form-data) → 上传文档
GET    /api/admin/me                                   → 当前用户角色+部门
```

---

## 五、技术选型

| 层 | 选型 | 版本 |
|---|---|---|
| 前端框架 | Next.js (App Router) | 16+ |
| UI 组件 | Radix UI + Tailwind CSS | v4 |
| 图表 | recharts | ^3.7 |
| 流程图 | mermaid | ^11.12 |
| 代码高亮 | react-syntax-highlighter | ^16 |
| Markdown | react-markdown + remark-gfm | ^9 |
| C# 后端 | ASP.NET Core Minimal API | .NET 10 |
| ORM | Entity Framework Core | ^10 |
| 数据库 | SQLite | - |
| 认证 | JWT (Microsoft.AspNetCore.Authentication.JwtBearer) | - |
| Excel | openpyxl (Python) | ^3.1 |
| 日志解析 | pymavlink (Python) | ^2.4 |
| AI SDK | httpx → DeepSeek API (Python) | - |
| 部署 | Docker Compose | v3 |
| CI/CD | GitHub Actions | - |

---

## 六、与 OpenDeepWiki 的关系（已融合，2026-08-06 更新）

> **状态:OpenDeepWiki 的 Wiki 生成能力已完整融合进 Team Portal,不再独立部署/运行。**

```text
OpenDeepWiki(已停用)          Team Portal
┌──────────────────┐          ┌──────────────────┐
│ 代码→Wiki 生成     │  ──融合──▶ │ Wiki 文档模块      │
│ (git/zip/翻译)    │          │ /wiki + /wiki/import │
│                  │          │ WikiGeneratorService │
└──────────────────┘          │ (AI读源码生成文档)   │
                              │ git提交/ZIP上传/翻译  │
                              └──────────────────┘
```

融合情况:
- **WikiGeneratorService.cs**(`src/TeamPortal/Services/`)= 原 OpenDeepWiki 生成器移植版("Inspired by OpenDeepWiki WikiGenerator")
- 前端 Wiki 导入页(`web/app/(protected)/wiki/import/`)支持 git/ZIP/翻译三种方式
- 生成的文档进入知识库(`data/knowledge/`),可被 AI RAG 检索
- **端口冲突说明**:OpenDeepWiki 原占 8080/3000,与 Team Portal 相同;因已融合,OpenDeepWiki 不再需要运行,冲突不存在

遗留事项:
- OpenDeepWiki 仓库 `G:\OpenDeepWiki` 保留作历史参考,不再部署
- `G:\长期资料库\CUADC技术资料库\` 等资料库内容可通过知识库上传/文档上传导入 Team Portal

---

## 七、部署架构

```
专用服务器 (Linux / Windows Server)
└── /opt/team-portal/
    ├── docker-compose.yml
    ├── data/              ← 数据卷 (定期备份)
    └── .env               ← 密钥 (不在 Git 中)

   Nginx (可选)
   └── team.yourdomain.com → localhost:3000
```
