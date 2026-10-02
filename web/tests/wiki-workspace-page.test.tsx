import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import WikiViewerPage from "@/app/(protected)/wiki/[id]/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentUser: () => ({ user: { role: "member", name: "member" }, loading: false }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url === "/api/wiki/tasks/t1")
      return Promise.resolve({ id: "t1", projectName: "wiki1", status: "completed", targetFolder: "公共", visibility: "public", type: "git" });
    if (url === "/api/wiki/tasks/t1/catalog") return Promise.resolve([]);
    if (url === "/api/wiki/tasks/t1/diagnose") return Promise.resolve({ workspaceExists: false, workspacePath: null });
    return Promise.resolve({});
  });
});

describe("Wiki 项目页：工作区丢失", () => {
  it("workspaceExists=false 时项目页挂出提示与「重新克隆」入口", async () => {
    render(<WikiViewerPage />);

    expect(await screen.findByText(/源码工作区已丢失/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新克隆源码/ })).toBeInTheDocument();
  });
});
