# 设备接入 API（ESP32 / 传感器网关）

> 状态：已实现并通过集成测试（8/8）
> 接口前缀：设备侧 `/api/device`，管理侧 `/api/admin/devices`
> 适用：ESP32、ESP8266、树莓派、任意能发 HTTP 的采集节点

本文档同时是**使用手册**和**开发资料**：前半部分教管理员和设备开发者怎么用，后半部分讲代码结构、如何扩展、测试与运维。

---

## 1. 这是什么

给团队物料系统加了一条**设备通道**：硬件设备不需要模拟用户登录，用管理员签发的一对凭据（`DeviceKey` + `DeviceSecret`）就能：

- 上报任意遥测数据（重量、温度、在柜状态、门磁……原样落库）
- 按物料编码查询物料
- 上报库存变动（扫码入库/出库），自动更新库存并留流水与审计

设计上刻意保持「薄」：服务端**不解析**遥测内容，只保证能收、能存、能回放；语义由设备侧约定。这样后续接称重、RFID、温湿度都不需要改表。

---

## 2. 整体架构

```
┌──────────┐   HTTP + X-Device-Key/Secret   ┌──────────────────────┐
│  ESP32   │ ─────────────────────────────► │  TeamPortal 后端     │
│  采集器  │ ◄───────────────────────────── │  :8080               │
└──────────┘         JSON 响应               │  /api/device/*       │
                                             │  /api/admin/devices/*│
                                             └──────────┬───────────┘
                                                        │ EF Core
                                                        ▼
                                             ┌──────────────────────┐
                                             │ SQLite               │
                                             │ Devices              │
                                             │ DeviceTelemetries    │
                                             │ InventoryItems       │
                                             │ InventoryTransactions│
                                             └──────────────────────┘

       浏览器 ──► Next.js ──► /api/admin/devices（JWT + AdminOnly）
```

两条认证通道彼此独立：

| 通道 | 凭据 | 谁用 |
|---|---|---|
| 用户 JWT | `Authorization: Bearer <token>` | 浏览器 / 管理端 |
| 设备凭据 | `X-Device-Key` + `X-Device-Secret` | ESP32 等硬件 |

---

## 3. 快速开始（5 分钟）

> 以下命令在 PowerShell 里请用 `curl.exe`（PowerShell 的 `curl` 是 `Invoke-WebRequest` 别名，参数不兼容）。

### 3.1 管理员登录拿 token

```bash
curl.exe -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<你的口令>"}'
# {"token":"eyJhbGciOi..."}
```

> 登录接口有独立限流：生产环境 **5 次/60 秒/IP**。创建第一个设备只需要登录一次。

### 3.2 创建设备

```bash
curl.exe -s -X POST http://localhost:8080/api/admin/devices \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"电池柜1采集器","type":"esp32","locationCode":"CAB-01"}'
```

返回：

```json
{
  "id": 1,
  "name": "电池柜1采集器",
  "deviceKey": "dev_6f3a1c2b9d4e8a70",
  "type": "esp32",
  "locationCode": "CAB-01",
  "enabled": true,
  "createdAt": "2026-11-08T09:12:33.123Z",
  "secret": "9c2f7b1e..."
}
```

> ⚠️ **`secret` 只在这个响应里出现一次**。服务端只存哈希，丢了只能重置（见 6.4）。请立刻抄进固件配置或密码管理器。

### 3.3 设备心跳

```bash
curl.exe -s http://localhost:8080/api/device/ping \
  -H "X-Device-Key: dev_6f3a1c2b9d4e8a70" \
  -H "X-Device-Secret: 9c2f7b1e..."
# {"deviceId":1,"name":"电池柜1采集器","type":"esp32","locationCode":"CAB-01","serverTime":"..."}
```

### 3.4 上报一条遥测

```bash
curl.exe -s -X POST http://localhost:8080/api/device/telemetry \
  -H "X-Device-Key: dev_6f3a1c2b9d4e8a70" \
  -H "X-Device-Secret: 9c2f7b1e..." \
  -H "Content-Type: application/json" \
  -d '{"kind":"weight","payload":{"cabinet":"CAB-01","grams":12345,"batteryCount":12}}'
# 201 {"id":1,"createdAt":"..."}
```

### 3.5 查看设备与最近遥测

```bash
curl.exe -s http://localhost:8080/api/admin/devices -H "Authorization: Bearer <token>"
curl.exe -s "http://localhost:8080/api/admin/devices/1/telemetry?limit=20" -H "Authorization: Bearer <token>"
```

---

## 4. 认证机制

### 4.1 凭据组成

| 字段 | 格式 | 说明 |
|---|---|---|
| `DeviceKey` | `dev_` + 16 位十六进制 | 公开标识，可出现在日志里 |
| `DeviceSecret` | 48 位十六进制（192 位随机） | 机密，只在创建/重置时返回一次 |

### 4.2 请求头

每个设备请求必须同时携带：

```
X-Device-Key:    dev_6f3a1c2b9d4e8a70
X-Device-Secret: 9c2f7b1e...
```

两个头缺一、错误、或设备被禁用 → **401**。

### 4.3 哈希与校验

- 服务端存 `SecretHash = "salt:sha256(salt + secret)"`（每设备独立随机盐，十六进制）。
- 校验用定长比较（`CryptographicOperations.FixedTimeEquals`），防时序侧信道。
- 为什么不用 BCrypt：Secret 是服务端生成的 192 位随机值，本身没有低熵问题；慢哈希只会让每个上报请求多花几十毫秒。

### 4.4 LastSeen 节流

设备每次认证成功会刷新 `LastSeenAt` / `LastSeenIp`，但**最多每 60 秒写一次库**——设备高频上报时不至于每次请求都产生一次写事务。管理端的 `online` 判定是「最后心跳在 5 分钟内」。

### 4.5 密钥轮换 / 禁用 / 删除

| 操作 | 方法 | 效果 |
|---|---|---|
| 重置密钥 | `POST /api/admin/devices/{id}/rotate-secret` | 返回新 secret；旧 secret 立即 401 |
| 禁用 | `PUT /api/admin/devices/{id}` `{"enabled":false}` | 该设备所有请求 401，但数据保留 |
| 删除 | `DELETE /api/admin/devices/{id}` | 设备 + 其全部遥测级联删除 |

设备丢失、离职交接、怀疑泄露 → 一律「先 rotate，再决定是否禁用」。

### 4.6 认证失败响应

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json

{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.2","title":"Unauthorized","status":401}
```

---

## 5. 设备侧 API

所有响应都是 JSON；错误统一用 RFC 7807 ProblemDetails。

### 5.1 `GET /api/device/ping`

心跳 + 自检。建议设备上电后先调一次，确认凭据有效。

**响应 200：**

```json
{
  "deviceId": 1,
  "name": "电池柜1采集器",
  "type": "esp32",
  "locationCode": "CAB-01",
  "serverTime": "2026-11-08T09:15:00.000Z"
}
```

`serverTime` 可用于设备校时（设备无 RTC 时）。

---

### 5.2 `POST /api/device/telemetry`

上报原始遥测/事件。

**请求：**

```json
{
  "kind": "weight",
  "payload": { "cabinet": "CAB-01", "grams": 12345 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | string | 否 | 事件类型，默认 `telemetry`；超 32 字符截断 |
| `payload` | 任意 JSON | 否 | 原样落库；序列化后超过 **20000 字符** 返回 400 |

**响应 201：**

```json
{ "id": 42, "createdAt": "2026-11-08T09:15:00.000Z" }
```

**错误：**

| 状态码 | 场景 |
|---|---|
| 400 | payload 超过 20000 字符 |
| 401 | 凭据无效 |

> 服务端不校验 payload 结构。建议设备侧自己约定 `kind` 命名，例如：
> `weight`（称重）、`door`（门磁）、`temp`（温度）、`scan`（扫码事件）、`heartbeat`（仅保活）。

---

### 5.3 `GET /api/device/materials/{code}`

按物料编码查询（大小写不敏感）。

**响应 200：**

```json
{
  "id": 17,
  "name": "6S 3300mAh 锂电池",
  "category": "电池电源",
  "code": "BAT-LIPO-6S3300MAH-2026-0001",
  "quantity": 10,
  "locationCode": "A-1-2-3",
  "status": "available"
}
```

**错误：** 404 = 没有这个编码。

---

### 5.4 `POST /api/device/materials/{code}/stock`

上报库存变动（扫码入库/出库）。

**请求：**

```json
{ "delta": -2, "note": "拿出去飞" }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `delta` | int | 正数入库、负数出库；不能为 0 |
| `note` | string? | 可选备注 |

**响应 200：**

```json
{ "id": 17, "quantity": 8, "delta": -2 }
```

**错误：**

| 状态码 | 场景 |
|---|---|
| 400 | delta = 0，或扣减后库存为负 |
| 404 | 编码不存在 |
| 401 | 凭据无效 |

**副作用：**

- 更新 `InventoryItems.Quantity`（同一事务内）
- 写一条 `InventoryTransactions`：`Type = device_in / device_out`，`UserName = device:{DeviceKey}`
- 写审计日志：`device-stock-in` / `device-stock-out`

> 注意：设备流水和人工领用流水共用一张表，前端「物料交易记录」会同时显示 `device_in/device_out`。

---

## 6. 管理侧 API

全部端点挂在 `/api/admin/devices`，策略 `AdminOnly`（只有 `role=admin` 的 JWT 能访问）。

### 6.1 `GET /` 设备列表

**响应 200：**

```json
[
  {
    "id": 1,
    "name": "电池柜1采集器",
    "deviceKey": "dev_6f3a1c2b9d4e8a70",
    "type": "esp32",
    "locationCode": "CAB-01",
    "firmwareVersion": "1.0.3",
    "enabled": true,
    "createdAt": "2026-11-08T09:12:33.123Z",
    "lastSeenAt": "2026-11-08T09:15:00.000Z",
    "lastSeenIp": "192.168.1.50",
    "online": true
  }
]
```

`online` = 已启用 且 最后心跳在 5 分钟内。

### 6.2 `POST /` 创建设备

**请求：**

```json
{ "name": "电池柜1采集器", "type": "esp32", "locationCode": "CAB-01" }
```

- `name` 必填（非空）
- `type` 可选：`esp32` / `sensor` / `gateway` / `other`，默认 `esp32`
- `locationCode` 可选

**响应 201：** 见 3.2，含一次性 `secret`。

### 6.3 `PUT /{id}` 更新设备

**请求**（所有字段可选，只传要改的）：

```json
{
  "name": "电池柜1采集器",
  "type": "esp32",
  "locationCode": "CAB-01",
  "firmwareVersion": "1.0.4",
  "enabled": true
}
```

- `locationCode` 传空字符串 = 清空
- `enabled: false` = 禁用（设备立即 401）

**响应 200：** 更新后的设备（不含 secret）。

### 6.4 `POST /{id}/rotate-secret` 重置密钥

**响应 200：**

```json
{ "id": 1, "secret": "新的48位十六进制" }
```

旧 secret 立即失效。设备端需要同步更新并重启。

### 6.5 `DELETE /{id}` 删除设备

**响应 200：** `{ "success": true }`

级联删除该设备的全部遥测。审计日志保留（记录设备名与 DeviceKey）。

### 6.6 `GET /{id}/telemetry?limit=50` 最近遥测

- `limit` 范围 1–500，默认 50
- 按时间倒序

**响应 200：**

```json
[
  {
    "id": 42,
    "deviceId": 1,
    "kind": "weight",
    "payloadJson": "{\"cabinet\":\"CAB-01\",\"grams\":12345}",
    "createdAt": "2026-11-08T09:15:00.000Z"
  }
]
```

> `payloadJson` 是**字符串**（原始 JSON 文本），前端需要自己 `JSON.parse`。这样设计是为了不约束设备 payload 的形状。

---

## 7. 数据模型

### 7.1 `Devices`

| 列 | 类型 | 说明 |
|---|---|---|
| `Id` | INTEGER PK | |
| `Name` | TEXT NOT NULL | 设备名 |
| `DeviceKey` | TEXT NOT NULL UNIQUE | `dev_...` |
| `SecretHash` | TEXT NOT NULL | `salt:hash` |
| `Type` | TEXT | 默认 `esp32` |
| `LocationCode` | TEXT NULL | 关联库位/柜体 |
| `FirmwareVersion` | TEXT NULL | 设备可上报或管理端填写 |
| `Enabled` | INTEGER NOT NULL DEFAULT 1 | 0 = 禁用 |
| `CreatedAt` | TEXT NOT NULL | UTC |
| `LastSeenAt` | TEXT NULL | UTC |
| `LastSeenIp` | TEXT NULL | |

### 7.2 `DeviceTelemetries`

| 列 | 类型 | 说明 |
|---|---|---|
| `Id` | INTEGER PK | |
| `DeviceId` | INTEGER NOT NULL | FK → Devices，`ON DELETE CASCADE` |
| `Kind` | TEXT NOT NULL | 事件类型 |
| `PayloadJson` | TEXT NOT NULL | 原始 JSON |
| `CreatedAt` | TEXT NOT NULL | UTC |

索引：`(DeviceId, CreatedAt)`。

### 7.3 建表与迁移

本项目采用 **EF Migrations + 幂等补表** 双轨：

- `Program.cs` 启动时先 `db.Database.Migrate()`（全新库由 InitialCreate 建基础表）
- 再执行 `MigrateExistingTables()` 里手写的 `CREATE TABLE IF NOT EXISTS`（本功能的两张表在这里，见 `Program.cs` 中「设备接入」段）

因此**已有生产库升级不需要手动跑 SQL**，重启即自动补表。

> 开发提醒：仓库注释约定「后续 schema 变更应新增 EF 迁移，不再向 `MigrateExistingTables` 添加语句」。设备表沿用旧约定落在这里，是因为它要同时兼容历史库；新增字段优先走 EF 迁移。

### 7.4 容量与清理

- 每条遥测约 100–500 字节；4 台设备每 30 秒一条 ≈ 每天 1.1 万条，一年约 400 万条（~1–2 GB）。
- 当前**没有自动清理**。建议：
  - 设备端按需上报（状态变化 + 5 分钟一次心跳即可，不要每秒上报）
  - 后续加一个维护任务：保留 90 天，或按 `Kind` 保留不同时长
  - 需要长期曲线时，把关键指标（重量/温度）单独落结构化表，遥测表只做原始留档

---

## 8. ESP32 参考实现

### 8.1 依赖

- Arduino ESP32 core（自带 `WiFi.h`、`HTTPClient.h`）
- 不强制 ArduinoJson：下面示例手拼 JSON，避免额外依赖；接复杂 payload 时再引入

### 8.2 最小可用固件

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

// ── 配置（生产建议放 NVS / 编译宏，不要提交到 git）──
const char* WIFI_SSID   = "team-wifi";
const char* WIFI_PASS   = "********";
const char* API_BASE    = "http://192.168.1.10:8080";
const char* DEVICE_KEY  = "dev_6f3a1c2b9d4e8a70";
const char* DEVICE_SECRET = "9c2f7b1e...";

int postJson(const String& path, const String& body) {
  HTTPClient http;
  http.begin(String(API_BASE) + path);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.addHeader("X-Device-Secret", DEVICE_SECRET);
  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("POST %s -> %d %s\n", path.c_str(), code, http.getString().c_str());
  } else {
    Serial.printf("POST %s -> transport error %d\n", path.c_str(), code);
  }
  http.end();
  return code;
}

bool ping() {
  HTTPClient http;
  http.begin(String(API_BASE) + "/api/device/ping");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.addHeader("X-Device-Secret", DEVICE_SECRET);
  int code = http.GET();
  http.end();
  return code == 200;
}

void reportWeight(int grams) {
  String body = "{\"kind\":\"weight\",\"payload\":{\"grams\":" + String(grams) + "}}";
  postJson("/api/device/telemetry", body);
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  Serial.println("WiFi connected");
  Serial.printf("ping -> %d\n", ping());
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    int grams = readScale();          // 你的称重/霍尔采集逻辑
    reportWeight(grams);
  }
  delay(30000);                       // 30 秒一次足够
}
```

### 8.3 断网缓存与重传

设备经常部署在信号差的位置，建议加一个小的环形缓冲：

```cpp
const int CAP = 32;
String queue[CAP];
int head = 0, count = 0;

void enqueue(const String& body) {
  queue[head] = body;
  head = (head + 1) % CAP;
  if (count < CAP) count++;
}

void flushQueue() {
  while (count > 0 && WiFi.status() == WL_CONNECTED) {
    int tail = (head - count + CAP) % CAP;
    int code = postJson("/api/device/telemetry", queue[tail]);
    if (code != 201) break;          // 失败就留着重试
    count--;
  }
}
```

策略建议：

| 情况 | 做法 |
|---|---|
| 网络断开 | 数据进环形缓冲，不丢最新 N 条 |
| 401 | **不要重试**：说明密钥错了/设备被禁用，记录日志后进入低功耗提示 |
| 429 | 退避（本项目 `/api/device` 当前未启用限流，但前置代理可能限） |
| 5xx | 指数退避重试 |
| 缓存满 | 丢最旧，保留最新 |

### 8.4 配置管理

- 固件内硬编码仅适合原型；正式部署建议把 `DEVICE_KEY/SECRET` 存 NVS，配一个串口/AP 配网流程写入。
- 更换密钥时同步改 NVS 并重启，避免旧密钥一直 401。

---

## 9. 开发指南

### 9.1 代码结构

| 文件 | 职责 |
|---|---|
| `src/TeamPortal/Data/Models/Device.cs` | 设备实体 |
| `src/TeamPortal/Data/Models/DeviceTelemetry.cs` | 遥测流水实体 |
| `src/TeamPortal/Services/DeviceAuthService.cs` | 签发、哈希、认证、重置、LastSeen 节流 |
| `src/TeamPortal/Endpoints/DeviceEndpoints.cs` | 设备侧 4 个端点 |
| `src/TeamPortal/Endpoints/DeviceAdminEndpoints.cs` | 管理侧 6 个端点 |
| `src/TeamPortal/Data/AppDbContext.cs` | DbSet + 索引 + 外键 |
| `src/TeamPortal/Program.cs` | 注册、映射、建表 |
| `tests/api/DeviceEndpointTests.cs` | 8 个集成测试 |

### 9.2 新增一个设备端点

1. 在 `DeviceEndpoints.cs` 的 group 里加 `MapGet/MapPost`；
2. 第一行统一 `var device = await auth.AuthenticateAsync(ctx); if (device is null) return Unauthorized();`；
3. 需要审计时注入 `LogService`，用 `actor = $"device:{device.DeviceKey}"`；
4. 需要物料时注入 `InventoryService`（只读）或 `AppDbContext`（写）。

示例：

```csharp
group.MapGet("/config", async (HttpContext ctx, DeviceAuthService auth) =>
{
    var device = await auth.AuthenticateAsync(ctx);
    if (device is null) return Results.Problem("设备认证失败", statusCode: 401);
    return Results.Ok(new { pollSeconds = 30, locationCode = device.LocationCode });
});
```

### 9.3 扩展遥测语义

当前 `payload` 是黑盒。如果要做「温度超限告警」，有两种做法：

**A. 设备侧声明 kind，服务端按 kind 解析（推荐先做）**

```csharp
if (kind == "temp")
{
    using var doc = JsonDocument.Parse(payload);
    var value = doc.RootElement.GetProperty("celsius").GetDouble();
    if (value > 60) _notification.Notify("温度告警", $"{device.Name} 柜内温度 {value}℃", "/battery");
}
```

**B. 加独立结构化表**

新增 `DeviceReadings(DeviceId, Metric, Value, CreatedAt)`，遥测上报时同时写一份。适合要做图表/统计的场景。

两种可以并存：原始 JSON 留档，结构化的只存关心的指标。

### 9.4 测试

```bash
# 只跑设备接入测试
dotnet test tests/api --filter FullyQualifiedName~DeviceEndpointTests

# 全量（注意下面两个环境坑）
dotnet test tests/api
```

测试覆盖：创建设备/心跳、错误密钥、禁用、重置密钥、遥测落库、超大 payload、按编码查物料、库存变动、在线状态。

**两个本机环境坑：**

1. **NuGet fallback 目录**
   `obj/*.nuget.g.props` 里可能残留不存在的 `D:\Program Files (x86)\visual sdk\NuGetPackages`。
   解决：删掉 `src/TeamPortal/obj` 和 `tests/api/obj` 后重新 `dotnet restore`。

2. **测试宿主 EventLog**
   Windows 上测试宿主默认挂 EventLog provider，当前用户无事件日志写权限时直接抛异常，表现为「所有集成测试启动失败」。
   本功能的测试已在 `NewClient` 里 `ClearProviders()`；**仓库里其他老测试仍会因这个原因失败**，与业务代码无关。
   若要全量跑通，可临时给测试项目加环境变量或以允许写事件日志的账户运行。

### 9.5 数据库变更规范

- 全新表/列：优先新增 EF 迁移（`dotnet ef migrations add <Name>`）；
- 需要兼容历史库的幂等补表：放 `MigrateExistingTables()`，用 `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` + 忽略 duplicate；
- 不要在实体里用 `[NotMapped]` 绕过迁移——那会让生产库与实体静默不一致。

### 9.6 限流说明

- `/api/device/*` **没有**挂 `RequireRateLimiting`，不受登录限流影响；
- `/api/auth/login` 生产 5 次/60 秒/IP；`/api/ai`、`/api/wiki`、固件下载等挂了 `default`（生产 60 次/10 秒/IP）。
- 如果设备量很大且经同一出口 IP，后续要给设备端单独加限流策略时，注意按 `DeviceKey` 分桶而不是 IP。

---

## 10. 安全与运维

### 10.1 安全检查清单

- [ ] `DeviceSecret` 只存在固件/NVS/密码管理器，不进 git、不进日志
- [ ] 生产环境走 HTTPS（设备端 `http.begin` 改为 `https.begin` 并校验证书或至少跳过校验明确记录风险）
- [ ] 定期检查 `lastSeenIp` 是否符合预期网段
- [ ] 设备丢失立即 `rotate-secret` 或 `enabled=false`
- [ ] 审计日志里搜 `device-stock-` 核对库存变动来源

### 10.2 审计日志在哪

管理端「系统日志 / 操作日志」页，或直接查 `OperationLogs`：

| action | 触发 |
|---|---|
| `create` / `update` / `delete` / `rotate-secret` | 管理端设备操作，targetType=`device` |
| `device-stock-in` / `device-stock-out` | 设备改库存，targetType=`item` |

### 10.3 监控建议

- 在线率：`online=false` 的设备数（可加仪表盘卡片）
- 遥测延迟：设备侧记录 `serverTime` 与本地时间差
- 401 突增：可能是密钥轮换后固件没更新

---

## 11. 已知限制与后续规划

当前限制：

- 遥测**不分页查询**（只有最近 N 条），没有按时间范围/kind 过滤
- 没有 WebSocket/SSE 实时推送，前端要轮询
- 没有自动清理/归档遥测
- 没有设备端固件 OTA
- 没有前端管理页（当前用 curl/OpenAPI 调试）

建议路线：

1. 前端 `/admin/devices` 管理页（列表、在线状态、一次性密钥展示、遥测回看）
2. 遥测查询加时间范围 + kind 过滤 + 分页
3. 关键指标结构化（重量/温度）→ 看板与告警
4. 遥测保留策略（后台清理任务）
5. 设备注册配额与按 DeviceKey 限流

---

## 12. 附录

### 12.1 错误码速查

| 状态码 | 含义 | 典型原因 |
|---|---|---|
| 200 | 成功 | |
| 201 | 已创建 | 创建设备、上报遥测 |
| 400 | 参数错误 | delta=0、payload 超长、name 为空、库存不足 |
| 401 | 认证失败 | 缺头、密钥错误、设备禁用、JWT 过期 |
| 403 | 无权限 | 非 admin 访问管理端 |
| 404 | 不存在 | 设备/物料编码不存在 |
| 429 | 限流 | 登录过于频繁（设备端点目前不限流） |
| 500 | 服务端错误 | 查服务端日志 |

### 12.2 curl 速查（PowerShell 用 curl.exe）

```bash
# 登录
curl.exe -s -X POST http://localhost:8080/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"***"}'

# 建设备
curl.exe -s -X POST http://localhost:8080/api/admin/devices -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"柜1","type":"esp32","locationCode":"CAB-01"}'

# 列表
curl.exe -s http://localhost:8080/api/admin/devices -H "Authorization: Bearer $TOKEN"

# 禁用
curl.exe -s -X PUT http://localhost:8080/api/admin/devices/1 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"enabled":false}'

# 重置密钥
curl.exe -s -X POST http://localhost:8080/api/admin/devices/1/rotate-secret -H "Authorization: Bearer $TOKEN"

# 心跳（设备）
curl.exe -s http://localhost:8080/api/device/ping -H "X-Device-Key: dev_xxx" -H "X-Device-Secret: xxx"

# 上报（设备）
curl.exe -s -X POST http://localhost:8080/api/device/telemetry -H "X-Device-Key: dev_xxx" -H "X-Device-Secret: xxx" -H "Content-Type: application/json" -d '{"kind":"weight","payload":{"grams":12345}}'

# 查物料（设备）
curl.exe -s http://localhost:8080/api/device/materials/BAT-LIPO-6S3300MAH-2026-0001 -H "X-Device-Key: dev_xxx" -H "X-Device-Secret: xxx"

# 库存变动（设备）
curl.exe -s -X POST http://localhost:8080/api/device/materials/BAT-LIPO-6S3300MAH-2026-0001/stock -H "X-Device-Key: dev_xxx" -H "X-Device-Secret: xxx" -H "Content-Type: application/json" -d '{"delta":-1,"note":"出库"}'
```

### 12.3 OpenAPI

管理端可访问 `GET /api/admin/openapi`（StaffOnly）导出 OpenAPI 文档，用于生成客户端或 Postman 集合。
