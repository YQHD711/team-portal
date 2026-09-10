"use client";

/**
 * 低库存阈值/提醒等级的唯一前端来源：由后端 `GET /api/inventory/meta` 下发
 * （后端取值来自设置页 Inventory:LowStockThreshold / LowStockGrade）。
 * 仪表盘配色、库存页横幅与表格、物料布局格位配色都读这里，不再各自硬编码。
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";

/** 后端种子值，接口返回前先用它，避免首帧闪烁 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const DEFAULT_LOW_STOCK_GRADE = "C";

interface LowStockState {
  /** 低库存阈值：数量 < threshold 视为库存不足 */
  threshold: number;
  /** 仪表盘「低库存提醒」限定等级（库存页不过滤等级） */
  grade: string;
  /** 是否拿到过后端下发值 */
  loaded: boolean;
}

interface MetaResponse {
  lowStockThreshold?: number;
  lowStockGrade?: string;
}

const LowStockContext = createContext<LowStockState>({
  threshold: DEFAULT_LOW_STOCK_THRESHOLD,
  grade: DEFAULT_LOW_STOCK_GRADE,
  loaded: false,
});

export function LowStockProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LowStockState>({
    threshold: DEFAULT_LOW_STOCK_THRESHOLD,
    grade: DEFAULT_LOW_STOCK_GRADE,
    loaded: false,
  });

  useEffect(() => {
    let alive = true;
    api.get<MetaResponse>("/api/inventory/meta")
      .then(meta => {
        if (!alive) return;
        const threshold = Number(meta?.lowStockThreshold);
        setState({
          threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_LOW_STOCK_THRESHOLD,
          grade: meta?.lowStockGrade || DEFAULT_LOW_STOCK_GRADE,
          loaded: true,
        });
      })
      .catch(() => { /* 拿不到就用兜底值，界面不阻塞 */ });
    return () => { alive = false; };
  }, []);

  return <LowStockContext.Provider value={state}>{children}</LowStockContext.Provider>;
}

/** 读取低库存规则（无 Provider 时返回兜底值，便于组件单测） */
export function useLowStock(): LowStockState {
  return useContext(LowStockContext);
}
