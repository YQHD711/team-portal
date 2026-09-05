import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import LoginPage from "@/app/auth/login/page";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({
  setToken: vi.fn(),
  getToken: vi.fn(() => null),
  removeToken: vi.fn(),
}));
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/auth/login",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  useSelectedLayoutSegment: () => null,
  useSelectedLayoutSegments: () => [],
}));

const mockedPost = vi.mocked(api.post as (endpoint: string, body: unknown) => Promise<unknown>);
const mockedSetToken = vi.mocked(setToken);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("登录页", () => {
  it("渲染品牌文案与表单元素", () => {
    render(<LoginPage />);

    expect(screen.getByText("雏鹰之翼")).toBeInTheDocument();
    expect(screen.getByText("雏鹰之翼航模队 · 内部系统")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入密码")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /注册/ })).toHaveAttribute("href", "/auth/register");
  });

  it("提交后调用登录接口、存 token 并跳转首页", async () => {
    mockedPost.mockResolvedValueOnce({ token: "tok-123" });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入用户名"), { target: { value: "admin" } });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /登录/ }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/auth/login", { username: "admin", password: "secret" })
    );
    expect(mockedSetToken).toHaveBeenCalledWith("tok-123");
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("登录失败展示后端错误信息", async () => {
    mockedPost.mockRejectedValueOnce(new Error("用户名或密码错误"));

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入用户名"), { target: { value: "admin" } });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /登录/ }));

    expect(await screen.findByText("用户名或密码错误")).toBeInTheDocument();
    // 失败后不应跳转
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("请求进行中按钮显示登录中并禁用", async () => {
    let resolveLogin!: (v: unknown) => void;
    mockedPost.mockImplementationOnce(() => new Promise((r) => { resolveLogin = r; }));

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入用户名"), { target: { value: "admin" } });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /登录/ }));

    expect(await screen.findByText("登录中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /登录/ })).toBeDisabled();

    resolveLogin({ token: "t" });
  });
});
