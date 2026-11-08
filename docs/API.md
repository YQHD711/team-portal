# TeamPortal API 参考

> 版本：main（2026-11）
> 机器可读契约：`GET /api/admin/openapi`（staff 权限）返回 OpenAPI JSON
> 本文是人工维护的索引 + 重点接口说明；完整接口清单见第 8 节（由生产 OpenAPI 自动生成）

---

## 1. 基础约定

| 项 | 值 |
|---|---|
| 生产地址 | `https://8.137.161.160` |
| 本地开发 | `http://localhost:8080`（前端 `:3000` 代理 `/api`） |
| 内容类型 | `application/json`；文件上传用 `multipart/form-data` |
| 错误格式 | RFC 7807 `application/problem+json` |
| 时间格式 | ISO 8601 UTC（`2026-11-08T10:00:00Z`） |
| OpenAPI | `GET /api/admin/openapi`（StaffOnly） |

---

## 2. 认证（三种通道）

### 2.1 用户 JWT（网页端）

```http
Authorization: Bearer <token>
```

- 获取：`POST /api/auth/login`，body `{"username":"...","password":"..."}` → `{"token":"..."}`
- 有效期：默认 7 天（设置项 `Auth:JwtExpireDays`）
- 改角色/改部门/改密码后旧 token 立即失效（TokenVersion 机制）
- 登录失败有锁定策略（默认 5 次错→锁 15 分钟）

### 2.2 设备凭据（ESP32 / 扫码终端）

```http
X-Device-Key: dev_xxxxxxxxxxxxxxxx
X-Device-Secret: <48 位十六进制>
```

- 管理端「管理 → 设备管理」创建设备时一次性获得
- 用于 `/api/device/*` 的遥测、物料查询、设备登录

### 2.3 设备内用户会话

设备上登录使用人后获得的短期 token（**不是用户 JWT**）：

```http
X-Device-Key: dev_xxx
X-Device-Secret: xxx
X-Device-Session: <sessionToken>
```

- 获取：`POST /api/device/login`（带设备凭据 + 用户账号密码）
- 有效期 12 小时；绑定设备；可 `POST /api/device/logout` 撤销
- 用于 `/api/device/battery/*` 的借还

---

## 3. 模块索引

| 模块 | 路径前缀 | 专项文档 |
|---|---|---|
| 认证 / 用户 | `/api/auth`, `/api/admin/users` | — |
| 组织架构 / 邀请码 | `/api/admin/departments`, `/api/admin/invite-codes` | — |
| 知识库 | `/api/knowledge` | — |
| 学习库 | `/api/study` | — |
| 物料库存 | `/api/inventory` | `docs/物料管理规范.md` |
| 领用 / 盘点 / 报损 | `/api/material` | `docs/物料管理规范.md` |
| 采购 / 财务 | `/api/finance` | — |
| **电池借还** | `/api/battery` | **`docs/电池借还API.md`** |
| **设备接入** | `/api/device` | **`docs/设备接入API.md`** |
| **设备管理** | `/api/admin/devices` | **`docs/设备接入API.md`** |
| 电池事故记录（旧） | `/api/batteries` | 注意：这是**事故记录**，不是借还台账 |
| 标签模板 | `/api/label-templates` | `docs/标签打印SDK接入.md` |
| 飞行日志 / 固件 | `/api/firmware`, `/api/flight-diagnoses` | — |
| Wiki 生成 | `/api/wiki` | — |
| AI 助手 | `/api/ai`, `/api/chat` | — |
| 通知 | `/api/notifications` | — |
| 文件 / 网盘 | `/api/files`, `/api/baidu` | — |
| 档案 / 考核 / 认证 | `/api/profile`, `/api/admin/exams`, `/api/admin/profiles` | — |
| 事故安全 | `/api/incidents` | — |
| 系统管理 | `/api/admin/settings`, `/api/admin/logs`, `/api/admin/backup`, `/api/admin/trash` | — |

---

## 4. 设备接入（详见 docs/设备接入API.md）

### 4.1 设备管理（admin）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/admin/devices` | 设备列表（含在线状态） |
| POST | `/api/admin/devices` | 创建设备，返回一次性 Secret |
| PUT | `/api/admin/devices/{id}` | 改名/类型/库位/固件/启停 |
| POST | `/api/admin/devices/{id}/rotate-secret` | 重置密钥 |
| DELETE | `/api/admin/devices/{id}` | 删除设备（遥测级联） |
| GET | `/api/admin/devices/{id}/telemetry?limit=50` | 最近遥测 |

### 4.2 设备侧

| 方法 | 路径 | 认证 | 作用 |
|---|---|---|---|
| GET | `/api/device/ping` | 设备凭据 | 心跳 |
| POST | `/api/device/login` | 设备凭据 | 设备上登录使用人 → sessionToken |
| POST | `/api/device/logout` | 设备凭据+会话 | 撤销会话 |
| POST | `/api/device/telemetry` | 设备凭据 | 上报遥测（原始 JSON） |
| GET | `/api/device/materials/{code}` | 设备凭据 | 按编码查物料 |
| POST | `/api/device/materials/{code}/stock` | 设备凭据 | 上报库存变动 |

### 4.3 设备端电池借还（借用人=设备会话用户）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/device/battery/{code}` | 按编码查电池 |
| GET | `/api/device/battery/mine` | 当前用户在此设备上的在借 |
| POST | `/api/device/battery/{code}/borrow` | 借出 |
| POST | `/api/device/battery/{code}/return` | 归还 |

---

## 5. 电池借还（详见 docs/电池借还API.md）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/battery?status=&search=` | 登录 | 台账列表 |
| GET | `/api/battery/next-code` | 登录 | 下一个可用编码 |
| GET | `/api/battery/by-code/{code}` | 登录 | 扫码查询（大小写不敏感） |
| GET | `/api/battery/{id}` | 登录 | 单块详情 |
| POST | `/api/battery` | staff | 新增（code 可留空自动生成） |
| PUT | `/api/battery/{id}` | staff | 编辑 |
| DELETE | `/api/battery/{id}` | **admin** | 删除（在借拒绝，流水级联） |
| POST | `/api/battery/{id}/borrow` | 登录 | 借出（body.userId 存在=代借，仅 staff） |
| POST | `/api/battery/{id}/return` | 登录 | 归还 |
| GET | `/api/battery/loans` | 登录 | 借还流水 |
| GET | `/api/battery/mine` | 登录 | 我的在借 |
| GET | `/api/battery/overdue?hours=` | 登录 | 超时未还 |

字段限制：`code ≤ 50`、`model ≤ 100`、`notes ≤ 500`；禁止 `<script`/`<img`/`onerror=`/`javascript:` 片段。

---

## 6. 权限矩阵（电池模块）

| 操作 | member | 部长 | admin |
|---|---|---|---|
| 查看台账/流水 | ✅ | ✅ | ✅ |
| 本人借出/归还 | ✅ | ✅ | ✅ |
| 代借/代还 | ❌ | ✅ | ✅ |
| 新增/编辑电池 | ❌ | ✅ | ✅ |
| 强制回库（改状态） | ❌ | ✅ | ✅ |
| 删除电池 | ❌ | ❌ | ✅ |

---

## 7. 错误码

| 状态码 | 含义 |
|---|---|
| 200 | 成功 |
| 201 | 已创建 |
| 400 | 参数错误 / 字段超限 / 非法字符 / 编码重复 |
| 401 | 未登录 / token 失效 / 设备凭据错误 / 设备会话过期 |
| 403 | 无权限（角色不足、跨设备会话） |
| 404 | 资源不存在 |
| 409 | 状态冲突（重复借出/归还、在借删除） |
| 429 | 限流 / 账号锁定 |
| 500 | 服务端错误（查系统日志） |

统一响应：

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "电池当前状态为「借出」，不能借出",
  "traceId": "00-..."
}
```

---

## 8. 附录：完整接口清单

### /（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/` |

### /api/admin/agent（7）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/agent/analyze` |
| `POST` | `/api/admin/agent/analyze/stream` |
| `GET` | `/api/admin/agent/guide` |
| `GET` | `/api/admin/agent/memory` |
| `POST` | `/api/admin/agent/memory/clear` |
| `GET` | `/api/admin/agent/status` |
| `GET` | `/api/admin/agent/tools` |

### /api/admin/ai（2）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/ai/default-prompt` |
| `GET` | `/api/admin/ai/models` |

### /api/admin/backup（5）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/backup` |
| `GET` | `/api/admin/backup` |
| `DELETE` | `/api/admin/backup/{fileName}` |
| `POST` | `/api/admin/backup/restore` |
| `GET` | `/api/admin/backup/stats` |

### /api/admin/baidu（9）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/baidu/auth-code` |
| `GET` | `/api/admin/baidu/auth-url` |
| `POST` | `/api/admin/baidu/backup` |
| `GET` | `/api/admin/baidu/download` |
| `GET` | `/api/admin/baidu/files` |
| `DELETE` | `/api/admin/baidu/files` |
| `POST` | `/api/admin/baidu/init-folders` |
| `GET` | `/api/admin/baidu/quota` |
| `POST` | `/api/admin/baidu/upload` |

### /api/admin/certifications（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/certifications` |

### /api/admin/competitions（1）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/competitions/import` |

### /api/admin/dashboard（1）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/dashboard/invalidate` |

### /api/admin/departments（4）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/departments` |
| `POST` | `/api/admin/departments` |
| `PUT` | `/api/admin/departments/{id}` |
| `DELETE` | `/api/admin/departments/{id}` |

### /api/admin/devices（6）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/devices` |
| `POST` | `/api/admin/devices` |
| `PUT` | `/api/admin/devices/{id}` |
| `DELETE` | `/api/admin/devices/{id}` |
| `POST` | `/api/admin/devices/{id}/rotate-secret` |
| `GET` | `/api/admin/devices/{id}/telemetry` |

### /api/admin/documents（1）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/documents/upload` |

### /api/admin/exams（8）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/exams` |
| `POST` | `/api/admin/exams` |
| `PUT` | `/api/admin/exams/{id}` |
| `DELETE` | `/api/admin/exams/{id}` |
| `GET` | `/api/admin/exams/{id}/results` |
| `POST` | `/api/admin/exams/{id}/results` |
| `DELETE` | `/api/admin/exams/{id}/results/{resultId}` |
| `GET` | `/api/admin/exams/passes` |

### /api/admin/invite-codes（4）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/invite-codes` |
| `POST` | `/api/admin/invite-codes` |
| `DELETE` | `/api/admin/invite-codes/{id}` |
| `POST` | `/api/admin/invite-codes/{id}/revoke` |

### /api/admin/knowledge（4）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/knowledge/asset` |
| `DELETE` | `/api/admin/knowledge/delete` |
| `POST` | `/api/admin/knowledge/rename` |
| `POST` | `/api/admin/knowledge/write` |

### /api/admin/logs（7）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/logs` |
| `POST` | `/api/admin/logs/cleanup` |
| `GET` | `/api/admin/logs/export` |
| `GET` | `/api/admin/logs/operations` |
| `GET` | `/api/admin/logs/operations/export` |
| `GET` | `/api/admin/logs/operations/stats` |
| `GET` | `/api/admin/logs/stats` |

### /api/admin/me（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/me` |

### /api/admin/profiles（10）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/profiles` |
| `GET` | `/api/admin/profiles/{slug}` |
| `PUT` | `/api/admin/profiles/{userId}` |
| `GET` | `/api/admin/profiles/{userId}/certifications` |
| `POST` | `/api/admin/profiles/{userId}/competitions` |
| `PUT` | `/api/admin/profiles/{userId}/competitions/{id}` |
| `DELETE` | `/api/admin/profiles/{userId}/competitions/{id}` |
| `POST` | `/api/admin/profiles/{userId}/training` |
| `PUT` | `/api/admin/profiles/{userId}/training/{id}` |
| `DELETE` | `/api/admin/profiles/{userId}/training/{id}` |

### /api/admin/rag-stats（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/rag-stats` |

### /api/admin/runtime-stats（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/runtime-stats` |

### /api/admin/settings（3）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/settings` |
| `PUT` | `/api/admin/settings` |
| `GET` | `/api/admin/settings/{key}` |

### /api/admin/stats（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/stats` |

### /api/admin/training（1）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/admin/training/batch` |

### /api/admin/trash（5）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/trash` |
| `GET` | `/api/admin/trash/{id}` |
| `DELETE` | `/api/admin/trash/{id}` |
| `POST` | `/api/admin/trash/{id}/restore` |
| `POST` | `/api/admin/trash/cleanup` |

### /api/admin/users（5）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/admin/users` |
| `POST` | `/api/admin/users` |
| `PUT` | `/api/admin/users/{id}` |
| `DELETE` | `/api/admin/users/{id}` |
| `POST` | `/api/admin/users/import-csv` |

### /api/ai（3）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/ai/chat` |
| `POST` | `/api/ai/search` |
| `GET` | `/api/ai/suggestions` |

### /api/auth（4）

| 方法 | 路径 |
|---|---|
| `PUT` | `/api/auth/change-password` |
| `POST` | `/api/auth/login` |
| `GET` | `/api/auth/me` |
| `POST` | `/api/auth/register` |

### /api/baidu（2）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/baidu/view-by-path` |
| `GET` | `/api/baidu/view/{fsId}` |

### /api/batteries（4）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/batteries` |
| `POST` | `/api/batteries` |
| `PUT` | `/api/batteries/{id}` |
| `DELETE` | `/api/batteries/{id}` |

### /api/battery（12）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/battery` |
| `POST` | `/api/battery` |
| `GET` | `/api/battery/{id}` |
| `PUT` | `/api/battery/{id}` |
| `DELETE` | `/api/battery/{id}` |
| `POST` | `/api/battery/{id}/borrow` |
| `POST` | `/api/battery/{id}/return` |
| `GET` | `/api/battery/by-code/{code}` |
| `GET` | `/api/battery/loans` |
| `GET` | `/api/battery/mine` |
| `GET` | `/api/battery/next-code` |
| `GET` | `/api/battery/overdue` |

### /api/chat（4）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/chat/new-session` |
| `GET` | `/api/chat/sessions` |
| `GET` | `/api/chat/sessions/{sessionId}` |
| `DELETE` | `/api/chat/sessions/{sessionId}` |

### /api/client-logs（1）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/client-logs` |

### /api/dashboard（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/dashboard` |

### /api/device（10）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/device/battery/{code}` |
| `POST` | `/api/device/battery/{code}/borrow` |
| `POST` | `/api/device/battery/{code}/return` |
| `GET` | `/api/device/battery/mine` |
| `POST` | `/api/device/login` |
| `POST` | `/api/device/logout` |
| `GET` | `/api/device/materials/{code}` |
| `POST` | `/api/device/materials/{code}/stock` |
| `GET` | `/api/device/ping` |
| `POST` | `/api/device/telemetry` |

### /api/downloads（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/downloads/print-service` |

### /api/files（4）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/files` |
| `DELETE` | `/api/files/{id}` |
| `GET` | `/api/files/{id}/download` |
| `POST` | `/api/files/upload` |

### /api/finance（11）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/finance/report/monthly` |
| `GET` | `/api/finance/requests` |
| `POST` | `/api/finance/requests` |
| `GET` | `/api/finance/requests/{id}` |
| `DELETE` | `/api/finance/requests/{id}` |
| `POST` | `/api/finance/requests/{id}/approve` |
| `POST` | `/api/finance/requests/{id}/purchase` |
| `POST` | `/api/finance/requests/{id}/receive` |
| `POST` | `/api/finance/requests/{id}/reject` |
| `GET` | `/api/finance/requests/all` |
| `GET` | `/api/finance/stats` |

### /api/firmware（8）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/firmware/assets` |
| `GET` | `/api/firmware/boards` |
| `GET` | `/api/firmware/cache` |
| `DELETE` | `/api/firmware/cache` |
| `DELETE` | `/api/firmware/cache/item` |
| `GET` | `/api/firmware/download` |
| `GET` | `/api/firmware/sources` |
| `GET` | `/api/firmware/versions` |

### /api/flight-diagnoses（3）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/flight-diagnoses` |
| `GET` | `/api/flight-diagnoses` |
| `GET` | `/api/flight-diagnoses/{id}` |

### /api/incidents（4）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/incidents` |
| `POST` | `/api/incidents` |
| `PUT` | `/api/incidents/{id}` |
| `DELETE` | `/api/incidents/{id}` |

### /api/inventory（15）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/inventory` |
| `POST` | `/api/inventory` |
| `GET` | `/api/inventory/{id}` |
| `PUT` | `/api/inventory/{id}` |
| `DELETE` | `/api/inventory/{id}` |
| `POST` | `/api/inventory/{id}/checkin` |
| `POST` | `/api/inventory/{id}/checkout` |
| `POST` | `/api/inventory/{id}/consume` |
| `POST` | `/api/inventory/{id}/photo` |
| `GET` | `/api/inventory/{id}/transactions` |
| `GET` | `/api/inventory/by-code/{code}` |
| `GET` | `/api/inventory/by-code/{code}/qr.svg` |
| `POST` | `/api/inventory/import` |
| `GET` | `/api/inventory/meta` |
| `GET` | `/api/inventory/next-code` |

### /api/knowledge（4）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/knowledge/content` |
| `DELETE` | `/api/knowledge/delete` |
| `GET` | `/api/knowledge/download` |
| `GET` | `/api/knowledge/tree` |

### /api/label-templates（5）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/label-templates` |
| `POST` | `/api/label-templates` |
| `PUT` | `/api/label-templates/{id}` |
| `DELETE` | `/api/label-templates/{id}` |
| `POST` | `/api/label-templates/{id}/default` |

### /api/material（29）

| 方法 | 路径 |
|---|---|
| `POST` | `/api/material/checkout` |
| `GET` | `/api/material/checkout/{id}` |
| `POST` | `/api/material/checkout/{id}/approve-admin` |
| `POST` | `/api/material/checkout/{id}/approve-dept` |
| `POST` | `/api/material/checkout/{id}/checkin` |
| `POST` | `/api/material/checkout/{id}/reject` |
| `GET` | `/api/material/checkout/my` |
| `GET` | `/api/material/checkout/outstanding` |
| `GET` | `/api/material/checkout/pending` |
| `POST` | `/api/material/damage-report` |
| `GET` | `/api/material/damage-report` |
| `PUT` | `/api/material/damage-report/{id}/resolve` |
| `GET` | `/api/material/stocktake` |
| `GET` | `/api/material/stocktake/{id}` |
| `DELETE` | `/api/material/stocktake/{id}` |
| `POST` | `/api/material/stocktake/{id}/assign` |
| `POST` | `/api/material/stocktake/{id}/auto-assign` |
| `POST` | `/api/material/stocktake/{id}/batch-check` |
| `POST` | `/api/material/stocktake/{id}/cancel` |
| `POST` | `/api/material/stocktake/{id}/finalize` |
| `PUT` | `/api/material/stocktake/{id}/item/{itemId}` |
| `POST` | `/api/material/stocktake/{id}/items` |
| `DELETE` | `/api/material/stocktake/{id}/items/{inventoryItemId}` |
| `POST` | `/api/material/stocktake/{id}/items/{inventoryItemId}/assign` |
| `POST` | `/api/material/stocktake/{id}/merge` |
| `POST` | `/api/material/stocktake/{id}/pause` |
| `POST` | `/api/material/stocktake/{id}/resume` |
| `GET` | `/api/material/stocktake/my-tasks` |
| `POST` | `/api/material/stocktake/start` |

### /api/notifications（6）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/notifications` |
| `POST` | `/api/notifications/{id}/read` |
| `POST` | `/api/notifications/clear` |
| `POST` | `/api/notifications/read-all` |
| `GET` | `/api/notifications/stream` |
| `GET` | `/api/notifications/unread-count` |

### /api/profile（6）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/profile` |
| `PUT` | `/api/profile` |
| `GET` | `/api/profile/certifications` |
| `GET` | `/api/profile/competitions` |
| `GET` | `/api/profile/exam-passes` |
| `GET` | `/api/profile/training` |

### /api/public（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/public/brand` |

### /api/search（1）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/search` |

### /api/storage（8）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/storage/layouts` |
| `POST` | `/api/storage/layouts` |
| `PUT` | `/api/storage/layouts/{id}` |
| `DELETE` | `/api/storage/layouts/{id}` |
| `POST` | `/api/storage/layouts/{id}/editing` |
| `GET` | `/api/storage/layouts/{id}/editing` |
| `DELETE` | `/api/storage/layouts/{id}/editing` |
| `GET` | `/api/storage/layouts/{roomCode}/items` |

### /api/study（3）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/study/library` |
| `POST` | `/api/study/progress` |
| `GET` | `/api/study/stats` |

### /api/wiki（19）

| 方法 | 路径 |
|---|---|
| `GET` | `/api/wiki/settings` |
| `PUT` | `/api/wiki/settings` |
| `POST` | `/api/wiki/submit-git` |
| `POST` | `/api/wiki/submit-zip` |
| `GET` | `/api/wiki/tasks` |
| `GET` | `/api/wiki/tasks/{id}` |
| `DELETE` | `/api/wiki/tasks/{id}` |
| `GET` | `/api/wiki/tasks/{id}/blob/{path}` |
| `GET` | `/api/wiki/tasks/{id}/catalog` |
| `GET` | `/api/wiki/tasks/{id}/diagnose` |
| `GET` | `/api/wiki/tasks/{id}/doc` |
| `PUT` | `/api/wiki/tasks/{id}/doc` |
| `GET` | `/api/wiki/tasks/{id}/edits` |
| `GET` | `/api/wiki/tasks/{id}/missing` |
| `POST` | `/api/wiki/tasks/{id}/reclone` |
| `POST` | `/api/wiki/tasks/{id}/restore-from-history` |
| `POST` | `/api/wiki/tasks/{id}/retry-missing` |
| `POST` | `/api/wiki/tasks/{id}/update` |
| `PATCH` | `/api/wiki/tasks/{id}/visibility` |


---

## 9. 获取机器可读契约

```bash
# 登录
curl.exe -s -X POST https://8.137.161.160/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"***\"}"

# 导出 OpenAPI（staff 权限）
curl.exe -s https://8.137.161.160/api/admin/openapi \
  -H "Authorization: Bearer <token>" > openapi.json
```

可直接导入 Postman / Swagger Editor / 生成客户端 SDK。
