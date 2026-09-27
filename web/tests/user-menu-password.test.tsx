import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UserMenu } from "@/components/layout/UserMenu";
import { api } from "@/lib/api";
import { removeToken } from "@/lib/auth";

const mockPush = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({
  removeToken: vi.fn(),
  getToken: vi.fn(() => "tok"),
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { id: 1, username: "zhang", role: "member" }, loading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const mockedPut = vi.mocked(api.put as (endpoint: string, body: unknown) => Promise<unknown>);

/** 打开菜单 → 进入修改密码表单 → 填好 → 提交 */
function submitPasswordChange() {
  render(<UserMenu />);
  fireEvent.click(screen.getByText("zhang"));
  fireEvent.click(screen.getByText("修改密码"));
  fireEvent.change(screen.getByPlaceholderText("当前密码"), { target: { value: "oldpw123456" } });
  fireEvent.change(screen.getByPlaceholderText("新密码(至少6位)"), { target: { value: "newpw123456" } });
  fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("chatSessionId", "s-1");
  localStorage.setItem("baidu_authed", "1");
});

describe("修改密码", () => {
  // 回归：前端曾发 {current, newPwd}，服务端 record 是 CurrentPassword/NewPassword，
  // 字段名对不上 → 服务端永远 400，UI 却显示"当前密码错误"（把契约 bug 伪装成密码记错）。
  it("按服务端契约发送 currentPassword / newPassword", async () => {
    mockedPut.mockResolvedValueOnce({ success: true });

    submitPasswordChange();

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith("/api/auth/change-password", {
        currentPassword: "oldpw123456",
        newPassword: "newpw123456",
      })
    );
  });

  // 服务端改密码会自增 TokenVersion 让旧 token 立即失效，
  // 所以前端必须主动登出并说明原因，而不是等下一个请求 401。
  it("成功后清除登录态与本机残留状态并跳到登录页", async () => {
    mockedPut.mockResolvedValueOnce({ success: true });

    submitPasswordChange();

    await waitFor(() => expect(removeToken).toHaveBeenCalled());
    expect(mockPush).toHaveBeenCalledWith("/auth/login");
    expect(localStorage.getItem("chatSessionId")).toBeNull();
    expect(localStorage.getItem("baidu_authed")).toBeNull();
  });

  it("失败时提示原因且不跳转", async () => {
    mockedPut.mockRejectedValueOnce(new Error("400"));

    submitPasswordChange();

    expect(await screen.findByText(/修改失败/)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(removeToken).not.toHaveBeenCalled();
  });
});
