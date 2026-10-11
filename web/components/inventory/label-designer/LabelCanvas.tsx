"use client";

import { useEffect, useMemo, useState } from "react";
import { createQrMatrix, renderLabelPng, type QrMatrix } from "@/lib/labelPdf";
import { SAMPLE_LABEL_DATA, type LabelTemplate } from "@/lib/labelTemplate";
import type { Rect } from "@/lib/labelGeometry";
import { ElementBox } from "./ElementBox";

/** 画布显示比例：6 px/mm（80×50 的标签 → 480×300 的编辑区） */
export const PX_PER_MM = 6;
/** 预览栅格化用的低 DPI：与导出**同一套 renderLabelPng**，只是分辨率小、拖动时刷新够快 */
const PREVIEW_DPI = 150;

interface Props {
  template: LabelTemplate;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, rect: Rect) => void;
}

/** 带 mm 网格的画布：实时预览用示例物料数据渲染（renderLabelPng，与导出一致） */
export function LabelCanvas({ template, selectedId, onSelect, onChange }: Props) {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 二维码模块矩阵：与导出同一个 createQrMatrix
    void import("qrcode-generator")
      .then(mod => { if (!cancelled) setMatrix(createQrMatrix(SAMPLE_LABEL_DATA.url, mod.default)); })
      .catch(() => { /* 拿不到就只显示网格与元素框，不影响编辑 */ });
    return () => { cancelled = true; };
  }, []);

  const preview = useMemo(() => ({ ...template, dpi: Math.min(template.dpi, PREVIEW_DPI) }), [template]);
  const png = useMemo(() => (matrix ? renderLabelPng(SAMPLE_LABEL_DATA, matrix, preview) : null), [matrix, preview]);

  const width = template.widthMm * PX_PER_MM;
  const height = template.heightMm * PX_PER_MM;
  const gridStep = 5 * PX_PER_MM;

  return (
    <div className="inline-block">
      {/* mm 标尺（每 10mm 一个刻度） */}
      <div className="relative" style={{ marginLeft: 18 }}>
        <div className="absolute -top-4 left-0 right-0 flex text-[10px] text-faint" data-testid="designer-ruler">
          {Array.from({ length: Math.floor(template.widthMm / 10) + 1 }, (_, i) => (
            <span key={i} className="border-l border-border pl-0.5" style={{ width: 10 * PX_PER_MM }}>{i * 10}</span>
          ))}
        </div>
      </div>

      <div className="flex">
        {/* 左侧刻度 */}
        <div className="mr-1 flex w-4 flex-col text-[10px] text-faint">
          {Array.from({ length: Math.floor(template.heightMm / 10) + 1 }, (_, i) => (
            <span key={i} className="border-t border-border" style={{ height: 10 * PX_PER_MM }}>{i * 10}</span>
          ))}
        </div>

        <div data-testid="designer-canvas" onPointerDown={() => onSelect(null)}
          className="relative border border-border shadow-sm"
          style={{
            width, height, backgroundColor: template.background,
            backgroundImage: "linear-gradient(to right, rgba(15,23,42,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.08) 1px, transparent 1px)",
            backgroundSize: `${gridStep}px ${gridStep}px`,
          }}>
          {png && (
            <img data-testid="designer-preview" src={png} alt="标签预览" draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full" />
          )}
          {template.elements.map(el => (
            <ElementBox key={el.id} el={el} page={{ widthMm: template.widthMm, heightMm: template.heightMm }}
              pxPerMm={PX_PER_MM} selected={el.id === selectedId} onSelect={onSelect} onChange={onChange} />
          ))}
        </div>
      </div>
    </div>
  );
}
