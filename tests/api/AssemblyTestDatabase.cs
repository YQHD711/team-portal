using System.Runtime.CompilerServices;

namespace api;

/// <summary>
/// 测试库的装配级初始化：让每次 `dotnet test` 从一份全新的 SQLite 库开始。
///
/// 为什么需要（实测结论）：
///  - 测试里的 `UseSetting("ConnectionStrings:DefaultConnection", …)` **不会落到应用配置**（不是缓存问题，
///    是注入通道失效：三个 host 传三个不同路径，生效连接串三次都是 appsettings 的默认值）。
///  - 于是所有测试其实共用 `tests/api/bin/data/teamportal.db`。多个 host 各自启动一次迁移，
///    会把 `AddStorageLayoutVersion` 里的 `ADD COLUMN UpdatedBy` 应用两次 → `duplicate column name: UpdatedBy`。
///  - **进程级环境变量能落地**（实测 `effective == expectedFromEnv`），所以这里指向本次运行独有的临时库。
/// </summary>
internal static class AssemblyTestDatabase
{
    /// <summary>本次运行独占目录（备份目录由 dbPath 推导 = &lt;dir&gt;/backups/db，独占目录里没有旧备份）</summary>
    public static readonly string Dir =
        System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"tp-testrun-{Guid.NewGuid():N}");

    public static readonly string Path = System.IO.Path.Combine(Dir, "teamportal.db");

    [ModuleInitializer]
    internal static void Initialize()
    {
        // ⚠️ 关键：BackupService.CheckAndRecoverOnStartup() 在 Migrate() **之前**跑，触发条件是
        // `!File.Exists(_dbPath)` → 测试用一个"还不存在"的新库路径，就会触发**从备份恢复**，
        // 把一份较新 schema 的备份（已含 StorageLayouts.UpdatedBy）恢复进来，随后 Migrate() 再
        // ADD COLUMN → `duplicate column name: UpdatedBy`。BackupService 没有 AutoRecover 开关
        // （备份目录由 dbPath 推导），所以测试侧唯一干净的做法：**先建一个合法空库**，
        // 让恢复逻辑判定"库存在且健康"而跳过，再由 Migrate() 正常建表。
        System.IO.Directory.CreateDirectory(Dir);
        Environment.SetEnvironmentVariable("ConnectionStrings__DefaultConnection", $"Data Source={Path}");
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                try { File.Delete(Path + suffix); } catch { /* 尽力而为 */ }
            }
        };
    }
}
