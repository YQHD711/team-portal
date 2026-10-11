# TeamPortal AI 知识库利用率改造 · 需求规格

> 交付对象：编码 agent（直接实施）
> 提出：2026-10-11 | 依据：线上实测诊断（证据见附录）
> 硬约束：服务器 1.8G 内存，禁止引入常驻大内存依赖；现有架构（.NET 10 后端 + TF-IDF 索引）上做增量改造，不换检索框架

---

## 背景与目标

现状：队员聊天 RAG 链路（AiProxyService → KnowledgeSearchService TF-IDF）形同虚设——中文提问无法命中英文文档（知识库 4602 篇中约 1635 篇为英文），且检索效果无任何观测数据。

目标（验收口径）：
1. 中文提问可命中英文文档并正确标注出处
2. 管理员能看到 RAG 实际命中情况（空转率可量化）
3. 知识问答质量提升（温度、学习库接入）

---

## P0-1 中英桥接索引（核心）

### 需求
为每篇英文文档生成一行中文摘要 sidecar，参与现有 TF-IDF 索引，使中文 query 命中英文原文。

### 实现
- 新建后台任务 `BridgingIndexJob`：
  - 扫描知识库目录，筛选英文文档（判定：ASCII 占比 > 70% 或无 CJK 字符）
  - 对每篇调用 DeepSeek API（复用现有 `AI:DeepSeekKey` / `AI:ModelName` 配置），prompt 要求输出一行 JSON：`{"t": "<中文标题>", "k": ["关键词1", "关键词2", ...], "d": "<一句话中文摘要≤60字>"}`
  - 输出写入同目录 `{filename}.zhidx.json`（sidecar）
- sidecar 必须被 `KnowledgeSearchService` 索引：Tokenize 正常处理其中文内容；同时 sidecar 内加一行原文文件路径，检索结果命中 sidecar 时映射到原文档返回
- ACL：sidecar 与原文同路径，天然继承现有 `CanAccess` 路径过滤，无需额外处理
- 调度与限流：
  - 手动触发入口 + 每日增量跑一次（只处理新增/变更文档，用文件 mtime 对比）
  - 并发 1，请求间隔 ≥ 500ms，失败重试 2 次后跳过并记日志
  - 硬上限：单次运行最多处理 300 篇，防止一次烧完 token

### 验收
- [ ] 对 DeepWiki 目录（91 篇英文）全量生成 sidecar，抽查 5 篇内容正确
- [ ] 用"盘旋半径由什么决定"检索，能返回 TECS/导航相关英文文档，snippet 出自原文
- [ ] sidecar 文件不出现在知识库树 UI 和 knowledge_read 中（过滤 `*.zhidx.json`）

---

## P0-2 RAG 可观测性

### 需求
记录每次检索的实际效果，量化空转率。

### 实现
- `KnowledgeSearchService.Search` 增加结果统计日志（Category=`ai`）：
  - `RAG search: q=<query前40字> hits=<scores字典条数> returned=<topK条数> empty=<是否为空>`
  - AiProxyService 拿到最终 context 后补记：`RAG context: chars=<上下文长度> used=<注入文档数>`
- 管理员端 `/admin` 新增"AI 检索统计"卡片（可挂在现有系统健康页）：
  - 最近 7 天：检索次数、空结果次数、空转率百分比
  - 最近 10 条空结果 query 列表（用于发现知识库缺口）

### 验收
- [ ] 聊天提问后 SystemLogs 可见对应 RAG 日志
- [ ] 管理页能显示空转率数值

---

## P1-1 检索与生成质量

1. **分块索引**：`KnowledgeSearchService` 由整文档索引改为分块索引（chunk ≈ 800 字符，重叠 100 字符）；同一文档多 chunk 得分取 max 聚合；snippet 直接取命中 chunk。注意 `_docCount` 语义变为 chunk 数，IDF 公式不变
2. **BM25 打分**：以 BM25(k1=1.5, b=0.75) 替换 TF-IDF 计分，倒排索引结构不变，仅改打分函数（需缓存文档平均长度）
3. **温度**：聊天默认 `AI:Temperature` 由 1.0 改为 0.3（保留设置项可调）
4. **提示词补充**（AiProxyService RAG 注入段）：加一句"参考资料为空时，必须先告知用户『知识库中未检索到相关队内资料』，再基于通用知识回答"

### 验收
- [ ] 索引重建后内存占用增量 < 300MB（1.8G 服务器硬约束）
- [ ] 长文档（如 ArdupilotWiki 长页）检索 snippet 命中在相关段落而非文档开头
- [ ] 空结果时回答开头明确声明未检索到资料

---

## P1-2 学习库接入聊天

### 需求
"工程部怎么学""我想学习电子部资料"这类问题，直接给出学习路径而非通用建议。

### 实现
- `/study` 学习库数据（阶段/课时结构）注入检索范围：将各部门学习库导出为索引文档（每部门一份，含阶段标题+课时清单+晋级门槛），chat RAG 自然命中
- 提示词加规则："若检索到学习库内容，按阶段顺序给出学习路径并注明在 /study 页面查看完整内容"

### 验收
- [ ] "工程部怎么学"的回答包含工程部学习库的具体阶段名称

---

## 明确不做（本期范围外）

- 本地 embedding 模型 / 向量数据库（内存约束 + 现无 API，P2 评估后再议）
- SystemAgent 改造（其运维定位正确，不动）
- 知识库内容本身的结构调整

---

## 附录：诊断证据（2026-10-11 实测）

- ChatMessages 全表仅 57 条/近月，活跃用户 3 人
- SystemLogs：`search_knowledge` 相关 0 条；RAG 无任何命中统计日志
- 知识库 4602 md / 66M：ArdupilotWiki 英文 1544 篇、DeepWiki（ArduPilot 53 + PX4 38）91 篇全英文
- 真实提问样本"ardupilot plane guide模式的盘旋半径由什么决定"——答案在 DeepWiki 英文档，中文 query TF-IDF 零召回，RAG 上下文为空，模型退化为通用知识回答
- `KnowledgeSearchService`：整文档索引 + TF-IDF + 中文单字/bigram；`AiProxyService.ChatStream` topK=8 → 过滤后取 5 注入；temperature 默认 1.0
