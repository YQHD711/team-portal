# Agent 开发指南

> 本文档定义了 AI Agent 在本项目中的工作方式和约束。

---

## 一、项目入口

Agent 拿到任务后，第一步永远是：

```bash
# 1. 读架构文档
cat docs/ARCHITECTURE.md

# 2. 读当前任务对应的 Phase
cat docs/ROADMAP.md

# 3. 理解 Makefile 命令
cat Makefile

# 4. 跑一遍确保环境正常
make build
```

---

## 二、统一命令（Makefile）

Agent **不需要记住具体命令**，全部通过 Makefile：

```makefile
make build    # 编译三端 (C# + Next.js + Python 语法检查)
make test     # 全量测试 (xUnit + Vitest + pytest)
make dev      # 本地开发: docker compose up
make lint     # 代码风格检查
make clean    # 清理构建产物
```

Agent 提交代码前**必须**跑 `make test` 通过。

---

## 三、代码规范

### C# (src/TeamPortal/)
- 使用 Minimal API，不写传统 Controller
- 一个 Endpoint 一个文件，放在 Endpoints/ 下
- Services 只写纯逻辑，不依赖 HTTP 上下文
- 使用 `appsettings.json` + 环境变量覆盖（不硬编码密钥）
- 错误处理: try-catch → Problem() 返回标准错误 JSON

### TypeScript/React (web/)
- 使用 App Router，不写 Pages Router
- 组件放 `components/`，页面放 `app/`
- API 调用统一走 `lib/api.ts` 的封装函数
- 不直接 fetch，用 api.ts 里的类型安全方法
- 禁止 `any` 类型

### Python (ai-service/)
- FastAPI + Pydantic 模型
- 三个路由文件: chat.py, search.py, logs.py
- `requirements.txt` 固定版本号（用 `==`，不用 `>=`）
- 内部 HTTP 调用用 httpx.AsyncClient

### 通用
- 不写超过 200 行的单文件（拆）
- 不写没有测试的代码
- 不硬编码路径，用环境变量或配置文件

---

## 四、测试规范

### 每个新功能 = 三端测试

| 端 | 框架 | 目录 | 运行 |
|---|---|---|---|
| C# | xUnit | tests/api/ | `dotnet test` |
| 前端 | Vitest | tests/web/ | `npx vitest run` |
| Python | pytest | tests/ai/ | `python -m pytest` |

### 测试覆盖率最低要求
- C# Services: 必须测试（单元测试）
- C# Endpoints: 建议测试（集成测试）
- 前端组件: 关键交互必须测试
- Python 路由: 必须测试（httpx AsyncClient 调自己）

---

## 五、Git 工作流

```
main ← 受保护分支，禁止直接推送
  │
  ├── phase/N-name ← 每个 Phase 一个分支
  │     │
  │     └── task/N.M-name ← 每个 Task 一个分支（Agent 从这改）
  │
  └── fix/xxx ← Bug 修复分支
```

### Agent 提交流程
1. 从 main 切 `task/X.Y-name`
2. 写代码 + 写测试
3. `make test` 通过
4. `git commit -m "feat(module): description"`
5. 推送到 GitHub → 创建 PR
6. CI 跑 `make test` → ✅ 才合并

### Commit 规范 (Conventional Commits)
```
feat(web): add inventory search filter
fix(api): prevent NPE in knowledge tree
test(ai): add chat endpoint integration test
chore: update docker-compose version
```

---

## 六、CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test-csharp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '10.0' }
      - run: cd tests/api && dotnet test

  test-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: cd web && npm ci && cd ../tests/web && npx vitest run

  test-python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: cd ai-service && pip install -r requirements.txt
      - run: cd tests/ai && python -m pytest
```

---

## 七、自我升级机制

当项目需要新增功能或修复 Bug 时：

1. 主助手（我）分析需求 → 确定改哪个 Phase
2. 开出 Task → 分配给 Agent
3. Agent 在独立分支开发 + 测试
4. PR Review → CI 全绿 → 合并
5. 主助手更新 `docs/ROADMAP.md` 标记完成

### 升级触发条件
- 用户明确说"开发 Phase X"
- 用户报告 Bug
- 技术栈升级（如 .NET 11 发布）

### 升级约束
- 不影响现有 API 签名（破坏性变更需新建 v2 路由）
- 不删除已有测试（可新增，不可删）
- 必须更新 ARCHITECTURE.md

---

## 八、禁止事项

| 禁止 | 原因 |
|---|---|
| 直接在 main 分支改代码 | 必须走 PR + CI |
| 跳过测试 | CI 会挡，浪费时间 |
| 在 OpenDeepWiki 仓库里加代码 | 两个产品独立 |
| 引入新语言/框架 | 保持技术栈统一 |
| 硬编码路径/密钥 | 用配置注入 |
| 单文件超过 200 行 | 不可维护 |
| `any` 类型 | 类型安全是 Agent 的底线 |
