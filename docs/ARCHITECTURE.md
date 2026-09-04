# 雏鹰之翼航模队管理系统 — 架构设计文档

> 创建: 2026-06-22 | 更新: 2026-07-04 | 状态: 已上线 v1.0

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

**角色系统:**
| 角色 | 权限范围 |
|---|---|
| 管理员 | 全部功能，可管理所有部门和用户 |
| 部长 | 本部门成员管理 + 本部门知识库编辑 + 文档上传 |
| 成员 | 查看公共 + 本部门知识库，使用功能模块 |

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
POST   /api/admin/users        { username, password, role, departmentId }
PUT    /api/admin/users/{id}   { role, departmentId, password }
DELETE /api/admin/users/{id}
GET    /api/admin/departments                          → 部门列表
POST   /api/admin/departments  { name, description }
PUT    /api/admin/departments/{id}
DELETE /api/admin/departments/{id}
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
