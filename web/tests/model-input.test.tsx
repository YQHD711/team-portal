import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModelInput, MODEL_SUGGESTIONS } from "@/components/ui/ModelInput";

/** 受控用法，和设置页 / Wiki 页一致：值由外部持有 */
function Harness({ initial = "deepseek-v4-pro", onChange = () => {} }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ModelInput
      value={value}
      onChange={v => { setValue(v); onChange(v); }}
      label="AI:ModelName"
    />
  );
}

const toggle = () => screen.getByTestId("model-input-toggle");
const input = () => screen.getByLabelText("AI:ModelName");

describe("ModelInput：可自由输入 + 受控下拉候选", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("点下拉按钮就展开候选（不再是浏览器自己管弹层的原生 datalist）", () => {
    render(<Harness />);
    expect(screen.queryByTestId("model-input-options")).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle());

    const list = screen.getByTestId("model-input-options");
    expect(list).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    for (const m of MODEL_SUGGESTIONS) {
      expect(screen.getByTestId(`model-option-${m}`)).toHaveTextContent(m);
    }
    expect(screen.getAllByRole("option")).toHaveLength(MODEL_SUGGESTIONS.length);
    // 再点一次收起
    fireEvent.click(toggle());
    expect(screen.queryByTestId("model-input-options")).not.toBeInTheDocument();
  });

  it("选中候选会写回输入框并收起列表", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(toggle());

    fireEvent.click(screen.getByTestId("model-option-deepseek-reasoner"));

    expect(input()).toHaveValue("deepseek-reasoner");
    expect(onChange).toHaveBeenCalledWith("deepseek-reasoner");
    expect(screen.queryByTestId("model-input-options")).not.toBeInTheDocument();
  });

  it("仍可手动输入任意模型名（不退化成一个只能选的 select）", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "my-self-hosted-qwen3-32b" } });
    expect(input()).toHaveValue("my-self-hosted-qwen3-32b");
    // 手输的值不在候选里也不该被改写
    fireEvent.click(toggle());
    expect(screen.queryByTestId("model-option-my-self-hosted-qwen3-32b")).not.toBeInTheDocument();
    expect(input()).toHaveValue("my-self-hosted-qwen3-32b");
  });

  it("Esc 与点击外部都会收起候选", () => {
    render(<Harness />);
    fireEvent.click(toggle());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByTestId("model-input-options")).not.toBeInTheDocument();

    fireEvent.click(toggle());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("model-input-options")).not.toBeInTheDocument();
  });

  it("键盘也能选：输入框里 ArrowDown 打开候选、Enter 写回", () => {
    render(<Harness />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByTestId("model-input-options")).toBeInTheDocument();

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input()).toHaveValue("deepseek-v4-flash");
  });

  // 回归：点箭头本身可能让浏览器把聚焦元素滚进视野 → 触发 scroll。
  // 曾经的做法是「一滚动就关闭」，表现就是用户说的「按了没反应」。
  it("滚动时弹层重算坐标跟着输入框，不许被关掉；贴底时向上弹", () => {
    let top = 100;
    vi.spyOn(HTMLInputElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLInputElement) {
      return { top, bottom: top + 38, left: 20, right: 220, width: 200, height: 38, x: 20, y: top, toJSON: () => ({}) } as DOMRect;
    });

    render(<Harness />);
    fireEvent.click(toggle());
    const list = () => screen.getByTestId("model-input-options");
    expect(list().style.top).toBe("142px"); // 100 + 38 + 4

    top = 300;
    fireEvent.scroll(window);
    expect(list()).toBeInTheDocument();
    expect(list().style.top).toBe("342px");

    // 视口只剩很小空间 → 改为向上弹（用 bottom 定位，避免被切掉）
    top = 700;
    fireEvent.scroll(window);
    expect(list().style.bottom).toBe("72px"); // innerHeight(768) - 700 + 4
    expect(list().style.top).toBe("");
  });
});
