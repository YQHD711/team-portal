"use client";

/**
 * 把画布的**真实变换**发布到 DOM（`data-stage-transform="ox,oy,scale"`），供 e2e 读取。
 *
 * 为什么要发布而不是让 e2e 推导：e2e 曾三次因"按 canvas 宽推导缩放 / 按居中假设偏移"算出错误坐标
 * （纵向、横向、缩放各一次），而"用角标 bbox 反解偏移"是**循环论证**（角标由同一份 view 算出，
 * 会把同一个错误再确认一遍）。这里给的是 Konva stage/layer 的**实际值**，是真实数据、不是测试标记。
 */

import { useEffect, type RefObject } from "react";
import type Konva from "konva";

export function useStageTransformPublisher(
  stageRef: RefObject<Konva.Stage | null>,
  wrapRef: RefObject<HTMLDivElement | null>,
  view: { x: number; y: number; scale: number },
  size: { w: number; h: number },
): void {
  useEffect(() => {
    const st = stageRef.current;
    const wrap = wrapRef.current;
    if (!st || !wrap) return;
    const layer = st.getLayers()[0];
    const ox = st.x() + (layer?.x() ?? 0);
    const oy = st.y() + (layer?.y() ?? 0);
    const sc = (layer?.scaleX() ?? 1) * (st.scaleX() ?? 1);
    wrap.setAttribute("data-stage-transform", `${ox.toFixed(2)},${oy.toFixed(2)},${sc.toFixed(6)}`);
  }, [stageRef, wrapRef, view, size]);
}