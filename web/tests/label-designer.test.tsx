import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import LabelTemplatesPage from "@/app/(protected)/admin/label-templates/page";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { installFakeCanvas } from "./support/labelCanvas";

/**
 * 拖拽设计器：拖移/缩放/夹取、增删、保存载荷、设为默认唯一性、接口不可用的降级、管理员门禁。
 * 拖拽只用 pointer* 事件，不依赖真实布局（指针位移按画布 6px/mm 换算）。
 */

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: vi.fn() }));

const mockedGet = vi.mocked(api.get as (e: string) => Promise<unknown>);
const mockedPost = vi.mocked(api.post as (e: string, b?: unknown) => Promise<unknown>);
const mockedPut = vi.mocked(api.put as (e: string, b?: unknown) => Promise<unknown>);
const mockedDelete = vi.mocked(api.delete as (e: string) => Promise<unknown>);
const mockedUser = vi.mocked(useCurrentUser);

const tpl = (over: Record<string, unknown> = {}) => ({
  id: 1, name: "默认 80×50", isDefault: true, widthMm: 80, heightMm: 50, dpi: 600, background: "#FFFFFF",
  elements: [
    { id: "el1", type: "qr", x: 3, y: 10, w: 30, h: 30, quietMm: 3 },
    { id: "el2", type: "text", x: 36, y: 14, w: 41, h: 6, field: "code", fontSizePt: 12, fontWeight: 700, fontFamily: "mono", color: "#111111", align: "center", autoShrink: true },
  ],
  ...over,
});

const asAdmin = () => mockedUser.mockReturnValue({ user: { id: 1, username: "admin", role: "admin", department: null, departmentId: null }, loading: false, refresh: vi.fn() });
const el = (id: string) => document.querySelector<HTMLElement>(`[data-element-id="${id}"]`)!;
const item = (id: number) => document.querySelector<HTMLElement>(`[data-template-id="${id}"]`)!;

/**
 * jsdom 的两个坑：
 * 1) 没有 PointerEvent —— `fireEvent.pointerMove(..., { clientX })` 会把坐标丢掉（delta 变 NaN）；
 * 2) React 不认「用 MouseEvent 冒充的 pointerdown」，所以起手仍用 fireEvent.pointerDown。
 * 因此：起手用 fireEvent.pointerDown，移动/抬起用 MouseEvent 以 pointer* 事件名派发在**元素**上
 * （会冒泡到组件监听指针的 window），坐标就能真实传递，行为与真浏览器一致。
 */
const moveTo = (target: EventTarget, clientX: number, clientY: number) => {
  target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX, clientY }));
};

const drag = (target: Element, dx: number, dy: number) => {
  fireEvent.pointerDown(target);
  moveTo(target, dx, dy);
  fireEvent.pointerUp(window);
};

beforeEach(() => {
  vi.clearAllMocks();
  installFakeCanvas();
  asAdmin();
  mockedPost.mockResolvedValue({});
  mockedPut.mockResolvedValue({});
  mockedDelete.mockResolvedValue({});
  mockedGet.mockImplementation(async (endpoint: string) =>
    endpoint === "/api/label-templates" ? { templates: [tpl()] } : {});
});
afterEach(() => vi.restoreAllMocks());

const renderPage = async () => {
  render(<LabelTemplatesPage />);
  await waitFor(() => expect(screen.getAllByTestId("designer-element").length).toBe(2));
};

describe("标签模板设计器：拖拽与缩放", () => {
  it("拖动元素：x/y 按 0.5mm 吸附变化", async () => {
    await renderPage();

    // 画布 6px/mm → 拖 (60, 24)px = (10, 4)mm；el1 从 (3,10) → (13,14)
    drag(el("el1"), 60, 24);

    expect(screen.getByTestId("element-x")).toHaveValue(13);
    expect(screen.getByTestId("element-y")).toHaveValue(14);
  });

  it("拖出页面：夹在页面内（不是允许拖出去再报错）", async () => {
    await renderPage();

    drag(el("el1"), 6000, 6000);   // 拖到右下无穷远

    const x = Number((screen.getByTestId("element-x") as HTMLInputElement).value);
    const y = Number((screen.getByTestId("element-y") as HTMLInputElement).value);
    const w = Number((screen.getByTestId("element-w") as HTMLInputElement).value);
    const h = Number((screen.getByTestId("element-h") as HTMLInputElement).value);
    expect(x + w).toBeLessThanOrEqual(80);
    expect(y + h).toBeLessThanOrEqual(50);
    expect(x).toBe(50);
    expect(y).toBe(20);

    drag(el("el1"), -6000, -6000);  // 再拖到左上
    expect(screen.getByTestId("element-x")).toHaveValue(0);
    expect(screen.getByTestId("element-y")).toHaveValue(0);
  });

  it("拖右下角手柄：w/h 变化且不越界", async () => {
    await renderPage();
    fireEvent.pointerDown(el("el1"));   // 先选中，手柄才出现

    drag(screen.getByTestId("handle-se"), 60, 12);   // +10mm / +2mm

    expect(screen.getByTestId("element-w")).toHaveValue(40);
    expect(screen.getByTestId("element-h")).toHaveValue(32);
  });

  it("加/删元素", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("add-text"));
    expect(screen.getAllByTestId("designer-element")).toHaveLength(3);

    fireEvent.click(screen.getByTestId("element-delete"));
    expect(screen.getAllByTestId("designer-element")).toHaveLength(2);
  });
});

describe("标签模板设计器：模板管理", () => {
  it("保存发 PUT，载荷是**完整模板**（含完整 elements 数组）", async () => {
    await renderPage();
    fireEvent.change(screen.getByTestId("template-name"), { target: { value: "我的版式" } });
    fireEvent.click(screen.getByTestId("template-save"));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    const [url, body] = mockedPut.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/api/label-templates/1");
    expect(body).toMatchObject({ name: "我的版式", widthMm: 80, heightMm: 50, dpi: 600, background: "#FFFFFF" });
    expect(body.elements).toHaveLength(2);
    expect(body.elements).toEqual([
      expect.objectContaining({ id: "el1", type: "qr", x: 3, y: 10, w: 30, h: 30, quietMm: 3 }),
      expect.objectContaining({ id: "el2", type: "text", field: "code", fontSizePt: 12, fontWeight: 700, align: "center" }),
    ]);
  });

  /**
   * 回归（用户实测：「我改为库位标签，但是一点保存就自动变回物料标签」）：
   * 两个前端 bug 叠加 ——
   *  ① `toWritePayload` 漏发 `kind` → 后端 POST 默认 material / PUT 视为"保持原值"
   *  ② `normalizeTemplate` 漏读 `kind` → 即使后端存了 location，前端归一化后又变回 material
   * 这个用例同时钉住载荷与保存后的界面值（用后端回显模拟）。
   */
  it("把「用途」改成库位标签 → 保存载荷 kind=location，保存后界面仍是库位标签（不再变回物料）", async () => {
    await renderPage();
    expect(screen.getAllByTestId("template-kind")).toHaveLength(1);   // 曾经被脚本复制成 3 个重复控件

    fireEvent.change(screen.getByTestId("template-kind"), { target: { value: "location" } });
    mockedPut.mockResolvedValue(tpl({ kind: "location" }));            // 模拟后端回显
    fireEvent.click(screen.getByTestId("template-save"));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    const [, body] = mockedPut.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toMatchObject({ kind: "location" });
    await waitFor(() => expect(screen.getByTestId("template-kind")).toHaveValue("location"));
  });

  it("保存载荷始终带 kind；归一化也保留 kind（老模板缺字段 → material）", async () => {
    const { normalizeTemplate } = await import("@/lib/labelTemplate");
    expect(normalizeTemplate(tpl({ kind: "location" }))?.kind).toBe("location");
    expect(normalizeTemplate(tpl())?.kind).toBe("material");

    await renderPage();
    fireEvent.change(screen.getByTestId("template-name"), { target: { value: "改名以触发可保存" } });
    fireEvent.click(screen.getByTestId("template-save"));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    const [, body] = mockedPut.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.kind).toBe("material");   // 不传会被后端当成"保持原值"，必须显式发
  });

  it("设为默认：只发一次请求，列表里默认标识唯一", async () => {
    mockedGet.mockResolvedValue({ templates: [tpl(), tpl({ id: 2, name: "备选", isDefault: false })] });
    render(<LabelTemplatesPage />);
    await waitFor(() => expect(screen.getAllByTestId("template-item")).toHaveLength(2));

    expect(screen.getAllByTestId("default-badge")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("template-set-default-2"));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][0]).toBe("/api/label-templates/2/default");
    const badges = await screen.findAllByTestId("default-badge");
    expect(badges).toHaveLength(1);
    // 唯一默认就是刚点的那一个
    expect(within(item(2)).getByTestId("default-badge")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(1);   // 没有靠重新拉全量来掩盖不一致
  });

  it("新建走 POST；删除走 DELETE", async () => {
    mockedPost.mockResolvedValue(tpl({ id: 7, name: "我的版式 副本", isDefault: false }));
    await renderPage();

    fireEvent.click(screen.getByTestId("template-new"));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/label-templates", expect.objectContaining({ name: expect.stringContaining("副本") })));

    await waitFor(() => expect(screen.getAllByTestId("template-item")).toHaveLength(2));
    fireEvent.click(screen.getByTestId("template-delete"));
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("/api/label-templates/7"));
  });
});

describe("标签模板设计器：权限与降级", () => {
  it("非管理员：看不到设计器（只有提示）", () => {
    mockedUser.mockReturnValue({ user: { id: 2, username: "member", role: "member", department: null, departmentId: null }, loading: false, refresh: vi.fn() });
    render(<LabelTemplatesPage />);

    expect(screen.getByTestId("not-admin")).toBeInTheDocument();
    expect(screen.queryByTestId("designer-canvas")).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/label-templates");
  });

  it("接口 404：给可读提示、用内置默认模板，页面不崩且仍可编辑", async () => {
    mockedGet.mockRejectedValue(new Error("HTTP 404"));
    render(<LabelTemplatesPage />);

    expect(await screen.findByTestId("templates-notice")).toHaveTextContent(/模板接口不可用/);
    expect(screen.getByTestId("designer-canvas")).toBeInTheDocument();
    expect(screen.getAllByTestId("designer-element").length).toBeGreaterThan(0);
    // 内置默认模板仍可拖动编辑（不会因为拉不到模板就白屏）
    drag(screen.getAllByTestId("designer-element")[0], 60, 0);
    expect(screen.getByTestId("element-x")).toBeInTheDocument();
  });
});
