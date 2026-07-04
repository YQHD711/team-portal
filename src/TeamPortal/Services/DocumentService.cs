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
        var mdName = Path.GetFileNameWithoutExtension(fileName) + ".md";
        var tempPath = Path.GetTempFileName();

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

            // Add title header
            var title = Path.GetFileNameWithoutExtension(fileName);
            var fullContent = $"# {title}\n\n> 上传文件: {fileName}\n\n{content}";

            // Save to knowledge base
            var relativePath = $"{targetFolder}/{mdName}".TrimStart('/');
            _knowledge.WriteFile(relativePath, fullContent);

            return relativePath;
        }
        finally
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
        }
    }
}
