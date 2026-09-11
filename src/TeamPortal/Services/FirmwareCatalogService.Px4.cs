namespace TeamPortal.Services;

/// <summary>PX4 侧：没有机型维度，版本 = GitHub Release tag，飞控板 = 资产名去掉 .px4。</summary>
public partial class FirmwareCatalogService
{
    private Task<IReadOnlyList<Px4Release>?> Px4ReleasesAsync() =>
        CachedAsync<IReadOnlyList<Px4Release>>("fw:px4:releases", async () =>
        {
            var json = await FetchTextAsync($"{_px4Api}?per_page=30");
            if (json is null) return null;
            var releases = FirmwareCatalogParser.ParsePx4Releases(json);
            return releases.Count == 0 ? null : releases;
        });

    private async Task<IReadOnlyList<FirmwareVersion>?> Px4VersionsAsync()
    {
        var releases = await Px4ReleasesAsync();
        if (releases is null) return null;
        var versions = releases
            .Where(r => r.Assets.Count > 0)
            .Select(r => new FirmwareVersion(r.Tag, r.Label, r.Prerelease))
            .ToList();
        return versions.Count == 0 ? null : versions;
    }

    private async Task<IReadOnlyList<FirmwareBoard>?> Px4BoardsAsync(string version)
    {
        var release = await Px4ReleaseAsync(version);
        if (release is null) return null;
        return release.Assets.Select(a => new FirmwareBoard(a.Name[..^4], a.Size)).ToList();
    }

    private async Task<IReadOnlyList<FirmwareAsset>?> Px4AssetsAsync(string version, string board)
    {
        var release = await Px4ReleaseAsync(version);
        if (release is null) return null;
        var asset = release.Assets.FirstOrDefault(a => a.Name.Equals(board + ".px4", StringComparison.OrdinalIgnoreCase));
        if (asset is null) return null;
        return [new FirmwareAsset(asset.Name, "px4", "PX4 固件（QGroundControl 刷写）", asset.Size)];
    }

    private async Task<Px4Release?> Px4ReleaseAsync(string version)
    {
        if (!FirmwareSegments.IsSafe(version)) return null;
        var releases = await Px4ReleasesAsync();
        return releases?.FirstOrDefault(r => r.Tag == version);
    }
}
