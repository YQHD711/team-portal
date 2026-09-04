using System.Collections.Concurrent;
using System.Text;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// TF-IDF full-text search over knowledge base with inverted index.
/// Auto-rebuilds on file changes via FileSystemWatcher.
/// </summary>
public class KnowledgeSearchService : IDisposable
{
    private readonly string _basePath;
    private readonly ILogger<KnowledgeSearchService> _logger;
    private readonly FileSystemWatcher? _watcher;
    private readonly object _lock = new();

    // Inverted index: token → list of (relativePath, termFrequency)
    private ConcurrentDictionary<string, List<DocEntry>> _index = new(StringComparer.OrdinalIgnoreCase);
    // Document lengths for TF-IDF normalization
    private ConcurrentDictionary<string, int> _docLengths = new();
    // Total document count
    private int _docCount;

    private static readonly string[] TextPatterns = { "*.md", "*.txt", "*.json", "*.csv", "*.xml" };

    private record DocEntry(string Path, int TermFreq);

    public KnowledgeSearchService(IConfiguration config, ILogger<KnowledgeSearchService> logger)
    {
        _logger = logger;
        _basePath = config.GetValue<string>("Knowledge:BasePath")
                    ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "knowledge");

        if (Directory.Exists(_basePath))
        {
            RebuildIndex();

            // Watch for file changes
            try
            {
                _watcher = new FileSystemWatcher(_basePath)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
                    EnableRaisingEvents = true
                };
                _watcher.Created += (_, _) => DebounceRebuild();
                _watcher.Changed += (_, _) => DebounceRebuild();
                _watcher.Deleted += (_, _) => DebounceRebuild();
                _watcher.Renamed += (_, _) => DebounceRebuild();
            }
            catch { _logger.LogWarning("FileSystemWatcher could not be initialized for knowledge base"); }
        }

        _logger.LogInformation("KnowledgeSearchService initialized with {Count} documents", _docCount);
    }

    private CancellationTokenSource? _debounceCts;
    private void DebounceRebuild()
    {
        _debounceCts?.Cancel();
        _debounceCts = new CancellationTokenSource();
        Task.Delay(3000, _debounceCts.Token).ContinueWith(t =>
        {
            if (!t.IsCanceled) RebuildIndex();
        }, TaskContinuationOptions.NotOnCanceled);
    }

    private void RebuildIndex()
    {
        lock (_lock)
        {
            var newIndex = new ConcurrentDictionary<string, List<DocEntry>>(StringComparer.OrdinalIgnoreCase);
            var newDocLengths = new ConcurrentDictionary<string, int>();
            var count = 0;

            foreach (var pattern in TextPatterns)
            {
                foreach (var file in Directory.GetFiles(_basePath, pattern, SearchOption.AllDirectories))
                {
                    try
                    {
                        var text = File.ReadAllText(file);
                        if (string.IsNullOrWhiteSpace(text)) continue;
                        var relPath = Path.GetRelativePath(_basePath, file).Replace('\\', '/');
                        var tokens = Tokenize(text);
                        var tokenCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                        foreach (var t in tokens)
                        {
                            tokenCounts.TryGetValue(t, out var c);
                            tokenCounts[t] = c + 1;
                        }
                        newDocLengths[relPath] = tokens.Count;
                        foreach (var (token, tf) in tokenCounts)
                        {
                            newIndex.AddOrUpdate(token,
                                _ => new List<DocEntry> { new(relPath, tf) },
                                (_, list) => { lock (list) list.Add(new(relPath, tf)); return list; });
                        }
                        count++;
                    }
                    catch (Exception ex) { _logger.LogWarning(ex, "Failed to index file: {File}", file); }
                }
            }

            _index = newIndex;
            _docLengths = newDocLengths;
            _docCount = count;
            _logger.LogInformation("Knowledge index rebuilt: {Count} docs, {Terms} terms", count, newIndex.Count);
        }
    }

    /// <summary>
    /// Search with TF-IDF scoring. Returns top K results with snippets.
    /// </summary>
    public List<KbResult> Search(string query, int topK = 5)
    {
        if (_docCount == 0) return new List<KbResult>();

        var queryTokens = TokenizeQuery(query);
        if (queryTokens.Length == 0) return new List<KbResult>();

        // TF-IDF scoring per document
        var scores = new Dictionary<string, double>();
        foreach (var token in queryTokens)
        {
            if (!_index.TryGetValue(token, out var postings)) continue;
            var idf = Math.Log(1.0 + (double)_docCount / postings.Count); // IDF

            foreach (var entry in postings)
            {
                var docLen = _docLengths.GetValueOrDefault(entry.Path, 1);
                var tf = (double)entry.TermFreq / docLen; // normalized TF
                scores.TryGetValue(entry.Path, out var existing);
                scores[entry.Path] = existing + tf * idf;
            }
        }

        var results = new List<KbResult>();
        foreach (var (path, score) in scores.OrderByDescending(x => x.Value).Take(topK))
        {
            var fullPath = Path.Combine(_basePath, path);
            string snippet = "";
            try
            {
                var content = File.ReadAllText(fullPath);
                // 找 query 与文档的最长公共连续子串（如"管理委员会"）作锚点，精准定位；
                // 若只取最先命中的 bigram（"管理"/"委员"等泛词），摘要会被无关出现干扰甚至截断。
                var anchor = FindBestAnchor(query, content);
                snippet = ExtractSnippet(content, string.IsNullOrEmpty(anchor) ? queryTokens[0] : anchor, 1500);
            }
            catch { /* snippet extraction failure is non-critical */ }
            results.Add(new KbResult { Path = path, Snippet = snippet, Score = score });
        }

        return results;
    }

    // Chinese-friendly tokenization for indexing
    private static List<string> Tokenize(string text)
    {
        var tokens = new List<string>();
        var lower = text.ToLowerInvariant();

        // English/alphanumeric words
        foreach (Match m in Regex.Matches(lower, @"[a-z0-9][a-z0-9_-]*"))
            tokens.Add(m.Value);

        // Chinese characters: character unigrams + common bigrams
        var chinese = Regex.Replace(lower, @"[^\p{IsCJKUnifiedIdeographs}]", "");
        for (int i = 0; i < chinese.Length; i++)
            tokens.Add(chinese[i].ToString());
        for (int i = 0; i < chinese.Length - 1; i++)
            tokens.Add(chinese.Substring(i, 2));

        return tokens;
    }

    // Query tokenization: extract meaningful terms
    private static string[] TokenizeQuery(string query)
    {
        var tokens = new List<string>();
        var lower = query.ToLowerInvariant().Trim();

        // English/alphanumeric words
        foreach (Match m in Regex.Matches(lower, @"[a-z0-9][a-z0-9_-]*"))
            tokens.Add(m.Value);

        // Chinese: full string + character bigrams
        var chinese = Regex.Replace(lower, @"[^\p{IsCJKUnifiedIdeographs}]", "");
        if (chinese.Length > 0)
        {
            tokens.Add(chinese); // full string as one term
            for (int i = 0; i < chinese.Length - 1; i++)
                tokens.Add(chinese.Substring(i, 2));
        }

        return tokens.Distinct().ToArray();
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

    /// <summary>在 query 中寻找与文档内容的最长公共连续子串（如人名、机构全称），用于精准定位摘要锚点。</summary>
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

    public void Dispose()
    {
        _watcher?.Dispose();
        _debounceCts?.Cancel();
    }
}

public class KbResult
{
    public string Path { get; set; } = "";
    public string Snippet { get; set; } = "";
    public double Score { get; set; }
}
