using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的 DeepSeek 调用与工具执行部分：
/// 带 function calling 的 AI 对话循环，以及 AI 可调用的文件系统工具（列目录/读文件/搜代码/写文档）。
/// </summary>
public partial class WikiGeneratorService
{
    // ════════════════════════════════════════
    //  AI Agent Core — DeepSeek function calling
    // ════════════════════════════════════════

    private async Task<string> CallDeepSeekWithTools(string systemPrompt, string userMessage, List<ToolDef> tools, string taskDesc, string? modelName = null)
    {
        var apiKey = await GetApiKey();
        var baseUrl = await GetBaseUrl();
        var model = modelName ?? _options.ContentModel;

        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = userMessage }
        };

        var iteration = 0;

        while (iteration < 50)
        {
            iteration++;
            var payload = new
            {
                model,
                messages,
                temperature = _options.Temperature,
                top_p = _options.TopP,
                tools = tools.Select(t => new
                {
                    type = "function",
                    function = new { name = t.Name, description = t.Description, parameters = t.Parameters }
                }).ToList(),
                tool_choice = "auto",
                max_tokens = _options.MaxOutputTokens,
                extra_body = new { thinking_mode = _options.ThinkingMode }
            };

            var json = JsonSerializer.Serialize(payload, JsonOpts);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
            {
                Content = content
            };
            req.Headers.Add("Authorization", $"Bearer {apiKey}");

            var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();

            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"DeepSeek API error: {resp.StatusCode} - {body[..Math.Min(body.Length, 200)]}");

            using var doc = JsonDocument.Parse(body);
            var choice = doc.RootElement.GetProperty("choices")[0];
            var msg = choice.GetProperty("message");

            // Add assistant message to conversation
            var assistantMsg = new Dictionary<string, object> { ["role"] = "assistant" };

            // Check for tool calls
            if (msg.TryGetProperty("tool_calls", out var toolCalls) && toolCalls.GetArrayLength() > 0)
            {
                var toolCallList = new List<object>();
                var toolResults = new List<object>();

                foreach (var tc in toolCalls.EnumerateArray())
                {
                    var func = tc.GetProperty("function");
                    var funcName = func.GetProperty("name").GetString()!;
                    var funcArgs = func.GetProperty("arguments").GetString()!;
                    var callId = tc.GetProperty("id").GetString()!;

                    _logger.LogInformation("AI Tool call: {Func}({Args})", funcName, funcArgs[..Math.Min(funcArgs.Length, 100)]);

                    var result = await ExecuteTool(funcName, funcArgs);

                    toolCallList.Add(new
                    {
                        id = callId, type = "function",
                        function = new { name = funcName, arguments = funcArgs }
                    });

                    toolResults.Add(new
                    {
                        role = "tool", tool_call_id = callId,
                        content = result[..Math.Min(result.Length, 8000)] // truncate very long results
                    });
                }

                assistantMsg["tool_calls"] = toolCallList;
                messages.Add(assistantMsg);
                messages.AddRange(toolResults);
            }
            else
            {
                // Final text response
                var text = msg.GetProperty("content").GetString() ?? "";
                _logger.LogInformation("AI generation complete ({Task}), {Len} chars", taskDesc, text.Length);
                return text;
            }
        }

        throw new InvalidOperationException($"AI agent timed out after {_options.DocumentGenerationTimeoutMinutes} minutes");
    }

    // ════════════════════════════════════════
    //  Tools — AI 可调用的文件系统工具
    // ════════════════════════════════════════

    private async Task<string> ExecuteTool(string name, string argsJson)
    {
        try
        {
            using var args = JsonDocument.Parse(argsJson);
            var root = args.RootElement;

            return name switch
            {
                "list_files" => ToolListFiles(GetArg(root, "path")),
                "read_file" => ToolReadFile(GetArg(root, "path")),
                "search_code" => ToolSearchCode(GetArg(root, "pattern"), GetArg(root, "path") ?? ""),
                "write_catalog" => ToolWriteCatalog(GetArg(root, "json")),
                "write_doc" => ToolWriteDoc(GetArg(root, "path"), GetArg(root, "content")),
                _ => $"{{\"error\": \"Unknown tool: {name}\"}}"
            };
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private static string GetArg(JsonElement root, string key) => root.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";

    private string ToolListFiles(string path)
    {
        var dir = ResolvePath(path);
        if (!Directory.Exists(dir)) return $"{{\"error\": \"Directory not found: {path}\"}}";
        var items = new List<string>();
        foreach (var d in Directory.GetDirectories(dir).Select(Path.GetFileName).Where(n => !n.StartsWith('.') && !ExcludedDirs.Contains(n!)).OrderBy(n => n))
            items.Add($"📁 {d}/");
        foreach (var f in Directory.GetFiles(dir).Select(Path.GetFileName).Where(n => !n!.StartsWith('.')).OrderBy(n => n).Take(50))
            items.Add($"📄 {f}");
        return JsonSerializer.Serialize(new { path, items });
    }

    private string ToolReadFile(string path)
    {
        var fullPath = ResolvePath(path);
        if (!File.Exists(fullPath)) return $"{{\"error\": \"File not found: {path}\"}}";
        var ext = Path.GetExtension(fullPath).ToLowerInvariant();
        if (ext is ".dll" or ".exe" or ".so" or ".bin" or ".zip" or ".png" or ".jpg" or ".ico" or ".pdf")
            return $"{{\"error\": \"Binary file, cannot read: {path}\"}}";
        var text = File.ReadAllText(fullPath);
        if (text.Length > 15000) text = text[..15000] + $"\n\n...(truncated, total {text.Length} chars)";
        _processedFiles.Add(path);
        return text;
    }

    private string ToolSearchCode(string pattern, string path)
    {
        try
        {
            var dir = string.IsNullOrEmpty(path) ? _workspacePath : ResolvePath(path);
            if (!Directory.Exists(dir)) return $"{{\"error\": \"Directory not found\"}}";
            var results = new List<string>();
            var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.Compiled);
            foreach (var file in Directory.GetFiles(dir, "*.*", SearchOption.AllDirectories).Take(200))
            {
                var name = Path.GetFileName(file);
                if (name.StartsWith('.') || file.Contains("node_modules") || file.Contains(".git")) continue;
                try
                {
                    var lines = File.ReadAllLines(file);
                    for (int i = 0; i < lines.Length; i++)
                        if (regex.IsMatch(lines[i]))
                            results.Add($"{Path.GetRelativePath(_workspacePath, file).Replace('\\', '/')}:{i + 1}: {lines[i].Trim()[..Math.Min(lines[i].Trim().Length, 120)]}");
                    if (results.Count > 50) break;
                }
                catch { /* skip binary */ }
            }
            return JsonSerializer.Serialize(new { pattern, matches = results.Take(50).ToList(), total = results.Count });
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private string ToolWriteCatalog(string json) { _catalogJson = json; return "{\"success\": true, \"message\": \"Catalog saved\"}"; }

    private string ToolWriteDoc(string path, string content)
    {
        var relativePath = $"{_targetFolder}/{_projectName}/{path}.md".Replace("//", "/");
        _knowledge.WriteFile(relativePath, content);
        _logger.LogInformation("Doc written: {Path}", relativePath);
        return $"{{\"success\": true, \"path\": \"{relativePath}\"}}";
    }

    private string ResolvePath(string relativePath)
    {
        var full = Path.GetFullPath(Path.Combine(_workspacePath, relativePath));
        var norm = Path.GetFullPath(_workspacePath);
        return full.StartsWith(norm) ? full : throw new InvalidOperationException("Path traversal denied");
    }
}
