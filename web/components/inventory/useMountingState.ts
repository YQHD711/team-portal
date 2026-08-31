/** 物料挂载状态：加载房间物料、挂载/卸下（PUT locationCode）、连线锚点与数据 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { buildConnectionLines, type ConnectionLine, type LineEnd } from "./ConnectionLines";

/** 连线视图共享状态（编辑器与查看器复用）：锚点由面板/画布上报，汇总成线数据 */
export function useMountingView(items: MaterialItem[], elements: ItemElement[]) {
  const [itemAnchors, setItemAnchors] = useState<Map<number, LineEnd>>(new Map());
  const [cellCenters, setCellCenters] = useState<Map<string, LineEnd>>(new Map());
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const lines = useMemo(
    () => buildConnectionLines(items, elements, itemAnchors, cellCenters),
    [items, elements, itemAnchors, cellCenters]
  );
  return { itemAnchors, setItemAnchors, cellCenters, setCellCenters, hoverKey, setHoverKey, lines };
}

/** 编辑器物料状态：加载房间物料 + 挂载/卸下 */
export function useMountingState(roomCode: string, elements: ItemElement[]) {
  const [items, setItems] = useState<MaterialItem[]>([]);

  useEffect(() => {
    api
      .get<{ locationCode: string; items: MaterialItem[] }[]>(`/api/storage/layouts/${roomCode}/items`)
      .then(groups => setItems(groups.flatMap(g => g.items)))
      .catch(() => setItems([]));
  }, [roomCode]);

  /** 挂载/卸下：PUT locationCode（其余字段不传，后端不覆盖）；按响应局部更新；返回是否成功 */
  const applyLocation = useCallback(async (id: number, locationCode: string): Promise<boolean> => {
    try {
      const updated = await api.put<MaterialItem>(`/api/inventory/${id}`, { locationCode });
      setItems(prev => prev.map(it => (it.id === id ? updated : it)));
      return true;
    } catch {
      return false;
    }
  }, []);

  const view = useMountingView(items, elements);
  return { items, applyLocation, ...view };
}
