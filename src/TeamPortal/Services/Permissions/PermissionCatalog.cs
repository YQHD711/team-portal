namespace TeamPortal.Services.Permissions;

/// <summary>一条可配置权限：key 稳定、分组用于管理页归类。</summary>
public sealed record PermissionDef(string Key, string Group, string Label, string? Desc = null);

/// <summary>
/// 权限目录与默认矩阵（不落库的那一半）。
///
/// 数据库只存**覆盖值**：管理员改过的 (角色, 权限) 才有一行；没有行 = 用这里定义的默认值。
/// 这样以后调整默认权限不会被历史数据锁死，恢复默认也只是删行。
/// </summary>
public static class PermissionCatalog
{
    public static readonly IReadOnlyList<string> Roles = new[] { "member", "部长", "admin" };

    public static readonly IReadOnlyList<PermissionDef> All = new PermissionDef[]
    {
        // ── 内容与知识 ──
        new("content.knowledge.view", "内容与知识", "阅读知识库"),
        new("content.knowledge.edit", "内容与知识", "编辑知识库", "新建/修改文档"),
        new("content.knowledge.delete", "内容与知识", "删除知识库内容"),
        new("content.wiki.view", "内容与知识", "阅读 Wiki"),
        new("content.wiki.manage", "内容与知识", "生成/管理 Wiki", "提交仓库、改 Wiki 设置"),
        new("content.study.view", "内容与知识", "学习库"),
        new("content.study.manage", "内容与知识", "编辑学习库内容"),
        new("content.files.view", "内容与知识", "查看资源共享"),
        new("content.files.upload", "内容与知识", "上传共享文件"),
        new("content.files.delete", "内容与知识", "删除共享文件"),

        // ── 物料 ──
        new("material.inventory.view", "物料", "查看零件库存"),
        new("material.inventory.manage", "物料", "新增/编辑/删除零件", "含导入 Excel"),
        new("material.inventory.export", "物料", "导出库存与标签"),
        new("material.checkout.apply", "物料", "领用申请"),
        new("material.checkout.approve", "物料", "审批领用"),
        new("material.stocktake.execute", "物料", "执行盘点"),
        new("material.stocktake.manage", "物料", "创建/管理盘点"),
        new("material.finance.apply", "物料", "提交采购申请"),
        new("material.finance.approve", "物料", "审批采购"),
        new("material.layout.view", "物料", "查看物料布局"),
        new("material.layout.edit", "物料", "编辑物料布局"),
        new("material.battery.view", "物料", "查看电池台账"),
        new("material.battery.borrow", "物料", "借还电池"),
        new("material.battery.manage", "物料", "管理电池台账", "新增/编辑/导出"),

        // ── 团队 ──
        new("team.incidents.view", "团队", "查看事故记录"),
        new("team.incidents.report", "团队", "报备事故"),
        new("team.incidents.manage", "团队", "处理事故记录"),
        new("team.profile.self", "团队", "维护自己的档案"),
        new("team.profile.manage", "团队", "管理他人档案"),

        // ── 管理端 ──
        new("admin.users.view", "管理端", "查看队员与部门"),
        new("admin.users.manage", "管理端", "管理队员", "改角色/部门/重置密码/邀请码"),
        new("admin.exams.manage", "管理端", "考核管理"),
        new("admin.settings.manage", "管理端", "系统设置"),
        new("admin.content.manage", "管理端", "内容管理", "界面文案与使用引导"),
        new("admin.logs.view", "管理端", "系统日志"),
        new("admin.trash.manage", "管理端", "回收站"),
        new("admin.backup.manage", "管理端", "备份恢复"),
        new("admin.cloud.manage", "管理端", "云存储"),
        new("admin.devices.manage", "管理端", "设备管理"),
        new("admin.ai.use", "管理端", "AI 运维助手"),
        new("admin.permissions.manage", "管理端", "权限管理", "只能由拥有本权限的人继续授权"),
    };

    /// <summary>默认矩阵：成员基础 → 部长扩展 → 管理员全量</summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlySet<string>> Defaults = BuildDefaults();

    private static Dictionary<string, IReadOnlySet<string>> BuildDefaults()
    {
        var member = Set(
            "content.knowledge.view", "content.wiki.view", "content.study.view",
            "content.files.view", "content.files.upload",
            "material.inventory.view", "material.checkout.apply", "material.stocktake.execute",
            "material.finance.apply", "material.layout.view",
            "material.battery.view", "material.battery.borrow",
            "team.incidents.view", "team.incidents.report", "team.profile.self");

        var staff = Set(member.Concat(new[]
        {
            "content.knowledge.edit", "content.knowledge.delete", "content.wiki.manage",
            "content.study.manage", "content.files.delete",
            "material.inventory.manage", "material.inventory.export",
            "material.checkout.approve", "material.stocktake.manage",
            "material.finance.approve", "material.layout.edit",
            "material.battery.manage",
            "team.incidents.manage", "team.profile.manage",
            "admin.users.view", "admin.users.manage", "admin.exams.manage",
        }).ToArray());

        var admin = Set(All.Select(p => p.Key).ToArray());

        return new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
        {
            ["member"] = member,
            ["部长"] = staff,
            ["admin"] = admin,
        };
    }

    private static HashSet<string> Set(params string[] keys) => new(keys, StringComparer.Ordinal);

    public static IEnumerable<PermissionDef> ByGroup() =>
        All.OrderBy(p => GroupOrder(p.Group)).ThenBy(p => p.Key);

    private static int GroupOrder(string group) => group switch
    {
        "内容与知识" => 0,
        "物料" => 1,
        "团队" => 2,
        "管理端" => 3,
        _ => 9,
    };
}
