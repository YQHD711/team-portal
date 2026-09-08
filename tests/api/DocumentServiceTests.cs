using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>文档服务：PDF/DOCX 本地提取（PdfPig/OpenXML）。</summary>
public class DocumentServiceTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly KnowledgeService _knowledge;
    private readonly DocumentService _svc;

    public DocumentServiceTests()
    {
        var conn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        _db = new AppDbContext(opts);
        _db.Database.EnsureCreated();

        var kbDir = Path.Combine(Path.GetTempPath(), $"tp-kb-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(kbDir, "公共"));
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Knowledge:BasePath"] = kbDir
            })
            .Build();
        _knowledge = new KnowledgeService(config, new NullLogService(new TestScopeFactory(_db)), new TestScopeFactory(_db));
        _svc = new DocumentService(_knowledge);
        _kbDir = kbDir;
    }

    private readonly string _kbDir;

    public void Dispose()
    {
        try { Directory.Delete(_kbDir, true); } catch { }
        _db.Dispose();
    }

    private static IFormFile FormFile(string name, byte[] content)
    {
        var ms = new MemoryStream(content);
        return new FormFile(ms, 0, content.Length, "file", name) { Headers = new HeaderDictionary() };
    }

    [Fact]
    public async Task UploadAndProcess_Docx_ExtractsParagraphText()
    {
        // 构造最小 DOCX（OpenXML）：三个段落
        var docxPath = Path.Combine(Path.GetTempPath(), $"doc-{Guid.NewGuid():N}.docx");
        using (var doc = DocumentFormat.OpenXml.Packaging.WordprocessingDocument.Create(docxPath, DocumentFormat.OpenXml.WordprocessingDocumentType.Document))
        {
            var part = doc.AddMainDocumentPart();
            part.Document = new DocumentFormat.OpenXml.Wordprocessing.Document();
            var body = part.Document.AppendChild(new DocumentFormat.OpenXml.Wordprocessing.Body());
            foreach (var para in new[] { "第一段", "第二段", "第三段" })
                body.AppendChild(new DocumentFormat.OpenXml.Wordprocessing.Paragraph(
                    new DocumentFormat.OpenXml.Wordprocessing.Run(
                        new DocumentFormat.OpenXml.Wordprocessing.Text(para))));
        }
        try
        {
            var file = FormFile("test.docx", await File.ReadAllBytesAsync(docxPath));
            var path = await _svc.UploadAndProcess(file, "公共", "member", null);

            Assert.Equal("公共/test.md", path);
            var content = _knowledge.GetContent(path);
            Assert.NotNull(content);
            Assert.Contains("第一段", content);
            Assert.Contains("第二段", content);
            Assert.Contains("第三段", content);
        }
        finally { try { File.Delete(docxPath); } catch { } }
    }

    [Fact]
    public async Task UploadAndProcess_Pdf_ExtractsPageText()
    {
        // 最小合法 PDF（单一内容流 + 简单文本）
        var pdfPath = Path.Combine(Path.GetTempPath(), $"doc-{Guid.NewGuid():N}.pdf");
        var content = "Hello World TeamPortal";
        var stream = new System.Text.StringBuilder();
        stream.Append("%PDF-1.4\n");
        stream.Append("1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n");
        stream.Append("2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n");
        stream.Append("3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n");
        stream.Append("4 0 obj\n<</Length ").Append(content.Length + 4).Append(">>\nstream\nBT /F1 12 Tf 72 720 Td (").Append(content).Append(") Tj ET\nendstream\nendobj\n");
        stream.Append("5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n");
        stream.Append("trailer\n<</Root 1 0 R /Size 6>>\n");
        stream.Append("%%EOF\n");
        await File.WriteAllTextAsync(pdfPath, stream.ToString());

        try
        {
            var file = FormFile("test.pdf", await File.ReadAllBytesAsync(pdfPath));
            var path = await _svc.UploadAndProcess(file, "公共", "member", null);

            Assert.Equal("公共/test.md", path);
            var text = _knowledge.GetContent(path);
            Assert.NotNull(text);
            Assert.Contains("Hello World", text);
        }
        finally { try { File.Delete(pdfPath); } catch { } }
    }

    [Fact]
    public async Task UploadAndProcess_Conflict_Throws()
    {
        _knowledge.WriteFile("公共/dup.md", "x");
        var file = FormFile("dup.md", "y"u8.ToArray());
        await Assert.ThrowsAsync<DocumentConflictException>(() =>
            _svc.UploadAndProcess(file, "公共", "member", null));
    }
}
