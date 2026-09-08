using System.Text;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using UglyToad.PdfPig;

namespace TeamPortal.Services;

public class DocumentService
{
    private readonly KnowledgeService _knowledge;

    public DocumentService(KnowledgeService knowledge)
    {
        _knowledge = knowledge;
    }

    public async Task<string> UploadAndProcess(IFormFile file, string targetFolder, string? role, string? dept)
    {
        // Validate access
        if (!_knowledge.CanAccess(targetFolder, role, dept))
            throw new UnauthorizedAccessException("Access denied");

        // Determine target path
        var fileName = Path.GetFileName(file.FileName);
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        // TXT keeps its original extension (plain text needs no conversion); MD/PDF/DOCX are stored as .md for AI RAG
        var targetName = ext is ".txt" or ".md" ? fileName : Path.GetFileNameWithoutExtension(fileName) + ".md";
        var targetPath = $"{targetFolder}/{targetName}".TrimStart('/');

        // Reject overwrite of an existing knowledge file
        if (_knowledge.FileExists(targetPath))
            throw new DocumentConflictException("同名文件已存在");

        // Preserve original extension for AI service format detection
        var tempPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}{ext}");

        try
        {
            // Save uploaded file temporarily
            await using (var stream = File.Create(tempPath))
                await file.CopyToAsync(stream);

            string content;

            // Extract text based on file type
            if (ext is ".md" or ".txt")
            {
                content = await File.ReadAllTextAsync(tempPath, Encoding.UTF8);
            }
            else
            {
                // 本地 C# 解析 PDF/DOCX（原 ai-service PyPDF2/python-docx 已收编）
                content = ext switch
                {
                    ".pdf" => ExtractPdf(tempPath),
                    ".docx" => ExtractDocx(tempPath),
                    _ => throw new InvalidOperationException($"Unsupported format: {ext}")
                };
            }

            // TXT is plain text — save verbatim with its original extension
            if (ext == ".txt")
            {
                _knowledge.WriteFile(targetPath, content);
                return targetPath;
            }

            // Add title header
            var title = Path.GetFileNameWithoutExtension(fileName);
            var fullContent = $"# {title}\n\n> 上传文件: {fileName}\n\n{content}";

            // Save converted .md to knowledge base (for AI RAG)
            _knowledge.WriteFile(targetPath, fullContent);

            // PDF/DOCX also keep the original file for download
            if (ext is not ".md")
            {
                var origPath = $"{targetFolder}/{fileName}".TrimStart('/');
                _knowledge.WriteFile(origPath, File.ReadAllBytes(tempPath));
            }

            return targetPath;
        }
        finally
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
        }
    }

    /// <summary>本地 PDF 文本提取（PdfPig，行为对齐原 PyPDF2：取前 50 页、逐页拼接、保留空行）。</summary>
    private static string ExtractPdf(string filePath)
    {
        var sb = new StringBuilder();
        using (var pdf = PdfDocument.Open(filePath))
        {
            foreach (var page in pdf.GetPages().Take(50))
            {
                var text = page.Text;
                if (!string.IsNullOrWhiteSpace(text))
                    sb.Append(text).AppendLine();
            }
        }
        return sb.ToString().Trim();
    }

    /// <summary>本地 DOCX 段落文本提取（OpenXML SDK，行为对齐原 python-docx：仅段落、忽略表格/页眉页脚）。</summary>
    private static string ExtractDocx(string filePath)
    {
        var sb = new StringBuilder();
        using var doc = WordprocessingDocument.Open(filePath, isEditable: false);
        var body = doc.MainDocumentPart?.Document is { } document ? document.Body : null;
        if (body is not null)
        {
            foreach (var para in body.Elements<Paragraph>())
            {
                // 优先 Descendants<Text>() 而非 InnerText：SDT(内容控件) 不会卡死
                var text = string.Concat(para.Descendants<Text>().Select(t => t.Text));
                if (!string.IsNullOrWhiteSpace(text))
                    sb.AppendLine(text);
            }
        }
        return sb.ToString().Trim();
    }
}

public class DocumentConflictException : Exception
{
    public DocumentConflictException(string message) : base(message) { }
}
