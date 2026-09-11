import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SettingsPage from "@/app/(protected)/admin/settings/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock("@/lib/brand", () => ({
  useBrand: () => ({ refresh: vi.fn(), teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "", description: "", logoUrl: null, primaryColor: null, theme: "indigo", loading: false }),
}));

const mockGet = vi.mocked(api.get as (url: string) => Promise<unknown>);

const settingsPayload = {
  "AI 服务": [
    { key: "AI:SystemPrompt", value: "", category: "AI 服务", description: "AI 助手系统提示词（留空使用内置默认…）" },
    { key: "AI:ModelName", value: "deepseek-v4-pro", category: "AI 服务", description: "对话/分析模型名称" },
    { key: "AI:DeepSeekKey", value: "secret", category: "AI 服务", description: "DeepSeek API Key" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(settingsPayload);
});

describe("系统设置：AI 提示词", () => {
  it("提示词用多行文本框编辑，模型名仍是单行可自由输入", async () => {
    render(<SettingsPage />);

    // 提示词是长文本，必须是 textarea（单行输入框没法编辑）
    const prompt = await screen.findByLabelText("AI:SystemPrompt");
    expect(prompt.tagName).toBe("TEXTAREA");
    expect(prompt).toHaveAttribute("placeholder", "留空 = 使用内置默认提示词");

    // 模型名保持单行 + datalist 建议
    const model = screen.getByLabelText("AI:ModelName");
    expect(model.tagName).toBe("INPUT");
    expect(model).toHaveValue("deepseek-v4-pro");
    expect(model).toHaveAttribute("list");

    // 密钥仍然是密码框
    const key = screen.getByLabelText("AI:DeepSeekKey");
    expect(key).toHaveAttribute("type", "password");
  });

  it("修改提示词会写进提交内容", async () => {
    render(<SettingsPage />);
    const prompt = await screen.findByLabelText("AI:SystemPrompt");

    fireEvent.change(prompt, { target: { value: "只用一句话回答" } });

    expect(prompt).toHaveValue("只用一句话回答");
  });
});
