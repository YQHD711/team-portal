"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { saveBlob } from "@/lib/download";
import { type FirmwareAsset, formatBytes, buildDownloadUrl } from "@/lib/firmware";
import { Download, Loader2, Search } from "lucide-react";
import { FirmwareCacheAdmin } from "./FirmwareCacheAdmin";
import { useFirmwareCatalog, msgOf } from "./useFirmwareCatalog";

const DOWNLOAD_TIMEOUT = 600000; // 10 分钟：首次下载要由服务器回源上游

const selectClass =
  "w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50";

/** 固件下载：来源 → 机型 → 版本 → 飞控板 → 文件，由服务端代理下载并落盘缓存。 */
export function FirmwarePanel() {
  const c = useFirmwareCatalog();
  const [busy, setBusy] = useState(false);
  const admin = isAdmin();

  const handleDownload = async () => {
    if (!c.asset || !c.versionId || !c.board) return;
    setBusy(true);
    c.setError(null);
    try {
      const url = buildDownloadUrl({
        source: c.sourceId, vehicle: c.vehicle, version: c.versionId, board: c.board, asset: c.asset.name,
      });
      saveBlob(await api.download(url, DOWNLOAD_TIMEOUT), c.asset.name);
    } catch (err) {
      c.setError(msgOf(err, "固件下载失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        服务器代理官方固件源。首个人下载时回源并缓存到本机，之后队员从内网缓存直接下载。
      </p>

      {c.error && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{c.error}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {c.sources.map(s => (
          <button
            key={s.id}
            onClick={() => {
              c.setSourceId(s.id);
              c.setVehicle(s.vehicles[0]?.id ?? null);
            }}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              s.id === c.sourceId ? "border-primary bg-primary/10 text-foreground" : "text-muted hover:bg-surface-hover"
            }`}
          >
            {s.label}
          </button>
        ))}
        {c.active && <span className="self-center text-xs text-faint">{c.active.hint}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {c.needsVehicle && (
          <label className="space-y-1">
            <span className="text-xs text-muted">机型</span>
            <select aria-label="机型" className={selectClass} value={c.vehicle ?? ""} onChange={e => c.setVehicle(e.target.value)}>
              {c.active?.vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        )}

        <label className="space-y-1">
          <span className="text-xs text-muted">版本</span>
          <select aria-label="版本" className={selectClass} value={c.versionId} onChange={e => c.setVersionId(e.target.value)}>
            {c.versions.length === 0 && <option value="">加载中…</option>}
            {c.versions.map(v => (
              <option key={v.id} value={v.id}>{v.label}{v.prerelease ? "（预发布）" : ""}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted">飞控板（共 {c.boards.length} 块）</span>
          <select aria-label="飞控板" className={selectClass} value={c.board} onChange={e => c.setBoard(e.target.value)}>
            <option value="">请选择飞控板</option>
            {c.shownBoards.map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input
          aria-label="搜索飞控板"
          placeholder="搜索飞控板，如 Pixhawk6X / fmu-v6x"
          value={c.boardQuery}
          onChange={e => c.setBoardQuery(e.target.value)}
          className="w-full rounded-lg border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      <AssetList assets={c.assets} selected={c.asset} onSelect={c.setAsset} />

      <button
        onClick={handleDownload}
        disabled={!c.asset || busy}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        下载固件
      </button>

      {admin && c.active && <FirmwareCacheAdmin sourceLabel={c.active.label} />}
    </div>
  );
}

function AssetList({
  assets, selected, onSelect,
}: {
  assets: FirmwareAsset[];
  selected: FirmwareAsset | null;
  onSelect: (a: FirmwareAsset) => void;
}) {
  return (
    <div className="rounded-xl border bg-surface divide-y">
      {assets.length === 0 ? (
        <p className="p-6 text-center text-sm text-faint">选择飞控板后显示可下载的固件文件</p>
      ) : (
        assets.map(a => (
          <label key={a.name} className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-surface-hover">
            <span className="flex items-center gap-3 min-w-0">
              <input
                type="radio"
                name="firmware-asset"
                aria-label={a.name}
                checked={selected?.name === a.name}
                onChange={() => onSelect(a)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{a.name}</span>
                <span className="block text-xs text-faint">{a.label}</span>
              </span>
            </span>
            <span className="shrink-0 text-xs text-faint">{formatBytes(a.size)}</span>
          </label>
        ))
      )}
    </div>
  );
}
