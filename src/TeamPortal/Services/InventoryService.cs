using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class InventoryService
{
    /// <summary>
    /// 低库存阈值兜底值：与 SettingsService 种子 `Inventory:LowStockThreshold` 保持一致。
    /// 真实取值一律走 <see cref="GetLowStockThresholdAsync"/>（设置页可改），
    /// 前端通过 GET /api/inventory/meta 拿同一个值 —— 阈值只有这一个来源。
    /// </summary>
    public const int DefaultLowStockThreshold = 5;

    /// <summary>根据单价自动判定物料等级：≥1000→A, 100~999→B, ＜100→C</summary>
    public static string CalcGrade(decimal unitPrice) => unitPrice switch
    {
        >= 1000 => "A",
        >= 100 => "B",
        _ => "C"
    };

    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly NotificationService _notification;
    private readonly SettingsService _settings;

    public InventoryService(AppDbContext db, LogService log, NotificationService notification, SettingsService settings)
    {
        _db = db; _log = log; _notification = notification; _settings = settings;
    }

    /// <summary>低库存阈值（设置页 Inventory:LowStockThreshold，兜底 5）：仪表盘、库存页、通知共用</summary>
    public Task<int> GetLowStockThresholdAsync()
        => _settings.GetInt("Inventory:LowStockThreshold", DefaultLowStockThreshold);

    /// <summary>低库存判定：数量 &lt; 阈值（与前端显示口径一致）</summary>
    public static bool IsLowStock(int quantity, int threshold) => quantity < threshold;

    public async Task<List<InventoryItem>> GetAll(string? search, string? category)
    {
        var query = _db.InventoryItems.AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            // 编码在库里存的是全大写，而 EF 把 Contains 翻译成大小写敏感的 instr()，
            // 所以拿大写的搜索词再比一次：这样手输 bat-lipo… 或扫码枪吐出来的都能搜到。
            var upper = s.ToUpperInvariant();
            query = query.Where(i => i.Name.Contains(s) || (i.Code != null && i.Code.Contains(upper)));
        }
        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(i => i.Category == category);

        return await query.OrderBy(i => i.Name).ToListAsync();
    }

    public async Task<InventoryItem?> GetById(int id)
    {
        return await _db.InventoryItems.FindAsync(id);
    }

    public async Task<InventoryItem> Create(string name, string category, int quantity,
        string grade = "C", decimal unitPrice = 0, int? departmentId = null, string? code = null, string? locationCode = null)
    {
        var normalized = await NormalizeCodeAsync(code, null);
        var item = new InventoryItem
        {
            Name = name, Category = category, Quantity = quantity,
            Status = "available",
            Grade = unitPrice > 0 ? CalcGrade(unitPrice) : grade,
            UnitPrice = unitPrice, DepartmentId = departmentId,
            Code = normalized, LocationCode = LocationOrNull(locationCode),
            UpdatedAt = DateTime.UtcNow,
        };
        _db.InventoryItems.Add(item);
        await _db.SaveChangesAsync();

        // 审计日志
        _log.Info("inventory", $"Part added: {name}", $"{{\"qty\":{quantity},\"cat\":\"{category}\"}}");

        // 低量告警（阈值取自设置页，与仪表盘/库存页同一口径）
        var addThreshold = await GetLowStockThresholdAsync();
        if (IsLowStock(quantity, addThreshold))
        {
            _notification.Notify("库存预警", $"零件「{name}」库存仅剩 {quantity} 件（低于 {addThreshold} 件），请及时补货。");
        }

        return item;
    }

    public async Task<InventoryItem?> Update(int id,
        string? name = null, int? quantity = null, string? status = null,
        string? grade = null, decimal? unitPrice = null, int? departmentId = null,
        string? code = null, string? locationCode = null, bool clearCode = false)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return null;
        if (name is not null) item.Name = name;
        if (quantity.HasValue) item.Quantity = quantity.Value;
        if (status is not null) item.Status = status;
        if (unitPrice.HasValue) item.UnitPrice = unitPrice.Value;
        if (unitPrice.HasValue && grade is null)
            item.Grade = CalcGrade(unitPrice.Value);
        else if (grade is not null)
            item.Grade = grade;
        if (departmentId.HasValue) item.DepartmentId = departmentId.Value;
        if (clearCode) item.Code = null;
        else if (code is not null) item.Code = await NormalizeCodeAsync(code, id);
        // 库位：null = 本次不改；空串 = 明确清空（物料可以先不归位）
        if (locationCode is not null) item.LocationCode = LocationOrNull(locationCode);
        item.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return item;
    }

    /// <summary>空串/纯空白一律归一成 null：库里不存 ""，避免"有库位但显示为空"的歧义</summary>
    private static string? LocationOrNull(string? locationCode)
        => string.IsNullOrWhiteSpace(locationCode) ? null : locationCode.Trim();

    /// <summary>
    /// 编码归一化：去空白 + 全大写（规范要求全串大写，否则短链大小写不一致查不到），并查重。
    /// excludeId 用于编辑时排除自己。空串返回 null。
    /// </summary>
    private async Task<string?> NormalizeCodeAsync(string? code, int? excludeId)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var normalized = code.Trim().ToUpperInvariant();
        var dup = await _db.InventoryItems.AnyAsync(i => i.Code == normalized && (excludeId == null || i.Id != excludeId));
        if (dup) throw new InvalidOperationException($"物料编码 {normalized} 已被占用，请换一个");
        return normalized;
    }

    /// <summary>
    /// 按规范 §6.2 拼装下一个可用编码：前缀由分类决定，年份取采购年，序号按
    /// 「前缀-物品号-型号-年份」这个池子取下一个。物品号与型号必须由人给
    /// （系统无法从名称可靠地推出），所以这是"半自动"。
    /// </summary>
    public async Task<string> NextCodeAsync(string category, string itemNo, string model, int? year = null)
    {
        var prefix = CategoryPrefix(category);
        var item = (itemNo ?? "").Trim().ToUpperInvariant();
        var mdl = (model ?? "").Trim().ToUpperInvariant();
        var yr = year ?? DateTime.UtcNow.Year;
        var head = $"{prefix}-{item}-{mdl}-{yr}-";

        var existing = await _db.InventoryItems.AsNoTracking()
            .Where(i => i.Code != null && i.Code.StartsWith(head))
            .Select(i => i.Code!)
            .ToListAsync();

        var max = 0;
        foreach (var c in existing)
        {
            var tail = c[head.Length..];
            if (tail.Length == 4 && int.TryParse(tail, out var n) && n > max) max = n;
        }
        return head + (max + 1).ToString("D4");
    }

    /// <summary>分类 → 编码前缀（与《物料管理规范》附录 A/D 保持一致）</summary>
    public static string CategoryPrefix(string? category) => category switch
    {
        "电子元器件" => "EL",
        "结构材料" => "ST",
        "工具设备" => "TL",
        "耗材" => "CS",
        "动力系统" => "PW",
        "飞控系统" => "FC",
        "通信设备" => "RF",
        "电池电源" => "BAT",
        _ => "XX",
    };

    /// <summary>按编码查物料（供 /i/&lt;编码&gt; 扫码与手输兜底使用，大小写不敏感）</summary>
    public async Task<InventoryItem?> GetByCode(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var normalized = code.Trim().ToUpperInvariant();
        return await _db.InventoryItems.AsNoTracking()
            .Include(i => i.Department)
            .FirstOrDefaultAsync(i => i.Code == normalized);
    }

    // ── 二维码短链 ──

    /// <summary>
    /// 决定短链用哪个地址。优先级：**管理员配置的 App:PublicBaseUrl** > 调用方给的浏览器地址。
    ///
    /// 为什么不用"当前请求的地址"：后端前面的请求是 Next.js 服务端转发的，ctx.Request.Host
    /// 永远是容器内网地址（曾经生成出过 `http://backend:8080/i/...` 这种谁也扫不开的短链）。
    /// 内网地址在任何情况下都不该出现在给队员扫的链接里。
    ///
    /// 返回空串表示"既没配、调用方也没给"——此时调用方必须自己决定怎么处理，不要瞎编一个。
    /// </summary>
    public async Task<string> ResolvePublicBaseUrlAsync(string? clientOrigin)
    {
        var configured = (await _settings.Get("App:PublicBaseUrl", "")).Trim();
        if (!string.IsNullOrEmpty(configured)) return configured.TrimEnd('/');
        return NormalizeOrigin(clientOrigin);
    }

    /// <summary>把调用方给的地址规范化；不是合法的 http(s) 绝对地址就返回空串（宁可不给，也不给个错的）</summary>
    public static string NormalizeOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin)) return "";
        if (!Uri.TryCreate(origin.Trim(), UriKind.Absolute, out var uri)) return "";
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return "";
        return $"{uri.Scheme}://{uri.Authority}";
    }

    /// <summary>物料短链：{对外地址}/i/{编码}（规范 §6.3）</summary>
    public static string BuildShortUrl(string baseUrl, string code)
        => $"{baseUrl.TrimEnd('/')}/i/{Uri.EscapeDataString(code.Trim().ToUpperInvariant())}";

    /// <summary>服务端渲染二维码（SVG），供浏览器之外的使用方（打印、导出、MCP）取用</summary>
    public static string BuildQrSvg(string text, int pixelsPerModule = 6)
    {
        using var generator = new QRCoder.QRCodeGenerator();
        using var data = generator.CreateQrCode(text, QRCoder.QRCodeGenerator.ECCLevel.M);
        return new QRCoder.SvgQRCode(data).GetGraphic(pixelsPerModule);
    }

    /// <summary>
    /// 地址看起来不像队员手机能访问的——打印标签前用来提醒。命中任意一条即为真：
    /// 空值 / localhost / 回环 / **单段主机名**（`backend`、`web` 这类容器服务名没有点，
    /// 手机在公网 DNS 上解析不了）。
    /// </summary>
    public static bool LooksNonPublic(string? baseUrl)
    {
        if (string.IsNullOrWhiteSpace(baseUrl)) return true;
        if (!Uri.TryCreate(baseUrl.Trim(), UriKind.Absolute, out var uri)) return true;

        var host = uri.Host.ToLowerInvariant();
        if (host is "localhost" or "127.0.0.1" or "0.0.0.0" or "::1") return true;
        // IPv4 字面量有"点"，域名的点更多；单段主机名（无点）= 内网服务名
        if (!host.Contains('.') && !System.Net.IPAddress.TryParse(host, out _)) return true;
        return false;
    }


    public async Task SetPhoto(int id, string photoUrl)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return;
        item.PhotoUrl = photoUrl;
        item.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    public async Task<bool> Delete(int id)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return false;
        _db.InventoryItems.Remove(item);
        await _db.SaveChangesAsync();
        _log.Warn("inventory", $"Part deleted: {item.Name}");
        return true;
    }

    /// <summary>本地解析库存 Excel(.xlsx/.xlsm)并入库。原 ai-service openpyxl 转发已收编。
    /// 数据约定: 首行表头(名称/分类/数量/库位/状态), 自第 2 行起逐行导入。</summary>
    public async Task<int> ImportFromExcel(string filePath)
    {
        var count = 0;
        var importThreshold = await GetLowStockThresholdAsync();
        using var stream = File.OpenRead(filePath);
        foreach (var row in MiniExcelLibs.MiniExcel.Query(stream, useHeaderRow: true))
        {
            // MiniExcel 非泛型 Query 返回 ExpandoObject(实现 IDictionary<string,object>)
            if (row is not IDictionary<string, object> d || d.Count == 0) continue;

            string Get(string key) => d.TryGetValue(key, out var v) ? v?.ToString() ?? "" : "";
            // 兼容中英/中列名
            var name = Get("名称");     if (string.IsNullOrEmpty(name)) name = Get("Name");
            if (string.IsNullOrEmpty(name)) name = Get("name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            var category = FirstNonEmpty(Get("分类"), Get("Category"), Get("category"), "未分类");
            var code = FirstNonEmpty(Get("编码"), Get("Code"), Get("code"), Get("物料编码"), Get("物料编码Code"), "");
            var quantityStr = Get("数量"); if (string.IsNullOrEmpty(quantityStr)) quantityStr = Get("Qty");
            if (string.IsNullOrEmpty(quantityStr)) quantityStr = Get("qty");
            int.TryParse(quantityStr, out var quantity);
            var locationCode = FirstNonEmpty(Get("库位"), Get("Location"), Get("location"), Get("LocationCode"), Get("位置"), "");
            var status = FirstNonEmpty(Get("状态"), Get("Status"), Get("status"), "available");
            var explicitGrade = FirstNonEmpty(Get("Grade"), Get("等级"), Get("grade"), "");
            var unitPriceStr = Get("单价"); if (string.IsNullOrEmpty(unitPriceStr)) unitPriceStr = Get("UnitPrice");
            decimal.TryParse(unitPriceStr, out var unitPrice);
            // Grade: 显式列优先;否则按单价自动判定(≥1000→A, 100~999→B, ＜100→C;无单价→C)
            var grade = string.IsNullOrEmpty(explicitGrade)
                ? (unitPrice > 0 ? CalcGrade(unitPrice) : "C")
                : explicitGrade;

            _db.InventoryItems.Add(new InventoryItem
            {
                Name = name,
                Category = category,
                Quantity = quantity,
                Code = string.IsNullOrWhiteSpace(code) ? null : code.Trim().ToUpperInvariant(),
                LocationCode = string.IsNullOrEmpty(locationCode) ? null : locationCode,
                Status = status,
                Grade = grade,
                UnitPrice = unitPrice,
                UpdatedAt = DateTime.UtcNow,
            });

            // 低量告警（整个导入批次用同一阈值，避免循环内反复读设置）
            if (IsLowStock(quantity, importThreshold))
                _notification.Notify("库存预警", $"导入零件「{name}」库存仅剩 {quantity} 件（低于 {importThreshold} 件），请及时补货。");

            count++;
        }
        await _db.SaveChangesAsync();

        // 审计日志
        _log.Info("inventory", $"Excel import completed", $"{{\"imported\":{count}}}");

        return count;
    }

    private static string FirstNonEmpty(params string[] values)
    {
        foreach (var v in values)
            if (!string.IsNullOrWhiteSpace(v)) return v;
        return "";
    }
}
