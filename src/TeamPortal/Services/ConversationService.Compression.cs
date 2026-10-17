using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public partial class ConversationService
{

    /// <summary>
    /// Compress old messages into a system-level summary.
    /// Takes oldest 15 user/assistant messages, summarizes them via AI,
    /// stores the summary as a system message, deletes originals.
    /// </summary>
    private async Task CompressMemory(AppDbContext db, string sessionId, AiClient ai)
    {
        var oldMessages = await db.ChatMessages
            .Where(m => m.SessionId == sessionId && m.Role != "system")
            .OrderBy(m => m.Id)
            .Take(15)
            .ToListAsync();

        if (oldMessages.Count < 5) return;

        // Build conversation text for summarization
        var sb = new StringBuilder();
        foreach (var m in oldMessages)
            sb.AppendLine($"[{m.Role}]: {m.Content}");

        // Ask AI to summarize
        var summaryPrompt = $"请用中文简洁总结以下对话的关键信息（不超过200字），保留重要决策、数据、用户偏好、任务进度等信息：\n\n{sb}";

        try
        {
            var opt = await ai.ResolveAsync();
            if (string.IsNullOrWhiteSpace(opt.ApiKey))
            {
                _log.LogWarning("历史压缩跳过：未配置 AI ApiKey（系统设置 AI:ApiKey）");
                return;
            }

            // 走统一 payload 构造：思考模式/服务商差异（thinking、top_p、temperature 互斥）由 AiClient 处理，
            // 不在这里手拼 —— 手拼会在 Provider=OpenAI 兼容时发出对方不认识的字段（400）。
            // 保留原行为：temperature 0.3、max_tokens 500。
            var messages = new object[] { new { role = "user", content = summaryPrompt } };
            var payload = ai.BuildChatPayload(opt, messages, stream: false, maxTokens: 500, temperature: 0.3);
            var req = ai.CreateChatRequest(opt, payload);

            var resp = await ai.SendAsync(req);
            if (resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var summary = AiClient.ExtractMessageContent(doc.RootElement) ?? "";

                if (!string.IsNullOrWhiteSpace(summary))
                {
                    // Store summary as system message
                    db.ChatMessages.Add(new ChatMessage
                    {
                        SessionId = sessionId, UserName = "system", Role = "system",
                        Content = $"📝 历史摘要: {summary}", SessionTitle = null
                    });

                    // Delete summarized messages
                    db.ChatMessages.RemoveRange(oldMessages);
                    await db.SaveChangesAsync();
                }
                else
                {
                    _log.LogWarning("历史压缩未生效：模型返回空摘要（model={Model}）", opt.Model);
                }
            }
            else
            {
                var err = await resp.Content.ReadAsStringAsync();
                if (err.Length > 300) err = err[..300];
                // 保留"压缩失败不阻塞对话"的语义 —— 但**不再纯静默**（否则换端点配错时永远查不到）。
                _log.LogWarning("历史压缩失败（不阻塞对话）：HTTP {Status} model={Model} 错误={Error}",
                    (int)resp.StatusCode, opt.Model, err);
            }
        }
        catch (Exception ex)
        {
            // compressed failure is non-critical — 不影响对话，但要留痕
            _log.LogWarning(ex, "历史压缩异常（不阻塞对话）");
        }
    }
}