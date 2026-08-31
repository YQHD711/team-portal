using System.Net.Http.Headers;
using System.Text.RegularExpressions;

namespace TeamPortal.Middleware;

/// <summary>
/// WebTools 反向代理 — 把 /webtools/* 转发到 ArduPilot WebTools 静态站点 (http://127.0.0.1:8123)。
/// 使 iframe 与主站同源，浏览器 File System Access API（showDirectoryPicker）才能在 iframe 内正常调用。
/// HTML 返回时把页面内相对资源路径（src/href）改写为 /webtools/... 绝对路径：
///   - 不依赖 &lt;base&gt;（缓存/iframe 导航下不可靠）
///   - 不依赖 URL 尾斜杠（iframe 内点 ./LogFinder 生成无尾斜杠 URL，../modules 会解析到宿主根导致 404）
/// </summary>
public static class WebToolsProxyMiddleware
{
    private static readonly HttpClient Client = new()
    {
        BaseAddress = new Uri("http://127.0.0.1:8123/"),
        Timeout = TimeSpan.FromSeconds(60),
    };

    /// <summary>src/href 属性值里的相对路径 → /webtools/... 绝对路径</summary>
    private static readonly Regex AttrRegex = new(
        @"\b(src|href)=(""([^""]*)""|'([^']*)')",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static void UseWebToolsProxy(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            if (!context.Request.Path.StartsWithSegments("/webtools"))
            {
                await next();
                return;
            }

            // 无扩展名且无尾斜杠的目录请求：服务端补斜杠转发（不返回 301——Next.js rewrite 吞尾斜杠会与 301 循环）
            var raw = context.Request.Path.Value!;
            var lastSeg = raw.Substring(raw.LastIndexOf('/') + 1);
            var needsDir = !raw.EndsWith("/") && !lastSeg.Contains('.');
            var targetPath = context.Request.Path == "/webtools" || context.Request.Path == "/webtools/"
                ? ""
                : (needsDir ? raw.Substring("/webtools".Length).TrimStart('/') + "/" : context.Request.Path.Value!.Substring("/webtools".Length).TrimStart('/'));
            var target = new Uri(Client.BaseAddress!, targetPath + context.Request.QueryString.ToString());

            using var req = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
            {
                req.Content = new StreamContent(context.Request.Body);
                if (!string.IsNullOrEmpty(context.Request.ContentType))
                    req.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(context.Request.ContentType);
            }

            HttpResponseMessage resp;
            try
            {
                resp = await Client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
            }
            catch (Exception ex)
            {
                context.Response.StatusCode = StatusCodes.Status502BadGateway;
                await context.Response.WriteAsync($"WebTools 服务不可用：{ex.Message}");
                return;
            }

            using (resp)
            {
                context.Response.StatusCode = (int)resp.StatusCode;
                // 禁止缓存：避免浏览器缓存修复前的旧 HTML（相对路径解析错误）
                context.Response.Headers["Cache-Control"] = "no-store";
                foreach (var header in resp.Content.Headers)
                    context.Response.Headers[header.Key] = header.Value.ToArray();

                if (resp.Content.Headers.ContentType?.MediaType?.Contains("text/html") == true)
                {
                    var body = await resp.Content.ReadAsStringAsync();
                    // 页面基准目录：取请求路径的目录部分（/webtools/LogFinder/ 或 /webtools/）
                    // 注意：/webtools/index.html 的目录是 /webtools/，不是文件本身
                    var dir = raw;
                    var slash = dir.LastIndexOf('/');
                    if (slash > 0)
                    {
                        var leaf = dir.Substring(slash + 1);
                        if (leaf.Contains('.')) dir = dir.Substring(0, slash + 1); // 文件 → 取其目录
                    }
                    var baseDir = dir.EndsWith("/") ? dir : dir + "/";
                    body = AttrRegex.Replace(body, m => RewriteAttr(m, baseDir));
                    context.Response.ContentLength = System.Text.Encoding.UTF8.GetByteCount(body);
                    await context.Response.WriteAsync(body);
                }
                else
                {
                    await resp.Content.CopyToAsync(context.Response.Body);
                }
            }
        });
    }

    /// <summary>把 src/href 相对路径改写为 /webtools/... 绝对路径；绝对路径/协议/锚点等原样保留</summary>
    private static string RewriteAttr(Match m, string baseDir)
    {
        var attr = m.Groups[1].Value;               // src 或 href
        var quote = m.Groups[2].Value[0];           // " 或 '
        var val = m.Groups[3].Success ? m.Groups[3].Value : m.Groups[4].Value;
        var abs = ResolveAbsolute(val, baseDir);
        return $"{attr}={quote}{abs}{quote}";
    }

    private static string ResolveAbsolute(string rel, string baseDir)
    {
        if (string.IsNullOrEmpty(rel)) return rel;
        if (rel.StartsWith("//") || rel.StartsWith("http://") || rel.StartsWith("https://")
            || rel.StartsWith("#") || rel.StartsWith("data:") || rel.StartsWith("javascript:")
            || rel.StartsWith("mailto:") || rel.StartsWith("/")) return rel;
        // baseDir 以 /webtools/... 开头，相对路径拼上去后规范化 ./ 与 ../
        var combined = baseDir + rel;
        // 用 Uri 规范化 . 和 ..（基于假 host，只取 AbsolutePath）
        try
        {
            var uri = new Uri(new Uri("http://local" + baseDir), rel);
            return uri.AbsolutePath;
        }
        catch
        {
            return combined;
        }
    }
}
