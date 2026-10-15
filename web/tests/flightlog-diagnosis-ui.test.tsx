import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DiagnosisReport, Finding } from "@/lib/flightlog/types/report";
import { buildChartData, pickSeries } from "@/components/flightlog/diagnosis/chartData";
import { isUnknownSide, statusLabel } from "@/components/flightlog/diagnosis/format";
import { DiagnosisPanel } from "@/components/flightlog/diagnosis/DiagnosisPanel";

/**
 * 诊断报告 UI：结论优先、证据可展开。
 * ⚠️ 最重要的负向对照：unknown 一侧（not_applicable / missing_required / …）**绝不能**渲染成「通过」。
 */

const runMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flightlog/runDiagnosis", () => ({ runDiagnosis: runMock }));
// jsdom 没有 canvas 2D：把 uPlot 换成不画图的替身，只验证我们的数据/容器
vi.mock("uplot", () => ({
  default: class {
    constructor(_o: unknown, _d: unknown, target: HTMLElement) { target.appendChild(document.createElement("canvas")); }
    destroy() {}
  },
}));
vi.mock("@/components/flightlog/LogFileList", () => ({ LogFileList: () => <div data-testid="logs-tab" /> }));
vi.mock("@/components/flightlog/FirmwarePanel", () => ({ FirmwarePanel: () => <div data-testid="fw-tab" /> }));
// 报告出来后会挂载诊断历史（拉 /api/flight-diagnoses）：空列表替身，避免测试去发真实请求
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(async () => ({ total: 0, items: [] })), post: vi.fn(), put: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
import FlightLogPage from "@/app/(protected)/flightlog/page";

const finding = (over: Partial<Finding> & Pick<Finding, "ruleId" | "title" | "severity" | "status">): Finding => ({
  window: { startSec: 12.5, endSec: 40 },
  axis: "roll",
  phenomenon: "现象描述",
  impact: "影响判断",
  evidence: [{ label: "样本数", detail: "3274" }],
  metrics: { rms: 1.234 },
  suggestions: [{ order: 1, text: "降低 P 增益", param: { name: "ATC_RAT_RLL_P", from: 0.25, to: 0.18, reason: "抑制低频振荡" }, verify: "rate error RMS 下降 ≥30%" }],
  docLinks: ["https://ardupilot.org/copter/docs/tuning-process-instructions.html"],
  charts: [],
  note: null,
  ...over,
});

const spectrumChart = {
  id: "c1", kind: "spectrum" as const, title: "Err 频谱", signals: [],
  window: null, thresholds: [{ value: 10, label: "10Hz 参考", axis: "x" as const }],
  peakMarkers: [{ freqHz: 11.5, label: "陷波中心" }], highlightWindow: null,
  spectrum: { ref: { series: "PIDR", field: "Err" }, points: [{ freqHz: 5, power: 0.5 }, { freqHz: 11.5, power: 3.2 }, { freqHz: 20, power: 0.1 }], peakHz: 11.5 },
};

const report: DiagnosisReport = {
  meta: {
    platform: "ardupilot", vehicleKind: "copter", vehicle: "ArduCopter", firmwareVersion: "4.6.2",
    firmwareString: "ArduCopter V4.6.2 (1ebd4d99)", versionNumeric: 40602, durationSec: 125.4, armed: true,
  },
  fileName: "quad_20260617.bin", sizeBytes: 10_200_000, parseMs: 480, analyzeMs: 120, summary: { critical: 1, warning: 0, passed: 1, unknown: 2 },
  findings: [
    finding({ ruleId: "pid-osc", title: "速率环低频振荡", severity: "critical", status: "fired", charts: [spectrumChart] }),
    finding({ ruleId: "vibe-ok", title: "振动水平", severity: "ok", status: "passed" }),
    finding({ ruleId: "filter-na", title: "滤波有效性", severity: "unknown", status: "not_applicable", note: "本规则要求 ArduPilot ≥ 4.4（需要 PIDR 逐项日志），当前 4.0.3" }),
    finding({ ruleId: "vibe-missing", title: "振动超标", severity: "unknown", status: "missing_required", note: "缺少 VIBE 消息，无法评估振动" }),
  ],
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

const showReport = async () => {
  runMock.mockResolvedValue({ report });
  render(<DiagnosisPanel />);
  const file = new File([new Uint8Array([1, 2, 3])], "quad_20260617.bin");
  fireEvent.change(screen.getByTestId("diagnosis-file-input"), { target: { files: [file] } });
  await screen.findByTestId("diagnosis-report");
  return file;
};

describe("诊断报告 UI", () => {
  it("critical 结论渲染严重等级与五要素（时间定位/现象/影响/建议）", async () => {
    await showReport();

    const card = screen.getByText("速率环低频振荡").closest("[data-testid='finding-card']") as HTMLElement;
    expect(within(card).getByTestId("finding-severity")).toHaveTextContent("严重");
    expect(within(card).getByTestId("finding-status")).toHaveTextContent("已触发");
    expect(within(card).getByTestId("finding-phenomenon")).toHaveTextContent("现象描述");
    expect(within(card).getByTestId("finding-impact")).toHaveTextContent("影响判断");
    expect(card).toHaveTextContent("12.50s – 40.00s");
    // 展开证据：metrics / 判定过程 / 建议步骤（param from→to + verify）/ 依据
    expect(within(card).getByTestId("evidence-metrics")).toHaveTextContent("1.23");
    expect(within(card).getByTestId("evidence-steps")).toHaveTextContent("样本数");
    expect(within(card).getByTestId("suggestion-param")).toHaveTextContent("0.25");
    expect(within(card).getByTestId("suggestion-param-to")).toHaveTextContent("0.18");
    expect(within(card).getByTestId("suggestion-verify")).toHaveTextContent("RMS 下降");
    expect(within(card).getByTestId("evidence-doc-links")).toHaveTextContent("ardupilot.org");
  });

  it("status=passed 才显示「通过」", async () => {
    await showReport();

    const passed = screen.getByText("振动水平").closest("[data-testid='finding-card']")!;
    expect(within(passed as HTMLElement).getByTestId("finding-status")).toHaveTextContent("通过");
  });

  it("结构性不适用折叠成一行（条数与名称可见），展开后仍显示原因、**不显示「通过」**", async () => {
    await showReport();

    // 折叠行：数量与名称必须可见（折叠 ≠ 静默）
    const summary = screen.getByTestId("finding-na-summary");
    expect(summary).toHaveTextContent("本机型不适用 1 项：滤波有效性");
    // 机型缺失的项不单独占卡片（用户：非此机型的数据不要展示）
    expect(screen.queryAllByTestId("finding-card").some(el => el.textContent?.includes("滤波有效性"))).toBe(false);

    // 展开后可看到每条的原因，且绝不出现「通过」
    fireEvent.click(summary);
    const card = screen.getByText("滤波有效性").closest("[data-testid='finding-card']") as HTMLElement;
    expect(within(card).getByTestId("finding-severity")).toHaveTextContent("不适用");
    expect(within(card).getByTestId("finding-note")).toHaveTextContent("要求 ArduPilot ≥ 4.4");
    expect(within(card).getByTestId("finding-severity")).not.toHaveTextContent("通过");
    expect(within(card).getByTestId("finding-note")).not.toHaveTextContent("通过");

    // 缺数据（missing_required）不属于结构性不适用 → 仍然单独成卡片
    const missing = screen.getByText("振动超标").closest("[data-testid='finding-card']") as HTMLElement;
    expect(within(missing).getByTestId("finding-status")).toHaveTextContent("缺少必需数据");
    expect(within(missing).getByTestId("finding-note")).toHaveTextContent("缺少 VIBE 消息");

    // 纯函数层面也钉住：unknown 一侧的状态都不是 passed
    expect(isUnknownSide("not_applicable")).toBe(true);
    expect(isUnknownSide("missing_required")).toBe(true);
    expect(isUnknownSide("insufficient_data")).toBe(true);
    expect(isUnknownSide("checked_but_not_supported")).toBe(true);
    expect(isUnknownSide("passed")).toBe(false);
    expect(statusLabel("insufficient_data")).toContain("无法判断");
  });

  it("runDiagnosis 抛错（未接线）：显示可读错误，不静默", async () => {
    runMock.mockRejectedValue(new Error("日志诊断尚未接线：解析器与规则引擎正在接入"));
    render(<DiagnosisPanel />);
    fireEvent.change(screen.getByTestId("diagnosis-file-input"), {
      target: { files: [new File([new Uint8Array([1])], "a.bin")] },
    });

    expect(await screen.findByTestId("diagnosis-error")).toHaveTextContent("尚未接线");
    expect(screen.queryByTestId("diagnosis-report")).not.toBeInTheDocument();
  });

  it("拖入文件被接受：交给 runDiagnosis 并显示进度", async () => {
    let done: (v: { report: DiagnosisReport }) => void = () => {};
    runMock.mockImplementation((_file: File, opts?: { onProgress?: (p: unknown) => void }) => {
      opts?.onProgress?.({ phase: "parsing", percent: 42, message: "解析 DataFlash 消息…" });
      return new Promise(resolve => { done = resolve as typeof done; });
    });
    render(<DiagnosisPanel />);

    const file = new File([new Uint8Array([9, 9])], "fr_raw_0803.bin");
    fireEvent.drop(screen.getByTestId("diagnosis-dropzone"), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    expect(runMock.mock.calls[0][0]).toBe(file);
    expect(screen.getByTestId("diagnosis-progress")).toHaveTextContent("42%");
    done({ report });
    expect(await screen.findByTestId("diagnosis-report")).toBeInTheDocument();
  });

  it("频谱图用规则给的 points（UI 不重算 FFT）；时序图无数据时占位不崩", async () => {
    await showReport();

    expect(screen.getByTestId("diagnosis-chart")).toHaveAttribute("data-chart-kind", "spectrum");
    expect(screen.getByTestId("diagnosis-chart-canvas")).toBeInTheDocument();
    // 时序图：没有 LogDocument 数据 → 明确占位，不猜不补零
    const ts = buildChartData({ ...spectrumChart, id: "t", kind: "timeseries", spectrum: null }, []);
    expect(ts).toBeNull();
    // 不降采样：点数是源数据的点数（谱图 3 点 → 数据仍是 3 点）
    const spec = buildChartData(spectrumChart, []);
    expect(spec).not.toBeNull();
    expect(spec![0]).toHaveLength(spectrumChart.spectrum.points.length);
  });

  it("pickSeries：按 SignalRef 从 LogDocument 取曲线，缺字段返回 null（不补零）", () => {
    const doc = {
      series: { "PIDR:0": { name: "PIDR", instance: 0, timeSec: new Float64Array([0, 1, 2]), fields: { Err: new Float64Array([1, 2, 3]) }, units: {} } },
    } as unknown as Parameters<typeof pickSeries>[0];

    expect(pickSeries(doc, { series: "PIDR", field: "Err" })?.values).toHaveLength(3);
    const s = pickSeries(doc, { series: "PIDR", field: "Err" })!;
    expect(buildChartData({ ...spectrumChart, kind: "timeseries", spectrum: null }, [s])![0]).toHaveLength(3);
    expect(pickSeries(doc, { series: "VIBE", field: "VibeX" })).toBeNull();
  });

  it("/flightlog 页：默认标签仍是「日志文件」，切到「诊断」出现诊断面板", async () => {
    render(<FlightLogPage />);

    expect(screen.getByRole("tab", { name: "日志文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("logs-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("diagnosis-dropzone")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "诊断" }));
    expect(screen.getByTestId("diagnosis-dropzone")).toBeInTheDocument();
    expect(screen.getByTestId("diagnosis-empty")).toBeInTheDocument();
  });
});
