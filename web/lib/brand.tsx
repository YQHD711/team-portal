"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

/** 品牌配置 — 与后端 GET /api/public/brand 返回结构一致 */
export interface BrandConfig {
  teamName: string;
  teamSubtitle: string;
  systemTitle: string;
  description: string;
  logoUrl: string | null;
  primaryColor: string | null;
  theme: string; // indigo | sky | light | warm
}

/** 兜底默认值（接口失败/未返回时使用），与后端 SettingsService 默认值保持一致 */
const DEFAULT_BRAND: BrandConfig = {
  teamName: "雏鹰之翼",
  teamSubtitle: "航模队",
  systemTitle: "雏鹰之翼 · 航模队管理系统",
  description: "雏鹰之翼航模队 — 知识库、零件库存、飞行日志管理与AI助手",
  logoUrl: null,
  primaryColor: null,
  theme: "indigo",
};

const THEMES = ["indigo", "sky", "light", "warm"] as const;

/** 应用主题：设置 <html data-theme> 触发 globals.css 的多套配色变量 */
function applyTheme(brand: BrandConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = THEMES.includes(brand.theme as (typeof THEMES)[number])
    ? brand.theme
    : "indigo";
  root.setAttribute("data-theme", theme);

  // 管理员自定义主色：覆盖主题默认主色（--primary/--accent 及其派生色）
  if (brand.primaryColor) {
    root.style.setProperty("--primary", brand.primaryColor);
    root.style.setProperty("--accent", brand.primaryColor);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--accent");
  }
}

/** 品牌配置 + 强制刷新方法（合并进 context，useBrand 解构字段时保持兼容） */
export interface BrandContextValue extends BrandConfig {
  /** 重新拉取品牌配置并应用主题（管理员保存主题/主色后调用） */
  refresh: () => void;
}

const BrandContext = createContext<BrandContextValue>({
  ...DEFAULT_BRAND,
  refresh: () => {},
});

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND);

  const load = useCallback(async () => {
    // 公开端点，无需鉴权；失败时保持默认品牌文案 + 默认主题
    try {
      const b = await api.get<BrandConfig>("/api/public/brand");
      setBrand(b);
      applyTheme(b);
    } catch {}
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 强制刷新：管理员在设置页保存主题/主色后调用，让全局配色立即生效
  const refresh = useCallback(() => {
    void load();
  }, [load]);

  // 合并 brand 字段与 refresh，保持 useBrand() 解构 ({teamName} 等) 兼容
  const value = useMemo<BrandContextValue>(
    () => ({ ...brand, refresh }),
    [brand, refresh]
  );

  return (
    <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}

// TODO: logoUrl 目前仅读取未应用 — 可注入 <link rel="icon"> 与各处 <img src>。
// primaryColor 已通过 applyTheme 注入 CSS 变量 --primary/--accent 生效。