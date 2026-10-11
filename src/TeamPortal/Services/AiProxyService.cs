using System.Text;
using System.Text.Json;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// AI service — DeepSeek V4 Pro with knowledge base RAG.
/// Uses TF-IDF indexed search for fast, relevant knowledge retrieval.
/// </summary>
public partial class AiProxyService
{
    private readonly AiClient _ai;
    private readonly SettingsService _settings;
    private readonly KnowledgeSearchService _search;
    private readonly KnowledgeService _knowledge;
    private readonly LogService _log;
    private readonly AppDbContext _db;

    /// <summary>
    /// 内置默认提示词。前端是纯文本渲染（whitespace-pre-wrap），所以这里明确要求模型不要输出
    /// Markdown 装饰与 emoji —— 否则 **加粗**、## 标题、--- 分割线会原样显示，看起来全是符号。
    /// 管理员可在「系统设置 → AI 服务 → AI:SystemPrompt」整体替换。
    /// </summary>
    internal const string DefaultSystemPrompt = """
        你是"雏鹰之翼"航模队的内部 AI 助手，为队员提供技术支持和知识查询服务。

        身份：航模队的技术顾问，熟悉航模设计、制作、飞行全流程，涵盖空气动力学、电子工程、材料科学、竞赛规则等领域。

        规则：
        1. 优先使用知识库中的队内资料作答，并在结尾用「来源：文件名」注明出处
        2. 知识库没有相关内容时可用通用知识回答，但必须说明「以下信息来自通用知识，请以队内最新规范为准」
        3. 回答精准务实、避免冗长，让队员能直接照着做
        4. 技术参数与安全规范必须严谨，不确定的信息要明确说明
        5. 使用中文，语气专业而亲切，像资深队员在指导新人

        输出格式（重要，务必遵守）：
        - 直接输出纯文本，不要任何 Markdown 装饰：不用星号加粗、不用井号做标题、不用横线做分割、不用引用块、不要表格
        - 不要输出 emoji 或装饰性小图标、符号
        - 需要分点时用「1. 2. 3.」或「- 」的简单列表，最多一层；能用一两段话讲清楚就不要列表
        - 先给结论，再给必要的说明
        """;

    /// <summary>取生效的提示词：管理员配置优先，留空则用内置默认。</summary>
    internal static string SystemPromptOrDefault(string? configured) =>
        string.IsNullOrWhiteSpace(configured) ? DefaultSystemPrompt : configured.Trim();

    private async Task<string> ResolveSystemPrompt() =>
        SystemPromptOrDefault(await _settings.Get("AI:SystemPrompt"));

    public AiProxyService(AiClient ai, SettingsService settings, KnowledgeSearchService search,
        KnowledgeService knowledge, LogService log, AppDbContext db)
    {
        _ai = ai;
        _settings = settings;
        _search = search;
        _knowledge = knowledge;
        _log = log;
        _db = db;
    }

    /// <summary>调用者身份,用于把知识库检索限制在其有权查看的范围内(跨部门/他人私人 wiki 不参与检索)。</summary>
    public readonly record struct SearchScope(string? Role, string? Department, int UserId);

    /// <summary>
    /// 聊天主入口（task-16 起是"模型自主多轮检索"）：先按原逻辑注入 RAG + 实时块 + 提示词，
    /// 再让模型自己决定要不要继续检索/翻文档（上限见 AgenticChatAsync），最后一轮仍以 SSE 流返回。
    /// </summary>
    public async Task<Stream?> ChatStream(string question, SearchScope scope, List<(string role, string content)>? history = null)
    {
        var opt = await _ai.ResolveAsync();
        if (!opt.IsConfigured) return null;

        var messages = await BuildMessagesAsync(question, scope, history);
        return await AgenticChatAsync(opt, messages, scope);
    }

    public async Task<object?> Search(string query, SearchScope scope)
    {
        var results = _search.Search(query, topK: 5, scope.Role, scope.Department, scope.UserId);
        var context = BuildContext(results);

        string? answer = null;
        var opt = await _ai.ResolveAsync();
        if (opt.IsConfigured)
        {
            try
            {
                var messages = new List<object> { new { role = "system", content = await ResolveSystemPrompt() } };
                var ragPrompt = results.Count > 0
                    ? $"根据以下参考资料回答问题。\n\n参考资料：\n{context}\n\n问题：{query}"
                    : query;
                messages.Add(new { role = "user", content = ragPrompt });

                var payload = _ai.BuildChatPayload(opt, messages, stream: false);
                var resp = await _ai.SendAsync(_ai.CreateChatRequest(opt, payload));
                if (resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(body);
                    answer = AiClient.ExtractMessageContent(doc.RootElement);
                }
            }
            catch { }
        }

        return new { sources = results.Select(r => new { r.Path, r.Snippet, r.Score }), answer };
    }

    /// <summary>
    /// RAG 注入段（P1-1 起**始终注入**）。三种组合：
    ///   - KB 空 + 无实时数据 → P1-1 原文：回答开头必须先声明「知识库中未检索到相关队内资料」；
    ///   - 有 KB 资料（±实时数据）→ 原有 KB 段 + 学习库规则（P1-2）+ 实时数据规则；
    ///   - **KB 空但有实时数据** → 不再要求声明"没检索到资料"（明明查到了实时库存），直接按实时结果回答。
    /// 实时块里的数字是当前值，模型必须直接用；查不到要明说去「零件库存 / 物料布局」看，严禁编。
    /// </summary>
    internal static string RagInjectionFor(string context, string? liveContext = null)
    {
        var hasKb = !string.IsNullOrEmpty(context);
        var hasLive = !string.IsNullOrEmpty(liveContext);
        if (!hasKb && !hasLive)
            return "知识库检索结果：没有检索到相关资料。回答开头必须先明确告知用户「知识库中未检索到相关队内资料」，"
                   + "再基于通用知识回答，并提醒以队内最新规范为准；不要编造队内资料或来源。";

        var sb = new System.Text.StringBuilder();
        if (hasKb)
        {
            sb.AppendLine("知识库参考资料（按相关度排序）：");
            sb.AppendLine("请优先使用这些资料回答；与问题无关的直接忽略。");
            sb.AppendLine("若这些资料都不能回答该问题，必须先在回答开头说明「知识库中未检索到相关队内资料」，再基于通用知识回答并注明。");
            sb.AppendLine("若资料里包含学习库（某部门的学习路径、阶段与课时），按阶段顺序给出学习路径（阶段名与课时名要具体），并提醒可在 /study 页面查看完整内容与打勾进度。");
            sb.AppendLine();
            sb.AppendLine(context);
        }
        else
        {
            sb.AppendLine("知识库没有匹配到文档；下面是系统实时查询结果，直接按它回答，不需要再声明\"没有资料\"。");
        }

        if (hasLive)
        {
            sb.AppendLine();
            sb.AppendLine(liveContext);
            sb.AppendLine("关于「系统实时查询结果」：其中的数量、库位、状态是**当前值**，直接采用，不要用通用知识推测。");
            sb.AppendLine("如果用户问的物料或房间没有出现在实时结果里，明确说明「系统里没有查到该物料（或房间），请到「零件库存 / 物料布局」页面确认」，严禁编造数量或货位。");
        }
        return sb.ToString().TrimEnd();
    }

    /// <summary>拼装知识库上下文。刻意不用 emoji/## 装饰：这些符号会被模型照抄进回答里。</summary>
    internal static string BuildContext(List<KbResult> sources)
    {
        if (sources.Count == 0) return "";
        return string.Join("\n\n", sources.Select(s => $"来源：{s.Path}（相关度 {s.Score:F2}）\n{s.Snippet}"));
    }
}
