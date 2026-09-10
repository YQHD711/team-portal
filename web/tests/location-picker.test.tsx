import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LocationPicker } from "@/components/inventory/LocationPicker";
import {
  axisOptions, composeLocCode, locationOptionsOf, matchLocCode, type RoomLayoutOption,
} from "@/components/inventory/locationOptions";

/** 房间平面图：立体货架(4×8) + 柜子(4×2) + 设备(1×1) + 一个没有编码的货架 */
const shelf = { id: "it1", type: "shelf", name: "A货架", x: 0, y: 0, w: 300, h: 120, rotation: 0, locCode: "1030-A", rows: 4, cols: 8 };
const cabinet = { id: "it2", type: "cabinet", name: "B柜", x: 0, y: 0, w: 100, h: 60, rotation: 0, locCode: "1030-B", rows: 4, cols: 2 };
const device = { id: "it3", type: "device", name: "充电器", x: 0, y: 0, w: 80, h: 80, rotation: 0, locCode: "1030-C", rows: 1, cols: 1 };
const noCode = { id: "it4", type: "shelf", name: "无编码架", x: 0, y: 0, w: 100, h: 60, rotation: 0, locCode: "" };

const layoutJson = (items: unknown[]) =>
  JSON.stringify({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items });

const room: RoomLayoutOption = { roomCode: "1030", roomName: "库房", layoutJson: layoutJson([shelf, cabinet, device, noCode]) };
const emptyRoom: RoomLayoutOption = { roomCode: "201", roomName: "空房", layoutJson: null };

const change = (label: string, value: string) => {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
  return el;
};

describe("库位选项派生（locationOptions）", () => {
  it("从平面图元素生成选项：跳过无编码元素，标注类型与格位", () => {
    const options = locationOptionsOf(room.layoutJson);

    expect(options.map(o => o.locCode)).toEqual(["1030-A", "1030-B", "1030-C"]);
    expect(options[0].label).toContain("A货架（1030-A）");
    expect(options[0].label).toContain("立体货架");
    expect(options[0].label).toContain("4 层 × 8 位");
    expect(options[0].usesCells).toBe(true);
    expect(options[2]).toMatchObject({ usesCells: false, rows: 1, cols: 1 });  // 1×1 整体挂载
    expect(locationOptionsOf(null)).toEqual([]);
    expect(locationOptionsOf("{ 坏 json")).toEqual([]);
  });

  it("编码组装：格位元素带层位，整体挂载只到元素，越界返回空", () => {
    const [shelfOpt, , deviceOpt] = locationOptionsOf(room.layoutJson);

    expect(composeLocCode(shelfOpt, "3", "5")).toBe("1030-A-3-05");
    expect(composeLocCode(shelfOpt, "5", "1")).toBe("");     // 超出 4 层
    expect(composeLocCode(shelfOpt, "1", "9")).toBe("");     // 超出 8 位
    expect(composeLocCode(shelfOpt, "", "")).toBe("");
    expect(composeLocCode(deviceOpt, "1", "1")).toBe("1030-C");
    expect(composeLocCode(null, "1", "1")).toBe("");
  });

  it("已有编码回填：能识别四段与整体挂载，识别不了返回 null", () => {
    const options = locationOptionsOf(room.layoutJson);

    expect(matchLocCode(options, "1030-A-3-05")).toMatchObject({ row: "3", col: "5" });
    expect(matchLocCode(options, "1030-a-3-05")?.option.locCode).toBe("1030-A");  // 大小写不敏感
    expect(matchLocCode(options, "1030-C")).toMatchObject({ row: "1", col: "1" });
    expect(matchLocCode(options, "1030-A-9-01")).toBeNull();      // 层越界 → 交给手动输入
    expect(matchLocCode(options, "1030-01-3-05")).toBeNull();     // 旧式「架号」编码
    expect(matchLocCode(options, "999-Z-1-01")).toBeNull();
    expect(matchLocCode(options, "")).toBeNull();
  });

  it("层/位可选项为 1..n", () => {
    expect(axisOptions(4)).toEqual(["1", "2", "3", "4"]);
    expect(axisOptions(0)).toEqual(["1"]);
  });
});

describe("库位选择器（LocationPicker）", () => {
  it("室 → 元素 → 层 → 位 联动生成编码", () => {
    const onChange = vi.fn();
    render(<LocationPicker rooms={[room, emptyRoom]} value="" onChange={onChange} />);

    // 未选房间时元素下拉禁用
    expect(screen.getByLabelText("库位元素")).toBeDisabled();
    change("房间", "1030");
    expect(screen.getByLabelText("库位元素")).toBeEnabled();

    change("库位元素", "1030-A");
    expect(onChange).toHaveBeenLastCalledWith("1030-A-1-01");

    change("层", "3");
    expect(onChange).toHaveBeenLastCalledWith("1030-A-3-01");
    change("位", "5");
    expect(onChange).toHaveBeenLastCalledWith("1030-A-3-05");
    expect(screen.getByText("1030-A-3-05")).toBeInTheDocument();
  });

  it("整体挂载元素只生成元素编码，层/位不可用", () => {
    const onChange = vi.fn();
    render(<LocationPicker rooms={[room]} value="" onChange={onChange} />);
    change("房间", "1030");

    change("库位元素", "1030-C");

    expect(onChange).toHaveBeenLastCalledWith("1030-C");
    expect(screen.getByLabelText("层")).toBeDisabled();
    expect(screen.getByLabelText("位")).toBeDisabled();
  });

  it("识别不了的历史编码回退手动输入且原样保留（不得静默改写）", () => {
    const onChange = vi.fn();
    render(<LocationPicker rooms={[room]} value="1030-01-3-05" onChange={onChange} />);

    const manualInput = screen.getByLabelText("手动输入库位编码");
    expect(manualInput).toHaveValue("1030-01-3-05");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.queryByLabelText("库位元素")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();          // 打开表单不能改写既有编码

    fireEvent.change(manualInput, { target: { value: "1030-02-1-02" } });
    expect(onChange).toHaveBeenLastCalledWith("1030-02-1-02");
  });

  it("房间没有平面图元素时给出提示，可切回手动输入", () => {
    render(<LocationPicker rooms={[emptyRoom]} value="" onChange={vi.fn()} />);

    change("房间", "201");

    expect(screen.getByText(/该房间还没有平面图元素/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByLabelText("手动输入库位编码")).toHaveValue("");
  });

  it("布局接口不可用时回退到兜底房间列表", () => {
    const onChange = vi.fn();
    render(<LocationPicker rooms={[]} fallbackRooms={["1012", "1013"]} value="" onChange={onChange} />);

    change("房间", "1012");

    expect(screen.getByText(/该房间还没有平面图元素/)).toBeInTheDocument();
  });
});
