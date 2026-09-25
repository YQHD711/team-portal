using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// AI 运维助手的管理员操作手册（get_admin_guide 工具的数据源）。
/// 全部内容编译进程序集：容器里只拷贝 publish 产物，docs/ 与源码都不在镜像中，
/// 因此手册不能靠读文件，否则线上永远取不到。
/// </summary>
public partial class SystemAgentService
{
    /// <summary>手册章节（供 /api/admin/agent/guide 展示，与 get_admin_guide 工具同源）。</summary>
    internal static IReadOnlyList<(string Topic, string Body)> GuideTopics() => GuideSections;

    /// <summary>按章节名或正文关键词返回手册内容；查不到就如实说没有，不编造。</summary>
    internal static string GetAdminGuide(string? topic)
    {
        if (string.IsNullOrWhiteSpace(topic))
            return JsonSerializer.Serialize(new
            {
                topics = GuideSections.Select(s => s.Topic),
                note = "传 topic 取具体章节，例如 topic=\"发布与上线\"。回答管理员的操作类问题前应先查这里。"
            });

        var t = topic.Trim();
        foreach (var s in GuideSections)
        {
            if (s.Topic.Contains(t, StringComparison.OrdinalIgnoreCase) || t.Contains(s.Topic, StringComparison.OrdinalIgnoreCase))
                return JsonSerializer.Serialize(new { topic = s.Topic, content = s.Body });
        }

        var matched = GuideSections.Where(s => s.Body.Contains(t, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (matched.Length > 0)
            return JsonSerializer.Serialize(new
            {
                matchedTopics = matched.Select(m => m.Topic),
                contents = matched.Select(m => new { m.Topic, m.Body })
            });

        return JsonSerializer.Serialize(new
        {
            topics = GuideSections.Select(s => s.Topic),
            note = $"手册里没有「{t}」这一节。可按 topics 里的章节名再查；确实没有的就如实告诉管理员手册未覆盖，不要编。"
        });
    }

    private static readonly (string Topic, string Body)[] GuideSections =
    [
        ("用户与权限", """
            角色三档：admin（系统管理员，全部功能）、部长（staff：本部门 + 公共知识库、组织架构、考核、邀请码、Wiki 设置）、member（普通队员）。
            · 新队员入队：/admin/invites 生成邀请码 → 队员在注册页填邀请码自助注册 → 到 /admin/users 编辑其部门与角色。
            · 调整角色/部门：/admin/users → 该行「编辑」。
            · 删除账号：/admin/users → 「删除」。admin 与部长账号不可删除，需要先降级为 member。
            · 部门增删改：/admin/organization。
            · 权限是「前端隐藏 + 后端强制」两层：菜单看不到不代表没权限，接口由 AdminOnly / StaffOnly 策略把关。判定越权问题要看日志里的 403，而不是看菜单。
            """),

        ("知识库维护", """
            目录名即权限：顶层目录「公共」（或「公共知识库」）全员可见；顶层目录等于部门名 → 仅该部门与 admin 可见；根目录下散落的 .md 对所有人可见。
            · 写接口位于 /api/admin 下，要求 admin 或部长，且只能写「公共」或「自己部门」的目录。部长能改公共库是当前设计，不是漏洞。
            · 页面：/admin/knowledge 新建/编辑/重命名/删除文档，保留历史版本（.history 目录；它不在目录树里显示，属于基础设施）。
            · 从 Git 仓库或 ZIP 生成 Wiki：/wiki/import；生成参数在 /admin/wiki-settings。
            · 生成完的通知按可见性投递：公共项目全员可见，部门项目只通知该部门成员，个人项目只通知发起人。
            · 保存报 400：先在 /admin/logs 看同一时刻 category=knowledge 的 error 行。最常见原因是容器内以非 root 用户 app 运行，而宿主机挂载进来的目录属主是 root，导致无写权限。
            """),

        ("备份与恢复", """
            · 自动备份：本地数据库备份每 6 小时一次；每天凌晨 3:00 前后做日备份 + 日志归档 + 云备份（需先在 /admin/cloud 配好百度网盘）。
            · 手动备份：/admin/backup → 立即备份。
            · 恢复：/admin/backup → 选中某份备份 → 恢复。当前数据库会被替换，服务自动重启（3-5 秒）；恢复前建议先手动备份一份当前库。
            · 最新一份备份不允许删除（它可能是唯一的完好副本）。
            · 启动时会检测数据库完整性，异常则自动从最新备份恢复，并在系统日志里留一条 warn。
            """),

        ("日志与排障", """
            · /admin/logs：按级别、分类、关键词、时间范围筛选，可导出 CSV；操作日志（谁在什么时候点了什么）与系统日志是两个视图。
            · 推荐排查顺序：先筛 error/warn → 用 category 定位模块（auth / wiki / knowledge / inventory / agent / backup / system）→ 用时间点对齐用户的操作。
            · 日志保留期在 /admin/settings 配置；过期日志每天先归档到本地 CSV + 云盘，归档成功后才删除对应行（不会出现「删了却没归档」）。
            · 日志写入是异步批量落库，短时间内的最新几条可能还在缓冲里，查不到时把时间范围放宽几分钟。
            """),

        ("系统设置", """
            · /admin/settings：AI 服务（密钥、模型、超时、迭代上限）、库存低库存阈值与等级、日志保留、品牌配置等。
            · 保存后立即生效（服务内部有设置缓存，保存接口会刷新缓存）。
            · 密钥类字段在界面上是密文；本助手读取设置时同样会脱敏，只回答「已配置 / 未配置」，不回显密钥内容。
            """),

        ("发布与上线", """
            · 代码变更不走本系统：AI 运维助手不能改代码、不能编译、不能重启服务，也没有这个入口。
            · 流程：开分支 → 改代码 → 本地跑 dotnet test tests/api/、cd web && npx vitest run、npx tsc --noEmit、npx playwright test → 提 PR → CI 通过 → squash 合并到 main。
            · 合并后 CI 构建镜像，服务器定时任务（约 5 分钟一轮）自动拉取并滚动更新；页面页脚显示的 build 号（形如 #138 · 83f7ebc）可确认当前跑的是哪一版。
            · 需要回滚代码：走 git revert 或重新合并，不要在服务器上手工改文件 —— 下一轮自动部署会覆盖掉。
            """),

        ("常见故障", """
            · 页面提示「失败」且没有原因：先看 /admin/logs 同时段的 error；前端多数提示已经把后端消息带出来了，先照抄那句话定位。
            · 上传/保存文件失败：优先怀疑目录权限与磁盘空间（本助手 get_system_health 可直接看磁盘剩余）。
            · AI 功能报密钥错误或无响应：/admin/settings 检查 DeepSeek 密钥是否已配置；get_settings 可确认。
            · 收不到通知：通知按可见性投递 —— 个人任务只发发起人、部门任务只发该部门成员、公共任务全员。
            · 百度网盘备份上传失败：/admin/cloud 重新授权，再看 category=backup 的日志。
            · 页面样式/功能像旧版本：看页脚 build 号，可能是自动部署还没轮询到（约 5 分钟一次）。
            """),
    ];
}
