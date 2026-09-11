/** 固件下载的数据契约与纯函数工具（与后端 FirmwareEndpoints 对齐）。 */

export interface FirmwareVehicle {
  id: string;
  label: string;
}

export interface FirmwareSourceInfo {
  id: string;
  label: string;
  hint: string;
  vehicles: FirmwareVehicle[];
}

export interface FirmwareVersion {
  id: string;
  label: string;
  prerelease: boolean;
}

export interface FirmwareBoard {
  name: string;
  size: number | null;
}

export interface FirmwareAsset {
  name: string;
  kind: string;
  label: string;
  size: number | null;
}

export interface CachedFirmware {
  source: string;
  vehicle: string;
  version: string;
  board: string;
  fileName: string;
  size: number;
  modified: number;
}

export interface ItemList<T> {
  items: T[];
}

/** 人类可读体积；未知体积显示 — 而不是 0 B（0 会被误读成空文件）。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 组装下载地址；所有段一律编码，避免空格/特殊字符把查询串拆坏。 */
export function buildDownloadUrl(sel: {
  source: string;
  vehicle: string | null;
  version: string;
  board: string;
  asset: string;
}): string {
  const params = new URLSearchParams({
    source: sel.source,
    version: sel.version,
    board: sel.board,
    asset: sel.asset,
  });
  if (sel.vehicle) params.set("vehicle", sel.vehicle);
  return `/api/firmware/download?${params.toString()}`;
}

/** 默认选中最适合刷写的格式：APJ 优先，其次按后端排序取第一个。 */
export function pickDefaultAsset(assets: FirmwareAsset[]): FirmwareAsset | null {
  return assets.find(a => a.kind === "apj") ?? assets[0] ?? null;
}

/** 板子搜索：名字包含即命中（PX4 一个版本就有 400+ 块板子）。 */
export function boardMatches(board: FirmwareBoard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return board.name.toLowerCase().includes(q);
}
