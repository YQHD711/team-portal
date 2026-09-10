import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ItemElement, MaterialItem } from "@/components/inventory/layoutTypes";
import { ElementDetail } from "@/components/inventory/ElementDetail";
import { PropertyDialog } from "@/components/inventory/PropertyPanel";
import { MaterialsPanel } from "@/components/inventory/MaterialsPanel";
import { RoomCard } from "@/components/inventory/RoomCard";

const shelf: ItemElement = {
  id: "e1", type: "shelf", name: "A货架", locCode: "201-A",
  x: 100, y: 100, w: 200, h: 60, rotation: 0, rows: 4, cols: 8,
};
const cabinet: ItemElement = {
  id: "e2", type: "cabinet", name: "B柜", locCode: "201-B",
  x: 0, y: 0, w: 100, h: 60, rotation: 0, rows: 4, cols: 2,
};
const device: ItemElement = {
  id: "e3", type: "device", name: "充电器", locCode: "201-C",
  x: 0, y: 0, w: 80, h: 80, rotation: 0, rows: 1, cols: 1,
};

const items: MaterialItem[] = [
  { id: 1, name: "桨叶", category: "动力系统", quantity: 5, locationCode: "201-A-1-01" },
  { id: 2, name: "螺丝", category: "耗材", quantity: 2, locationCode: "201-A-3-05" },
  { id: 3, name: "胶带", quantity: 4, locationCode: "201-B-2-01" },
  { id: 4, name: "充电线", quantity: 6, locationCode: "201-C" },
  { id: 5, name: "杂物", quantity: 1, locationCode: "" },
];

describe("正视细节视图（ElementDetail）", () => {
  it("立体货架按层 × 位展开，点格位切换该格物料清单", () => {
    render(<ElementDetail element={shelf} items={items} onClose={vi.fn()} />);

    expect(screen.getByText("正视（层 × 位）")).toBeInTheDocument();
    expect(screen.getByText("4 层 × 8 位")).toBeInTheDocument();
    expect(screen.getByText("2 种 · 7 件")).toBeInTheDocument();
    // 默认展示首格明细（物料名同时出现在格位与明细里，故用 getAllByText）
    expect(screen.getByText(/格位明细 · 1层01位/)).toBeInTheDocument();
    expect(screen.getAllByText("桨叶").length).toBeGreaterThan(0);
    expect(screen.getByText("201-A-1-01")).toBeInTheDocument();

    // 点 3层05位 → 明细切到该格
    fireEvent.click(screen.getByTitle(/3层05位/));
    expect(screen.getByText(/格位明细 · 3层05位/)).toBeInTheDocument();
    expect(screen.getByText("201-A-3-05")).toBeInTheDocument();
    expect(screen.queryByText("201-A-1-01")).not.toBeInTheDocument();

    // 空格位提示
    fireEvent.click(screen.getByTitle(/4层08位/));
    expect(screen.getByText(/格位明细 · 4层08位/)).toBeInTheDocument();
    expect(screen.getByText("该格位为空，可把物料拖拽到画布对应格位挂载")).toBeInTheDocument();
  });

  it("1×1 元素显示整体挂载，柜子按层 × 格展示", () => {
    const { unmount } = render(<ElementDetail element={device} items={items} onClose={vi.fn()} />);
    expect(screen.getAllByText("整体挂载").length).toBeGreaterThan(0);
    expect(screen.getAllByText("充电线").length).toBeGreaterThan(0);
    expect(screen.getByText("1 种 · 6 件")).toBeInTheDocument();
    unmount();

    render(<ElementDetail element={cabinet} items={items} onClose={vi.fn()} />);
    expect(screen.getByText("正视（层 × 格）")).toBeInTheDocument();
    expect(screen.getByText("4 层 × 2 格")).toBeInTheDocument();
    expect(screen.getByTitle(/2层01格/)).toBeInTheDocument();
  });

  it("initialCell 直接定位到指定格位并可关闭", () => {
    const onClose = vi.fn();
    render(<ElementDetail element={shelf} items={items} initialCell="201-A-3-05" onClose={onClose} />);
    expect(screen.getByText(/格位明细 · 3层05位/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("元素属性弹窗（PropertyDialog）", () => {
  it("按 cm 编辑位置/尺寸并保存，尺寸预设可一键套用", () => {
    const onSave = vi.fn();
    render(<PropertyDialog element={shelf} roomCode="201" onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText("宽（cm）")).toHaveValue(200);
    expect(screen.getByLabelText("深（cm）")).toHaveValue(60);
    expect(screen.getByLabelText("X 位置（cm）")).toHaveValue(100);

    fireEvent.change(screen.getByLabelText("宽（cm）"), { target: { value: "300" } });
    fireEvent.blur(screen.getByLabelText("宽（cm）"));
    fireEvent.change(screen.getByLabelText("X 位置（cm）"), { target: { value: "55" } });
    fireEvent.blur(screen.getByLabelText("X 位置（cm）"));
    fireEvent.click(screen.getByText("保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ w: 300, x: 55, h: 60 }));
  });

  it("格位划分按类型显示行/列称呼并可修改", () => {
    const onSave = vi.fn();
    render(<PropertyDialog element={shelf} roomCode="201" onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText(/格位划分 · 4 层 × 8 位/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("行数（层）"), { target: { value: "3" } });
    fireEvent.blur(screen.getByLabelText("行数（层）"));
    fireEvent.change(screen.getByLabelText("列数（位）"), { target: { value: "6" } });
    fireEvent.blur(screen.getByLabelText("列数（位）"));
    fireEvent.click(screen.getByText("保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ rows: 3, cols: 6 }));
  });

  it("切换为柜子后行/列称呼变为 层/格，尺寸预设随之切换", () => {
    render(<PropertyDialog element={shelf} roomCode="201" onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("类型"), { target: { value: "cabinet" } });
    expect(screen.getByLabelText("列数（格）")).toBeInTheDocument();
    expect(screen.getByText("100×60")).toBeInTheDocument();
  });

  it("正视详情与删除回调带上当前元素", () => {
    const onDetail = vi.fn();
    const onDelete = vi.fn();
    render(<PropertyDialog element={shelf} roomCode="201" onSave={vi.fn()} onDelete={onDelete} onDetail={onDetail} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("正视详情"));
    expect(onDetail).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
    fireEvent.click(screen.getByText("删除"));
    expect(onDelete).toHaveBeenCalledWith("e1");
  });

  it("墙/门/窗不提供格位划分，只改长度与位置", () => {
    const wall = { id: "wall-1", x: 0, y: 0, w: 200, h: 10, rotation: 0 };
    render(<PropertyDialog element={wall} roomCode="201" onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("行数（层）")).not.toBeInTheDocument();
    expect(screen.getByText("常用尺寸（cm）")).toBeInTheDocument();
    expect(screen.getByText("300 cm")).toBeInTheDocument();
  });
});

describe("物料面板（MaterialsPanel）", () => {
  beforeEach(() => { vi.spyOn(window, "confirm").mockReturnValue(true); });
  afterEach(() => { vi.restoreAllMocks(); });

  const renderPanel = (over: Partial<React.ComponentProps<typeof MaterialsPanel>> = {}) => {
    const props = {
      roomCode: "201", items, elements: [shelf, cabinet, device],
      selectedId: null, onSelect: vi.fn(), onItemRects: vi.fn(),
      onUnmount: vi.fn(), onPick: vi.fn(), onDetail: vi.fn(), ...over,
    };
    render(<MaterialsPanel {...props} />);
    return props;
  };

  it("按元素分组并用「层位/层格」标注，未定位单独列出", () => {
    renderPanel();
    expect(screen.getByText(/物料挂载（5）/)).toBeInTheDocument();
    expect(screen.getByText("A货架")).toBeInTheDocument();
    expect(screen.getByText("B柜")).toBeInTheDocument();
    expect(screen.getByText("1层01位")).toBeInTheDocument();
    expect(screen.getByText("3层05位")).toBeInTheDocument();
    expect(screen.getByText("2层01格")).toBeInTheDocument();
    expect(screen.getByText("未定位（1）")).toBeInTheDocument();
    // 设备无格位细分 → 分组标题与条目都显示完整编码
    expect(screen.getAllByText("201-C").length).toBeGreaterThan(0);
    expect(screen.getByText("充电器")).toBeInTheDocument();
  });

  it("搜索过滤物料，点选移动与卸下回调正确", () => {
    const props = renderPanel();
    fireEvent.change(screen.getByPlaceholderText("搜索物料…"), { target: { value: "螺丝" } });
    expect(screen.getByText("螺丝")).toBeInTheDocument();
    expect(screen.queryByText("桨叶")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("搜索物料…"), { target: { value: "" } });

    // 「移动」进入点选挂载
    fireEvent.click(screen.getAllByTitle("点选挂载：点击后到画布上点目标格位")[0]);
    expect(props.onPick).toHaveBeenCalledWith(expect.objectContaining({ locationCode: "201-A-1-01" }));

    // 「卸下」需确认
    fireEvent.click(screen.getAllByTitle("从当前位置卸下")[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(props.onUnmount).toHaveBeenCalledWith(1);

    // 正视详情入口
    fireEvent.click(screen.getAllByTitle("正视细节视图")[0]);
    expect(props.onDetail).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("只读模式不显示拖拽与移动按钮", () => {
    renderPanel({ dnd: false, onPick: undefined, onUnmount: undefined });
    expect(screen.queryByTitle("点选挂载：点击后到画布上点目标格位")).not.toBeInTheDocument();
    expect(screen.queryByTitle("从当前位置卸下")).not.toBeInTheDocument();
  });
});

describe("房间卡片（RoomCard）", () => {
  const layoutJson = JSON.stringify({
    width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [],
    items: [shelf, cabinet],
  });

  it("展示 cm 尺寸、元素构成与物料统计", () => {
    render(
      <RoomCard isStaff onOpen={vi.fn()}
        row={{ id: 1, roomCode: "201", roomName: "库房", floor: 1, cabinetCount: 2, shelfCount: 4, positionCount: 8, updatedAt: "", layoutJson }}
        items={items} />
    );
    expect(screen.getByText(/900 × 600 cm/)).toBeInTheDocument();
    expect(screen.getByText(/立体货架×1 柜子×1/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument(); // 物料种类（201-A×2 + 201-B + 201-C）
    // 阈值来自后端设置，无 Provider 时用兜底值 5：螺丝 2 与胶带 4 低于 5，桨叶 5 / 充电线 6 不算
    expect(screen.getByText("2 预警")).toBeInTheDocument();
  });

  it("未配置平面图时给出提示", () => {
    render(
      <RoomCard isStaff={false} onOpen={vi.fn()}
        row={{ id: 2, roomCode: "202", roomName: "加工间", floor: 1, cabinetCount: 0, shelfCount: 0, positionCount: 0, updatedAt: "", layoutJson: null }}
        items={[]} />
    );
    expect(screen.getByText("尚未配置平面图")).toBeInTheDocument();
    expect(screen.queryByText(/预警/)).not.toBeInTheDocument();
  });
});
