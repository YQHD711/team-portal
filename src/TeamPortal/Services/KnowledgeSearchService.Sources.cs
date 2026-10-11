namespace TeamPortal.Services;

/// <summary>
/// 索引的**内容来源**（从 KnowledgeSearchService.Index.cs 拆出，那个文件已贴着 200 行上限）：
/// 知识库文件分块（含桥接 pseudo 块）与 P1-2 的学习库虚拟文档。
/// 两遍扫描必须拿到**完全一致**的顺序，否则分块下标会错位 —— 所有来源都收在 <see cref="AllChunks"/> 里。
/// </summary>
public partial class KnowledgeSearchService
{
    /// <summary>文件分块 + 学习库虚拟文档。</summary>
    private IEnumerable<(string Path, int Start, int Length, string Text)> AllChunks(
        List<(string Path, string Text)> virtualDocs)
        => EnumerateChunks().Concat(virtualDocs.Select(d => (d.Path, VirtualChunkStart, 0, d.Text)));

    /// <summary>
    /// 学习库虚拟文档（P1-2）：从与 /study 页面同一份数据构造，不落盘、不调 AI。
    /// 直接用相同的依赖手工构造 KnowledgeService（DI 里的 scoped 服务在这个单例里解析不到时会让整个
    /// 索引缺掉学习库；手工构造只用到 config/log/scopeFactory 三件，测试环境也能工作）。
    /// 取不到时返回空表并记告警 —— 学习库数据出问题不能把整个检索索引拖垮。
    /// </summary>
    private List<(string Path, string Text)> BuildStudyDocs()
    {
        try
        {
            var knowledge = new KnowledgeService(_config, _log, _scopeFactory);
            return StudyIndexDocBuilder.Build(knowledge);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "构建学习库索引文档失败，本次索引不含学习库（其余文档不受影响）");
            return [];
        }
    }

    /// <summary>逐分块枚举知识库文件（按文件、按顺序）。</summary>
    private IEnumerable<(string Path, int Start, int Length, string Text)> EnumerateChunks()
    {
        foreach (var pattern in TextPatterns)
        {
            foreach (var file in Directory.GetFiles(_basePath, pattern, SearchOption.AllDirectories))
            {
                // 中英桥接 sidecar 不单独成为一篇文档：它的中文内容作为"桥接伪块"并入原文索引，
                // 于是中文 query 命中 sidecar 时，返回的仍是原文路径。
                if (KnowledgeBridge.IsSidecar(file)) continue;
                string text;
                try { text = File.ReadAllText(file); } catch { continue; }
                if (string.IsNullOrWhiteSpace(text)) continue;
                var relPath = Path.GetRelativePath(_basePath, file).Replace('\\', '/');

                foreach (var (start, length) in ChunkRanges(text.Length))
                    yield return (relPath, start, length, text.Substring(start, length));

                var bridge = KnowledgeBridge.TryReadIndexText(KnowledgeBridge.SidecarPathFor(file));
                if (bridge is not null) yield return (relPath, BridgeChunkStart, 0, bridge);
            }
        }
    }
}
