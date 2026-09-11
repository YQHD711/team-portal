namespace TeamPortal.Services;

/// <summary>ArduPilot 侧：目录站是 Apache 自动索引，路径 /{机型}/{版本}/{飞控板}/{文件}。</summary>
public partial class FirmwareCatalogService
{
    private Task<IReadOnlyList<FirmwareVersion>?> ArduPilotVersionsAsync(string? vehicle)
    {
        if (!IsKnownVehicle(vehicle))
            return Task.FromResult<IReadOnlyList<FirmwareVersion>?>(null);

        return CachedAsync<IReadOnlyList<FirmwareVersion>>($"fw:ap:ver:{vehicle}", async () =>
        {
            var entries = await FetchListingAsync($"{_arduPilotBase}/{vehicle}/");
            if (entries is null) return null;
            var versions = FirmwareCatalogParser.ParseArduPilotVersions(entries);
            return versions.Count == 0 ? null : versions;
        });
    }

    private Task<IReadOnlyList<FirmwareBoard>?> ArduPilotBoardsAsync(string? vehicle, string version)
    {
        if (!IsKnownVehicle(vehicle) || !IsPlausibleArduPilotVersion(version))
            return Task.FromResult<IReadOnlyList<FirmwareBoard>?>(null);

        return CachedAsync<IReadOnlyList<FirmwareBoard>>($"fw:ap:boards:{vehicle}:{version}", async () =>
        {
            var entries = await FetchListingAsync($"{_arduPilotBase}/{vehicle}/{version}/");
            if (entries is null) return null;
            var boards = entries
                .Where(e => e.IsDirectory && FirmwareSegments.IsSafe(e.Name))
                .Select(e => new FirmwareBoard(e.Name, null))
                .ToList();
            return boards.Count == 0 ? null : boards;
        });
    }

    private Task<IReadOnlyList<FirmwareAsset>?> ArduPilotAssetsAsync(string? vehicle, string version, string board)
    {
        if (!IsKnownVehicle(vehicle) || !IsPlausibleArduPilotVersion(version) || !FirmwareSegments.IsSafe(board))
            return Task.FromResult<IReadOnlyList<FirmwareAsset>?>(null);

        return CachedAsync<IReadOnlyList<FirmwareAsset>>($"fw:ap:assets:{vehicle}:{version}:{board}", async () =>
        {
            var entries = await FetchListingAsync($"{_arduPilotBase}/{vehicle}/{version}/{board}/");
            if (entries is null) return null;
            var assets = FirmwareCatalogParser.ParseArduPilotAssets(entries);
            return assets.Count == 0 ? null : assets;
        });
    }

    /// <summary>版本段只允许官方 channels 与 stable-X.Y.Z 形态，其余（含带斜杠/点的怪值）连上游请求都不会发出。</summary>
    private static bool IsPlausibleArduPilotVersion(string? version)
    {
        if (string.IsNullOrEmpty(version)) return false;
        if (version is "stable" or "beta" or "latest" or "dev") return true;
        if (!version.StartsWith("stable-", StringComparison.Ordinal) || version.Length <= 7) return false;
        return version[7..].All(c => char.IsAsciiDigit(c) || c == '.');
    }
}
