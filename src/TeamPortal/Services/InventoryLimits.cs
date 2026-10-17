namespace TeamPortal.Services;

/// <summary>
/// 库存数量边界（审计 #6）。
///
/// 背景：`POST /api/inventory/{id}/checkin` 只校验 `Quantity &gt; 0`，没有上界 ——
/// 一次请求就能把数量写成接近 `int.MaxValue` 的值；此后**任何整表读取都会 `OverflowException`**，
/// 全站库存功能直接不可用（不是"显示错"，是"打不开"）。
///
/// 这里给两个边界：
///  - <see cref="MaxPerRequest"/>：单次归还/借出的上限（挡住"一次写天文数字"）
///  - <see cref="MaxStock"/>：库存总量的上限（挡住"多次累加到溢出"）
/// 取值远大于真实用量（航模队库存以"件"计），但远小于 int.MaxValue，留足安全余量。
/// </summary>
public static class InventoryLimits
{
    /// <summary>单次借出/归还的数量上限</summary>
    public const int MaxPerRequest = 1_000_000;

    /// <summary>单个物料库存总量上限（任何写入后都不得超过）</summary>
    public const int MaxStock = 10_000_000;

    /// <summary>校验单次请求数量；非法时返回可读原因</summary>
    public static bool IsValidRequestQuantity(int quantity, out string? error)
    {
        error = null;
        if (quantity <= 0)
        {
            error = "数量必须为正整数";
            return false;
        }
        if (quantity > MaxPerRequest)
        {
            error = $"数量过大（单次最多 {MaxPerRequest}）";
            return false;
        }
        return true;
    }

    /// <summary>校验写入后的库存总量；越界时返回可读原因</summary>
    public static bool IsValidResultingStock(int resultingQuantity, out string? error)
    {
        error = null;
        if (resultingQuantity < 0)
        {
            error = "库存不足，无法借出这么多";
            return false;
        }
        if (resultingQuantity > MaxStock)
        {
            error = $"库存总量会超过上限 {MaxStock}，已拒绝";
            return false;
        }
        return true;
    }
}
