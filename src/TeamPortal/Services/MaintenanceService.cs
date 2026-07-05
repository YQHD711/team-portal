using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// Maintenance mode — apply proposals, compile, auto-rollback, restart.
/// </summary>
public class MaintenanceService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IWebHostEnvironment _env;
    private readonly LogService _log;
    private string ProjRoot => Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", ".."));

    public MaintenanceService(IServiceScopeFactory scopeFactory, IWebHostEnvironment env, LogService log)
    {
        _scopeFactory = scopeFactory;
        _env = env;
        _log = log;
    }

    /// <summary>Get git change history for the maintenance panel.</summary>
    public async Task<object> GetHistory()
    {
        var log = await RunCommand("git log --oneline -10");
        var status = await RunCommand("git status --short");
        _log.Info("maintenance", "Change history viewed");
        return new { log, status, projectRoot = ProjRoot };
    }

    /// <summary>
    /// Apply all approved proposals: git snapshot → compile → if OK restart, if fail rollback.
    /// Returns build result and error details.
    /// </summary>
    public async Task<object> ApplyChanges()
    {
        // 1. Git snapshot before changes
        _log.Info("maintenance", "📸 创建 git 快照...");
        await RunCommand("git add -A");
        await RunCommand("git commit -m \"snapshot: pre-apply backup\" --allow-empty");
        var preCommit = (await RunCommand("git rev-parse HEAD")).Trim();
        _log.Info("maintenance", $"快照: {preCommit[..8]}");

        // 2. Get all approved (not applied) proposals
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var proposals = await db.CodeProposals
            .Where(p => p.Status == "approved" && !string.IsNullOrEmpty(p.SuggestedCode))
            .ToListAsync();

        if (proposals.Count == 0)
        {
            _log.Warn("maintenance", "没有待应用的提案");
            return new { success = false, message = "没有待应用的提案" };
        }

        _log.Info("maintenance", $"开始应用 {proposals.Count} 个提案: {string.Join(", ", proposals.Select(p => p.Title))}");

        // 3. Write all proposal code to disk
        var appliedFiles = new List<string>();
        var failedCount = 0;
        foreach (var p in proposals)
        {
            try
            {
                var fullPath = Path.GetFullPath(Path.Combine(ProjRoot, p.FilePath));
                var dir = Path.GetDirectoryName(fullPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                if (File.Exists(fullPath))
                {
                    p.OriginalCode = await File.ReadAllTextAsync(fullPath);
                    await File.WriteAllTextAsync(fullPath + ".bak", p.OriginalCode);
                }

                await File.WriteAllTextAsync(fullPath, p.SuggestedCode!);
                appliedFiles.Add(p.FilePath!);
                _log.Info("maintenance", $"写入文件: {p.FilePath} ({p.SuggestedCode!.Length} 字符)");
            }
            catch (Exception ex)
            {
                failedCount++;
                p.Status = "failed";
                p.ErrorMessage = $"写入失败: {ex.Message}";
                _log.Error("maintenance", $"写入 {p.FilePath} 失败", ex.Message);
            }
        }
        await db.SaveChangesAsync();

        // 4. Compile to temp output dir (avoids .exe lock from running process)
        _log.Info("maintenance", $"开始编译... 成功={appliedFiles.Count - failedCount} 文件, 失败={failedCount}");
        var tempOut = Path.Combine(Path.GetTempPath(), $"teamportal-build-{Guid.NewGuid():N}");
        var buildStart = DateTime.UtcNow;
        var buildResult = await RunCommand($"dotnet build src/TeamPortal/ -o \"{tempOut}\" --nologo", ProjRoot);
        var buildMs = (int)(DateTime.UtcNow - buildStart).TotalMilliseconds;
        var buildSuccess = !buildResult.Contains(": error ") && !buildResult.Contains("生成失败") && !buildResult.Contains("Build FAILED");

        // Clean temp
        if (Directory.Exists(tempOut)) { try { Directory.Delete(tempOut, true); } catch { } }

        if (buildSuccess)
        {
            _log.Info("maintenance", $"编译成功 ({buildMs}ms, {proposals.Count} 提案)");
            foreach (var p in proposals.Where(p => p.Status == "approved"))
            {
                p.Status = "applied";
                p.ErrorMessage = null;
            }
            await db.SaveChangesAsync();

            await RunCommand("git add -A");
            await RunCommand($"git commit -m \"apply: {proposals.Count} proposals — build OK\"");

            // Auto-restart: launch new process before exiting
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"timeout /t 2 /nobreak >nul && cd /d {ProjRoot} && dotnet run --project src/TeamPortal/\"",
                UseShellExecute = true,
                CreateNoWindow = false,
                WindowStyle = ProcessWindowStyle.Minimized
            };
            Process.Start(psi);
            _log.Info("maintenance", "New process launched, exiting current...");

            _ = Task.Run(async () => { await Task.Delay(500); Environment.Exit(0); });

            return new { success = true, message = $"编译成功({buildMs}ms)！{proposals.Count} 个提案已应用，服务将在3秒后自动重启...", files = appliedFiles };
        }
        else
        {
            var errSummary = ExtractBuildError(buildResult);
            _log.Error("maintenance", $"编译失败 ({buildMs}ms)", errSummary);

            foreach (var p in proposals)
            {
                p.Status = "failed";
                p.ErrorMessage = errSummary;
            }
            await db.SaveChangesAsync();

            await RunCommand("git checkout -- .");
            await RunCommand("git reset HEAD~1 --soft");
            _log.Warn("maintenance", "已回滚到编译前状态");

            return new
            {
                success = false,
                message = $"编译失败({buildMs}ms)，已自动回滚！",
                error = errSummary,
                fullOutput = buildResult[..Math.Min(3000, buildResult.Length)]
            };
        }
    }

    /// <summary>Rollback last applied change.</summary>
    public async Task<object> Rollback()
    {
        _log.Warn("maintenance", "↩️ 开始回滚...");
        var beforeCommit = (await RunCommand("git rev-parse HEAD")).Trim();
        _log.Info("maintenance", $"回滚前: {beforeCommit[..8]}");

        var result = await RunCommand("git reset --hard HEAD~1");
        await RunCommand("git clean -fd");
        var afterCommit = (await RunCommand("git rev-parse HEAD")).Trim();
        _log.Info("maintenance", $"回滚后: {afterCommit[..8]}");

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var applied = await db.CodeProposals.Where(p => p.Status == "applied").ToListAsync();
        foreach (var p in applied)
        {
            var fullPath = Path.GetFullPath(Path.Combine(ProjRoot, p.FilePath!));
            var bakPath = fullPath + ".bak";
            if (File.Exists(bakPath))
            {
                File.Move(bakPath, fullPath, overwrite: true);
                _log.Info("maintenance", $"恢复备份: {p.FilePath}");
            }
            p.Status = "reverted";
        }
        await db.SaveChangesAsync();

        _log.Warn("maintenance", $"回滚完成 — {applied.Count} 提案已恢复");

        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c \"timeout /t 2 /nobreak >nul && cd /d {ProjRoot} && dotnet run --project src/TeamPortal/\"",
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Minimized
        };
        Process.Start(psi);

        _ = Task.Run(async () => { await Task.Delay(500); Environment.Exit(0); });
        return new { success = true, message = $"已回滚 {applied.Count} 个提案，服务将自动重启。" };
    }

    private async Task<string> RunCommand(string command, string? workingDir = null)
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", $"/c {command}")
            {
                WorkingDirectory = workingDir ?? ProjRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            var proc = Process.Start(psi);
            if (proc is null) return "";
            var output = await proc.StandardOutput.ReadToEndAsync();
            var err = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            return output + err;
        }
        catch (Exception ex) { return $"Command failed: {ex.Message}"; }
    }

    private static string ExtractBuildError(string buildOutput)
    {
        var lines = buildOutput.Split('\n');
        // Match all error formats: CS (C#), MSB (MSBuild), CSC (compiler)
        var errors = lines.Where(l => l.Contains("error ") && (l.Contains(": error") || l.Contains("error CS") || l.Contains("error MSB"))).Take(8).ToList();
        if (errors.Count > 0) return string.Join("\n", errors);
        // Fallback: return tail of output
        var tail = lines.Where(l => !string.IsNullOrWhiteSpace(l)).TakeLast(20);
        return string.Join("\n", tail);
    }
}
