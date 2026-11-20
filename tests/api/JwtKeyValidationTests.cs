namespace api;

/// <summary>
/// JWT 密钥启动校验（条件性 P0）。回归背景：.env.example 的占位串
/// "change-me-to-a-random-string-at-least-32-chars" 有 45 字符，旧逻辑只校验
/// "长度 ≥ 32"，占位密钥能直接通过；一旦线上照抄 .env.example 部署，公开仓库里的
/// 这个"密钥"就能被用来伪造任意 JWT（含 role=admin），等于后台被接管。
/// 另外生产环境缺密钥不能退化成"每次重启随机生成"（全员被反复踢下线），必须启动即失败。
/// </summary>
public class JwtKeyValidationTests
{
    /// <summary>.env.example 里的真实占位串（45 字符），最典型的攻击面。</summary>
    private const string EnvExamplePlaceholder = "change-me-to-a-random-string-at-least-32-chars";

    /// <summary>32 字符合法密钥（长度刚好等于下限）。</summary>
    private const string ValidKey32 = "0123456789abcdef0123456789abcdef";

    [Fact]
    public void Production_EmptyKey_Rejected()
    {
        var error = Program.ValidateJwtKey(null, isProduction: true);
        Assert.NotNull(error);
        Assert.Contains("JWT__KEY", error!);
        Assert.Contains("生产环境", error!);
    }

    [Fact]
    public void Production_WhitespaceKey_Rejected()
        => Assert.NotNull(Program.ValidateJwtKey("   ", isProduction: true));

    [Theory]
    [InlineData(EnvExamplePlaceholder)]
    [InlineData("CHANGE-ME-please-this-is-long-enough-to-pass-32")]
    [InlineData("my-changeme-secret-value-that-is-long-enough-01")]
    [InlineData("your-secret-your-secret-your-secret-0001")]
    [InlineData("your_jwt_key_your_jwt_key_your_jwt_key_01")]
    public void KnownPlaceholder_Rejected_EvenIfLongEnough(string key)
    {
        // 这些串都 ≥32 字符：验证占位判定优先于长度判定，否则占位密钥会被当成合法值放行
        Assert.True(key.Length >= 32, "占位串用例必须够长，才能覆盖'长度校验会放行'的场景");
        var error = Program.ValidateJwtKey(key, isProduction: true);
        Assert.NotNull(error);
        Assert.Contains("占位", error!);
    }

    [Fact]
    public void Production_ValidKey_Accepted()
        => Assert.Null(Program.ValidateJwtKey(ValidKey32, isProduction: true));

    [Fact]
    public void NonProduction_EmptyKey_Allowed()
        => Assert.Null(Program.ValidateJwtKey(null, isProduction: false));

    [Fact]
    public void NonProduction_WhitespaceKey_Allowed()
        => Assert.Null(Program.ValidateJwtKey(" \t ", isProduction: false));

    [Theory]
    [InlineData(1)]
    [InlineData(31)]
    public void ShortKey_Rejected_InBothEnvironments(int length)
    {
        // 显式配置了短密钥时，非生产环境也保持原有拒绝行为，避免开发/生产行为分叉
        var key = new string('a', length);
        Assert.NotNull(Program.ValidateJwtKey(key, isProduction: false));
        Assert.NotNull(Program.ValidateJwtKey(key, isProduction: true));
    }

    [Theory]
    [InlineData(32)]
    [InlineData(48)]
    public void KeyAtOrAbove32_Accepted_InBothEnvironments(int length)
    {
        var key = new string('a', length);
        Assert.Null(Program.ValidateJwtKey(key, isProduction: false));
        Assert.Null(Program.ValidateJwtKey(key, isProduction: true));
    }

    [Fact]
    public void ShortPlaceholder_ReportsPlaceholderFirst()
    {
        // 短占位串要报"占位"而不是"长度不足"：否则会把修复方向带偏（去补长度而不是换密钥）
        var error = Program.ValidateJwtKey("changeme", isProduction: false);
        Assert.NotNull(error);
        Assert.Contains("占位", error!);
    }

    [Fact]
    public void Production_RandomBase64Key_Accepted()
    {
        // 非生产环境随机生成分支用的就是 Base64(32 字节)=44 字符，确认它不会被误判
        var generated = Convert.ToBase64String(
            System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        Assert.Null(Program.ValidateJwtKey(generated, isProduction: true));
    }
}
