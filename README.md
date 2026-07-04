# 航模队管理与运营系统 (Team Portal)

高校航模队知识管理、零件库存、飞行日志分析平台。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 + Tailwind CSS 4 + Radix UI |
| 后端 | ASP.NET Core 10 Minimal API |
| AI 服务 | Python FastAPI + DeepSeek |
| 数据库 | SQLite (EF Core) |
| 部署 | Docker Compose |

## 快速开始

```bash
# 本地开发
make dev

# 运行测试
make test

# 构建
make build
```

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [开发路线图](docs/ROADMAP.md)
- [Agent 开发指南](docs/AGENT_GUIDE.md)

## 目录结构

```
team-portal/
├── web/           # Next.js 前端
├── src/TeamPortal/# ASP.NET Core 后端
├── ai-service/    # Python FastAPI 辅助
├── data/          # 数据文件 (Git 忽略)
├── tests/         # 测试 (xUnit + Vitest + pytest)
└── docs/          # 文档
```

## 开发约束

- 禁止直接推 main 分支
- 提交前必须 `make test` 通过
- 新功能必须有测试
- 详见 [Agent 开发指南](docs/AGENT_GUIDE.md)

## License

MIT
