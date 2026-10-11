using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 实时库存/货位上下文（task-14 B）：**每次提问现查数据库**，把结果作为一块"系统实时查询结果"注入聊天。
///
/// 为什么不塞进 RAG 索引：库存数量随时在变，而索引只在**知识库文件变动**时重建 —— 写进索引必然答过期数字。
/// 这里每次提问都现查，所以数字永远是当前值（测试用"改库后再问拿到新值"钉住）。
///
/// 触发与匹配（宁可少给也别给错）：
///   - 房间块：问题里出现 `StorageLayout.RoomCode` 或房间名 → 输出房间网格 + `LayoutJson` 里**真实的**
///     货架元素（name/locCode/层×位）+ 该房间当前挂的物料件数；
///   - 物料块：只有问题里**完整出现**物料名（≥2 字）或编码（完整或 ≥6 字符的编码前缀）才输出，
///     不做模糊打分 —— 匹配不确定就干脆不注入，交给提示词让模型说明"系统里没查到"；
///   - 两块都没有 → 返回 null（不产出"没查到"的空块）。
///
/// 物料与布局对全员可见（《物料管理规范》），不额外做 ACL；也不带领用审批等他人私有数据。
/// </summary>
public static class LiveInventoryContext
{
    public const string Header = "[系统实时查询结果 —— 不是知识库文档，数字为当前值]";
    public const int MaxItems = 5;
    public const int MaxLayoutElements = 12;
    private const int MaxScanItems = 2000;          // 兜底：库存表很小，但别让异常数据把内存拉满
    private const int CodeTokenMinLength = 6;       // 编码前缀匹配的最小长度（再短就不够独特）

    /// <summary>这些问题看起来在问库存/货位，才值得去读物料表（性能：不为无关提问加载）。</summary>
    private static readonly string[] InventoryKeywords =
        ["库存", "物料", "零件", "还剩", "剩余", "多少", "数量", "库位", "存放", "在哪", "领用", "库房", "货架"];

    public static async Task<string?> BuildAsync(string question, AppDbContext db, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(question)) return null;

        var parts = new List<string>();
        if (await RoomBlockAsync(question, db, ct) is { } room) parts.Add(room);
        if (await ItemBlockAsync(question, db, ct) is { } items) parts.Add(items);
        return parts.Count == 0 ? null : Header + "\n" + string.Join("\n\n", parts);
    }

    // ── 房间块 ──

    private static async Task<string?> RoomBlockAsync(string question, AppDbContext db, CancellationToken ct)
    {
        var layouts = await db.StorageLayouts.AsNoTracking().OrderBy(l => l.RoomCode).ToListAsync(ct);
        var hit = layouts.FirstOrDefault(l =>
            question.Contains(l.RoomCode, StringComparison.OrdinalIgnoreCase)
            || (l.RoomName.Length >= 2 && question.Contains(l.RoomName, StringComparison.Ordinal)));
        if (hit is null) return null;

        var sb = new StringBuilder();
        sb.AppendLine($"房间 {hit.RoomCode} {hit.RoomName}（{hit.Floor} 层，{hit.CabinetCount} 货架 × {hit.ShelfCount} 层 × {hit.PositionCount} 位）");
        if (!string.IsNullOrWhiteSpace(hit.Description)) sb.AppendLine($"说明：{hit.Description}");

        var elements = LayoutElements(hit.LayoutJson);
        if (elements.Count > 0) sb.AppendLine($"平面图里的货架/位置元素：{string.Join("；", elements)}");

        var count = await db.InventoryItems.AsNoTracking()
            .CountAsync(i => i.LocationCode != null && i.LocationCode.StartsWith(hit.RoomCode), ct);
        sb.Append($"该房间当前挂的物料：{count} 件");
        return sb.ToString();
    }

    /// <summary>从平面图 JSON 里取出**真实存在**的货架/位置元素（name/locCode/层×位），坏 JSON 当没有元素。</summary>
    internal static List<string> LayoutElements(string? layoutJson)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(layoutJson)) return result;
        try
        {
            using var doc = JsonDocument.Parse(layoutJson);
            if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                return result;

            foreach (var item in items.EnumerateArray())
            {
                if (result.Count >= MaxLayoutElements) break;
                var name = Str(item, "name") ?? Str(item, "locCode");
                if (string.IsNullOrWhiteSpace(name)) continue;
                var loc = Str(item, "locCode");
                var shelves = Int(item, "shelfCount") ?? Int(item, "rows");
                var positions = Int(item, "positionCount") ?? Int(item, "cols");

                var text = new StringBuilder(name);
                if (!string.IsNullOrWhiteSpace(loc) && loc != name) text.Append($"（{loc}）");
                if (shelves is not null || positions is not null) text.Append($"：{shelves ?? 0} 层 × {positions ?? 0} 位");
                result.Add(text.ToString());
            }
        }
        catch { /* 平面图坏了就当没有元素，不拖累其它块 */ }
        return result;
    }

    // ── 物料块 ──

    private static async Task<string?> ItemBlockAsync(string question, AppDbContext db, CancellationToken ct)
    {
        var tokens = CodeTokens(question);
        if (!LooksInventoryRelated(question, tokens)) return null;

        var items = await db.InventoryItems.AsNoTracking().Take(MaxScanItems).ToListAsync(ct);
        var matched = items
            .Where(i => Matches(question, tokens, i))
            .OrderByDescending(i => i.Quantity)
            .ThenBy(i => i.Code, StringComparer.Ordinal)
            .Take(MaxItems)
            .ToList();
        if (matched.Count == 0) return null;

        var lines = matched.Select(i =>
            $"- {i.Name}（编码 {i.Code}，等级 {i.Grade}）：当前可用数量 {i.Quantity}，库位 {Blank(i.LocationCode)}，状态 {Blank(i.Status)}");
        return "匹配到的物料（实时值）：\n" + string.Join("\n", lines);
    }

    /// <summary>强匹配：问题里出现完整物料名（≥2 字）或编码（完整/≥6 字符的编码前缀）。不做模糊打分。</summary>
    internal static bool Matches(string question, List<string> codeTokens, InventoryItem item)
    {
        if (!string.IsNullOrWhiteSpace(item.Name) && item.Name.Length >= 2
            && question.Contains(item.Name, StringComparison.Ordinal))
            return true;
        if (string.IsNullOrWhiteSpace(item.Code)) return false;
        if (question.Contains(item.Code, StringComparison.OrdinalIgnoreCase)) return true;
        return codeTokens.Any(t => item.Code.StartsWith(t, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>问题里的"像编码"的词元（字母/数字/横线，≥6 字符），用于编码前缀匹配。</summary>
    internal static List<string> CodeTokens(string question)
    {
        var tokens = new List<string>();
        foreach (var raw in question.Split([' ', '\t', '\n', '\r', '，', '。', '、', '？', '?', '：', ':', '（', '）', '(', ')'], StringSplitOptions.RemoveEmptyEntries))
        {
            var token = raw.Trim();
            if (token.Length >= CodeTokenMinLength && token.Any(char.IsLetterOrDigit)
                && token.All(c => char.IsLetterOrDigit(c) || c is '-' or '_'))
                tokens.Add(token);
        }
        return tokens;
    }

    private static bool LooksInventoryRelated(string question, List<string> codeTokens) =>
        InventoryKeywords.Any(k => question.Contains(k, StringComparison.Ordinal)) || codeTokens.Count > 0;

    private static string Blank(string? s) => string.IsNullOrWhiteSpace(s) ? "未登记" : s;

    private static string? Str(JsonElement element, string name) =>
        element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int? Int(JsonElement element, string name) =>
        element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : null;
}
