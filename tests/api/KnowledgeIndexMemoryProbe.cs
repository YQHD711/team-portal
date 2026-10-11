using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// P1-1 的内存实测工装（规格硬约束：服务器 1.8G，索引内存增量必须 &lt; 300MB）。
///
/// **默认不跑**：它会生成 66MB 语料并全量建索引，几分钟 + 几十 MB 临时磁盘，不适合放进 CI 门禁。
/// 手动实测（这才是有效验证，不是估算）：
/// <code>
/// $env:TP_MEM_PROBE="1"; dotnet test tests/api/ --filter "FullyQualifiedName~KnowledgeIndexMemoryProbe"
/// </code>
/// 测得的值会写到 <c>%TEMP%\tp-index-mem.txt</c> 并在断言消息里显示；可用 <c>TP_MEM_PROBE_MB</c> 改语料体量。
/// </summary>
public class KnowledgeIndexMemoryProbe
{
    [Fact]
    public void IndexMemoryIncrement_IsWithinBudget()
    {
        if (Environment.GetEnvironmentVariable("TP_MEM_PROBE") != "1")
            return;   // 默认跳过（有意为之：见类注释）

        var targetMb = int.TryParse(Environment.GetEnvironmentVariable("TP_MEM_PROBE_MB"), out var m) ? m : 66;
        var realKb = Environment.GetEnvironmentVariable("TP_MEM_PROBE_PATH");   // 线上实测：直接指向真实知识库目录
        var dir = Path.Combine(Path.GetTempPath(), $"tp-memprobe-{Guid.NewGuid():N}");
        var kbDir = string.IsNullOrWhiteSpace(realKb) ? Path.Combine(dir, "knowledge") : realKb;
        if (string.IsNullOrWhiteSpace(realKb)) Directory.CreateDirectory(Path.Combine(kbDir, "公共"));
        try
        {
            var (files, bytes) = string.IsNullOrWhiteSpace(realKb)
                ? BuildCorpus(kbDir, targetMb)
                : (Directory.GetFiles(kbDir, "*.*", SearchOption.AllDirectories).Length,
                   Directory.GetFiles(kbDir, "*.*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length));
            var conn = new SqliteConnection("Data Source=:memory:");
            conn.Open();
            using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
            db.Database.EnsureCreated();
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = kbDir })
                .Build();

            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
            var before = GC.GetTotalMemory(true);

            using var svc = new KnowledgeSearchService(config, NullLogger<KnowledgeSearchService>.Instance,
                new TestScopeFactory(db), new NullLogService(new TestScopeFactory(db)));

            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
            var after = GC.GetTotalMemory(true);
            var deltaMb = (after - before) / 1048576.0;

            var report = $"mode={(string.IsNullOrWhiteSpace(realKb) ? (Environment.GetEnvironmentVariable("TP_MEM_PROBE_MODE") ?? "zipf") : "real-kb")} " +
                         $"corpus={bytes / 1048576.0:F1}MB (target {targetMb}MB) files={files} chunks={svc.IndexedChunkCount} " +
                         $"docs={svc.IndexedDocumentCount} terms={svc.IndexedTermCount} postings={svc.IndexedPostingCount} " +
                         $"prunedTerms={svc.PrunedTermCount} deltaMB={deltaMb:F1}";
            File.WriteAllText(Path.Combine(Path.GetTempPath(), "tp-index-mem.txt"), report);
            Console.WriteLine("[MemoryProbe] " + report);

            // random 模式是对抗性上界（自然语言不会有几百万个不重复词），只报告不判定预算
            if ((Environment.GetEnvironmentVariable("TP_MEM_PROBE_MODE") ?? "zipf") == "random") return;
            Assert.True(deltaMb < 300, $"[MemoryProbe] 索引内存增量超预算：{report}");
        }
        finally
        {
            try { Directory.Delete(dir, true); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// 造一份**内容多样**的等价语料（约一半中文、一半英文）：不能拿重复文本凑体积，
    /// 那样 distinct token 极少、postings 远少于真实知识库，测出来的内存会假性偏低。
    /// </summary>
    /// <summary>
    /// 造一份 66MB 的等价语料。两种模式（<c>TP_MEM_PROBE_MODE=zipf|random</c>）：
    ///   - <b>zipf（默认，接近真实知识库）</b>：固定词表 + 自然语言式的偏斜采样
    ///     （约 55 万词条：40 万中文 bigram + 15 万英文词），与真实文档的词表规模同量级；
    ///   - <b>random（对抗性上界）</b>：词表近乎无限（随机字母串），distinct token 会到几百万，
    ///     远超过任何自然语言语料 —— 用来测"最坏情况"。
    /// 只报 zipf 的数字会显得在挑好看的数，所以两种都测、都报。
    /// </summary>
    private static (int Files, long Bytes) BuildCorpus(string kbDir, int targetMb)
    {
        var mode = Environment.GetEnvironmentVariable("TP_MEM_PROBE_MODE") ?? "zipf";
        var rnd = new Random(20261011);
        var sb = new StringBuilder();
        long bytes = 0;
        var files = 0;

        if (mode == "random") return BuildRandomCorpus(kbDir, targetMb, rnd, sb);

        // ── zipf：固定词表 ──
        const int zhPoolSize = 650;            // 650² ≈ 42 万可能的 bigram
        var zhPool = new char[zhPoolSize];
        for (var i = 0; i < zhPoolSize; i++) zhPool[i] = (char)(0x4E00 + i * 3);
        var zhVocab = new string[zhPool.Length * zhPool.Length];
        var n = 0;
        foreach (var a in zhPool)
            foreach (var b in zhPool)
                zhVocab[n++] = new string([a, b]);
        var enVocab = BuildEnglishVocab(150_000, rnd);
        var zhCommon = zhVocab.Length / 10;    // 前 10% 当高频词，制造 Zipf 长尾
        var enCommon = enVocab.Length / 10;

        while (bytes < targetMb * 1024L * 1024)
        {
            sb.Clear();
            for (var para = 0; para < 30; para++)
            {
                for (var w = 0; w < 45; w++)
                    sb.Append(rnd.Next(2) == 0 ? zhVocab[rnd.Next(zhCommon)]
                                               : zhVocab[rnd.Next(zhVocab.Length)]).Append(rnd.Next(5) == 0 ? "，" : "");
                sb.Append('\n');
                for (var w = 0; w < 30; w++)
                    sb.Append(rnd.Next(2) == 0 ? enVocab[rnd.Next(enCommon)]
                                               : enVocab[rnd.Next(enVocab.Length)]).Append(' ');
                sb.Append("\n\n");
            }
            var text = sb.ToString();
            File.WriteAllText(Path.Combine(kbDir, "公共", $"doc{files:D5}.md"), text);
            bytes += Encoding.UTF8.GetByteCount(text);
            files++;
        }
        return (files, bytes);
    }

    private static string[] BuildEnglishVocab(int size, Random rnd)
    {
        const string letters = "abcdefghijklmnopqrstuvwxyz";
        var vocab = new string[size];
        for (var i = 0; i < size; i++)
        {
            var len = 4 + rnd.Next(8);
            var chars = new char[len];
            for (var c = 0; c < len; c++) chars[c] = letters[rnd.Next(letters.Length)];
            vocab[i] = new string(chars);
        }
        return vocab;
    }

    /// <summary>对抗性上界：词表近乎无限（随机字母词 + 2000 汉字的两两随机组合）。</summary>
    private static (int Files, long Bytes) BuildRandomCorpus(string kbDir, int targetMb, Random rnd, StringBuilder sb)
    {
        var zhPool = new char[2000];
        for (var i = 0; i < zhPool.Length; i++) zhPool[i] = (char)(0x4E00 + i);
        const string letters = "abcdefghijklmnopqrstuvwxyz";
        long bytes = 0;
        var files = 0;
        while (bytes < targetMb * 1024L * 1024)
        {
            sb.Clear();
            for (var para = 0; para < 30; para++)
            {
                for (var w = 0; w < 45; w++)
                {
                    var wordLen = 2 + rnd.Next(3);
                    for (var c = 0; c < wordLen; c++) sb.Append(zhPool[rnd.Next(zhPool.Length)]);
                    sb.Append(rnd.Next(5) == 0 ? "，" : "");
                }
                sb.Append('\n');
                for (var w = 0; w < 30; w++)
                {
                    var wordLen = 3 + rnd.Next(8);
                    for (var c = 0; c < wordLen; c++) sb.Append(letters[rnd.Next(letters.Length)]);
                    sb.Append(' ');
                }
                sb.Append("\n\n");
            }
            var text = sb.ToString();
            File.WriteAllText(Path.Combine(kbDir, "公共", $"doc{files:D5}.md"), text);
            bytes += Encoding.UTF8.GetByteCount(text);
            files++;
        }
        return (files, bytes);
    }
}
