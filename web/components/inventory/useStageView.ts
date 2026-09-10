"use client";

/** 画布视图 hook：初始适应、滚轮/双指缩放、滚轮锚点缩放、按钮缩放；编辑器与查看器共用 */
import { useCallback, useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { distance, fitView, midpoint, pinchView, zoomAt, type Pt, type View } from "./layoutGestures";

interface Options {
  stageRef: React.RefObject<Konva.Stage | null>;
  /** Stage 像素尺寸 */
  width: number;
  height: number;
  /** 内容尺寸（房间 cm） */
  contentW: number;
  contentH: number;
}

interface PinchState {
  dist: number;
  mid: Pt;
  view: View;
}

export function useStageView({ stageRef, width, height, contentW, contentH }: Options) {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const fitted = useRef(false);
  const pinch = useRef<PinchState | null>(null);

  const fit = useCallback(() => {
    setView(fitView(width, height, contentW, contentH));
  }, [width, height, contentW, contentH]);

  useEffect(() => {
    if (fitted.current || width <= 10) return;
    fitted.current = true;
    fit();
  }, [width, fit]);

  /** 客户端坐标 → Stage 像素坐标 */
  const stagePoint = useCallback((clientX: number, clientY: number): Pt | null => {
    const canvas = stageRef.current?.getContent();
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, [stageRef]);

  const twoPoints = (e: Konva.KonvaEventObject<TouchEvent>): [Pt, Pt] | null => {
    const t = e.evt.touches;
    if (!t || t.length < 2) return null;
    const a = stagePoint(t[0].clientX, t[0].clientY);
    const b = stagePoint(t[1].clientX, t[1].clientY);
    return a && b ? [a, b] : null;
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stagePoint(e.evt.clientX, e.evt.clientY) ?? { x: width / 2, y: height / 2 };
    const factor = e.evt.deltaY > 0 ? 0.9 : 1.1;
    setView(v => zoomAt(v, v.scale * factor, p.x, p.y));
  };

  const onTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const pts = twoPoints(e);
    if (!pts) return;
    // 双指时停止 Konva 的单指拖拽，避免与捏合缩放互相抢手势
    stageRef.current?.stopDrag();
    stageRef.current?.position({ x: 0, y: 0 });
    pinch.current = { dist: distance(pts[0], pts[1]), mid: midpoint(pts[0], pts[1]), view };
  };

  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const pts = twoPoints(e);
    if (!pts || !pinch.current) return;
    e.evt.preventDefault?.();
    stageRef.current?.stopDrag();
    const start = pinch.current;
    const mid = midpoint(pts[0], pts[1]);
    const zoomed = pinchView(start.view, start.dist, distance(pts[0], pts[1]), mid);
    // 双指整体移动 = 平移
    setView({ ...zoomed, x: zoomed.x + (mid.x - start.mid.x), y: zoomed.y + (mid.y - start.mid.y) });
  };

  const onTouchEnd = () => {
    pinch.current = null;
  };

  /** 以容器中心缩放（按钮/键盘用） */
  const zoomBy = useCallback((factor: number) => {
    setView(v => zoomAt(v, v.scale * factor, width / 2, height / 2));
  }, [width, height]);

  /** 拖空白平移后把 Stage 位移回收到视图状态 */
  const consumeStageDrag = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { x, y } = stage.position();
    stage.position({ x: 0, y: 0 });
    if (x !== 0 || y !== 0) setView(v => ({ ...v, x: v.x + x, y: v.y + y }));
  }, [stageRef]);

  return { view, setView, fit, zoomBy, onWheel, onTouchStart, onTouchMove, onTouchEnd, consumeStageDrag, stagePoint };
}
