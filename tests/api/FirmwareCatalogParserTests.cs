using TeamPortal.Services;

namespace api;

/// <summary>
/// 固件目录解析：ArduPilot 的 Apache 目录列表 HTML 与 PX4 的 Releases JSON。
/// 样例取自真实响应（含 ArduPilot「Parent Directory」行缺少 &lt;/tr&gt; 这一坑）。
/// </summary>
public class FirmwareCatalogParserTests
{
    private const string BoardListingHtml = """
        <html><head><title>ArduPilot firmware : /Plane/stable/Pixhawk6X</title></head>
        <table width=80%>
        <tr bgcolor="#aaaaaa"><td width=50 align=center><b>Type</b></td><td><b>Filename</b></td><td><b>Date</b></td><td><b>Size</b></td></tr>
        <tr bgcolor="#ffffff"><td align=center><img src="/icons/back.gif"></td><td><a href="/Plane/stable"><b>Parent Directory</B> </a></td>
        	<td>--</td><td>--</td>

        <tr bgcolor="#cacaca">
                                <td align=center><img src="/icons/text.gif"></td>
        			<td><a href="/Plane/stable/Pixhawk6X/arduplane.abin">arduplane.abin</a></td>
        			<td>Thu Sep  3 09:37:28 2026</td>
        			<td>1674671</td>
        </tr>
        <tr bgcolor="#ffffff">
                                <td align=center><img src="/icons/text.gif"></td>
        			<td><a href="/Plane/stable/Pixhawk6X/arduplane.apj">arduplane.apj</a></td>
        			<td>Thu Sep  3 09:37:28 2026</td>
        			<td>1538295</td>
        </tr>
        <tr bgcolor="#cacaca">
                                <td align=center><img src="/icons/text.gif"></td>
        			<td><a href="/Plane/stable/Pixhawk6X/arduplane_with_bl.hex">arduplane_with_bl.hex</a></td>
        			<td>Thu Sep  3 09:37:28 2026</td>
        			<td>4966108</td>
        </tr>
        <tr bgcolor="#ffffff">
                                <td align=center><img src="/icons/text.gif"></td>
        			<td><a href="/Plane/stable/Pixhawk6X/features.txt">features.txt</a></td>
        			<td>Thu Sep  3 09:37:28 2026</td>
        			<td>11487</td>
        </tr>
        <tr bgcolor="#cacaca">
                                <td align=center><img src="/icons/text.gif"></td>
        			<td><a href="/Plane/stable/Pixhawk6X/git-version.txt">git-version.txt</a></td>
        			<td>Thu Sep  3 09:37:28 2026</td>
        			<td>188</td>
        </tr>
        </table>
        <script>gtag('config','UA-75650032-4');</script>
        """;

    private const string VersionListingHtml = """
        <table width=80%>
        <tr bgcolor="#ffffff"><td align=center><img src="/icons/back.gif"></td><td><a href="/"><b>Parent Directory</B> </a></td>
        	<td>--</td><td>--</td>

        <tr bgcolor="#cacaca">
        			<td align=center><img src="/icons/folder.gif"></td>
        			<td><a href="/Plane/2026-09">2026-09</A></td>
        			<td>--</td>
        			<td>--</td>
        </tr>
        <tr bgcolor="#ffffff">
        			<td align=center><img src="/icons/folder.gif"></td>
        			<td><a href="/Plane/beta">beta</A></td>
        			<td>--</td>
        			<td>--</td>
        </tr>
        <tr bgcolor="#cacaca">
        			<td align=center><img src="/icons/folder.gif"></td>
        			<td><a href="/Plane/latest">latest</A></td>
        			<td>--</td>
        			<td>--</td>
        </tr>
        <tr bgcolor="#ffffff">
        			<td align=center><img src="/icons/folder.gif"></td>
        			<td><a href="/Plane/stable">stable</A></td>
        			<td>--</td>
        			<td>--</td>
        </tr>
        <tr bgcolor="#cacaca">
        			<td align=center><img src="/icons/folder.gif"></td>
        			<td><a href="/Plane/stable-4.5.7">stable-4.5.7</A></td>
        			<td>--</td>
        			<td>--</td>
        </tr>
        <tr bgcolor="#ffffff">
        			<td align=center><img src="/icons/folder.gif"></td>
        			<td><a href="/Plane/stable-4.6.0">stable-4.6.0</A></td>
        			<td>--</td>
        			<td>--</td>
        </tr>
        <tr bgcolor="#cacaca">
        			<td align=center><img src="/icons/folder.gif"></td>
        			<td><a href="/Plane/stable-4.3.0">stable-4.3.0</A></td>
        			<td>--</td>
        			<td>--</td>
        </tr>
        </table>
        """;

    private const string Px4Json = """
        [
          {
            "tag_name": "v1.18.0-rc1",
            "name": "v1.18.0-rc1",
            "prerelease": true,
            "assets": [
              { "name": "px4_fmu-v6x_default.px4", "size": 1800000, "browser_download_url": "https://github.com/PX4/PX4-Autopilot/releases/download/v1.18.0-rc1/px4_fmu-v6x_default.px4" },
              { "name": "px4_fmu-v6x_bootloader.bin", "size": 43000, "browser_download_url": "https://github.com/PX4/PX4-Autopilot/releases/download/v1.18.0-rc1/px4_fmu-v6x_bootloader.bin" },
              { "name": "px4_fmu-v6x_default.sbom.spdx.json", "size": 176000, "browser_download_url": "https://github.com/PX4/PX4-Autopilot/releases/download/v1.18.0-rc1/px4_fmu-v6x_default.sbom.spdx.json" }
            ]
          },
          {
            "tag_name": "v1.17.0",
            "name": "v1.17.0 - Stable Release",
            "prerelease": false,
            "assets": [
              { "name": "3dr_ctrl-n1_default.px4", "size": 1770550, "browser_download_url": "https://github.com/PX4/PX4-Autopilot/releases/download/v1.17.0/3dr_ctrl-n1_default.px4" }
            ]
          }
        ]
        """;

    [Fact]
    public void ParseListing_KeepsRowRightAfterUnclosedParentRow()
    {
        var entries = FirmwareCatalogParser.ParseListing(BoardListingHtml);
        var names = entries.Select(e => e.Name).ToList();

        // 回归：父目录行没有 </tr>，按 <tr>…</tr> 配对会把 arduplane.abin 一起吞掉
        Assert.Contains("arduplane.abin", names);
        Assert.Contains("arduplane.apj", names);
        Assert.DoesNotContain("Parent Directory", names);
        Assert.DoesNotContain("..", names);
    }

    [Fact]
    public void ParseListing_CarriesSizeForFilesOnly()
    {
        var entries = FirmwareCatalogParser.ParseListing(BoardListingHtml);

        var apj = entries.Single(e => e.Name == "arduplane.apj");
        Assert.False(apj.IsDirectory);
        Assert.Equal(1538295, apj.Size);

        var versionEntries = FirmwareCatalogParser.ParseListing(VersionListingHtml);
        Assert.All(versionEntries, e => Assert.True(e.IsDirectory));
        Assert.All(versionEntries, e => Assert.Null(e.Size));
        Assert.Equal("2026-09", versionEntries[0].Name);
    }

    [Fact]
    public void ParseArduPilotVersions_ChannelsFirstThenStableDescending()
    {
        var versions = FirmwareCatalogParser.ParseArduPilotVersions(
            FirmwareCatalogParser.ParseListing(VersionListingHtml));

        Assert.Equal(
            new[] { "stable", "beta", "latest", "stable-4.6.0", "stable-4.5.7", "stable-4.3.0" },
            versions.Select(v => v.Id));
        Assert.False(versions[0].Prerelease);
        Assert.True(versions[1].Prerelease);
        Assert.Equal("4.6.0", versions[3].Label);
    }

    [Fact]
    public void ParseArduPilotAssets_OnlyFlashableImages_ApjFirst()
    {
        var assets = FirmwareCatalogParser.ParseArduPilotAssets(
            FirmwareCatalogParser.ParseListing(BoardListingHtml));

        Assert.Equal(new[] { "apj", "abin", "hex" }, assets.Select(a => a.Kind));
        Assert.Equal(new[] { "arduplane.apj", "arduplane.abin", "arduplane_with_bl.hex" }, assets.Select(a => a.Name));
        Assert.DoesNotContain(assets, a => a.Name.EndsWith(".txt"));
    }

    [Fact]
    public void ParsePx4Releases_KeepsOnlyPx4Assets_AndFlagsPrerelease()
    {
        var releases = FirmwareCatalogParser.ParsePx4Releases(Px4Json);

        Assert.Equal(2, releases.Count);
        Assert.True(releases[0].Prerelease);
        Assert.False(releases[1].Prerelease);
        Assert.Equal("v1.17.0 - Stable Release", releases[1].Label);
        Assert.Equal("px4_fmu-v6x_default.px4", Assert.Single(releases[0].Assets).Name);
        Assert.Equal(1800000, releases[0].Assets[0].Size);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("{\"message\":\"API rate limit exceeded\"}")]
    public void ParsePx4Releases_BadPayload_ReturnsEmpty(string payload)
        => Assert.Empty(FirmwareCatalogParser.ParsePx4Releases(payload));

    [Theory]
    [InlineData("../../etc/passwd", false)]
    [InlineData("..", false)]
    [InlineData("a/b", false)]
    [InlineData("a\\b", false)]
    [InlineData("stable 4.5", false)]
    [InlineData("http://evil.com", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("Pixhawk6X", true)]
    [InlineData("stable-4.5.7", true)]
    [InlineData("px4_fmu-v6x_default.px4", true)]
    [InlineData("ARKV6X-bdshot", true)]
    public void IsSafe_WhitelistsPathSegments(string? segment, bool expected)
        => Assert.Equal(expected, FirmwareSegments.IsSafe(segment));
}
