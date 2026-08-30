namespace TeamPortal.Endpoints;

/// <summary>危险 HTML/脚本片段拦截(大小写不敏感),与 InventoryEndpoints 物料名校验同源。</summary>
public static class InputSanitizer
{
    private static readonly string[] UnsafeFragments = ["<script", "<img", "onerror=", "javascript:"];

    public static bool HasUnsafeFragment(string? text) =>
        text is not null && UnsafeFragments.Any(f => text.Contains(f, StringComparison.OrdinalIgnoreCase));
}
