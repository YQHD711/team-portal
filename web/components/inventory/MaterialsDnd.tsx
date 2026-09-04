"use client";

/** 物料拖拽条目：可拖到画布货架格子挂载（DataTransfer 传 id）；hover 上报连线高亮；已挂载条目右键卸下 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { MaterialItem } from "./layoutTypes";

interface MaterialChipProps {
  item: MaterialItem;
  className: string;
  title?: string;
  onClick?: () => void;
  onRef?: (el: HTMLElement | null) => void;
  onHover?: (id: number | null) => void;
  onUnmount?: (id: number) => void;
  draggable?: boolean;
  children: ReactNode;
}

export function MaterialChip({ item, className, title, onClick, onRef, onHover, onUnmount, draggable = true, children }: MaterialChipProps) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      ref={onRef}
      draggable={draggable}
      title={title}
      onClick={onClick}
      onDragStart={e => {
        e.dataTransfer.setData("text/plain", String(item.id));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => { setDragging(false); onHover?.(null); }}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      onContextMenu={onUnmount ? (e) => { e.preventDefault(); onUnmount(item.id); } : undefined}
      className={`select-none ${dragging ? "opacity-40" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
