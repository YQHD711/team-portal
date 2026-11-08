# 电池借还 API 与扫码接入

> 状态：已上线（main）
> 接口前缀：`/api/battery`
> 认证：用户 JWT（与登录态同一套），**不是**设备接入用的 `X-Device-Key`

本文档覆盖：电池单件台账的数据模型、借还 API、权限、扫码接入规范、标签导出，以及和「设备接入 API」的关系。

---

## 1. 概述

电池是**单件资产**，不是数量型物料：每块电池一条 `BatteryItems` 记录、一个唯一码（如 `BAT-0001`），借还一次写一条 `BatteryLoans` 流水。

和现有系统的关系：

| 模块 | 关系 |
|---|---|
| 物料库存（InventoryItems） | 独立。物料是数量型 + 审批领用；电池需要追责到具体哪一块 |
| 物料标签/二维码 | 复用渲染与 PDF 能力，标签内容改成 `/b/<code>` 短链 |
| 通知中心 | 超时未还由前端展示，后续可接后台提醒 |
| 审计日志 | 借出/归还/新增/编辑全部写 OperationLogs |
| 设备接入 API | 独立。设备认证是 `X-Device-Key`，电池借还需要用户身份 |

---

## 2. 认证

所有 `/api/battery/*` 端点都需要登录用户 JWT：

```http
Authorization: Bearer <token>
```

获取方式：`POST /api/auth/login`，body `{"username":"...","password":"..."}`，返回 `{"token":"..."}`。

> 设备（ESP32/扫码枪电脑）若要调用，需要一个真实用户账号登录拿 JWT；目前没有「设备直接借还」的免登录通道。

---

## 3. 数据模型

### 3.1 BatteryItems（电池台账）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int | 主键 |
| `code` | string | 唯一码，全队唯一；查询/借还均大小写不敏感 |
| `model` | string? | 型号，如 `6S 3300mAh` |
| `status` | string | `in_stock` / `borrowed` / `charging` / `repair` / `retired` |
| `health` | string? | 健康度：正常/鼓包/漏液/过放/报废 |
| `currentBorrowerId` | int? | 当前借用人 |
| `borrowedAt` | datetime? | 当前借出时间 |
| `notes` | string? | 备注 |
| `createdAt` / `updatedAt` | datetime | |

### 3.2 BatteryLoans（借还流水）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int | 主键 |
| `batteryId` | int | 电池 |
| `userId` | int | 借用人 |
| `borrowedAt` | datetime | 借出时间 |
| `returnedAt` | datetime? | 归还时间；`null` = 在借 |
| `returnedByUserId` | int? | 归还操作人（管理员代还时与借用人不同） |
| `note` | string? | 备注 |

---

## 4. 状态机

```
       借出                归还
in_stock ──────► borrowed ──────► in_stock
   ▲  ▲                                
   │  └── 管理员手工置为 charging / repair / retired（不可借出）
   │
   └── 管理员强制回库（会同时关闭未归还流水）
```

规则：
- 只有 `in_stock` 能借出；重复借出返回 **409**
- 只有 `borrowed` 能归还；重复归还返回 **409**
- `charging` / `repair` / `retired` 不参与借还
- `PUT` 不允许直接写 `borrowed`（必须走借出接口），避免「有状态没流水」

---

## 5. API 端点

### 5.1 台账列表

`GET /api/battery?status=&search=`

| 参数 | 说明 |
|---|---|
| `status` | 可选，按状态过滤 |
| `search` | 可选，按编码/型号模糊搜索（编码大小写不敏感） |

响应：`BatteryItem[]`（含 `currentBorrower` 导航对象）。

### 5.2 下一个可用编码

`GET /api/battery/next-code`

```json
{ "code": "BAT-0003" }
```

### 5.3 按编码查询（扫码入口）

`GET /api/battery/by-code/{code}`

- 大小写不敏感：`bat-0001` 与 `BAT-0001` 等价
- 找到返回 `BatteryItem`，否则 **404**

### 5.4 单块详情

`GET /api/battery/{id}` → `BatteryItem`，不存在 **404**。

### 5.5 新增电池（staff）

`POST /api/battery`

```json
{ "code": "BAT-0010", "model": "6S 3300mAh", "health": "正常", "notes": "新购入" }
```

- `code` 留空或省略 → 自动生成 `BAT-xxxx`
- 编码重复 → **400**
- 普通成员 → **403**
- 成功 → **201** + `BatteryItem`
- **字段限制**（超限 → 400）：
  - `code` ≤ 50 字符（自动转大写）
  - `model` ≤ 100 字符
  - `notes` ≤ 500 字符
  - 所有字段禁止 `<script`、`<img`、`onerror=`、`javascript:` 片段

### 5.6 编辑电池（staff）

`PUT /api/battery/{id}`

```json
{ "model": "6S 3300mAh", "status": "repair", "health": "鼓包", "notes": "待检", "clearModel": false }
```

- 只传要改的字段
- `clearModel: true` 清空型号
- `status` 传 `borrowed` → **400**（借出必须走借还接口）
- 从 `borrowed` 手动改成 `in_stock` = 管理员强制回库，会自动关闭未归还流水
- 字段长度/非法字符限制与新增一致（`model` ≤ 100、`notes` ≤ 500，禁止脚本片段）

### 5.7 借出

`POST /api/battery/{id}/borrow`

```json
{ "userId": null, "note": "周末飞" }
```

| 字段 | 说明 |
|---|---|
| `userId` | 省略或等于当前用户 = 本人借；不等于当前用户 = 代借（仅 staff） |
| `note` | 可选备注 |

成功 **200**：

```json
{ "loanId": 12, "batteryId": 3, "borrowerId": 7, "borrowedAt": "2026-11-08T10:00:00Z" }
```

错误：

| 状态码 | 场景 |
|---|---|
| 403 | 普通成员尝试代借 |
| 409 | 电池不在 `in_stock`（已借出/维修/退役） |

### 5.8 归还

`POST /api/battery/{id}/return`

```json
{ "note": "已还" }
```

成功 **200**：

```json
{ "loanId": 12, "batteryId": 3, "returnedAt": "2026-11-08T12:00:00Z" }
```

错误：**409**（电池不在借出状态 / 找不到未归还流水）。

### 5.9 借还流水

`GET /api/battery/loans?batteryId=&userId=&activeOnly=&take=`

| 参数 | 说明 |
|---|---|
| `batteryId` | 只看某块电池 |
| `userId` | 只看某个借用人 |
| `activeOnly` | `true` = 只看未归还 |
| `take` | 1–500，默认 100 |

### 5.10 我的在借

`GET /api/battery/mine` → 当前登录用户未归还的 `BatteryLoan[]`。

### 5.11 超时未还

`GET /api/battery/overdue?hours=`

- `hours` 省略时取设置项 `Battery:OverdueHours`（默认 24）
- 返回所有 `returnedAt = null` 且借出超过阈值的流水

### 5.12 删除电池（admin）

`DELETE /api/battery/{id}`

- 仅 **管理员** 可调用；部长/成员 → **403**
- 电池在借出状态，或存在未归还流水 → **409**（先归还再删）
- 删除成功 **200** `{ "success": true }`，该电池的借还流水一并删除（级联）
- 不存在 → **404**

> 用于清理误录/测试数据。删除后不可恢复，操作会写入审计日志。

---

## 6. 权限矩阵

| 操作 | member | 部长 | admin |
|---|---|---|---|
| 查看台账/流水 | ✅ | ✅ | ✅ |
| 本人借出/归还 | ✅ | ✅ | ✅ |
| 代借/代还 | ❌ | ✅ | ✅ |
| 新增/编辑电池 | ❌ | ✅ | ✅ |
| 强制回库（改状态） | ❌ | ✅ | ✅ |
| 删除电池 | ❌ | ❌ | ✅ |

> 免审批：借还不经过任何审批链，扫码即生效；靠流水 + 超时列表做事后管理。

---

## 7. 扫码接入规范

### 7.1 二维码内容

电池标签上的二维码内容固定为：

```
{baseUrl}/b/{code}
```

例如 `https://team.example.com/b/BAT-0001`。扫码后直接打开借还落地页。

### 7.2 三种扫码方式

| 方式 | 路径 | 说明 |
|---|---|---|
| 手机系统相机 | 扫二维码 → 打开 `/b/<code>` | 无需安装、无需摄像头权限，最推荐 |
| 浏览器摄像头 | `/batteries/scan` 点「摄像头」 | 用 `BarcodeDetector` API；Chrome/Edge/Android 支持，iOS Safari 不支持时提示改用系统相机 |
| USB 扫码枪 | `/batteries/scan` 输入框 | 扫码枪当键盘输入，回车即查询；也兼容扫 `{baseUrl}/b/<code>` 短链（会自动提取编码） |

### 7.3 未登录扫码

`/b/<code>` 页面在登录保护路由下：未登录会跳登录页，登录后自动回跳原电池页（与物料 `/i/<code>` 同一机制）。

### 7.4 设备通道（X-Device-Key + 设备内用户会话）

设备终端（柜边平板/扫码台）不需要网页登录，用设备凭据接入：

1. 管理端创建设备，拿到 `DeviceKey` / `Secret`
2. 设备端 `POST /api/device/login`（带设备凭据）→ 返回 `sessionToken`（12 小时）
3. 之后调用电池借还接口，请求头带：

```
X-Device-Key: dev_xxx
X-Device-Secret: xxx
X-Device-Session: <sessionToken>
```

设备端电池接口（借用人 = 当前会话用户）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/device/battery/{code}` | 按编码查电池 |
| GET | `/api/device/battery/mine` | 当前用户在此设备上的在借 |
| POST | `/api/device/battery/{code}/borrow` | 借出 |
| POST | `/api/device/battery/{code}/return` | 归还 |

设备终端页面：`/device`（免网页登录，打开即可配置设备 + 登录使用人 + 扫码借还）。

> 会话 12 小时自动过期；登出调 `POST /api/device/logout`。会话与设备绑定，换设备无效。

---

## 8. 标签导出

入口：`/batteries` 页右上角「导出标签」（staff 可见）。

- 导出**当前筛选结果**的电池标签，每块一张
- 二维码内容 = `{baseUrl}/b/{code}`，另印编码与型号
- 模板取团队「物料默认模板」（`/api/label-templates`），接口不可用时回落内置默认模板
- PDF 页面尺寸 = 模板尺寸（不是 A4），可直接送标签机
- 文件名：`电池标签-YYYY-MM-DD.pdf`

---

## 9. 错误响应

统一 RFC 7807 `application/problem+json`：

```json
{ "type": "...", "title": "...", "status": 409, "detail": "电池当前状态为「借出」，不能借出" }
```

| 状态码 | 含义 |
|---|---|
| 400 | 参数错误 / 编码重复 / 非法状态变更 |
| 401 | 未登录或 token 失效 |
| 403 | 无权限（普通成员代借、普通成员新增电池） |
| 404 | 电池/编码不存在 |
| 409 | 状态冲突（重复借出、重复归还、找不到未归还流水） |

---

## 10. 常见问题

**Q：借出时返回 409？**
A：电池当前不是 `in_stock`。查台账看状态；如果显示"借出"但没人承认，管理员可用 `PUT` 强制回库（会关闭未归还流水）。

**Q：扫码枪扫出来是一整条 URL？**
A：正常。`/batteries/scan` 的 `extractBatteryCode` 会自动从 `/b/<code>` 或 `/i/<code>` 短链里取编码。

**Q：为什么普通成员不能代借？**
A：代借会把责任记到别人头上，必须由部长/管理员操作；借用人本人可以自助借还。

**Q：超时阈值怎么改？**
A：系统设置项 `Battery:OverdueHours`（默认 24 小时），前后端共用这个口径。

**Q：电池编码能和物料编码一样吗？**
A：建议独立用 `BAT-0001` 这类短码。物料编码是五段式且对应"型号"而非"单件"，两者语义不同。

---

## 11. 相关文档

- 设备接入 API：`docs/设备接入API.md`
- 物料编码规范：`docs/物料管理规范.md`
- 架构说明：`docs/ARCHITECTURE.md`
