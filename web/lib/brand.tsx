"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

/** 品牌配置 — 与后端 GET /api/public/brand 返回结构一致 */
export interface BrandConfig {
  teamName: string;
  teamSubtitle: string;
  systemTitle: string;
  description: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

/** 兜底默认值（接口失败/未返回时使用），与后端 SettingsService 默认值保持一致 */
const DEFAULT_BRAND: BrandConfig = {
  teamName: "雏鹰之翼",
  teamSubtitle: "航模队",
  systemTitle: "雏鹰之翼 · 航模队管理系统",
  description: "雏鹰之翼航模队 — 知识库、零件库存、飞行日志管理与AI助手",
  logoUrl: null,
  primaryColor: null,
};

const BrandContext = createContext<BrandConfig>(DEFAULT_BRAND);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND);

  useEffect(() => {
    // 公开端点，无需鉴权；失败时保持默认品牌文案
    api.get<BrandConfig>("/api/public/brand")
      .then(setBrand)
      .catch(() => {});
  }, []);

  return (
    <BrandContext.Provider value={brand}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}

// TODO: logoUrl / primaryColor 目前仅读取未应用 —
//   logoUrl 可注入 <link rel="icon"> 与各处 <img src>；primaryColor 可注入 CSS 变量 --brand-color 供 Tailwind 主题色使用
