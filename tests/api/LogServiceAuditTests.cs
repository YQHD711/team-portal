using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Services;

namespace api;

/// <summary>LogService 审计脱敏 —— 覆盖 P0:异常路径绕过脱敏、敏感键漏匹配、截断无护栏。</summary>
public class LogServiceAuditTests
{
    private static string Scrub(object data, int maxLen = 2000) => LogService.SerializeAndScrub(data, maxLen);

    [Fact]
    public void SerializeAndScrub_RedactsSensitiveKeys()
    {
        var json = Scrub(new { password = "p@ss", ApiKey = "keyvalue", api_key = "snakevalue", refreshToken = "tokvalue", normal = "keep" });

        Assert.DoesNotContain("p@ss", json);
        Assert.DoesNotContain("keyvalue", json);
        Assert.DoesNotContain("snakevalue", json);
        Assert.DoesNotContain("tokvalue", json);
        var node = JsonNode.Parse(json)!.AsObject();
        Assert.Equal("***", (string?)node["password"]);
        Assert.Equal("***", (string?)node["api_key"]); // 归一化后命中 apikey,旧实现漏匹配
        Assert.Equal("keep", (string?)node["normal"]);
    }

    [Fact]
    public void SerializeAndScrub_NestedObjectsAndArrays_Redacted()
    {
        var json = Scrub(new
        {
            user = new { name = "u1", password = "secret1" },
            items = new object[] { new { token = "secret2", id = 1 } }
        });

        Assert.DoesNotContain("secret1", json);
        Assert.DoesNotContain("secret2", json);
        Assert.Contains("u1", json);
        Assert.Contains("id", json);
    }

    [Fact]
    public void SerializeAndScrub_SerializeFailure_ReturnsMarkerNotRawData()
    {
        var json = Scrub(new { password = "s3cr3t-value", boom = new Exploding() });

        Assert.Contains("serialize-failed", json);
        Assert.DoesNotContain("s3cr3t-value", json); // 失败路径绝不落原文
    }

    [Fact]
    public void SerializeAndScrub_DeepNesting_StillRedacted()
    {
        // 深度 100 > JsonNode 默认上限 64:旧实现 Parse 抛异常后被吞掉 → 原样落库绕过脱敏
        object data = new { password = "deep-secret" };
        for (var i = 0; i < 100; i++) data = new { level = i, child = data };

        var json = Scrub(data, 100_000); // 放宽上限,避免截断掉最深处的敏感字段

        Assert.DoesNotContain("deep-secret", json);
        Assert.Contains("***", json);
    }

    [Fact]
    public void SerializeAndScrub_ExceedingMaxLen_Truncates()
    {
        var json = Scrub(new { note = new string('x', 500) }, 50);

        Assert.EndsWith("…[truncated]", json);
        Assert.True(json.Length <= 50 + "…[truncated]".Length);
    }

    [Fact]
    public void SerializeAndScrub_NonPositiveMaxLen_DoesNotThrow()
    {
        // 配置成 0/负数时旧实现 json[..maxLen] 会抛 ArgumentOutOfRangeException 打断调用方业务
        var json = Scrub(new { note = new string('x', 500) }, -5);

        Assert.False(string.IsNullOrEmpty(json));
    }

    [Fact]
    public void Audit_SettingsUnavailable_DoesNotThrow()
    {
        // 审计失败不得影响业务流程
        using var svc = new LogService(new TestScopeFactory(null!), NullLogger<LogService>.Instance, null!);

        var ex = Record.Exception(() => svc.Audit("login", "tester", "user", "1", new { password = "x" }, "127.0.0.1"));

        Assert.Null(ex);
    }

    private sealed class Exploding
    {
        public string Boom => throw new InvalidOperationException("serialize boom");
    }
}
