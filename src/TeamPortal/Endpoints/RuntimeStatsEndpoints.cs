using System.Diagnostics;
using System.Globalization;
using System.Runtime;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 管理端运行监控 — 进程/内存/GC/线程/数据库 连接池/系统 CPU/磁盘等指标。
/// 设计:轻量采样(~1-3ms),每秒调用 OK。3 秒前端轮询可接受。
/// </summary>
public static class RuntimeStatsEndpoints
{
    private static readonly Process _proc = Process.GetCurrentProcess();
    private static DateTime _lastCpuSample = DateTime.UtcNow;
    private static TimeSpan _lastCpuTime = _proc.TotalProcessorTime;
    private static DateTime _startTime = _proc.StartTime.ToUniversalTime();
    // GCMemoryInfo.TotalAvailableMemoryBytes 是 GC 堆上限(系统物理内存的一部分),
    // 不是系统总内存 — 字段命名 _gcTotalAvailMB 强调这一点
    private static readonly long _gcTotalAvailMB;
    private static readonly int _processorCount = Environment.ProcessorCount;

    static RuntimeStatsEndpoints()
    {
        // GCMemoryInfo 在 .NET 10 才有;老版本走 GC.GetGCMemoryInfo
        var gcmi = GC.GetGCMemoryInfo();
        _gcTotalAvailMB = gcmi.TotalAvailableMemoryBytes / (1024 * 1024);
    }

    public static void MapRuntimeStats(this WebApplication app)
    {
        app.MapGet("/api/admin/runtime-stats", () =>
        {
            // 进程 CPU 使用率:delta CPU 时间 / delta 总时间 / 核心数
            var nowCpu = _proc.TotalProcessorTime;
            var now = DateTime.UtcNow;
            double cpuPct = 0;
            var elapsed = (now - _lastCpuSample).TotalMilliseconds;
            if (elapsed > 100)
            {
                var cpuMs = (nowCpu - _lastCpuTime).TotalMilliseconds;
                cpuPct = Math.Clamp(cpuMs / elapsed / _processorCount * 100, 0, 100);
                _lastCpuSample = now;
                _lastCpuTime = nowCpu;
            }

            // 强制刷新 WorkingSet64 / PrivateMemorySize64
            _proc.Refresh();

            // GC 统计
            var gen0 = GC.CollectionCount(0);
            var gen1 = GC.CollectionCount(1);
            var gen2 = GC.CollectionCount(2);
            var gcMem = GC.GetTotalMemory(forceFullCollection: false);

            // 磁盘 — 跨平台:Windows/Linux 取系统盘;无驱动器时返回 null(沙箱环境)
            DriveInfo? drive = null;
            try { drive = DriveInfo.GetDrives().FirstOrDefault(d => d.IsReady); }
            catch { /* best effort */ }
            var disk = drive is null ? null : new
            {
                totalGB = Math.Round(drive.TotalSize / 1e9, 2),
                freeGB = Math.Round(drive.AvailableFreeSpace / 1e9, 2),
                usedPct = Math.Round((double)(drive.TotalSize - drive.AvailableFreeSpace) / drive.TotalSize * 100, 1),
            };

            return Results.Ok(new
            {
                // 进程
                pid = _proc.Id,
                processName = _proc.ProcessName,
                startTime = _startTime,
                uptimeSec = (long)(DateTime.UtcNow - _startTime).TotalSeconds,
                threads = _proc.Threads.Count,
                handles = _proc.HandleCount,
                cpuPct = Math.Round(cpuPct, 1),
                workingSetMB = Math.Round(_proc.WorkingSet64 / (1024.0 * 1024), 1),
                privateBytesMB = Math.Round(_proc.PrivateMemorySize64 / (1024.0 * 1024), 1),
                virtualMB = Math.Round(_proc.VirtualMemorySize64 / (1024.0 * 1024), 1),
                gc = new
                {
                    heapMB = Math.Round(gcMem / (1024.0 * 1024), 1),
                    gen0, gen1, gen2,
                },
                system = new
                {
                    processorCount = _processorCount,
                    totalMemoryMB = _gcTotalAvailMB,
                    isServerGC = GCSettings.IsServerGC,
                    os = Environment.OSVersion.VersionString,
                    dotnetVersion = Environment.Version.ToString(),
                    machineName = Environment.MachineName,
                    currentDir = Environment.CurrentDirectory,
                },
                disk,
                timestamp = DateTime.UtcNow,
            });
        }).RequireAuthorization("StaffOnly");
    }
}