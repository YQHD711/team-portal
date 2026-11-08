/** 设备管理页共用的类型与格式化。 */

export interface DeviceRow {
  id: number;
  name: string;
  deviceKey: string;
  type: string;
  locationCode: string | null;
  firmwareVersion: string | null;
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  online: boolean;
}

export interface CreatedDevice extends DeviceRow {
  secret: string;
}

export interface TelemetryRow {
  id: number;
  kind: string;
  payloadJson: string;
  createdAt: string;
}

export const DEVICE_TYPES = ["esp32", "sensor", "gateway", "test", "other"];

export function formatTime(iso: string | null): string {
  if (!iso) return "从未";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
