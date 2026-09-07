import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import WeChatBindPage from "@/app/auth/wechat/bind/page";
import { wechat } from "@/lib/api";
import { setToken } from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  wechat: { config: vi.fn(), bind: vi.fn(), unbind: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({
  setToken: vi.fn(),
  getToken: vi.fn(() => null),
  removeToken: vi.fn(),
}));
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace, refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/auth/wechat/bind",
  useSearchParams: () => new URLSearchParams("binding=e2e-token"),
  useParams: () => ({}),
  useSelectedLayoutSegment: () => null,
  useSelectedLayoutSegments: () => [],
}));

const mockedBind = vi.mocked(wechat.bind);
const mockedSetToken = vi.mocked(setToken);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("微信绑定页", () => {
  it("渲染绑定表单", () => {
    render(<WeChatBindPage />);
    expect(screen.getByText("绑定已有账号")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入系统用户名")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入系统密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /绑定并登录/ })).toBeInTheDocument();
  });

  it("绑定成功写入 token 并跳转首页", async () => {
    mockedBind.mockResolvedValueOnce({ token: "tok-wechat" });

    render(<WeChatBindPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入系统用户名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("请输入系统密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /绑定并登录/ }));

    await waitFor(() =>
      expect(mockedBind).toHaveBeenCalledWith("e2e-token", "alice", "secret")
    );
    expect(mockedSetToken).toHaveBeenCalledWith("tok-wechat");
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("绑定失败展示错误且不跳转", async () => {
    mockedBind.mockRejectedValueOnce(new Error("用户名或密码错误"));

    render(<WeChatBindPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入系统用户名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("请输入系统密码"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /绑定并登录/ }));

    expect(await screen.findByText("用户名或密码错误")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
