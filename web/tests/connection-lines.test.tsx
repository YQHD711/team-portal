import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useRef, useState } from "react";
import type Konva from "konva";
import type { ItemElement, MaterialItem, RoomLayout } from "@/components/inventory/layoutTypes";
import { ConnectionLines, type ConnectionLine } from "@/components/inventory/ConnectionLines";
import { MaterialsPanel } from "@/components/inventory/MaterialsPanel";
import { useMountingView } from "@/components/inventory/useMountingState";
import { useCellCenters } from "@/components/inventory/useCellCenters";

const shelf: ItemElement = {
  id: "e1", type: "shelf", name: "A货架", locCode: "201-A",
  x: 100, y: 100, w: 200, h: 60, rotation: 0, rows: 4, cols: 8,
};
const items: MaterialItem[] = [{ id: 1, name: "桨叶", quantity: 5, locationCode: "201-A-1-01" }];
const layout: RoomLayout = {
  width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items: [shelf],
};

/** 模拟页面滚动量：视口坐标 = 文档坐标 - scroll.top */
const scroll = { top: 0 };

function rect(top: number, height: number, left = 0, width = 100): DOMRect {
  return {
    x: left, y: top, top, left, width, height,
    right: left + width, bottom: top + height,
    toJSON: () => ({}),
  };
}

/**
 * 测量链路复现：物料面板上报条目中心（视口坐标）、useCellCenters 上报格位中心，
 * ConnectionLines 再减去容器原点画出连线 —— 与 PlannerViewer / RoomPlanner 一致。
 */
function Harness() {
  const workRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // 用稳定的假 Stage 替代 react-konva：useCellCenters 只用到 getContent()
  const [fakeStage] = useState(() => ({ getContent: () => canvasRef.current }) as unknown as Konva.Stage);
  const stageRef = useRef<Konva.Stage | null>(fakeStage);
  const { setItemAnchors, setCellCenters, hoverKey, lines } = useMountingView(items, layout.items);
  useCellCenters(layout, items, { scale: 1, x: 0, y: 0 }, stageRef, setCellCenters);
  return (
    <div ref={workRef} data-testid="connection-work">
      <div ref={canvasRef} data-testid="fake-stage-canvas" />
      <MaterialsPanel roomCode="201" items={items} elements={layout.items} selectedId={null}
        onSelect={() => {}} dnd={false} onItemRects={setItemAnchors} />
      <ConnectionLines containerRef={workRef} lines={lines} hoverKey={hoverKey} />
    </div>
  );
}

describe("连线锚点重测（查看正视细节视图返回后位置不偏移）", () => {
  beforeEach(() => {
    scroll.top = 0;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.dataset.testid === "connection-work") return rect(100 - scroll.top, 600, 0, 800);
      if (el.dataset.testid === "fake-stage-canvas") return rect(120 - scroll.top, 300, 0, 400);
      if ((el.getAttribute("title") ?? "").startsWith("201-A-1-01")) return rect(290 - scroll.top, 20, 0, 200);
      return rect(0, 0);
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("页面滚动导致布局位移后，连线两端坐标随锚点重测一起更新", () => {
    const { container } = render(<Harness />);
    // 每条连线（底衬 + 主线）都应与锚点算出的相对坐标一致
    const assertLinesPlaced = () => {
      const lines = container.querySelectorAll("svg line");
      expect(lines.length).toBeGreaterThan(0);
      for (const el of lines) {
        expect(Number(el.getAttribute("y1"))).toBeCloseTo(200, 3);
        expect(Number(el.getAttribute("y2"))).toBeCloseTo(149.75, 3);
      }
    };
    // 挂载时的基准：线相对容器左上角固定
    assertLinesPlaced();

    // 模拟「查看正视细节视图后返回」时浏览器恢复滚动位置：布局整体上移 250px
    act(() => {
      scroll.top = 250;
      document.dispatchEvent(new Event("scroll"));
    });

    // 锚点与容器原点同时重测 → 线仍停在正确位置，而不是跟着旧坐标漂移
    assertLinesPlaced();
  });
});

const demoLine: ConnectionLine = {
  id: 1, code: "201-A-1-01", color: "#f43f5e",
  from: { x: 40, y: 60 }, to: { x: 300, y: 180 },
};

function LineHarness({ hoverKey }: { hoverKey: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <ConnectionLines containerRef={ref} lines={[demoLine]} hoverKey={hoverKey} />
    </div>
  );
}

describe("连线外观", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(rect(0, 400, 0, 400));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("3px 圆头主线 + 光晕底衬 + 两端圆点，hover 时增粗提亮", () => {
    const { container, rerender } = render(<LineHarness hoverKey={null} />);
    const main = container.querySelector('[data-testid="connection-line"]');
    const halo = container.querySelector('[data-testid="connection-halo"]');
    expect(main).not.toBeNull();
    expect(halo).not.toBeNull();

    expect(Number(main!.getAttribute("stroke-width"))).toBe(3);
    expect(main!.getAttribute("stroke-linecap")).toBe("round");
    expect(Number(halo!.getAttribute("stroke-width"))).toBeGreaterThan(3);
    expect(Number(halo!.getAttribute("stroke-opacity"))).toBeLessThan(Number(main!.getAttribute("stroke-opacity")));
    expect(halo!.getAttribute("stroke")).toBe(demoLine.color);

    const dots = container.querySelectorAll('[data-testid="connection-dot"]');
    expect(dots).toHaveLength(2);
    expect(Number(dots[0].getAttribute("cx"))).toBe(demoLine.from.x);
    expect(Number(dots[1].getAttribute("cy"))).toBe(demoLine.to.y);

    const baseWidth = Number(main!.getAttribute("stroke-width"));
    const baseOpacity = Number(main!.getAttribute("stroke-opacity"));
    rerender(<LineHarness hoverKey={String(demoLine.id)} />);
    const hot = container.querySelector('[data-testid="connection-line"]')!;
    expect(Number(hot.getAttribute("stroke-width"))).toBeGreaterThan(baseWidth);
    expect(Number(hot.getAttribute("stroke-opacity"))).toBeGreaterThan(baseOpacity);
  });
});
