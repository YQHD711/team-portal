"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { defaultText } from "@/lib/copy/catalog";
import { TOURS } from "@/lib/tours/registry";
import { mergeTour, type GuideOverride } from "@/lib/tours/merge";
import type { TourDef } from "@/lib/tours/types";

interface ContentValue {
  /** 数据库里的文案覆盖值：key → value（未覆盖的 key 不出现） */
  overrides: Record<string, string>;
  /** 数据库里的引导覆盖；后端只下发启用的 */
  guideOverrides: Record<string, GuideOverride>;
  /** 保存文案/引导后调用：立即让当前会话生效 */
  refresh: () => Promise<void>;
}

const ContentContext = createContext<ContentValue>({
  overrides: {},
  guideOverrides: {},
  refresh: async () => {},
});

/**
 * 内容层 Provider：把服务端的文案与引导覆盖拉下来，页面用 useCopy / useTourDefs 消费。
 *
 * 拉取失败一律静默用默认值——文案接口挂了不能影响登录页渲染。
 */
export function ContentProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [guideOverrides, setGuideOverrides] = useState<Record<string, GuideOverride>>({});

  const refresh = useCallback(async () => {
    try {
      const texts = await api.get<Record<string, string>>("/api/content/texts");
      setOverrides(texts ?? {});
    } catch {
      setOverrides({});
    }
    // 引导需要登录；未登录时接口 401，静默跳过
    try {
      const rows = await api.get<GuideOverride[]>("/api/content/guides");
      const map: Record<string, GuideOverride> = {};
      for (const row of rows) map[row.tourKey] = row;
      setGuideOverrides(map);
    } catch {
      setGuideOverrides({});
    }
  }, []);

  useEffect(() => {
    // 首帧先用默认值渲染，挂载后再拉覆盖：避免 SSR/客户端首帧不一致
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ overrides, guideOverrides, refresh }),
    [overrides, guideOverrides, refresh],
  );

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

/** 取文案：数据库覆盖 → 代码默认值 → 调用方兜底 → key 本身 */
export function useCopy(): (key: string, fallback?: string) => string {
  const { overrides } = useContext(ContentContext);
  return useCallback(
    (key: string, fallback?: string) => overrides[key] ?? defaultText(key) ?? fallback ?? key,
    [overrides],
  );
}

/** 合并后的引导定义（代码默认 + 后台覆盖） */
export function useTourDefs(): TourDef[] {
  const { guideOverrides } = useContext(ContentContext);
  return useMemo(
    () => TOURS.map((def) => mergeTour(def, guideOverrides[def.key])),
    [guideOverrides],
  );
}

/** 让管理页保存后能立刻刷新内容（不暴露整块 context，避免误用） */
export function useContentRefresh(): () => Promise<void> {
  return useContext(ContentContext).refresh;
}
