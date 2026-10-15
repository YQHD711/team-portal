import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { LogDocument } from "@/lib/flightlog/types/log";
import type { DiagnosisReport } from "@/lib/flightlog/types/report";
import type { FlightDiagnosisRecord } from "@/lib/flightDiagnosesApi";

/**
 * 诊断历史（落库/回看/对比）+ 落库失败不影响报告。
 * 接口可能还没上线（404/失败）→ 只显示一句非阻塞提示，报告照常。
 */

const runMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flightlog/runDiagnosis", () => ({ runDiagnosis: runMock }));
vi.mock("uplot", () => ({
  default: class { constructor(_o: unknown, _d: unknown, t: HTMLElement) { t.appendChild(document.createElement("canvas")); } destroy() {} },
}));
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

import { DiagnosisPanel } from "@/components/flightlog/diagnosis/DiagnosisPanel";
import { DiagnosisHistory } from "@/components/flightlog/diagnosis/DiagnosisHistory";
import { api } from "@/lib/api";

const mockedGet = vi.mocked(api.get as (e: string) => Promise<unknown>);
const mockedPost = vi.mocked(api.post as (e: string, b?: unknown) => Promise<unknown>);

const meta = {
  platform: "ardupilot" as const, vehicleKind: "copter" as const, vehicle: "ArduCopter",
  firmwareVersion: "4.6.2", firmwareString: "ArduCopter V4.6.2", versionNumeric: 40602,
  durationSec: 120, armed: true,
};
const report: DiagnosisReport = {
  meta, fileName: "quad_20260617.bin", sizeBytes: 1024, parseMs: 196, analyzeMs: 12,
  summary: { critical: 3, warning: 1, passed: 0, unknown: 2 },
  findings: [{
    ruleId: "vibration_level", title: "振动超标", severity: "critical", status: "fired",
    window: null, axis: null, phenomenon: "p", impact: "i", evidence: [], metrics: {},
    suggestions: [], docLinks: [], charts: [], note: null,
  }],
};
const doc: LogDocument = {
  meta, series: {}, events: [], params: {}, messageCounts: {}, decodedFields: {}, warnings: [],
};
const result = {
  report, document: doc,
  parseStats: { records: 229_590, skippedBytes: 0, decodedTypes: 81, totalTypes: 81, parseMs: 196, analyzeMs: 12, warnings: [] },
};

const record = (over: Partial<FlightDiagnosisRecord>): FlightDiagnosisRecord => ({
  id: 1, fileName: "quad_20260617.bin", sizeBytes: 1024, records: 100, skippedBytes: 0,
  durationSec: 100, vehicle: "ArduCopter", vehicleKind: "copter", firmwareVersion: "4.6.2",
  versionNumeric: 40602, parseMs: 100, analyzeMs: 10, decodedTypes: 81, totalTypes: 81,
  critical: 0, warning: 2, passed: 1, unknown: 0, warnings: ["旧记录的警告"],
  findings: [{ ruleId: "vibration_level", title: "振动超标", severity: "warning", status: "fired", axis: null }],
  createdBy: "admin", createdAt: "2026-10-12T10:00:00Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockResolvedValue({ total: 0, items: [] });
  mockedPost.mockResolvedValue({ id: 1, createdAt: "2026-10-13T10:00:00Z" });
});
afterEach(() => vi.restoreAllMocks());

describe("诊断历史列表与对比", () => {
  it("渲染记录（时间/文件名/机型/严重/警告/无法判断/耗时），同文件显示「较上次」对比", async () => {
    mockedGet.mockResolvedValue({
      total: 3,
      items: [
        record({ id: 3, createdAt: "2026-10-13T10:00:00Z", critical: 3, warning: 1 }),
        record({ id: 2, createdAt: "2026-10-12T10:00:00Z", critical: 0, warning: 2 }),
        record({ id: 1, fileName: "other.bin", createdAt: "2026-10-11T10:00:00Z" }),
      ],
    });
    render(<DiagnosisHistory />);

    const items = await screen.findAllByTestId("history-item");
    expect(items).toHaveLength(3);
    const newest = document.querySelector('[data-record-id="3"]') as HTMLElement;
    expect(within(newest).getByText(/严重 3/)).toBeInTheDocument();
    expect(mockedGet.mock.calls[0][0]).toContain("/api/flight-diagnoses?limit=20");

    // 只有"同一 fileName 且确有更早记录"的那条才显示对比
    const compares = screen.getAllByTestId("history-compare");
    expect(compares).toHaveLength(1);
    expect(compares[0]).toHaveTextContent(/较上次/);
    expect(compares[0]).toHaveTextContent(/严重 0→3、警告 2→1/);
  });

  it("点击展开该条的结论摘要与 warnings", async () => {
    mockedGet.mockResolvedValue({ total: 1, items: [record({})] });
    render(<DiagnosisHistory />);
    await screen.findAllByTestId("history-item");

    fireEvent.click(screen.getByTestId("history-toggle"));

    const detail = screen.getByTestId("history-detail");
    expect(detail).toHaveTextContent("振动超标");
    expect(detail).toHaveTextContent("已触发");
    expect(detail).toHaveTextContent("旧记录的警告");
  });

  it("空列表与接口失败都是可读状态（不白屏）", async () => {
    const first = render(<DiagnosisHistory />);
    expect(await screen.findByTestId("history-empty")).toBeInTheDocument();
    first.unmount();

    mockedGet.mockRejectedValue(new Error("HTTP 404"));
    render(<DiagnosisHistory />);
    expect(await screen.findByTestId("history-error")).toHaveTextContent("诊断历史接口不可用");
    expect(screen.getByTestId("diagnosis-history")).toBeInTheDocument();
  });
});

describe("诊断落库（接口未上线也要能用）", () => {
  const analyze = async () => {
    render(<DiagnosisPanel />);
    fireEvent.change(screen.getByTestId("diagnosis-file-input"), { target: { files: [new File(["x"], "quad_20260617.bin")] } });
    await screen.findByTestId("diagnosis-report");
  };

  it("落库成功时 POST 契约字段（只传摘要，warnings 截断到 20 条），报告照常", async () => {
    runMock.mockResolvedValue({
      ...result,
      parseStats: {
        ...result.parseStats, skippedBytes: 4096, decodedTypes: 78,
        // 25 条（超 20 条上限）+ 一条超长（>500 字，必须被截断）
        warnings: ["超长警告 ".repeat(120), ...Array.from({ length: 25 }, (_, i) => `w${i}`)],
      },
    });
    await analyze();

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/api/flight-diagnoses");
    expect(body).toMatchObject({ fileName: "quad_20260617.bin", records: 229_590, skippedBytes: 4096, critical: 3, warning: 1, decodedTypes: 78, totalTypes: 81 });
    const sent = body.warnings as string[];
    expect(sent).toHaveLength(20);                                    // 条数上限
    expect(sent[0].length).toBeLessThanOrEqual(501);                  // 每条 ≤500 字（+省略号）
    expect(sent[0].endsWith("…")).toBe(true);
    expect(body.findings).toEqual([{ ruleId: "vibration_level", title: "振动超标", severity: "critical", status: "fired", axis: null }]);
    expect(body).not.toHaveProperty("document");
    expect(screen.queryByTestId("diagnosis-save-note")).not.toBeInTheDocument();
    // 解析日志面板也用的是同一份 parseStats
    expect(screen.getByTestId("parse-skipped-warning")).toBeInTheDocument();
    expect(screen.getByTestId("parse-coverage-warning")).toHaveTextContent("未完整覆盖 3 种消息类型");
  });

  it("负向对照：POST 失败（404/接口未上线）只提示一句，报告与结论完整保留", async () => {
    mockedPost.mockRejectedValue(new Error("HTTP 404"));
    runMock.mockResolvedValue(result);
    await analyze();

    expect(await screen.findByTestId("diagnosis-save-note")).toHaveTextContent("诊断记录未保存（接口不可用）");
    expect(screen.getByTestId("diagnosis-report")).toBeInTheDocument();
    expect(screen.getByTestId("parse-log-panel")).toBeInTheDocument();
    expect(screen.getByText("振动超标")).toBeInTheDocument();
    expect(screen.queryByTestId("diagnosis-error")).not.toBeInTheDocument();
  });
});
