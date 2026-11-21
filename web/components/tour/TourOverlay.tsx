"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { TourBubble } from "./TourBubble";
import type { ActiveTour } from "./TourProvider";

interface Rect { top: number; left: number; width: number; height: number }
interface Viewport { w: number; h: number }

interface Props {
  active: ActiveTour;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/** 气泡尺寸估算（用于决定放在目标上方还是下方） */
const BUBBLE_MAX_H = 220;
const BUBBLE_W = 320;
const MARGIN = 12;

/**
 * 引导遮罩：定位 data-guide 目标并用 box-shadow 挖洞高亮。
 *
 * 目标可能因为骨架屏/权限/移动端抽屉而暂时或永远不存在：
 * 先按 100ms×20 次重试，仍找不到就让调用方跳到下一步（引导不因缺元素而卡死）。
 */
export function TourOverlay({ active, onNext, onPrev, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ w: 0, h: 0 });
  const foundRef = useRef(false);
  const step = active.steps[active.index];

  useEffect(() => {
    setMounted(true);
    setViewport({ w: window.innerWidth, h: window.innerHeight });
  }, []);

  const measure = useCallback((): boolean => {
    // 空 target = 纯说明步骤：居中显示，不找元素、不自动跳过
    if (!step.target) {
      setRect(null);
      return true;
    }
    const el = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const inView = r.top >= 0 && r.bottom <= window.innerHeight;
    if (!inView) {
      el.scrollIntoView({ block: "center" });
      requestAnimationFrame(() => {
        const next = el.getBoundingClientRect();
        setRect({ top: next.top, left: next.left, width: next.width, height: next.height });
      });
    } else {
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    return true;
  }, [step.target]);

  // 定位 + 重试；仍然找不到就跳过本步
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    foundRef.current = measure();
    if (!foundRef.current) {
      timer = setInterval(() => {
        tries += 1;
        if (measure()) {
          foundRef.current = true;
          if (timer) clearInterval(timer);
        } else if (tries >= 20) {
          if (timer) clearInterval(timer);
          onNext();   // 目标确实不存在（无权限/移动端/页面改版）→ 跳过
        }
      }, 100);
    }
    const onViewportChange = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      measure();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [measure, onNext]);

  // 键盘：←/→ 翻页，Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft") onPrev();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onNext, onPrev, onClose]);

  if (!mounted) return null;

  const mobile = viewport.w < 640;
  const centered = !step.target;
  const style: CSSProperties = centered
    ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: mobile ? "min(92vw, 360px)" : 360 }
    : mobile
      ? { left: MARGIN, right: MARGIN, bottom: MARGIN, width: "auto" }
      : bubbleStyle(rect, viewport);

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl border-2 border-primary/80 transition-all duration-150"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 100vmax rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}
      <TourBubble
        title={step.title}
        body={step.body}
        index={active.index}
        total={active.steps.length}
        action={step.action}
        style={style}
        onPrev={onPrev}
        onNext={onNext}
        onClose={onClose}
      />
    </div>,
    document.body,
  );
}

/** 桌面气泡位置：优先放目标下方，空间不足放上方；水平居中并夹在视口内 */
function bubbleStyle(rect: Rect | null, viewport: Viewport): CSSProperties {
  if (!rect) return { left: MARGIN, top: MARGIN, width: BUBBLE_W };
  const below = rect.top + rect.height + MARGIN;
  const fitsBelow = below + BUBBLE_MAX_H < viewport.h;
  const top = fitsBelow ? below : Math.max(MARGIN, rect.top - MARGIN - BUBBLE_MAX_H);
  const left = Math.min(
    Math.max(MARGIN, rect.left + rect.width / 2 - BUBBLE_W / 2),
    Math.max(MARGIN, viewport.w - BUBBLE_W - MARGIN),
  );
  return { left, top, width: BUBBLE_W };
}
