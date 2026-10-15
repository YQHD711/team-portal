/**
 * FindingCard 的 note / 建议渲染回归防线。
 *
 * 线上缺口：`note` 原来只在 unknown 一侧渲染 → **fired 结论上的"起点值声明/降落段排除依据"与建议
 * 全部看不到**（恰恰是最需要它们的时候）。这里对四种 status 分别钉住"note 默认可见 + 建议可见 +
 * from → to 数字被渲染"。
 */

import { describe, expect, it } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Finding, Severity, CheckStatus } from "@/lib/flightlog/types/report";
import { FindingCard } from "@/components/flightlog/diagnosis/FindingCard";

const base: Finding = {
  ruleId: "pid_rate",
  title: "速率环跟踪质量（Roll）",
  severity: "warning",
  status: "fired",
  window: { startSec: 10, endSec: 20 },
  axis: "roll",
  phenomenon: "跟踪误差偏大",
  impact: "姿态跟随差",
  evidence: [{ label: "样本", detail: "600" }],
  metrics: { rms: 1.2 },
  suggestions: [],
  docLinks: [],
  charts: [],
  note: null,
};

const paramSuggestion = {
  order: 1,
  text: "把 D 项滤波调回与陀螺滤波同量级",
  param: { name: "ATC_RAT_RLL_FLTD", from: 40, to: 20, reason: "D 项滤波过高会引入噪声" },
  verify: "复飞后 D 项不再放大高频噪声，跟踪误差 RMS 不升",
};

const finding = (over: Partial<Finding>): Finding => ({ ...base, ...over });

describe("FindingCard：note 与建议默认可见（四种 status）", () => {
  it("fired（警告）：note 弱化但可见，建议块与 from → to 数字都渲染出来", () => {
    render(<FindingCard finding={finding({
      severity: "warning", status: "fired",
      note: "⚠️ 建议值是由实测签名推导的**起点值**，依赖「纯延迟 + 单一主频」近似",
      suggestions: [paramSuggestion],
    })} />);

    const note = screen.getByTestId("finding-note");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent("起点值");
    expect(note.className).toContain("text-faint");          // 弱化，不与 impact 抢眼

    const block = screen.getByTestId("finding-suggestions");
    expect(block).toBeVisible();                            // **不需要展开证据**就能看到
    expect(within(block).getByTestId("suggestion-param")).toHaveTextContent("ATC_RAT_RLL_FLTD");
    expect(within(block).getByTestId("suggestion-param-to")).toHaveTextContent("20");
    expect(block).toHaveTextContent("40");
    expect(block).toHaveTextContent("→");
    expect(within(block).getByTestId("suggestion-verify")).toHaveTextContent("RMS");
  });

  it("passed（通过）但带建议：note 与建议同样可见", () => {
    render(<FindingCard finding={finding({
      severity: "ok", status: "passed",
      note: "已排除降落段 320.5s–325.1s（依据 MODE=LAND）",
      suggestions: [{ ...paramSuggestion, param: { name: "INS_HNTCH_ATT", from: null, to: 15, reason: "起点值" } }],
    })} />);

    expect(screen.getByTestId("finding-note")).toBeVisible();
    expect(screen.getByTestId("finding-note")).toHaveTextContent("已排除降落段");
    expect(screen.getByTestId("finding-suggestions")).toBeVisible();
    expect(screen.getByTestId("suggestion-param-to")).toHaveTextContent("15");
  });

  it("insufficient_data（样本不足）：原因醒目显示，且不显示「通过」", () => {
    render(<FindingCard finding={finding({
      severity: "unknown", status: "insufficient_data",
      note: "窗口内样本只有 12 个，低于门槛 50 个，无法给出统计结论",
      suggestions: [],
    })} />);

    const note = screen.getByTestId("finding-note");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent("低于门槛 50 个");
    expect(note.className).toContain("border-warning");       // unknown 一侧保持醒目
    expect(screen.getByTestId("finding-status")).not.toHaveTextContent("通过");
    expect(screen.queryByTestId("finding-suggestions")).not.toBeInTheDocument();
  });

  it("missing_required（缺数据）：原因可见，绝不渲染成通过", () => {
    render(<FindingCard finding={finding({
      severity: "unknown", status: "missing_required",
      note: "缺少 VIBE 消息，无法评估振动",
      suggestions: [],
    })} />);

    expect(screen.getByTestId("finding-note")).toBeVisible();
    expect(screen.getByTestId("finding-note")).toHaveTextContent("缺少 VIBE");
    expect(screen.getByTestId("finding-status")).not.toHaveTextContent("通过");
  });

  it("note 为空：不渲染空壳；证据仍可折叠展开", async () => {
    render(<FindingCard finding={finding({ status: "fired", note: null, suggestions: [paramSuggestion] })} />);

    expect(screen.queryByTestId("finding-note")).not.toBeInTheDocument();
    expect(screen.getByTestId("finding-suggestions")).toBeVisible();
    expect(screen.queryByTestId("evidence-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("finding-toggle"));
    expect(await screen.findByTestId("evidence-panel")).toBeInTheDocument();
  });
});
