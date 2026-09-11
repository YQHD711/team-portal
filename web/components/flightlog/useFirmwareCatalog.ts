"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import {
  type FirmwareSourceInfo, type FirmwareVersion, type FirmwareBoard, type FirmwareAsset,
  type ItemList, pickDefaultAsset, boardMatches,
} from "@/lib/firmware";

export function msgOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 固件目录的级联状态机：来源 → 机型 → 版本 → 飞控板 → 文件，逐级拉取上游目录。 */
export function useFirmwareCatalog() {
  const [sources, setSources] = useState<FirmwareSourceInfo[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [versions, setVersions] = useState<FirmwareVersion[]>([]);
  const [versionId, setVersionId] = useState("");
  const [boards, setBoards] = useState<FirmwareBoard[]>([]);
  const [boardQuery, setBoardQuery] = useState("");
  const [board, setBoard] = useState("");
  const [assets, setAssets] = useState<FirmwareAsset[]>([]);
  const [asset, setAsset] = useState<FirmwareAsset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = sources.find(s => s.id === sourceId) ?? null;
  const needsVehicle = (active?.vehicles.length ?? 0) > 0;

  // 各 loader 的 setState 都放在 promise 回调里：effect 体内不同步 setState（避免级联渲染）
  const loadSources = () => {
    api
      .get<{ sources: FirmwareSourceInfo[] }>("/api/firmware/sources")
      .then(r => {
        setSources(r.sources);
        const first = r.sources[0];
        if (first) {
          setSourceId(first.id);
          setVehicle(first.vehicles[0]?.id ?? null);
        }
      })
      .catch(err => setError(msgOf(err, "固件来源加载失败")));
  };

  const loadVersions = () => {
    if (!sourceId || (needsVehicle && !vehicle)) return;
    const q = new URLSearchParams({ source: sourceId });
    if (vehicle) q.set("vehicle", vehicle);
    api
      .get<ItemList<FirmwareVersion>>(`/api/firmware/versions?${q}`)
      .then(r => {
        setVersions(r.items);
        setVersionId(r.items[0]?.id ?? "");
        setBoards([]);
        setBoard("");
        setAssets([]);
        setAsset(null);
      })
      .catch(err => setError(msgOf(err, "版本列表加载失败")));
  };

  const loadBoards = () => {
    if (!sourceId || !versionId) return;
    const q = new URLSearchParams({ source: sourceId, version: versionId });
    if (vehicle) q.set("vehicle", vehicle);
    api
      .get<ItemList<FirmwareBoard>>(`/api/firmware/boards?${q}`)
      .then(r => {
        setBoards(r.items);
        setBoardQuery("");
        setBoard("");
        setAssets([]);
        setAsset(null);
      })
      .catch(err => setError(msgOf(err, "飞控板列表加载失败")));
  };

  const loadAssets = () => {
    if (!sourceId || !versionId || !board) return;
    const q = new URLSearchParams({ source: sourceId, version: versionId, board });
    if (vehicle) q.set("vehicle", vehicle);
    api
      .get<ItemList<FirmwareAsset>>(`/api/firmware/assets?${q}`)
      .then(r => {
        setAssets(r.items);
        setAsset(pickDefaultAsset(r.items));
      })
      .catch(err => setError(msgOf(err, "固件文件列表加载失败")));
  };

  useEffect(() => { loadSources(); }, []);
  useEffect(() => { loadVersions(); }, [sourceId, vehicle]);
  useEffect(() => { loadBoards(); }, [sourceId, vehicle, versionId]);
  useEffect(() => { loadAssets(); }, [sourceId, vehicle, versionId, board]);

  return {
    sources, sourceId, setSourceId, active, needsVehicle,
    vehicle, setVehicle, versions, versionId, setVersionId,
    boards, shownBoards: boards.filter(b => boardMatches(b, boardQuery)), boardQuery, setBoardQuery,
    board, setBoard, assets, asset, setAsset, error, setError,
  };
}
