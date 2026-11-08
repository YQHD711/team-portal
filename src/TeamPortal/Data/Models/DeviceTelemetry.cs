namespace TeamPortal.Data.Models;

/// <summary>
/// 设备上报的原始遥测/事件。PayloadJson 原样保存设备发来的 JSON，
/// 不做结构化解析——先保证"数据能落库、能回放"，字段语义由设备侧约定。
/// </summary>
public class DeviceTelemetry
{
    public int Id { get; set; }

    public int DeviceId { get; set; }

    /// <summary>telemetry / heartbeat / scan / stock 等，由设备声明。</summary>
    public string Kind { get; set; } = "telemetry";

    public string PayloadJson { get; set; } = "{}";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Device? Device { get; set; }
}
