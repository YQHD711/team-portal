import { api } from "@/lib/api";

/** 引导状态：进行中 / 完成 / 跳过（跳过的人不该被反复打扰，但仍可重看） */
export type TourStatus = "in_progress" | "done" | "skipped";

export interface TourProgress {
  status: TourStatus;
  stepIndex: number;
  version: number;
}

type ProgressMap = Record<string, TourProgress>;

const CACHE_PREFIX = "tp.tours.v1.";

/** localStorage 缓存按用户隔离：共用电脑换账号登录不会串进度 */
function cacheKey(userId: number): string {
  return CACHE_PREFIX + userId;
}

export function readCache(userId: number): ProgressMap {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isProgressMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCache(userId: number, map: ProgressMap): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(map));
  } catch {
    // 隐私模式 / 配额满：缓存失败不影响功能，下次会重新拉服务端
  }
}

function isProgressMap(value: unknown): value is ProgressMap {
  if (typeof value !== "object" || value === null) return false;
  for (const p of Object.values(value as Record<string, unknown>)) {
    if (typeof p !== "object" || p === null) return false;
    const item = p as Record<string, unknown>;
    if (item.status !== "in_progress" && item.status !== "done" && item.status !== "skipped") return false;
    if (typeof item.stepIndex !== "number" || typeof item.version !== "number") return false;
  }
  return true;
}

/**
 * 拉服务端进度（真源）。
 *
 * 形状不对（代理/自定义 mock 返回对象而非数组）也按失败处理：
 * 调用方据此判断"拿不到进度"，从而不自动弹引导——宁可少弹一次，也不要在
 * 接口异常时把遮罩糊到用户脸上。
 */
export async function fetchRemote(): Promise<ProgressMap> {
  const data: unknown = await api.get("/api/me/tours");
  if (!Array.isArray(data)) throw new Error("unexpected /api/me/tours response");
  const rows = data as { tourKey: string; status: TourStatus; stepIndex: number; version: number }[];
  const map: ProgressMap = {};
  for (const row of rows) {
    map[row.tourKey] = { status: row.status, stepIndex: row.stepIndex, version: row.version };
  }
  return map;
}

/** 上报进度：失败只记日志，不打断引导（离线/后端抖动不应让引导卡住） */
export async function saveRemote(key: string, progress: TourProgress): Promise<void> {
  try {
    await api.put(`/api/me/tours/${key}`, progress);
  } catch {
    // 忽略：下一次步骤切换会再次上报，最终以服务端为准
  }
}

/** 重置单条或全部 */
export async function resetRemote(key?: string): Promise<void> {
  await api.delete(key ? `/api/me/tours/${key}` : "/api/me/tours");
}
