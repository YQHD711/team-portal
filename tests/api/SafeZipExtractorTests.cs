using System.IO.Compression;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 审计 #12：ZIP 解压限额。
/// 原实现直接 `ZipFile.ExtractToDirectory` —— 无条目数/总量上限（压缩炸弹可写满磁盘），
/// 也没有 zip-slip 校验（条目名 `../x` 能写到解压根之外）。
/// </summary>
public class SafeZipExtractorTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "zip-test-" + Guid.NewGuid().ToString("N"));

    public SafeZipExtractorTests() => Directory.CreateDirectory(_dir);
    public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    private string MakeZip(string name, params (string Entry, string Content)[] entries)
    {
        var path = Path.Combine(_dir, name);
        using var fs = new FileStream(path, FileMode.Create);
        using var zip = new ZipArchive(fs, ZipArchiveMode.Create);
        foreach (var (entry, content) in entries)
        {
            var e = zip.CreateEntry(entry);
            using var w = new StreamWriter(e.Open());
            w.Write(content);
        }
        return path;
    }

    [Fact]
    public void NormalZip_Extracts()
    {
        var zip = MakeZip("ok.zip", ("a/b.txt", "hello"), ("c.txt", "world"));
        var dest = Path.Combine(_dir, "out-ok");
        SafeZipExtractor.Extract(zip, dest);
        Assert.Equal("hello", File.ReadAllText(Path.Combine(dest, "a", "b.txt")));
        Assert.Equal("world", File.ReadAllText(Path.Combine(dest, "c.txt")));
    }

    [Fact]
    public void ZipSlip_IsRejected_AndNothingEscapes()
    {
        var zip = MakeZip("slip.zip", ("../escaped.txt", "pwn"));
        var dest = Path.Combine(_dir, "out-slip");
        Assert.Throws<InvalidOperationException>(() => SafeZipExtractor.Extract(zip, dest));
        Assert.False(File.Exists(Path.Combine(_dir, "escaped.txt")));
    }

    [Fact]
    public void TooManyEntries_IsRejected()
    {
        var zip = MakeZip("many.zip", ("1.txt", "a"), ("2.txt", "b"), ("3.txt", "c"));
        Assert.Throws<InvalidOperationException>(() =>
            SafeZipExtractor.Extract(zip, Path.Combine(_dir, "out-many"), maxEntries: 2));
    }

    [Fact]
    public void OversizeEntry_IsRejected()
    {
        var zip = MakeZip("big.zip", ("big.txt", new string('x', 200)));
        Assert.Throws<InvalidOperationException>(() =>
            SafeZipExtractor.Extract(zip, Path.Combine(_dir, "out-big"), maxEntryBytes: 100));
    }

    [Fact]
    public void TotalSizeLimit_IsRejected()
    {
        var zip = MakeZip("total.zip", ("a.txt", new string('x', 60)), ("b.txt", new string('y', 60)));
        Assert.Throws<InvalidOperationException>(() =>
            SafeZipExtractor.Extract(zip, Path.Combine(_dir, "out-total"), maxTotalBytes: 100));
    }
}
