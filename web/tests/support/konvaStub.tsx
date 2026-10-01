/**
 * 测试用的 react-konva 替身：react-konva 需要真实 Canvas，jsdom 里跑不起来。
 * 这里只保留「DOM 里能不能看到、点了会怎样」所需要的行为 —— 所有 Konva 形状
 * 渲染成带 data-konva 属性的 div，交互回调按名字对应到 DOM 事件。
 *
 * 注意：Konva 的属性（x/y/fill/stroke 等）在 DOM 上不可验证，视觉断言应放在
 * 纯 DOM 的浮层/卡片上，或者交给 Playwright E2E。
 */
import { createElement, type MouseEvent, type ReactNode, type Ref } from "react";
import type Konva from "konva";

type AnyProps = Record<string, unknown> & { children?: ReactNode };

/** Stage 的替身：useCellCenters 会调用 getContent().getBoundingClientRect()，给个空 div */
export const stageCanvas = { current: null as HTMLDivElement | null };

/** 只实现 useCellCenters / useStageView 用到的 Stage 表面（getContent / position / stopDrag） */
function fakeStage(node: HTMLDivElement | null): Konva.Stage {
  return {
    getContent: () => node,
    position: () => ({ x: 0, y: 0 }),
    stopDrag: () => {},
  } as unknown as Konva.Stage;
}

/** 组件把自己的 ref 交给真 Stage；替身要把它接住，否则 stageRef 永远为 null（定位/格位中心都测不到） */
function assignStageRef(ref: unknown, node: HTMLDivElement | null) {
  if (typeof ref === "function") (ref as (stage: Konva.Stage) => void)(fakeStage(node));
  else if (ref) (ref as { current: Konva.Stage | null }).current = fakeStage(node);
}

function StageStub({ children, ref }: AnyProps & { ref?: Ref<Konva.Stage> }) {
  return createElement("div", {
    "data-konva": "Stage",
    ref: (node: HTMLDivElement | null) => {
      stageCanvas.current = node;
      assignStageRef(ref, node);
    },
  }, children);
}

function shapeStub(kind: string) {
  return function ShapeStub({ children, onClick, onDblClick, onMouseEnter, onMouseLeave, ...rest }: AnyProps) {
    // 只把 data-* 透到 DOM（data-testid 用来定位格位），其余 Konva 属性留在替身里
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("data-")) data[key] = value;
    }
    return createElement("div", {
      "data-konva": kind,
      ...data,
      onClick: onClick as (e: MouseEvent) => void,
      onDoubleClick: onDblClick as (e: MouseEvent) => void,
      onMouseEnter: onMouseEnter as (e: MouseEvent) => void,
      onMouseLeave: onMouseLeave as (e: MouseEvent) => void,
    }, children);
  };
}

export const stubs = {
  Stage: StageStub,
  Layer: shapeStub("Layer"),
  Group: shapeStub("Group"),
  Rect: shapeStub("Rect"),
  Text: shapeStub("Text"),
  Shape: shapeStub("Shape"),
  Transformer: shapeStub("Transformer"),
};
