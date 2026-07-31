# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

高校航模队管理与运营系统，覆盖知识库、零件库存、飞行日志分析、AI 助手四个模块。三容器 Docker Compose 部署，与 OpenDeepWiki 共享技术栈经验但独立维护。

## 当前状态

项目已完成 Phase 0-9，**所有核心模块均已实现并运行**：

- ✅ 后端：ASP.NET Core 10 Minimal API（`src/TeamPortal/`）
- ✅ 前端：Next.js 16 App Router（`web/`）
- ✅ AI 服务：Python FastAPI（`ai-service/`）
- ✅ 数据库：SQLite（EF Core，`EnsureCreated` 模式）
- ✅ `Makefile` / `docker-compose.yml` / `.github/workflows/ci.yml`

**运行方式**：
```bash
dotnet run --project src/TeamPortal/    # 后端 :8080
cd web && npm run dev                   # 前端 :3000
cd ai-service && .venv/Scripts/python.exe -m uvicorn main:app --port 9001  # AI :9001
```

**管理员**：admin / admin123（可通过系统设置页面修改）
- ✅ `docs/ARCHITECTURE.md` — 架构权威来源
- ✅ `docs/ROADMAP.md` — 开发路线图（Phase 0 → Phase 6）
- ✅ `docs/AGENT_GUIDE.md` — Agent 工作方式与约束

收到开发任务时，先检查对应源代码是否已存在；若仍在设计阶段，按 `docs/ROADMAP.md` 从 Phase 0 开始搭建。

## 常用命令（Phase 0 实现后生效）

```bash
make build    # 编译三端 (C# + Next.js + Python 语法检查)
make test     # 全量测试 (xUnit + Vitest + pytest)
make dev      # 本地开发启动 (docker compose up)
make lint     # 代码风格检查
make clean    # 清理构建产物
```

单独测试：
```bash
dotnet test tests/api/          # C# xUnit
cd web && npx vitest run        # 前端 Vitest
python -m pytest tests/ai/      # Python pytest
```

## 架构

```
浏览器 → Next.js (:3000) → ASP.NET Core (:8080) → SQLite + Python 辅助服务 (:9001)
                                   │
                                   ├── 直读 data/knowledge/*.md
                                   ├── 转发 ai-service (DeepSeek API, pymavlink, openpyxl)
                                   └── JWT 认证
```

- **前端** (`web/`): Next.js 16 App Router + Tailwind CSS 4 + Radix UI + recharts + mermaid + react-markdown
- **后端** (`src/TeamPortal/`): ASP.NET Core 10 Minimal API + EF Core SQLite + JWT
- **AI 服务** (`ai-service/`): Python FastAPI，三个路由文件 chat.py / search.py / logs.py
- **数据** (`data/`): 知识库 .md 文件、`inventory.xlsx`、飞行日志 `.tlog`，整个目录 Git 忽略，运行时挂载。Agent 测试时手动往 `data/knowledge/` 放 `.md` 文件即可验证知识库功能

## 代码规范要点

- **代码风格统一遵循 `.editorconfig`**：C# 4 空格缩进，TS/JSON/YAML/MD 2 空格缩进，Python 4 空格缩进，Makefile Tab 缩进
- C#: Minimal API（不用传统 Controller），一个 Endpoint 一个文件，Services 纯逻辑不依赖 HTTP 上下文；错误处理统一 `try-catch → Problem()` 返回标准错误 JSON
- TypeScript: 禁用 `any`，API 调用统一走 `lib/api.ts` 封装，不直接 fetch
- Python: FastAPI + Pydantic，依赖用 `==` 固定版本，HTTP 调用用 httpx.AsyncClient
- 单文件不超过 200 行
- 不硬编码路径/密钥，用配置文件或环境变量注入

## 测试要求

| 端 | 框架 | 目录 | 覆盖要求 |
|---|---|---|---|
| C# | xUnit | tests/api/ | Services **必须**测（单元），Endpoints **建议**测（集成） |
| 前端 | Vitest | web/tests/ | 关键交互**必须**测 |
| Python | pytest | tests/ai/ | 路由**必须**测 |

## Git 工作流

```
main（禁止直推）← phase/N-name ← task/N.M-name（Agent 开发分支）
                         └── fix/xxx
```

- Commit 格式: `feat(scope): description` / `fix(scope): description`
- 提交前必须 `make test` 通过
- CI 通过才合并

## 禁止事项

| 禁止 | 原因 |
|---|---|
| 直接在 main 分支改代码 | 必须走 PR + CI |
| 跳过测试 | CI 会挡，浪费时间 |
| 在 OpenDeepWiki 仓库里加代码 | 两个产品独立 |
| 引入新语言/框架 | 保持技术栈统一 |
| 硬编码路径/密钥 | 用配置注入 |
| 单文件超过 200 行 | 不可维护 |
| TypeScript `any` 类型 | 类型安全底线 |
