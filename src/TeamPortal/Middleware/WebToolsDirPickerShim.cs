using System.Text.RegularExpressions;

namespace TeamPortal.Middleware;

/// <summary>
/// WebTools 页面注入的「目录选择」兜底脚本。
///
/// 背景：<c>window.showDirectoryPicker</c>（File System Access API）是 <b>SecureContext</b> 特性，
/// 只在 HTTPS 或 localhost 下存在。本系统按 IP:3000 用 http 直连（没有域名/证书），
/// 因此依赖它的工具（ArduPilot LogFinder）一按「搜索目录」就报「此浏览器不支持打开目录」，
/// 官方站点是 https 所以正常。
///
/// 兜底方式：原生 API 缺失时，用 <c>&lt;input type="file" webkitdirectory&gt;</c> 提供一个
/// <b>只读</b> 的目录句柄替身，覆盖 LogFinder 实际用到的全部接口
/// （name / kind / values() / getFile()），语义与原生一致：用户取消 → 抛 AbortError。
/// 原生 API 存在时脚本立即返回，不做任何事 —— 将来配上域名走 HTTPS，这里自动失效。
/// </summary>
public static class WebToolsDirPickerShim
{
    /// <summary>幂等标记：同一份 HTML 只会注入一次。</summary>
    internal const string Marker = "<!-- webtools-dirpicker-shim -->";

    internal const string Script = Marker + """
        <script>
        (function () {
          // 安全上下文（HTTPS / localhost）下原生 API 可用，什么都不要做
          if (typeof window.showDirectoryPicker === "function") return;

          function abortError() {
            return new DOMException("The user aborted a request.", "AbortError");
          }

          // 把 <input webkitdirectory> 给出的扁平文件列表还原成目录树
          function buildTree(files) {
            var root = { children: new Map() };
            var top = "";
            files.forEach(function (file) {
              var rel = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
              var leaf = rel.pop();
              if (!top && rel.length) top = rel[0];
              var node = root;
              rel.forEach(function (part) {
                var child = node.children.get(part);
                if (!child) { child = { children: new Map() }; node.children.set(part, child); }
                node = child;
              });
              node.children.set(leaf, { file: file });
            });
            return { root: root, top: top };
          }

          function toFileHandle(name, file) {
            return {
              kind: "file",
              name: name,
              getFile: function () { return Promise.resolve(file); },
              isSameEntry: function (other) { return Promise.resolve(!!other && other.name === name); },
              queryPermission: function () { return Promise.resolve("granted"); },
              requestPermission: function () { return Promise.resolve("granted"); }
            };
          }

          function toDirHandle(node, name) {
            return {
              kind: "directory",
              name: name,
              values: function () {
                var entries = Array.from(node.children.entries());
                return (async function* () {
                  for (var i = 0; i < entries.length; i++) {
                    var childName = entries[i][0], child = entries[i][1];
                    yield "file" in child ? toFileHandle(childName, child.file) : toDirHandle(child, childName);
                  }
                })();
              },
              getFileHandle: function (wanted) {
                var child = node.children.get(wanted);
                return child && "file" in child
                  ? Promise.resolve(toFileHandle(wanted, child.file))
                  : Promise.reject(new DOMException("Not found: " + wanted, "NotFoundError"));
              },
              getDirectoryHandle: function (wanted) {
                var child = node.children.get(wanted);
                return child && !("file" in child)
                  ? Promise.resolve(toDirHandle(child, wanted))
                  : Promise.reject(new DOMException("Not found: " + wanted, "NotFoundError"));
              },
              queryPermission: function () { return Promise.resolve("granted"); },
              requestPermission: function () { return Promise.resolve("granted"); }
            };
          }

          window.showDirectoryPicker = function () {
            return new Promise(function (resolve, reject) {
              var input = document.createElement("input");
              input.type = "file";
              input.webkitdirectory = true;
              input.multiple = true;
              input.style.display = "none";
              document.body.appendChild(input);

              var cleanup = function () { input.remove(); };
              input.addEventListener("change", function () {
                var files = Array.from(input.files || []);
                cleanup();
                if (files.length === 0) { reject(abortError()); return; }
                var tree = buildTree(files);
                // 和原生一样：句柄名取所选目录的目录名
                resolve(toDirHandle(tree.root, tree.top || "所选目录"));
              });
              input.addEventListener("cancel", function () { cleanup(); reject(abortError()); });
              // 必须同步 click，异步之后用户手势就失效了
              input.click();
            });
          };

          console.info("[WebTools] 非安全上下文（http + IP），已启用只读目录选择兜底；配置 HTTPS 后自动失效。");
        })();
        </script>

        """;

    private static readonly Regex HeadOpen = new(@"<head\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// 把兜底脚本注入 HTML（幂等）。优先插到 &lt;head&gt; 之后，让它在页面自身的脚本之前定义；
    /// 没有 head 就退到 &lt;/body&gt; 前，再没有就追加到末尾。
    /// </summary>
    internal static string Inject(string html)
    {
        if (string.IsNullOrEmpty(html) || html.Contains(Marker, StringComparison.Ordinal)) return html;

        var head = HeadOpen.Match(html);
        if (head.Success) return html.Insert(head.Index + head.Length, "\n" + Script);

        var bodyClose = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (bodyClose >= 0) return html.Insert(bodyClose, Script);

        return html + Script;
    }
}
