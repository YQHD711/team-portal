"use client";

import { LABEL_FIELDS, type LabelElement, type LabelTemplate } from "@/lib/labelTemplate";
import { MIN_SIZE_MM, clampRect } from "@/lib/labelGeometry";
import { Copy, Trash2 } from "lucide-react";

const input = "w-full rounded border border-border bg-background px-1.5 py-1 text-xs";
const label = "flex items-center justify-between gap-2 text-[11px] text-muted";

interface Props {
  template: LabelTemplate;
  selected: LabelElement | null;
  onPatchTemplate: (patch: Partial<LabelTemplate>) => void;
  onPatchElement: (id: string, patch: Partial<LabelElement>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/** 右侧属性面板：页面设置 + 选中元素的精确数值/样式（客户端也做一遍范围校验） */
export function ElementPanel({ template, selected, onPatchTemplate, onPatchElement, onDuplicate, onDelete }: Props) {
  const page = { widthMm: template.widthMm, heightMm: template.heightMm };
  const patchRect = (id: string, key: "x" | "y" | "w" | "h", raw: number) => {
    const next = clampRect({ ...selected!, [key]: raw }, page);
    onPatchElement(id, next);
  };

  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-2">
        <h3 className="font-medium text-muted">页面</h3>
        <label className={label}>名称
          <input data-testid="template-name" className={input} value={template.name}
            onChange={e => onPatchTemplate({ name: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>宽 mm
            <input data-testid="page-width" type="number" min={10} max={300} step={1} className={input} value={template.widthMm}
              onChange={e => onPatchTemplate({ widthMm: Math.min(300, Math.max(10, Number(e.target.value) || 10)) })} />
          </label>
          <label className={label}>高 mm
            <input data-testid="page-height" type="number" min={10} max={300} step={1} className={input} value={template.heightMm}
              onChange={e => onPatchTemplate({ heightMm: Math.min(300, Math.max(10, Number(e.target.value) || 10)) })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>DPI
            <select data-testid="page-dpi" className={input} value={template.dpi}
              onChange={e => onPatchTemplate({ dpi: Number(e.target.value) })}>
              {[203, 300, 600].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className={label}>背景
            <input data-testid="page-background" type="color" className="h-7 w-full rounded border border-border" value={template.background}
              onChange={e => onPatchTemplate({ background: e.target.value })} />
          </label>
        </div>
      </section>

      {!selected ? (
        <p data-testid="no-selection" className="rounded border border-dashed border-border p-2 text-[11px] text-faint">
          在画布上点一个元素来编辑它，或先「添加二维码 / 文本框」。
        </p>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-muted">元素 · {selected.type === "qr" ? "二维码" : "文字"}</h3>
            <div className="flex gap-1">
              <button type="button" data-testid="element-duplicate" onClick={() => onDuplicate(selected.id)}
                className="rounded border border-border p-1 hover:bg-surface-hover" title="复制"><Copy className="h-3 w-3" /></button>
              <button type="button" data-testid="element-delete" onClick={() => onDelete(selected.id)}
                className="rounded border border-border p-1 text-danger hover:bg-danger/10" title="删除"><Trash2 className="h-3 w-3" /></button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {(["x", "y", "w", "h"] as const).map(k => (
              <label key={k} className="text-[10px] text-faint">{k}
                <input data-testid={`element-${k}`} type="number" min={0} step={0.5} className={input} value={selected[k]}
                  onChange={e => patchRect(selected.id, k, Number(e.target.value))} />
              </label>
            ))}
          </div>

          {selected.type === "qr" ? (
            <label className={label}>静区 mm
              <input data-testid="element-quiet" type="number" min={0} step={0.5} className={input}
                value={selected.quietMm ?? 3}
                onChange={e => onPatchElement(selected.id, { quietMm: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          ) : (
            <>
              <label className={label}>字段
                <select data-testid="element-field" className={input} value={selected.field ?? ""}
                  onChange={e => onPatchElement(selected.id, { field: e.target.value as LabelElement["field"] })}>
                  <option value="">（固定文字）</option>
                  {LABEL_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
              {!selected.field && (
                <label className={label}>文字
                  <input data-testid="element-text" className={input} value={selected.text ?? ""}
                    onChange={e => onPatchElement(selected.id, { text: e.target.value })} />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className={label}>字号 pt
                  <input data-testid="element-font-size" type="number" min={4} max={72} step={0.5} className={input}
                    value={selected.fontSizePt ?? 10}
                    onChange={e => onPatchElement(selected.id, { fontSizePt: Math.min(72, Math.max(4, Number(e.target.value) || 4)) })} />
                </label>
                <label className={label}>字重
                  <select data-testid="element-font-weight" className={input} value={selected.fontWeight ?? 400}
                    onChange={e => onPatchElement(selected.id, { fontWeight: Number(e.target.value) })}>
                    {[300, 400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className={label}>字族
                  <select data-testid="element-font-family" className={input} value={selected.fontFamily ?? "sans"}
                    onChange={e => onPatchElement(selected.id, { fontFamily: e.target.value as "sans" | "mono" })}>
                    <option value="sans">sans</option><option value="mono">mono</option>
                  </select>
                </label>
                <label className={label}>对齐
                  <select data-testid="element-align" className={input} value={selected.align ?? "center"}
                    onChange={e => onPatchElement(selected.id, { align: e.target.value as LabelElement["align"] })}>
                    <option value="left">左</option><option value="center">中</option><option value="right">右</option>
                  </select>
                </label>
                <label className={label}>颜色
                  <input data-testid="element-color" type="color" className="h-7 w-full rounded border border-border" value={selected.color ?? "#111111"}
                    onChange={e => onPatchElement(selected.id, { color: e.target.value })} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-muted">
                <input data-testid="element-auto-shrink" type="checkbox" checked={selected.autoShrink !== false}
                  onChange={e => onPatchElement(selected.id, { autoShrink: e.target.checked })} />
                超宽自动缩小字号（autoShrink）
              </label>
            </>
          )}
          <p className="text-[10px] text-faint">最小 {MIN_SIZE_MM}mm；坐标吸附 0.5mm，越界会自动夹回页面内。</p>
        </section>
      )}
    </div>
  );
}
