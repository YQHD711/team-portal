using System.Net.Http.Headers;
using System.Text.RegularExpressions;

namespace TeamPortal.Middleware;

/// <summary>
/// WebTools 静态站中间件 — 直接服务 G:\ardupilot_log_analysis\WebTools 目录（替代反向代理）。
/// 关键点：
///  - 无尾斜杠目录请求（/webtools/LogFinder）不返回 301——Next.js rewrite 会把 301 Location 原样透传为
///    http://localhost:8080/... 绝对地址，导致 iframe 跳成跨源、File System Access API 被拦。
///    改为直接读该目录的 index.html 返回（200），iframe 保持 :3000 同源。
///  - HTML 响应把相对资源路径（src/href）改写为 /webtools/... 绝对路径：
///    不依赖 URL 尾斜杠（iframe 内点 ./LogFinder 生成无尾斜杠 URL 时，相对路径会解析到宿主根）。
/// </summary>
public static class WebToolsStaticMiddleware
{
    private const string DefaultWebToolsRoot = @"G:\ardupilot_log_analysis\WebTools";

    private static readonly Regex AttrRegex = new(
        @"\b(src|href)=(""([^""]*)""|'([^']*)')",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static void UseWebToolsStatic(this WebApplication app)
    {
        var webToolsRoot = app.Configuration["WebTools:Root"] ?? DefaultWebToolsRoot;
        if (!Directory.Exists(webToolsRoot))
        {
            return;
        }

        app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? "/";
            if (!path.StartsWith("/webtools", StringComparison.OrdinalIgnoreCase))
            {
                await next();
                return;
            }

            // /webtools 或 /webtools/ → 根目录 index.html
            var rel = path.Substring("/webtools".Length).TrimStart('/');
            if (rel.Length == 0) rel = "index.html";

            // 无扩展名目录请求 → 补 index.html（不重定向）
            var lastSeg = rel.Substring(rel.LastIndexOf('/') + 1);
            var needsIndex = !lastSeg.Contains('.') && !rel.EndsWith("/");
            if (needsIndex) rel = rel.TrimEnd('/') + "/index.html";
            else if (rel.EndsWith("/")) rel += "index.html";

            var full = Path.GetFullPath(Path.Combine(webToolsRoot, rel.Replace('/', Path.DirectorySeparatorChar)));
            // 防目录穿越
            if (!full.StartsWith(Path.GetFullPath(webToolsRoot) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || !File.Exists(full))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                await context.Response.WriteAsync("Not Found");
                return;
            }

            var bytes = await File.ReadAllBytesAsync(full, context.RequestAborted);
            var ext = Path.GetExtension(full).ToLowerInvariant();

            // WebTools 由已受保护的 Next.js /webtools 页面以同源 iframe 加载。
            // iframe 的 localStorage 不会向后端静态请求附加 JWT，且 Next rewrite
            // 不保证转发 Referer，因此这里不能用 Referer/JWT 拦截 HTML，否则 iframe
            // 会得到 401、页面表现为白屏。生产环境不暴露 backend 端口，访问入口仍由
            // 前端路由守卫保护；局域网配置同样不映射 backend 端口。

            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Response.Headers["Cache-Control"] = "no-store";
            context.Response.ContentType = ext switch
            {
                ".html" => "text/html; charset=utf-8",
                ".js" => "text/javascript",
                ".css" => "text/css",
                ".png" => "image/png",
                ".svg" => "image/svg+xml",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".gif" => "image/gif",
                ".json" => "application/json",
                ".ico" => "image/x-icon",
                ".txt" => "text/plain",
                ".woff2" => "font/woff2",
                _ => "application/octet-stream",
            };

            if (context.Response.ContentType.StartsWith("text/html"))
            {
                var body = System.Text.Encoding.UTF8.GetString(bytes);
                // 页面基准目录：取请求路径的目录部分（/webtools/LogFinder/ 或 /webtools/）
                // 注意：/webtools/index.html 的目录是 /webtools/，不是文件本身
                var dir = path;
                var slash = dir.LastIndexOf('/');
                if (slash > 0)
                {
                    var leaf = dir.Substring(slash + 1);
                    if (leaf.Contains('.')) dir = dir.Substring(0, slash + 1); // 文件 → 取其目录
                }
                var baseDir = dir.EndsWith("/") ? dir : dir + "/";
                body = AttrRegex.Replace(body, m => RewriteAttr(m, baseDir));
                bytes = System.Text.Encoding.UTF8.GetBytes(body);
            }

            context.Response.ContentLength = bytes.Length;
            await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
        });
    }

    /// <summary>Referer 是否来自指定 origin(精确边界,防止 localhost:3000evil.com 之类前缀误匹配)</summary>
    private static bool IsTrustedReferer(string referer, string origin)
    {
        if (!referer.StartsWith(origin, StringComparison.OrdinalIgnoreCase)) return false;
        return referer.Length == origin.Length
            || referer[origin.Length] is '/' or '?' or '#';
    }

    /// <summary>把 src/href 相对路径改写为 /webtools/... 绝对路径；绝对路径/协议/锚点等原样保留</summary>
    private static string RewriteAttr(Match m, string baseDir)
    {
        var attr = m.Groups[1].Value;               // src 或 href
        var quote = m.Groups[2].Value[0];           // " 或 '
        var val = m.Groups[3].Success ? m.Groups[3].Value : m.Groups[4].Value;
        var abs = ResolveAbsolute(val, baseDir);
        // 目录型链接（无扩展名、无斜杠结尾）补尾斜杠：保证 iframe 导航后 URL 带斜杠，
        // 页面内 JS 的相对路径（如 OpenIn.js 的 ../HardwareReport）才能正确解析到 /webtools/...
        if (attr == "href" && !abs.Contains('.') && !abs.EndsWith("/") && !abs.EndsWith("#"))
        {
            abs += "/";
        }
        return $"{attr}={quote}{abs}{quote}";
    }

    private static string ResolveAbsolute(string rel, string baseDir)
    {
        if (string.IsNullOrEmpty(rel)) return rel;
        if (rel.StartsWith("//") || rel.StartsWith("http://") || rel.StartsWith("https://")
            || rel.StartsWith("#") || rel.StartsWith("data:") || rel.StartsWith("javascript:")
            || rel.StartsWith("mailto:") || rel.StartsWith("/")) return rel;
        try
        {
            var uri = new Uri(new Uri("http://local" + baseDir), rel);
            return uri.AbsolutePath;
        }
        catch
        {
            return baseDir + rel;
        }
    }
}
