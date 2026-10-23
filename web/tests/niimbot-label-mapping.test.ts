import { describe, it, expect } from "vitest";
import type { LabelData, LabelElement, LabelTemplate } from "@/lib/labelTemplate";
import {
  K3W_COMMON_SIZE, horizontalAlign, isK3wCommonSize, k3wSizeWarning,
  mapLabelElement, mapLabelToPrintPage, ptToMm,
} from "@/lib/niimbot/labelMapping";

/**
 * 纯函数映射：模板（mm/pt）→ 精臣 SDK（mm）。不连 WebSocket、不碰 DOM。
 * 字段名是 SDL 历史协议（textAlignHorizonral 等），测试锁住拼写，防"顺手改正"打坏出纸。
 */

const data: LabelData = {
  code: "BAT-LIPO-6S3300MAH-2026-0007",
  url: "https://team.example.com/i/BAT-LIPO-6S3300MAH-2026-0007",
  name: "6S 3300mAh 电池",
  grade: "A",
  locationCode: "201-A-3-05",
  category: "电池电源",
};

function template(elements: LabelElement[], widthMm = 50, heightMm = 30): LabelTemplate {
  return { id: 1, name: "K3W 50×30", widthMm, heightMm, dpi: 200, background: "#FFFFFF", elements };
}

describe("模板 → SDK 单页数据", () => {
  it("画板尺寸/单位透传，rotate 归一为 0", () => {
    const page = mapLabelToPrintPage(template([
      { id: "qr", type: "qr", x: 2, y: 2, w: 20, h: 20 },
    ]), data);

    expect(page.InitDrawingBoardParam).toEqual({
      width: 50, height: 30, rotate: 0, path: "", verticalShift: 0, HorizontalShift: 0,
    });
    expect(page.elements).toHaveLength(1);
  });

  it("二维码元素：内容必须是短链、codeType=31、mm 坐标透传", () => {
    const page = mapLabelToPrintPage(template([
      { id: "qr", type: "qr", x: 24.5, y: 4, w: 22.5, h: 22.5, quietMm: 3 },
    ]), data);

    const qr = page.elements[0];
    expect(qr.type).toBe("qrCode");
    expect(qr.json).toMatchObject({
      x: 24.5, y: 4, width: 22.5, height: 22.5,
      value: "https://team.example.com/i/BAT-LIPO-6S3300MAH-2026-0007",
      codeType: 31,
      rotate: 0,
    });
  });

  it("文本元素：pt→mm 字号、水平对齐映射、粗体、lineMode、固定文案", () => {
    const page = mapLabelToPrintPage(template([
      { id: "code", type: "text", x: 2, y: 2, w: 30, h: 5, field: "code", fontSizePt: 12, fontWeight: 700, align: "center" },
      { id: "left", type: "text", x: 2, y: 8, w: 30, h: 5, text: "库位", fontSizePt: 8, fontWeight: 400, align: "left", autoShrink: false },
      { id: "right", type: "text", x: 2, y: 14, w: 30, h: 5, field: "locationCode", fontSizePt: 8, align: "right" },
    ]), data);

    const [code, left, right] = page.elements.map(e => e.json);
    expect(code).toMatchObject({
      value: "BAT-LIPO-6S3300MAH-2026-0007",
      fontSize: 4.23,                 // 12pt × 25.4 / 72
      textAlignHorizonral: 1,
      textAlignVertical: 1,
      lineMode: 6,
      fontStyle: [true, false, false, false],
      rotate: 0,
    });
    expect(left).toMatchObject({ value: "库位", textAlignHorizonral: 0, lineMode: 4, fontStyle: [false, false, false, false] });
    expect(right).toMatchObject({ value: "201-A-3-05", textAlignHorizonral: 2, lineMode: 6 });
  });

  it("空字段跳过，不产生空白元素", () => {
    const page = mapLabelToPrintPage(template([
      { id: "grade", type: "text", x: 2, y: 2, w: 10, h: 4, field: "grade", fontSizePt: 8 },
      { id: "qr", type: "qr", x: 2, y: 8, w: 10, h: 10 },
    ]), { ...data, grade: "" });

    expect(page.elements).toHaveLength(1);
    expect(page.elements[0].type).toBe("qrCode");
  });

  it("全部元素为空 → 抛可读错误（不静默打印空白标签）", () => {
    const empty: LabelData = { code: "", url: "", name: "", grade: null, locationCode: null, category: null };
    expect(() => mapLabelToPrintPage(template([
      { id: "name", type: "text", x: 2, y: 2, w: 10, h: 4, field: "name", fontSizePt: 8 },
    ]), empty)).toThrow(/空内容/);
  });

  it("当前模板契约外的元素（条码/线条/图形）明确抛错，提示改用导出 PDF", () => {
    expect(() => mapLabelElement({ id: "b", type: "barCode" as LabelElement["type"], x: 0, y: 0, w: 10, h: 10 }, data))
      .toThrow(/不支持直连打印/);
  });
});

describe("K3W 尺寸与单位辅助", () => {
  it("ptToMm 换算", () => {
    expect(ptToMm(12)).toBe(4.23);
    expect(ptToMm(72)).toBe(25.4);
  });

  it("水平对齐映射 0/1/2", () => {
    expect([horizontalAlign("left"), horizontalAlign("center"), horizontalAlign("right"), horizontalAlign(undefined)])
      .toEqual([0, 1, 2, 1]);
  });

  it("50×30 是 K3W 常用尺寸，其他尺寸给提醒", () => {
    expect(isK3wCommonSize(K3W_COMMON_SIZE)).toBe(true);
    expect(k3wSizeWarning({ ...K3W_COMMON_SIZE, name: "x" })).toBeNull();
    const warning = k3wSizeWarning({ widthMm: 80, heightMm: 50, name: "默认 80×50" });
    expect(warning).toContain("80×50");
    expect(warning).toContain("50×30");
  });
});
