namespace TeamPortal.Data.Models;

/// <summary>
/// 一次飞行日志诊断的记录（诊断历史）。
///
/// 为什么落库的是**摘要**而不是文档正文：解析与规则全在浏览器里跑，服务端拿不到 LogDocument；
/// 这里存的是"谁在什么时候诊断了哪个日志、结论是什么、解析是否完整"，
/// 用于日后回看（那次坠机当时工具报了什么）与同文件对比（复飞后严重数有没有下降）。
///
/// <see cref="WarningsJson"/> 存解析过程的非致命问题（跳字节/未知签名/字段解码失败），
/// <see cref="FindingsJson"/> 存每条结论的摘要（ruleId/title/severity/status/axis）。
/// </summary>
public class FlightDiagnosisRecord
{
    public int Id { get; set; }

    public string FileName { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public long Records { get; set; }
    /// <summary>解析时跳过的字节数（未知签名/坏记录）。&gt; 0 说明解析不完整。</summary>
    public long SkippedBytes { get; set; }
    public double DurationSec { get; set; }

    public string Vehicle { get; set; } = string.Empty;
    public string VehicleKind { get; set; } = string.Empty;
    public string FirmwareVersion { get; set; } = string.Empty;
    public int VersionNumeric { get; set; }

    public int ParseMs { get; set; }
    public int AnalyzeMs { get; set; }
    /// <summary>已解码消息类型数（"解析完整"的判据：应与 <see cref="TotalTypes"/> 相等）。</summary>
    public int DecodedTypes { get; set; }
    /// <summary>日志中出现的消息类型数。</summary>
    public int TotalTypes { get; set; }

    public int Critical { get; set; }
    public int Warning { get; set; }
    public int Passed { get; set; }
    public int Unknown { get; set; }

    /// <summary>解析警告原文（JSON 字符串数组，最多 20 条）。</summary>
    public string WarningsJson { get; set; } = "[]";
    /// <summary>结论摘要（JSON 数组）。</summary>
    public string FindingsJson { get; set; } = "[]";

    public int CreatedByUserId { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
