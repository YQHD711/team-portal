using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 标签模板的存取与不变量（task-17）：
///   - **永远有一个默认模板**（除非一个模板都没有）：删除默认模板时自动把最早的另一个提升为默认；
///     第一个被创建的模板无论如何都是默认；
///   - 任何写入都**先校验后改库**（见 <see cref="LabelTemplateValidation.Validate"/>），校验失败不写坏已有数据；
///   - 写入返回保存后的完整模板（前端要拿服务端算出的 id/updatedAt）。
/// 渲染与组合字段 `meta` 的拼接都在前端，后端只保证"存的是一份合法模板"。
/// </summary>
public class LabelTemplateService
{
    private readonly AppDbContext _db;

    public LabelTemplateService(AppDbContext db) => _db = db;

    public async Task<List<LabelTemplateDto>> ListAsync()
    {
        var all = await _db.LabelTemplates.AsNoTracking()
            .OrderByDescending(t => t.IsDefault).ThenBy(t => t.Id).ToListAsync();
        return all.Select(ToDto).ToList();
    }

    public async Task<LabelTemplateDto> CreateAsync(LabelTemplateDto req, string actor)
    {
        var all = await _db.LabelTemplates.ToListAsync();
        var entity = new LabelTemplate
        {
            Name = req.Name.Trim(),
            Kind = LabelTemplateSuitability.Normalize(req.Kind),
            WidthMm = req.WidthMm,
            HeightMm = req.HeightMm,
            Dpi = req.Dpi,
            Background = req.Background,
            ElementsJson = JsonSerializer.Serialize(req.Elements ?? [], LabelTemplateValidation.ElementsJson),
            UpdatedBy = actor,
            UpdatedAt = DateTime.UtcNow,
            // 第一个模板必须是默认（否则会出现"没有任何默认模板"的状态）
            IsDefault = req.IsDefault || all.Count == 0,
        };
        if (entity.IsDefault) foreach (var t in all) t.IsDefault = false;
        _db.LabelTemplates.Add(entity);
        await _db.SaveChangesAsync();   // 一次 SaveChanges = 一个事务，默认唯一性不会被竞态撕开
        return ToDto(entity);
    }

    /// <summary>全量替换（PUT 语义）。<c>IsDefault</c> 只向上生效：置 true 会成为唯一默认；false 不改默认归属。</summary>
    public async Task<LabelTemplateDto?> UpdateAsync(int id, LabelTemplateDto req, string actor)
    {
        var all = await _db.LabelTemplates.ToListAsync();
        var entity = all.FirstOrDefault(t => t.Id == id);
        if (entity is null) return null;

        entity.Name = req.Name.Trim();
        // kind 不传 -> 保持原值（老调用方 PUT 不带 kind，不会把库位模板降级）
        if (!string.IsNullOrWhiteSpace(req.Kind)) entity.Kind = LabelTemplateSuitability.Normalize(req.Kind);
        entity.WidthMm = req.WidthMm;
        entity.HeightMm = req.HeightMm;
        entity.Dpi = req.Dpi;
        entity.Background = req.Background;
        entity.ElementsJson = JsonSerializer.Serialize(req.Elements ?? [], LabelTemplateValidation.ElementsJson);
        entity.UpdatedBy = actor;
        entity.UpdatedAt = DateTime.UtcNow;
        if (req.IsDefault && !entity.IsDefault)
        {
            foreach (var t in all) t.IsDefault = false;
            entity.IsDefault = true;
        }
        await _db.SaveChangesAsync();
        return ToDto(entity);
    }

    /// <summary>删除；删的是默认模板且还有别的模板时，把最早的另一个提升为默认（保证不会"没有默认"）。</summary>
    public async Task<bool> DeleteAsync(int id)
    {
        var all = await _db.LabelTemplates.ToListAsync();
        var entity = all.FirstOrDefault(t => t.Id == id);
        if (entity is null) return false;

        var wasDefault = entity.IsDefault;
        _db.LabelTemplates.Remove(entity);
        if (wasDefault)
        {
            var promoted = all.Where(t => t.Id != id).OrderBy(t => t.Id).FirstOrDefault();
            if (promoted is not null) promoted.IsDefault = true;
        }
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<LabelTemplateDto?> SetDefaultAsync(int id)
    {
        var all = await _db.LabelTemplates.ToListAsync();
        var entity = all.FirstOrDefault(t => t.Id == id);
        if (entity is null) return null;

        // ③b：**默认按 kind 分离**（material / location 各有各的默认）。
        // 向后兼容：历史上只有 material → 对 material 模板的行为与原来完全等价（仍是"全局唯一默认"）。
        var kind = entity.Kind ?? "material";
        foreach (var t in all.Where(t => (t.Kind ?? "material") == kind)) t.IsDefault = t.Id == id;
        await _db.SaveChangesAsync();
        return ToDto(entity);
    }

    /// <summary>库里一个模板都没有时建默认模板（启动时调用；幂等）。</summary>
    public async Task<bool> SeedDefaultIfEmptyAsync()
    {
        if (await _db.LabelTemplates.AnyAsync()) return false;

        var seed = LabelTemplateValidation.BuiltInDefault();
        _db.LabelTemplates.Add(new LabelTemplate
        {
            Name = seed.Name,
            IsDefault = true,
            WidthMm = seed.WidthMm,
            HeightMm = seed.HeightMm,
            Dpi = seed.Dpi,
            Background = seed.Background,
            ElementsJson = JsonSerializer.Serialize(seed.Elements, LabelTemplateValidation.ElementsJson),
            UpdatedBy = "system",
            UpdatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();
        return true;
    }

    internal static LabelTemplateDto ToDto(LabelTemplate entity) => new()
    {
        Id = entity.Id,
        Name = entity.Name,
        Kind = entity.Kind,
        IsDefault = entity.IsDefault,
        WidthMm = entity.WidthMm,
        HeightMm = entity.HeightMm,
        Dpi = entity.Dpi,
        Background = entity.Background,
        Elements = Deserialize(entity.ElementsJson),
        UpdatedAt = entity.UpdatedAt,
    };

    /// <summary>ElementsJson 读回元素列表；坏 JSON 不让接口 500（当作空数组，前端会退回兜底版式）。</summary>
    internal static List<LabelElementDto> Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<LabelElementDto>>(json, LabelTemplateValidation.ElementsJson) ?? [];
        }
        catch
        {
            return [];
        }
    }
}
