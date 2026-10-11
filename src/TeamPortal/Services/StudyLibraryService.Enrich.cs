namespace TeamPortal.Services;

/// <summary>
/// 学习库的「读取正文/元信息」部分（从 StudyEndpoints 搬过来，见下）。
/// 单独一个 partial 是为了让 StudyLibraryService.cs 保持在 200 行以内。
/// </summary>
public static partial class StudyLibraryService
{
    /// <summary>
    /// 读入「_学习路径.md」「_阶段说明.md」的正文与 front matter 元信息 —— 这是 /study 页面卡片看到的数据。
    ///
    /// 放在这里而不是 Endpoint：P1-2 的「学习库索引导出」（<see cref="StudyIndexDocBuilder"/>）要用**同一份**
    /// 解析，不能让索引和页面各解析一套（否则索引里的阶段/课时会与页面显示漂移）。
    /// 路径全部来自已按 ACL 过滤的树，且统一走 KnowledgeService.GetContent（内含路径安全校验）。
    /// </summary>
    public static StudyScope Enrich(StudyScope scope, KnowledgeService knowledge)
    {
        var (scopeMeta, scopeBody) = ParseDoc(
            scope.OverviewPath is null ? null : knowledge.GetContent(scope.OverviewPath));

        return scope with
        {
            Overview = Blank(scopeBody),
            Duration = MetaValue(scopeMeta, "时长", "duration"),
            Goal = MetaValue(scopeMeta, "目标", "goal"),
            Stages = scope.Stages.Select(stage =>
            {
                var (meta, body) = ParseDoc(
                    stage.DescriptionPath is null ? null : knowledge.GetContent(stage.DescriptionPath));
                return stage with
                {
                    Description = Blank(body),
                    Duration = MetaValue(meta, "时长", "duration"),
                    Goal = MetaValue(meta, "目标", "goal"),
                };
            }).ToList()
        };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
