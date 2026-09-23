import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/layout/SidebarContext", () => ({
  useSidebar: () => ({ open: true, setOpen: vi.fn() }),
}));
vi.mock("@/lib/brand", () => ({
  useBrand: () => ({ teamName: "雏鹰之翼", teamSubtitle: "航模队" }),
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { role: "member", username: "u" }, loading: false, refresh: vi.fn() }),
}));
// Sidebar 依赖 usePathname 做高亮；裸 jsdom 里它是 null
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** 重新导入模块，让 NEXT_PUBLIC_* 的编译期内联逻辑重新求值 */
async function loadBuildInfo(sha: string, run: string) {
  vi.stubEnv("NEXT_PUBLIC_BUILD_SHA", sha);
  vi.stubEnv("NEXT_PUBLIC_BUILD_RUN", run);
  vi.resetModules();
  return import("@/lib/build-info");
}

describe("构建版本号", () => {
  it("未注入时显示 dev（本地构建）", async () => {
    const info = await loadBuildInfo("", "");

    expect(info.buildShortSha).toBe("dev");
    expect(info.buildLabel).toBe("dev");
  });

  it("只注入 commit 时显示短 sha", async () => {
    const info = await loadBuildInfo("2f72a11abcdef0123456789abcdef0123456789a", "");

    expect(info.buildShortSha).toBe("2f72a11");
    expect(info.buildLabel).toBe("2f72a11");
  });

  it("commit + CI 运行编号 → 「#编号 · 短sha」，方便和 Actions 页面对上", async () => {
    const info = await loadBuildInfo("2f72a11abcdef0123456789abcdef0123456789a", "120");

    expect(info.buildLabel).toBe("#120 · 2f72a11");
  });

  it("侧边栏页脚渲染出版本号（用于确认线上跑的是哪个 commit）", async () => {
    const { Sidebar } = await import("@/components/layout/Sidebar");
    render(<Sidebar />);

    expect(screen.getByText("雏鹰之翼 © 2026 · 内部系统")).toBeInTheDocument();
    expect(screen.getByTitle(/构建版本/)).toBeInTheDocument();
  });
});
