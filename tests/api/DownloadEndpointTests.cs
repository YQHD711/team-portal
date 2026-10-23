using Microsoft.Extensions.Configuration;
using TeamPortal.Endpoints;

namespace api;

/// <summary>打印服务安装包下载路径解析：容器里数据库在 /data，安装包应落在 /data/downloads 下。</summary>
public class DownloadEndpointTests
{
    private static IConfiguration Config(params (string Key, string Value)[] pairs)
        => new ConfigurationBuilder().AddInMemoryCollection(
            pairs.ToDictionary(p => p.Key, p => (string?)p.Value)).Build();

    [Fact]
    public void Resolve_UsesConnectionStringDirectory()
    {
        var config = Config(("ConnectionStrings:DefaultConnection", "Data Source=/data/teamportal.db"));
        var path = DownloadEndpoints.ResolvePrintServicePath(config, "/app");
        Assert.NotNull(path);
        Assert.EndsWith(Path.Combine("downloads", DownloadEndpoints.PrintServiceFileName), path);
    }

    [Fact]
    public void Resolve_PrefersExplicitConfig()
    {
        var config = Config(
            ("Downloads:PrintServicePath", "/srv/pkg/print.exe"),
            ("ConnectionStrings:DefaultConnection", "Data Source=/data/teamportal.db"));
        Assert.Equal("/srv/pkg/print.exe", DownloadEndpoints.ResolvePrintServicePath(config, "/app"));
    }

    [Fact]
    public void Resolve_ReturnsNullWithoutConnectionString()
    {
        Assert.Null(DownloadEndpoints.ResolvePrintServicePath(Config(), "/app"));
    }
}