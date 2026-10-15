import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DiagnosisParseStats } from "@/lib/flightlog/runDiagnosis";
import { ParseLogPanel } from "@/components/flightlog/diagnosis/ParseLogPanel";

/**
 * 「解析日志」面板：排查解析失败看的就是这里。
 * 两条硬要求：skippedBytes>0 必须**醒目告警**、覆盖度不足必须**明确标注**（都不是灰色小字）。
 */

const stats = (over: Partial<DiagnosisParseStats> = {}): DiagnosisParseStats => ({
  records: 229_590,
  skippedBytes: 0,
  decodedTypes: 81,
  totalTypes: 81,
  parseMs: 196,
  analyzeMs: 12,
  warnings: [],
  ...over,
});

describe("解析日志面板", () => {
  it("skippedBytes > 0：危险色醒目告警，写清跳过了多少字节", () => {
    render(<ParseLogPanel stats={stats({ skippedBytes: 4096 })} />);

    const warn = screen.getByTestId("parse-skipped-warning");
    expect(warn).toHaveTextContent("4096 字节");
    expect(warn).toHaveTextContent("被跳过");
    expect(warn.className).toContain("border-danger");   // 不是灰色小字
    expect(screen.queryByTestId("parse-skipped-none")).not.toBeInTheDocument();
  });

  it("skippedBytes = 0：显示「无跳过字节」，不误报", () => {
    render(<ParseLogPanel stats={stats()} />);

    expect(screen.getByTestId("parse-skipped-none")).toHaveTextContent("无跳过字节");
    expect(screen.queryByTestId("parse-skipped-warning")).not.toBeInTheDocument();
  });

  it("decodedTypes < totalTypes：明确标注未完整覆盖多少种类型", () => {
    render(<ParseLogPanel stats={stats({ decodedTypes: 78, totalTypes: 81 })} />);

    expect(screen.getByTestId("parse-coverage")).toHaveTextContent("78 / 81");
    const warn = screen.getByTestId("parse-coverage-warning");
    expect(warn).toHaveTextContent("未完整覆盖 3 种消息类型");
    expect(warn.className).toContain("border-warning");
  });

  it("覆盖完整时不出现覆盖告警", () => {
    render(<ParseLogPanel stats={stats()} />);
    expect(screen.queryByTestId("parse-coverage-warning")).not.toBeInTheDocument();
  });

  it("warnings 逐条原文展示（可折叠）；没有警告时不渲染空壳", () => {
    const { unmount } = render(<ParseLogPanel stats={stats({ warnings: ["第 12 字节处 CRC 不符", "未知消息类型 0x9a"] })} />);

    expect(screen.queryByTestId("parse-warnings")).not.toBeInTheDocument();   // 默认折叠
    fireEvent.click(screen.getByTestId("parse-warnings-toggle"));
    const items = screen.getAllByTestId("parse-warning-item");
    expect(items.map(i => i.textContent)).toEqual(["第 12 字节处 CRC 不符", "未知消息类型 0x9a"]);
    unmount();

    render(<ParseLogPanel stats={stats({ warnings: [] })} />);
    expect(screen.queryByTestId("parse-warnings-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("parse-warnings")).not.toBeInTheDocument();
  });

  it("records === 0：给结论（可能不是 DataFlash 日志），而不是一堆 0", () => {
    render(<ParseLogPanel stats={stats({ records: 0, decodedTypes: 0, totalTypes: 0 })} />);

    expect(screen.getByTestId("parse-records-zero")).toHaveTextContent("很可能不是 DataFlash 日志");
    expect(screen.getByTestId("parse-records")).toHaveTextContent("0 条记录");
  });

  it("展示解析/分析耗时与总记录数", () => {
    render(<ParseLogPanel stats={stats({ parseMs: 1500, analyzeMs: 340 })} />);

    expect(screen.getByTestId("parse-timing")).toHaveTextContent("解析 1.50 s");
    expect(screen.getByTestId("parse-timing")).toHaveTextContent("分析 340 ms");
    expect(screen.getByTestId("parse-records")).toHaveTextContent("229590");
  });
});
