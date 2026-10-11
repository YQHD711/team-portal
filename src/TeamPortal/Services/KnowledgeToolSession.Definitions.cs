namespace TeamPortal.Services;

/// <summary>
/// 给模型看的工具声明（OpenAI function calling 格式）。
/// 单独一个 partial 是为了让 KnowledgeToolSession.cs 保持在 200 行以内。
/// </summary>
public sealed partial class KnowledgeToolSession
{
    public static object[] Definitions =>
    [
        new
        {
            type = "function",
            function = new
            {
                name = "search_knowledge",
                description = "在队内知识库里做一次全文检索，返回最相关的文档片段（path/snippet/score）。"
                              + "当你觉得现有资料不足、或需要换个更具体的说法再找一次时调用它。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        query = new { type = "string", description = "检索关键词，尽量具体（例如「年终总结 训练 成绩」）" },
                        top_k = new { type = "integer", description = $"返回条数 1-{MaxSearchResults}，默认 {DefaultTopK}" }
                    },
                    required = new[] { "query" }
                }
            }
        },
        new
        {
            type = "function",
            function = new
            {
                name = "read_document",
                description = "读某份知识库文档的一段正文（分页）。想完整了解一篇长文档（例如年终总结）时，"
                              + "用返回的 offset/hasMore 逐页读完，不要只看第一页就下结论。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        path = new { type = "string", description = "文档相对路径，取自检索结果的 path" },
                        offset = new { type = "integer", description = "起始字符下标，默认 0" },
                        length = new { type = "integer", description = $"本次读取字符数 1-{MaxPageChars}，默认 {DefaultPageChars}" }
                    },
                    required = new[] { "path" }
                }
            }
        }
    ];
}
