"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createTemplate, deleteTemplate, fetchTemplates, saveTemplate, setDefaultTemplate,
} from "@/lib/labelTemplatesApi";
import { clampRect } from "@/lib/labelGeometry";
import { DEFAULT_TEMPLATE, type LabelElement, type LabelTemplate } from "@/lib/labelTemplate";

let seq = 0;
const newId = () => `el${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * 设计器的状态与动作（渲染都在组件里）：
 * - templates 列表 + 当前编辑的 template（工作副本）+ 选中元素
 * - 所有几何改动都过 `clampRect`（页面缩放时也重新夹一遍，保证"元素永远在页面内"）
 * - 「设为默认」只发一次请求，成功后**本地同步**（不靠重新拉全量掩盖不一致）
 */
export function useLabelDesigner({ enabled = true }: { enabled?: boolean } = {}) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([DEFAULT_TEMPLATE]);
  const [template, setTemplate] = useState<LabelTemplate>(DEFAULT_TEMPLATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error" | "ok"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }   // 非管理员：连列表都不拉
    let cancelled = false;
    fetchTemplates().then(res => {
      if (cancelled) return;
      setTemplates(res.templates);
      const first = res.templates.find(t => t.isDefault) ?? res.templates[0];
      setTemplate(first);
      setSelectedId(first.elements[0]?.id ?? null);
      setDegraded(res.degraded);
      if (res.degraded) setNotice({ kind: "info", text: res.message ?? "模板接口不可用，已用内置默认模板" });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [enabled]);

  /** 改当前模板（页面尺寸变化时把所有元素重新夹进新页面） */
  const patchTemplate = useCallback((patch: Partial<LabelTemplate>) => {
    setTemplate(prev => {
      const next = { ...prev, ...patch };
      const page = { widthMm: next.widthMm, heightMm: next.heightMm };
      next.elements = prev.elements.map(e => ({ ...e, ...clampRect(e, page) }));
      return next;
    });
    setDirty(true);
  }, []);

  const patchElement = useCallback((id: string, patch: Partial<LabelElement>) => {
    setTemplate(prev => {
      const page = { widthMm: prev.widthMm, heightMm: prev.heightMm };
      return {
        ...prev,
        elements: prev.elements.map(e => {
          if (e.id !== id) return e;
          const merged = { ...e, ...patch };
          return { ...merged, ...clampRect(merged, page) };
        }),
      };
    });
    setDirty(true);
  }, []);

  /** 几何改动（拖拽/缩放）只改 x/y/w/h —— 已在 labelGeometry 里吸附并夹取 */
  const setElementRect = useCallback((id: string, rect: { x: number; y: number; w: number; h: number }) => {
    setTemplate(prev => ({ ...prev, elements: prev.elements.map(e => (e.id === id ? { ...e, ...rect } : e)) }));
    setDirty(true);
  }, []);

  const addElement = useCallback((type: "qr" | "text") => {
    const id = newId();
    setTemplate(prev => {
      const page = { widthMm: prev.widthMm, heightMm: prev.heightMm };
      const base: LabelElement = type === "qr"
        ? { id, type, x: 2, y: 2, w: 24, h: 24, quietMm: 3 }
        : { id, type, x: 32, y: 6, w: 40, h: 6, field: "name", fontSizePt: 10, fontWeight: 400, fontFamily: "sans", color: "#111111", align: "center", autoShrink: true };
      return { ...prev, elements: [...prev.elements, { ...base, ...clampRect(base, page) }] };
    });
    setSelectedId(id);
    setDirty(true);
  }, []);

  const deleteElement = useCallback((id: string) => {
    setTemplate(prev => ({ ...prev, elements: prev.elements.filter(e => e.id !== id) }));
    setSelectedId(prev => (prev === id ? null : prev));
    setDirty(true);
  }, []);

  const duplicateElement = useCallback((id: string) => {
    setTemplate(prev => {
      const src = prev.elements.find(e => e.id === id);
      if (!src) return prev;
      const copy: LabelElement = { ...src, id: newId(), x: src.x + 1, y: src.y + 1 };
      return { ...prev, elements: [...prev.elements, { ...copy, ...clampRect(copy, { widthMm: prev.widthMm, heightMm: prev.heightMm }) }] };
    });
    setDirty(true);
  }, []);

  const selectTemplate = useCallback((t: LabelTemplate) => {
    setTemplate(t);
    setSelectedId(t.elements[0]?.id ?? null);
    setDirty(false);
  }, []);

  const replaceInList = (saved: LabelTemplate) =>
    setTemplates(prev => prev.map(t => (t.id === saved.id ? saved : t)));

  const save = useCallback(async () => {
    try {
      const saved = await saveTemplate(template);
      setTemplate(saved); replaceInList(saved); setDirty(false);
      setDegraded(false);
      setNotice({ kind: "ok", text: `已保存「${saved.name}」` });
    } catch (err) {
      setNotice({ kind: "error", text: `保存失败：${err instanceof Error ? err.message : "未知错误"}` });
    }
  }, [template]);

  const create = useCallback(async () => {
    try {
      const created = await createTemplate({ ...template, id: 0, name: `${template.name} 副本`, isDefault: false });
      setTemplates(prev => [...prev, created]);
      setTemplate(created);
      setSelectedId(created.elements[0]?.id ?? null);
      setNotice({ kind: "ok", text: `已新建「${created.name}」` });
    } catch (err) {
      setNotice({ kind: "error", text: `新建失败：${err instanceof Error ? err.message : "未知错误"}` });
    }
  }, [template]);

  const remove = useCallback(async (id: number) => {
    try {
      await deleteTemplate(id);
      const rest = templates.filter(t => t.id !== id);
      // 删掉的若是默认模板：本地把第一个顶上（服务端也会保证"永远有默认"，这里不制造不一致）
      const next = rest.map((t, i) => (t.isDefault || (i === 0 && !rest.some(r => r.isDefault)) ? { ...t, isDefault: true } : t));
      setTemplates(next);
      if (template.id === id && next[0]) selectTemplate(next[0]);
      setNotice({ kind: "ok", text: "已删除" });
    } catch (err) {
      setNotice({ kind: "error", text: `删除失败：${err instanceof Error ? err.message : "未知错误"}` });
    }
  }, [templates, template.id, selectTemplate]);

  /** 设为默认：**只发一次请求**，成功后本地把这一项置默认、其余全部取消（默认标识唯一） */
  const makeDefault = useCallback(async (id: number) => {
    try {
      await setDefaultTemplate(id);
      setTemplates(prev => prev.map(t => ({ ...t, isDefault: t.id === id })));
      setTemplate(prev => (prev.id === id ? { ...prev, isDefault: true } : { ...prev, isDefault: false }));
      setNotice({ kind: "ok", text: "已设为默认模板" });
    } catch (err) {
      setNotice({ kind: "error", text: `设为默认失败：${err instanceof Error ? err.message : "未知错误"}` });
    }
  }, []);

  const selected = template.elements.find(e => e.id === selectedId) ?? null;
  return {
    templates, template, selected, selectedId, loading, degraded, notice, dirty,
    setNotice, setSelectedId, selectTemplate, patchTemplate, patchElement, setElementRect,
    addElement, deleteElement, duplicateElement, save, create, remove, makeDefault,
  };
}
