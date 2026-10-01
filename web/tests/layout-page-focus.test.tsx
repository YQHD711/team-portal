import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import type { MaterialItem } from "@/components/inventory/layoutTypes";
import { theRooms, theItems, shelf } from "./support/layoutFixtures";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>,
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({ useCurrentUser: () => ({ user: { role: "admin" }, loading: false }) }));

// react-konva 走 DOM 替身；两个懒加载组件换成能记录 props 的桩，
// 这样「进哪个房间、选中/高亮谁」能在没有 Canvas 的环境里直接断言
vi.mock("react-konva", async () => (await import("./support/konvaStub")).stubs);

const viewerProps = vi.fn();
vi.mock("@/components/inventory/PlannerViewer", () => ({
  PlannerViewer: (props: Record<string, unknown>) => {
    viewerProps(props);
    return <div data-testid="viewer-stub">{String(props.initialElementId)}</div>;
  },
}));
vi.mock("@/components/inventory/RoomPlanner", () => ({
  RoomPlanner: () => <div data-testid="planner-stub" />,
}));

import { api } from "@/lib/api";
import StorageLayoutPage from "@/app/(protected)/inventory/layout/page";

const mockedGet = vi.mocked(api.get as (endpoint: string) => Promise<unknown>);

/** 模拟带查询参数的 URL（jsdom 默认 http://localhost/） */
function setSearch(search: string) {
  window.history.replaceState({}, "", `/inventory/layout${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  viewerProps.mockClear();
  setSearch("");
  mockedGet.mockImplementation((endpoint: string) => {
    if (endpoint === "/api/storage/layouts") return Promise.resolve(theRooms);
    if (endpoint === "/api/inventory") return Promise.resolve(theItems);
    return Promise.resolve([]);
  });
});
afterEach(() => { setSearch(""); });

/** 等页面加载完（含 next/dynamic 懒加载的查看器） */
async function renderPage() {
  render(<StorageLayoutPage />);
  await waitFor(() => expect(screen.queryByText("加载中...")).not.toBeInTheDocument());
}

const lastViewerProps = () => viewerProps.mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe("物料布局页：库位跳转的查询参数", () => {
  it("带 room+element+item 进入：直接切到该房间并定位高亮所查物料", async () => {
    setSearch("?room=1012&element=1012-A&item=2");
    await renderPage();

    // 不再显示房间网格，而是直接进了 1012（懒加载的查看器挂上来才算定位完成）
    await waitFor(() => expect(screen.getByTestId("viewer-stub")).toBeInTheDocument());
    const header = screen.getByTestId("layout-room-header");
    expect(header).toHaveTextContent("1012");
    expect(header).toHaveTextContent("库房");
    expect(screen.queryByText("1F")).not.toBeInTheDocument();

    const props = lastViewerProps();
    expect(props.roomCode).toBe("1012");
    expect(props.initialElementId).toBe(shelf.id);
    expect(props.focusElementId).toBe(shelf.id);
    expect((props.focusItem as MaterialItem).id).toBe(2);
    // 只把该房间的物料传给查看器（别的房间的物料不混进来）
    const roomItems = props.items as MaterialItem[];
    expect(roomItems.every(i => (i.locationCode ?? "").startsWith("1012"))).toBe(true);
  });

  it("不带参数进入：仍是原来的房间网格，点卡片才进房间且不带任何定位", async () => {
    await renderPage();

    expect(screen.getByText("1F")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /库房/ })).toBeInTheDocument();
    expect(screen.queryByTestId("viewer-stub")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /库房/ }));

    await waitFor(() => expect(screen.getByTestId("viewer-stub")).toBeInTheDocument());
    expect(screen.getByTestId("layout-room-header")).toHaveTextContent("1012");
    const props = lastViewerProps();
    expect(props.roomCode).toBe("1012");
    expect(props.initialElementId).toBeUndefined();
    expect(props.focusElementId).toBeUndefined();
    expect(props.focusItem).toBeNull();
  });

  it("房间对不上时退回房间网格；只有元素对不上时仍进房间但不定位", async () => {
    setSearch("?room=9999&element=9999-Z&item=1");
    await renderPage();

    expect(screen.getByText("1F")).toBeInTheDocument();
    expect(screen.queryByTestId("viewer-stub")).not.toBeInTheDocument();

    setSearch("?room=1012&element=9999-Z");
    await renderPage();

    await waitFor(() => expect(screen.getByTestId("viewer-stub")).toBeInTheDocument());
    const props = lastViewerProps();
    expect(props.roomCode).toBe("1012");
    expect(props.initialElementId).toBeUndefined();
    expect(props.focusItem).toBeNull();
  });
});
