"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { Cpu, Loader2, Plus } from "lucide-react";
import { DeviceRowCard } from "@/components/device/DeviceRowCard";
import { DeviceSecretModal, type SecretInfo } from "@/components/device/DeviceSecretModal";
import { DEVICE_TYPES, type CreatedDevice, type DeviceRow, type TelemetryRow } from "@/components/device/deviceAdminTypes";

/** 设备管理（仅管理员）：创建设备、一次性密钥、启停、重置密钥、删除、看遥测。 */
export default function AdminDevicesPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const isAdmin = user?.role === "admin";

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("esp32");
  const [locationCode, setLocationCode] = useState("");
  const [firmwareVersion, setFirmwareVersion] = useState("");

  const [secretInfo, setSecretInfo] = useState<SecretInfo | null>(null);
  const [telemetry, setTelemetry] = useState<Record<number, TelemetryRow[]>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await api.get<DeviceRow[]>("/api/admin/devices"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void fetchAll();
  }, [isAdmin, fetchAll]);

  if (userLoading) return <div className="p-8 text-sm text-faint">加载中…</div>;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm text-muted">设备管理只允许管理员维护。</p>
        <Link href="/" className="mt-3 inline-block text-xs text-sky-600 hover:underline">返回首页</Link>
      </div>
    );
  }

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setName("");
    setType("esp32");
    setLocationCode("");
    setFirmwareVersion("");
  };

  const openCreate = () => { resetForm(); setShowForm(true); };

  const openEdit = (d: DeviceRow) => {
    setEditId(d.id);
    setName(d.name);
    setType(d.type);
    setLocationCode(d.locationCode ?? "");
    setFirmwareVersion(d.firmwareVersion ?? "");
    setShowForm(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editId) {
        await api.put(`/api/admin/devices/${editId}`, { name, type, locationCode: locationCode || null, firmwareVersion: firmwareVersion || null });
      } else {
        const created = await api.post<CreatedDevice>("/api/admin/devices", { name, type, locationCode: locationCode || null });
        setSecretInfo({ title: "设备已创建", deviceName: created.name, deviceKey: created.deviceKey, secret: created.secret });
      }
      resetForm();
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (d: DeviceRow) => {
    if (!confirm(`重置「${d.name}」的密钥？旧密钥会立即失效，设备需要重新配置。`)) return;
    setBusy(true);
    try {
      const res = await api.post<{ id: number; secret: string }>(`/api/admin/devices/${d.id}/rotate-secret`, {});
      setSecretInfo({ title: "密钥已重置", deviceName: d.name, deviceKey: d.deviceKey, secret: res.secret });
    } catch (e) {
      setError(e instanceof Error ? e.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (d: DeviceRow) => {
    setBusy(true);
    try {
      await api.put(`/api/admin/devices/${d.id}`, { enabled: !d.enabled });
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: DeviceRow) => {
    if (!confirm(`删除设备「${d.name}」？该设备的遥测记录会一并删除。`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/devices/${d.id}`);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const loadTelemetry = async (d: DeviceRow) => {
    if (telemetry[d.id]) {
      setTelemetry(prev => { const next = { ...prev }; delete next[d.id]; return next; });
      return;
    }
    try {
      const rows = await api.get<TelemetryRow[]>(`/api/admin/devices/${d.id}/telemetry?limit=20`);
      setTelemetry(prev => ({ ...prev, [d.id]: rows }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "遥测加载失败");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">设备管理</h1>
          <span className="text-xs text-faint">ESP32 / 扫码终端接入</span>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-white">
          <Plus className="h-4 w-4" />新增设备
        </button>
      </div>

      {error && <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      {showForm && (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="text-sm font-medium">{editId ? "编辑设备" : "新增设备"}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              设备名称
              <input value={name} onChange={e => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="如：电池柜1采集器" />
            </label>
            <label className="block text-xs font-medium">
              类型
              <select value={type} onChange={e => setType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium">
              库位/柜体编码（可选）
              <input value={locationCode} onChange={e => setLocationCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="CAB-01" />
            </label>
            {editId && (
              <label className="block text-xs font-medium">
                固件版本
                <input value={firmwareVersion} onChange={e => setFirmwareVersion(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="1.0.0" />
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="rounded-lg border border-border px-3 py-1.5 text-sm">取消</button>
            <button onClick={save} disabled={busy || !name.trim()}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>
      ) : devices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-faint">
          <Cpu className="mx-auto mb-3 h-10 w-10 opacity-40" />
          还没有设备。点右上角「新增设备」，创建后把 DeviceKey/Secret 填到设备终端。
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map(d => (
            <DeviceRowCard key={d.id} device={d} busy={busy} telemetry={telemetry[d.id]}
              onEdit={() => openEdit(d)}
              onRotate={() => void rotate(d)}
              onToggle={() => void toggleEnabled(d)}
              onTelemetry={() => void loadTelemetry(d)}
              onRemove={() => void remove(d)} />
          ))}
        </div>
      )}

      <DeviceSecretModal info={secretInfo} onClose={() => setSecretInfo(null)} />
    </div>
  );
}
