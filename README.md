# 雏鹰之翼 · 航模队管理系统

高校航模队知识管理、零件库存、飞行日志分析、AI 助手平台。

## 功能模块

| 模块 | 功能 |
|---|---|
| 🏠 仪表盘 | 系统统计 + AI 对话面板 |
| 📚 知识库 | 公共/部门知识库，MDX 渲染，Mermaid 流程图，代码高亮 |
| 📦 零件库存 | 库存列表、搜索筛选、recharts 饼图、低库存告警 |
| 📊 飞行日志 | .tlog 解析、高度时间序列图、统计摘要 |
| 🤖 AI 助手 | DeepSeek API SSE 流式对话、RAG 知识库检索 |
| ⚙️ 管理后台 | 用户/部门/资料 CRUD、三级角色权限、文档上传 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 + Tailwind CSS 4 + Radix UI + recharts |
| 后端 | ASP.NET Core 10 Minimal API + EF Core SQLite + JWT |
| AI 服务 | Python FastAPI + DeepSeek + PyPDF2 + python-docx |
| 部署 | Docker Compose + Nginx + GitHub Actions CI |

## 角色权限

| 角色 | 权限 |
|---|---|
| 管理员 | 全部功能，管理所有部门和用户 |
| 部长 | 本部门成员/知识库管理，文档上传 |
| 成员 | 查看功能模块，公共+本部门知识库 |

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

## 生产部署

```bash
# 1. 克隆并配置
git clone <repo-url> /opt/team-portal
cd /opt/team-portal
cp .env.example .env
# 编辑 .env — 修改密钥和 API Key

# 2. 启动服务
make deploy    # docker compose up -d --build

# 3. 验证
make health    # 检查三端是否正常

# 4. HTTPS（可选）
# 参考 deploy/nginx.conf 配置 Nginx 反向代理
# 使用 certbot 获取免费 SSL 证书：
#   certbot --nginx -d team.yourdomain.com

# 5. 数据备份
# 每日自动备份:
#   crontab -e
#   0 3 * * * /opt/team-portal/deploy/backup.sh
```

## License

MIT
