namespace TeamPortal.Services;

/// <summary>保存房间布局的乐观并发判定（纯逻辑，便于单测）。</summary>
public enum LayoutSaveOutcome
{
    /// <summary>版本一致，正常保存</summary>
    Ok,
    /// <summary>请求没带"我加载时的版本" —— 无法判定是否会被覆盖，拒绝而不是静默接受</summary>
    MissingVersion,
    /// <summary>版本不一致且未要求强制覆盖 → 409</summary>
    Conflict,
    /// <summary>版本不一致但用户已确认强制覆盖</summary>
    Forced
}

/// <summary>
/// 房间布局保存的并发判定与可读文案。
///
/// 背景（实测）：`PUT /api/storage/layouts/{id}` 原来是 `FindAsync` → 覆盖全部字段 → SaveChanges，
/// 没有任何版本比对。两个客户端各自加载同一房间后依次保存，**后保存的会静默覆盖先保存的**
/// （实验里 A 的改动完全消失）。
///
/// ⚠️ 版本用**单调递增的 int**，不用 `UpdatedAt`：它只到秒，同一秒内的两次保存无法区分
/// （实测两次保存的 UpdatedAt 完全相同）。
/// </summary>
public static class LayoutConflictGuard
{
    public static LayoutSaveOutcome Decide(int currentVersion, int? expectedVersion, bool force)
    {
        if (expectedVersion is null) return LayoutSaveOutcome.MissingVersion;
        if (expectedVersion.Value == currentVersion) return LayoutSaveOutcome.Ok;
        return force ? LayoutSaveOutcome.Forced : LayoutSaveOutcome.Conflict;
    }

    public const string MissingVersionMessage =
        "保存被拒绝：请求缺少 expectedVersion（你加载该房间时的版本号）。"
        + "本接口不再接受不带版本的覆盖保存，否则会静默丢弃别人的改动 —— 请刷新页面拿到最新版本后重试。";

    /// <summary>409 的可读说明：告诉对方当前版本、谁在什么时候改的。</summary>
    public static string ConflictMessage(int currentVersion, int? expectedVersion, string? updatedBy, DateTime updatedAt)
    {
        var who = string.IsNullOrWhiteSpace(updatedBy) ? "其他人" : updatedBy;
        var when = updatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
        return $"此房间已被 {who} 于 {when} 修改（当前版本 {currentVersion}，你基于版本 {expectedVersion}）。"
            + "请刷新后重新合并你的改动；确认要丢弃对方的改动时，可选择强制覆盖。";
    }
}
