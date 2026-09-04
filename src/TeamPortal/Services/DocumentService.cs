using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

public class DocumentService
{
    private readonly HttpClient _http;
    private readonly KnowledgeService _knowledge;
    private readonly string _baseUrl;

    public DocumentService(HttpClient http, KnowledgeService knowledge, IConfiguration config)
    {
        _http = http;
        _knowledge = knowledge;
        _baseUrl = config.GetValue<string>("AiService:BaseUrl") ?? "http://localhost:9001";
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
                // Call Python service for PDF/DOCX
                var response = await _http.PostAsync(
                    $"{_baseUrl}/api/documents/extract?filepath={Uri.EscapeDataString(tempPath)}", null);

                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException("Document extraction failed");

                var json = await response.Content.ReadAsStringAsync();
                var doc = JsonDocument.Parse(json);
                content = doc.RootElement.GetProperty("text").GetString() ?? "";
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
}

public class DocumentConflictException : Exception
{
    public DocumentConflictException(string message) : base(message) { }
}
