import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

const refresh = vi.fn();
const notifications = [
  { id: 1, title: "库存不足", message: "螺旋桨只剩 1 个", link: null, level: "warning", isRead: false, createdAt: "2026-09-27T10:00:00Z" },
  { id: 2, title: "审批通过", message: "采购申请已通过", link: null, level: "success", isRead: true, createdAt: "2026-09-27T09:00:00Z" },
];

vi.mock("@/lib/hooks", () => ({
  useNotifications: () => ({ notifications, unreadCount: 1, refresh }),
}));

const mockedPost = vi.mocked(api.post as (endpoint: string, body: unknown) => Promise<unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  mockedPost.mockResolvedValue({ cleared: 2 });
  vi.stubGlobal("confirm", vi.fn(() => true));
});

/** 「清除」= 清我自己的通知列表（后端按用户打标记，不动共享的通知行）。 */
describe("通知铃铛 · 清除", () => {
  it("有通知时显示清除按钮，点击后调清除接口并刷新", async () => {
    render(<NotificationBell />);
    // 打开铃铛面板（触发按钮没有可访问名称，用容器选择器）
    fireEvent.click(document.querySelector("button.relative") as HTMLElement);

    const clear = await screen.findByRole("button", { name: "清除" });
    fireEvent.click(clear);

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/notifications/clear", {}));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("取消确认时不发请求", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<NotificationBell />);
    fireEvent.click(document.querySelector("button.relative") as HTMLElement);

    fireEvent.click(await screen.findByRole("button", { name: "清除" }));

    expect(mockedPost).not.toHaveBeenCalled();
  });
});
