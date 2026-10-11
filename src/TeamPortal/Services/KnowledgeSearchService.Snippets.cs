using System.Text;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 命中分块的摘要提取：**只在命中的那一块里**找锚点/关键词再截窗口。
/// 这是分块索引的核心价值 —— 长文档的答案在后半段时，摘要也落在后半段，而不是文档开头。
/// 虚拟文档（P1-2 学习库）用自己的正文出摘要；桥接伪块（原文里没有对应中文区间）退回"整篇找锚点"。
/// </summary>
public partial class KnowledgeSearchService
{
    private string SnippetForChunk(IndexSnapshot snapshot, int chunkId, string query, string[] queryTokens)
    {
        // 虚拟文档（P1-2 学习库）：正文不在磁盘上，直接用它自己的文本出摘要
        if (snapshot.VirtualTexts.TryGetValue(chunkId, out var virtualText))
        {
            var virtualAnchor = FindBestAnchor(query, virtualText);
            return ExtractSnippet(virtualText, string.IsNullOrEmpty(virtualAnchor) ? queryTokens[0] : virtualAnchor, 1500);
        }

        var chunk = snapshot.Chunks[chunkId];
        string content;
        try { content = File.ReadAllText(Path.Combine(_basePath, chunk.Path)); }
        catch { return ""; }   // 摘要失败不算检索失败

        if (chunk.Start >= 0 && chunk.Start < content.Length)
        {
            var length = Math.Min(chunk.Length, content.Length - chunk.Start);
            var chunkText = content.Substring(chunk.Start, length);
            var anchor = FindBestAnchor(query, chunkText);
            return ExtractSnippet(chunkText, string.IsNullOrEmpty(anchor) ? queryTokens[0] : anchor, ChunkSize + 400);
        }

        var docAnchor = FindBestAnchor(query, content);
        return ExtractSnippet(content, string.IsNullOrEmpty(docAnchor) ? queryTokens[0] : docAnchor, 1500);
    }

    private static string ExtractSnippet(string content, string keyword, int maxLen)
    {
        if (string.IsNullOrEmpty(keyword))
            return content.Length > maxLen ? content[..maxLen] + "\n..." : content;

        // 聚合关键词的所有出现位置，避免只取第一处（如关键词首次出现在目录、
        // 而正文答案在后面，导致检索摘要与问题无关）。
        var sb = new StringBuilder();
        var searchFrom = 0;
        var found = 0;
        while (sb.Length < maxLen)
        {
            var idx = content.IndexOf(keyword, searchFrom, StringComparison.OrdinalIgnoreCase);
            if (idx < 0) break;
            found++;
            var start = Math.Max(0, idx - 120);
            var end = Math.Min(content.Length, idx + keyword.Length + 160);
            if (sb.Length > 0) sb.Append("\n···\n");
            sb.Append(NormalizeWhitespace(content[start..end]));
            searchFrom = idx + Math.Max(1, keyword.Length);
        }

        if (found == 0)
            return content.Length > maxLen ? content[..maxLen] + "\n..." : content;

        var result = sb.ToString();
        return result.Length > maxLen ? result[..maxLen] + "\n..." : result;
    }

    /// <summary>在 query 中寻找与给定文本的最长公共连续子串（如人名、机构全称），用于精准定位摘要锚点。</summary>
    private static string FindBestAnchor(string query, string content)
    {
        string? best = null;
        foreach (Match seg in Regex.Matches(query, @"[\p{IsCJKUnifiedIdeographs}a-z0-9]+"))
        {
            var s = seg.Value;
            for (int i = 0; i < s.Length; i++)
            {
                var j = i;
                while (j < s.Length && content.Contains(s[i..(j + 1)], StringComparison.OrdinalIgnoreCase))
                    j++;
                if (j - i >= 2 && (best is null || j - i > best.Length))
                    best = s[i..j];
            }
        }
        return best ?? "";
    }

    /// <summary>把连续空白（含换行）压成单个空格，修复文档中因换行被拆断的内容（如"张宝\n庭"）。</summary>
    private static string NormalizeWhitespace(string text) => Regex.Replace(text, @"\s+", " ");
}
