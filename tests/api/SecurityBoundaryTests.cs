using TeamPortal.Services;

namespace api;

/// <summary>
/// 审计 #4 / #6 的负向测试（**修复前必须红**）：
///  - Wiki 删除的路径拼接：`../../data/teamportal.db` 这类输入必须被拒（不能把任意文件搬进回收站）
///  - 库存归还/借出数量：`int.MaxValue` 这类越界值必须被拒（否则整表读取 OverflowException，全站库存不可用）
/// </summary>
public class SecurityBoundaryTests
{
    private static string Root() => Path.Combine(Path.GetTempPath(), "kb-root-guard");

    [Theory]
    [InlineData("../..")]                       // 直接穿越
    [InlineData("../../data")]                  // 多级穿越（审计报告里的形态）
    [InlineData("..")]                          // 单级
    [InlineData("a/../../../data")]             // 中间穿越
    [InlineData("..\\..\\data")]                // Windows 分隔符穿越
    public void WikiProjectPath_Traversal_IsRejected(string malicious)
    {
        // 修复前这里会返回一个"跑出根目录"的绝对路径 → 删除接口会把它搬进回收站
        var resolved = KnowledgePathGuard.ResolveInside(Root(), malicious, "teamportal.db");

        Assert.Null(resolved);
    }

    [Theory]
    [InlineData("公共", "ardupilot")]
    [InlineData("公共", "ardupilot_EN")]
    [InlineData("技术文档", "飞控")]
    public void WikiProjectPath_NormalProject_IsAllowed(string folder, string project)
    {
        var resolved = KnowledgePathGuard.ResolveInside(Root(), folder, project);

        Assert.NotNull(resolved);
        Assert.StartsWith(Path.GetFullPath(Root()), resolved!, StringComparison.OrdinalIgnoreCase);
        Assert.EndsWith(project, resolved, StringComparison.Ordinal);
    }

    [Fact]
    public void WikiProjectPath_ResolveAll_RejectsWholeBatchWhenAnyIllegal()
    {
        var result = KnowledgePathGuard.ResolveAllInside(Root(), new[]
        {
            new[] { "公共", "ardupilot" },
            new[] { "../../data", "teamportal.db" },
        });

        Assert.Null(result);   // 不做"部分处理"
    }

    [Fact]
    public void WikiProjectPath_SiblingPrefix_IsRejected()
    {
        // 前缀比较的经典漏洞：/kb-root-guard2 以 /kb-root-guard 为前缀，但不是子目录
        var root = Root();
        var sibling = root + "-evil";
        var resolved = KnowledgePathGuard.ResolveInside(root, sibling, "x");

        Assert.Null(resolved);   // 绝对路径段越界（GetRelativePath 会给出 ..）
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    [InlineData(int.MaxValue)]
    [InlineData(1_000_001)]
    public void InventoryQuantity_OutOfRange_IsRejected(int quantity)
    {
        // 修复前：只有 `<= 0` 校验 → int.MaxValue 会被接受，写入后整表读取 OverflowException
        var valid = InventoryLimits.IsValidRequestQuantity(quantity, out var error);

        Assert.False(valid);
        Assert.False(string.IsNullOrWhiteSpace(error));   // 必须给可读原因
    }

    [Theory]
    [InlineData(1)]
    [InlineData(100)]
    [InlineData(1_000_000)]
    public void InventoryQuantity_InRange_IsAccepted(int quantity)
        => Assert.True(InventoryLimits.IsValidRequestQuantity(quantity, out _));

    [Theory]
    [InlineData(int.MaxValue)]
    [InlineData(10_000_001)]
    public void InventoryResultingStock_Overflow_IsRejected(int resulting)
    {
        var valid = InventoryLimits.IsValidResultingStock(resulting, out var error);

        Assert.False(valid);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void InventoryCheckin_NearOverflow_IsRejected()
    {
        // 库里已有接近上限的数量时，再归还一单也不能溢出
        var current = InventoryLimits.MaxStock;
        var valid = InventoryLimits.IsValidResultingStock(current + 1, out _);

        Assert.False(valid);
    }
}
