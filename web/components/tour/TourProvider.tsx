"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/lib/hooks";
import { tourForPath, visibleSteps } from "@/lib/tours/registry";
import { useTourDefs } from "@/components/content/ContentProvider";
import {
  fetchRemote, readCache, resetRemote, saveRemote, writeCache,
  type TourProgress, type TourStatus,
} from "@/lib/tours/progress";
import type { TourDef, TourStep } from "@/lib/tours/types";
import { TourOverlay } from "./TourOverlay";

export interface ActiveTour {
  tour: TourDef;
  steps: TourStep[];
  index: number;
}

interface TourCtx {
  active: ActiveTour | null;
  /** 手动开始某条引导（引导中心/帮助按钮） */
  start: (key: string) => void;
  /** 关闭当前引导（记为跳过） */
  stop: () => void;
  /** 重置进度：不传 key = 全部重置 */
  reset: (key?: string) => Promise<void>;
  progress: Record<string, TourProgress>;
}

const TourContext = createContext<TourCtx>({
  active: null,
  start: () => {},
  stop: () => {},
  reset: async () => {},
  progress: {},
});

export function useTour(): TourCtx {
  return useContext(TourContext);
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 640;
}

/** 角色可见步骤 + 移动端剔除「仅桌面」步骤（侧栏在移动端是抽屉，导航目标不存在） */
function stepsFor(def: TourDef, role: string | null): TourStep[] {
  const steps = visibleSteps(def, role);
  return isMobileViewport() ? steps.filter((s) => !s.desktopOnly) : steps;
}

/**
 * 引导运行时：自动触发、步骤推进、进度持久化。
 *
 * 自动触发条件：当前路径命中某条引导 && 该引导没有 done/skipped 记录 && 本次会话还没自动弹过。
 * 已经完成或被跳过的人不会再被打扰，但可以随时从引导中心/顶栏「?」重看。
 */
export function TourProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser();
  const pathname = usePathname();
  const tours = useTourDefs();
  const [progress, setProgress] = useState<Record<string, TourProgress>>({});
  const [ready, setReady] = useState(false);
  /** 服务端进度是否成功加载：拿不到就不自动弹（手动重看不受影响） */
  const [remoteOk, setRemoteOk] = useState(false);
  const [active, setActive] = useState<ActiveTour | null>(null);
  const autoStarted = useRef<Set<string>>(new Set());

  // 进度：本地缓存先上屏，服务端再校正（跨设备以服务端为准）
  useEffect(() => {
    if (!user) {
      setProgress({});
      setReady(true);
      return;
    }
    setProgress(readCache(user.id));
    fetchRemote()
      .then((remote) => {
        setProgress(remote);
        writeCache(user.id, remote);
        setRemoteOk(true);
      })
      .catch(() => { /* 离线/接口异常：沿用本地缓存，但不自动弹引导 */ })
      .finally(() => setReady(true));
  }, [user]);

  const persist = useCallback((tour: TourDef, status: TourStatus, stepIndex: number) => {
    if (!user) return;
    const entry: TourProgress = { status, stepIndex, version: tour.version };
    setProgress((prev) => {
      const map = { ...prev, [tour.key]: entry };
      writeCache(user.id, map);
      return map;
    });
    void saveRemote(tour.key, entry);
  }, [user]);

  const start = useCallback((key: string) => {
    const def = tours.find((t) => t.key === key);
    if (!def || !user) return;
    const steps = stepsFor(def, user.role);
    if (steps.length === 0) return;
    autoStarted.current.add(key);
    setActive({ tour: def, steps, index: 0 });
    persist(def, "in_progress", 0);
  }, [tours, user, persist]);

  const stop = useCallback(() => {
    if (active) persist(active.tour, "skipped", active.index);
    setActive(null);
  }, [active, persist]);

  const next = useCallback(() => {
    if (!active) return;
    const index = active.index + 1;
    if (index >= active.steps.length) {
      persist(active.tour, "done", active.index);
      setActive(null);
      return;
    }
    persist(active.tour, "in_progress", index);
    setActive({ ...active, index });
  }, [active, persist]);

  const prev = useCallback(() => {
    if (!active || active.index === 0) return;
    const index = active.index - 1;
    persist(active.tour, "in_progress", index);
    setActive({ ...active, index });
  }, [active, persist]);

  const reset = useCallback(async (key?: string) => {
    try {
      await resetRemote(key);
    } catch {
      return;
    }
    setProgress((prev) => {
      if (!key) {
        writeCache(user?.id ?? 0, {});
        return {};
      }
      const map = { ...prev };
      delete map[key];
      writeCache(user?.id ?? 0, map);
      return map;
    });
  }, [user]);

  // 自动触发：延迟 600ms，给页面数据与骨架屏留出渲染时间
  useEffect(() => {
    if (loading || !ready || !remoteOk || !user || active) return;
    const timer = setTimeout(() => {
      const def = tourForPath(pathname, user.role, tours);
      if (!def || autoStarted.current.has(def.key)) return;
      const saved = progress[def.key];
      if (saved && (saved.status === "done" || saved.status === "skipped")) return;
      const steps = stepsFor(def, user.role);
      if (steps.length === 0) return;
      autoStarted.current.add(def.key);
      const resume = saved?.status === "in_progress" ? Math.min(saved.stepIndex, steps.length - 1) : 0;
      setActive({ tour: def, steps, index: resume });
    }, 600);
    return () => clearTimeout(timer);
  }, [loading, ready, remoteOk, user, pathname, tours, progress, active]);

  return (
    <TourContext.Provider value={{ active, start, stop, reset, progress }}>
      {children}
      {active && <TourOverlay active={active} onNext={next} onPrev={prev} onClose={stop} />}
    </TourContext.Provider>
  );
}
