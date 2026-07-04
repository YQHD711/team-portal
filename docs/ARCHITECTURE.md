# 航模队管理系统 — 架构设计文档

> 创建时间: 2026-06-22 | 状态: 设计锁定，待开发

---

## 一、产品定位

航模队管理与运营系统，独立于 OpenDeepWiki（仅共享技术栈经验，不共享代码）。

**核心功能:**
- 知识库: 队员手册、调参指南、竞赛规则（MDX 渲染 + 代码高亮 + Mermaid 流程图）
- 零件库存: 零件索引、借用归还、用量统计
- 飞行日志: .tlog 解析 + recharts 可视化
- AI 助手: 问答搜索（DeepSeek API）

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

## 六、与 OpenDeepWiki 的关系

```
OpenDeepWiki          Team Portal
┌──────────┐          ┌──────────┐
│ 代码知识库  │          │ 航模队管理  │
│ 独立产品   │          │ 独立产品   │
│           │          │           │
│ 技术栈重叠: │          │           │
│ Next.js   │          │ Next.js   │
│ .NET 10   │          │ .NET 10   │
│ Radix UI  │          │ Radix UI  │
│ Tailwind  │          │ Tailwind  │
└──────────┘          └──────────┘
      │                     │
      └──── 不共享代码 ──────┘
      └──── 共享技术栈经验 ──┘
```

- 两个独立 Git 仓库
- 两个独立 Docker Compose
- 未来可选: JWT SSO 打通登录
- 绝不: 在 OpenDeepWiki 仓库里建子项目

---

## 七、部署架构

```
专用服务器 (Linux / Windows Server)
├── /opt/team-portal/
│   ├── docker-compose.yml
│   ├── data/              ← 数据卷 (定期备份)
│   └── .env               ← 密钥 (不在 Git 中)
│
└── /opt/opendeepwiki/     ← 独立部署
    └── docker-compose.yml

   Nginx (可选)
   ├── team.yourdomain.com → localhost:3000
   └── wiki.yourdomain.com → localhost:8080
```
