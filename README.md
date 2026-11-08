# 雏鹰之翼 · 航模队管理系统

高校航模队知识管理、零件库存、电池借还、飞行日志分析、设备接入、AI 助手平台。

## 功能模块

| 模块 | 功能 |
|---|---|
| 🏠 仪表盘 | 系统统计 + AI 对话面板 |
| 📚 知识库 | 公共/部门知识库，MDX 渲染，Mermaid 流程图，代码高亮 |
| 🎓 学习库 | 课程/文档学习进度、部门考核 |
| 📦 零件库存 | 库存列表、搜索筛选、低库存告警、库位布局、盘点、领用审批、报损、采购申请 |
| 🔋 电池借还 | 单件台账（每块唯一码）、扫码借出/归还、借还流水、超时提醒、标签批量导出 |
| 🏷️ 标签打印 | 物料/库位/电池二维码标签，模板设计器，PDF 导出与标签机直连打印 |
| 📊 飞行日志 | 上传/下载/删除、固件下载、日志分析（WebTools） |
| 🤖 AI 助手 | DeepSeek API SSE 流式对话、RAG 知识库检索 |
| 🔌 设备接入 | ESP32/扫码终端：DeviceKey 认证、遥测上报、设备内用户登录后扫码借还 |
| 🛡️ 事故安全 | 电池事故、飞行事故记录 |
| 📝 Wiki | 文档生成、编辑与版本管理 |
| ⚙️ 管理后台 | 用户/部门/资料/考核/邀请码/标签模板/日志/备份/设备管理 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 + Tailwind CSS 4 + Radix UI + recharts + react-qr-code |
| 后端 | ASP.NET Core 10 Minimal API + EF Core SQLite + JWT |
| AI/解析 | DeepSeek 直连 + MiniExcel + PdfPig + OpenXML SDK（全部 C# 内置） |
| 设备接入 | HTTP + `X-Device-Key`/`X-Device-Secret` + 设备内用户会话 |
| 标签导出 | jsPDF + qrcode-generator（模板驱动，二维码短链） |
| 部署 | Docker Compose + Nginx + GitHub Actions CI/CD + ghcr 镜像 |

## 角色权限

| 角色 | 权限 |
|---|---|
| 管理员 | 全部功能，管理所有部门、用户与设备 |
| 部长 | 本部门成员/知识库管理，物料与电池的日常管理 |
| 成员 | 查看功能模块，自助借还电池，公共+本部门知识库 |

## 电池管理与扫码借还

1. 电池录进台账，每块生成唯一码（`BAT-0001`），导出标签打印贴到电池上
2. 借出/归还：手机扫电池二维码，或柜边终端扫码（扫码枪/摄像头）
3. 借还流水自动记录借用人、时间；超时未还在台账高亮
4. 标签二维码内容为 `{baseUrl}/b/{code}`，扫码直接打开借还页

详见 [电池借还 API 与扫码接入](docs/电池借还API.md)。

## 设备接入（ESP32 / 扫码终端）

- 管理端「管理 → 设备管理」创建设备，一次性拿到 `DeviceKey` / `Secret`
- 设备用 `X-Device-Key` / `X-Device-Secret` 认证，可上报遥测（重量/温度/门磁等）
- 设备终端页 `/device` 免网页登录：配置设备凭据 → 使用人在设备上登录 → 扫码借还

详见 [设备接入 API](docs/设备接入API.md)。

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

- [API 参考](docs/API.md)（认证、模块索引、全部 258 个接口清单）
- [架构设计](docs/ARCHITECTURE.md)
- [使用指南](docs/使用指南.md)（给队员/部长/管理员，含常见问题）
- [物料管理规范](docs/物料管理规范.md)（分级/库位/领用归还/盘点/报损/采购执行标准）
- [设备接入 API](docs/设备接入API.md)（ESP32 遥测、设备内用户登录）
- [电池借还 API](docs/电池借还API.md)（台账、借还、扫码接入、标签导出）
- [标签打印 SDK 接入](docs/标签打印SDK接入.md)
- [推广文案](docs/推广文案.md)（可直接复制发群）
- [开发路线图](docs/ROADMAP.md)
- [Agent 开发指南](docs/AGENT_GUIDE.md)

## 目录结构

```
team-portal/
├── web/            # Next.js 前端
├── src/TeamPortal/ # ASP.NET Core 后端
├── deploy/         # 部署脚本与 Nginx 配置
├── data/           # 数据文件 (Git 忽略)
├── tests/          # 测试 (xUnit + Vitest)
└── docs/           # 文档
```

## 开发约束

- 禁止直接推 main 分支，走 `feat/*` 分支 + PR
- 提交前必须 `make test` 通过
- 新功能必须有测试
- 详见 [Agent 开发指南](docs/AGENT_GUIDE.md)

## 生产部署

### 一键部署（推荐）

```bash
git clone <repo-url> /opt/team-portal
cd /opt/team-portal
make quickstart   # 自动检测 Docker → 生成 .env → 生成 JWT 密钥 → 启动 → 健康检查
```

脚本会引导你完成全部步骤。部署完成后访问 `http://localhost:3000`，管理员初始密码在 `.env` 的 `ADMIN__PASSWORD`（首次登录后请修改）。

### 手动部署

```bash
# 1. 克隆并配置
git clone <repo-url> /opt/team-portal
cd /opt/team-portal
cp .env.example .env
# 编辑 .env — 修改密钥和 API Key（JWT__KEY 至少 32 字符，可用 openssl rand -base64 48 生成）

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
