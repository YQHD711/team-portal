namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的目录生成部分：通过 AI Agent 分析项目结构并生成 Wiki 目录（JSON 树）。
/// </summary>
public partial class WikiGeneratorService
{
    // ════════════════════════════════════════
    //  Catalog Generation
    // ════════════════════════════════════════

    private async Task<string> GenerateCatalog()
    {
        // 用户自定义目录：直接用，跳过 AI catalog 生成
        if (!string.IsNullOrEmpty(_customCatalogJson)) { _catalogJson = _customCatalogJson; return _catalogJson; }
        var maxTopItems = _complexityScore <= 2 ? "1-4" : _complexityScore >= 4 ? "5-10" : "3-7";
        var maxDepth = _complexityScore <= 2 ? "2" : "3";
        var scopeHint = _complexityScore <= 2 ? "简单项目，目录结构简洁即可，不要过度拆分" : "覆盖项目所有核心模块";

        var systemPrompt = $@"你是一个资深代码架构分析师。你需要分析项目代码并生成 Wiki 文档目录。

## 可用工具
- list_files(path): 列出目录内容
- read_file(path): 读取文件内容
- search_code(pattern, path): 搜索代码
- write_catalog(json): 写入目录结构（必须调用！）

## 工作流程
1. 用 list_files 浏览项目结构
2. 用 read_file 阅读入口文件和关键配置
3. 用 search_code 了解核心模块
4. 用 write_catalog 输出 JSON 目录

## 目录输出格式
[{{
  ""path"": ""getting-started"",
  ""title"": ""快速开始"",
  ""children"": [
    {{ ""path"": ""getting-started/installation"", ""title"": ""安装指南"" }}
  ]
}}]

## 规则
- {maxTopItems} 个顶层目录项
- 每项最多 {maxDepth} 层深度
- 使用中文标题
- {scopeHint}
- 必须调用 write_catalog 完成";

        var userMessage = $@"分析项目并生成 Wiki 目录。

项目名: {_projectName}
类型: {DetectProjectType()}

目录结构:
{BuildDirectoryTree()}

README:
{ReadReadme()}

入口文件:
{IdentifyEntryPoints()}

请开始分析并生成目录。";

        var tools = new List<ToolDef>
        {
            new("list_files", "List directory contents. Path is relative to project root.", new { path = new { type = "string", description = "Directory path, empty for root" } }),
            new("read_file", "Read file content. Returns text of the file.", new { path = new { type = "string", description = "Relative file path" } }),
            new("search_code", "Search code with regex pattern.", new { pattern = new { type = "string", description = "Regex pattern to search" }, path = new { type = "string", description = "Optional subdirectory path" } }),
            new("write_catalog", "Save the catalog JSON. MUST call this to complete.", new { json = new { type = "string", description = "Catalog JSON array" } }),
        };

        await CallDeepSeekWithTools(systemPrompt, userMessage, tools, "Catalog", _currentCatalogModel);
        return _catalogJson;
    }
}
