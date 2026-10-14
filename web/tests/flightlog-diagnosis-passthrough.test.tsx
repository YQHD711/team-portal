/**
 * 契约补口的回归测试：`DiagnosisResult.document` 必须真的透传到图表。
 *
 * 背景：规则只通过 `ChartRequest` 声明"该看哪几条曲线"，曲线的原始采样只能从 `LogDocument` 取。
 * 如果 `runDiagnosis` 不回传 document（或 UI 不透传），时序图会**静默地**永远显示"无数据"，
 * 而这在快照/文案层面看不出来——所以这里必须两端都钉住。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { LogDocument } from "@/lib/flightlog/types/log";
import type {
  ChartRequest,
  DiagnosisReport,
  Finding,
} from "@/lib/flightlog/types/report";

const runMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flightlog/runDiagnosis", () => ({ runDiagnosis: runMock }));
// jsdom 没有 canvas 2D：uPlot 换成只挂 canvas 的替身，验证的是"我们的数据与容器契约"
vi.mock("uplot", () => ({
  default: class {
    constructor(_opts: unknown, _data: unknown, target: HTMLElement) {
      target.appendChild(document.createElement("canvas"));
    }
    destroy() {}
  },
}));
vi.mock("@/components/flightlog/LogFileList", () => ({
  LogFileList: () => <div data-testid="logs-tab" />,
}));
vi.mock("@/components/flightlog/FirmwarePanel", () => ({
  FirmwarePanel: () => <div data-testid="fw-tab" />,
}));

import { DiagnosisPanel } from "@/components/flightlog/diagnosis/DiagnosisPanel";

const timeSeriesChart: ChartRequest = {
  id: "c1",
  kind: "timeseries",
  title: "Pitch 速率环：指令 / 实际 / 误差",
  signals: [{ series: "PIDP", field: "Err", label: "误差 Err" }],
  window: null,
  thresholds: [{ value: 0.1, label: "阈值", axis: "y" }],
  peakMarkers: [],
  highlightWindow: null,
  spectrum: null,
};

const finding: Finding = {
  ruleId: "pid_rate_tracking",
  title: "速率环跟踪质量（Pitch）",
  severity: "critical",
  status: "fired",
  window: null,
  axis: "pitch",
  phenomenon: "跟踪偏差偏大",
  impact: "姿态抖动",
  evidence: [{ label: "样本", detail: "600" }],
  metrics: { errRatio: 1.2 },
  suggestions: [],
  docLinks: [],
  charts: [timeSeriesChart],
  note: null,
};

const report: DiagnosisReport = {
  meta: {
    platform: "ardupilot",
    vehicleKind: "copter",
    vehicle: "ArduCopter",
    firmwareVersion: "4.6.2",
    firmwareString: "ArduCopter V4.6.2 (1ebd4d99)",
    versionNumeric: 40602,
    durationSec: 60,
    armed: true,
  },
  fileName: "a.bin",
  sizeBytes: 1024,
  parseMs: 200,
  analyzeMs: 5,
  summary: { critical: 1, warning: 0, passed: 0, unknown: 0 },
  findings: [finding],
};

const logDocument: LogDocument = {
  meta: report.meta,
  series: {
    "PIDP:0": {
      name: "PIDP",
      instance: 0,
      timeSec: Float64Array.from([0, 0.1, 0.2, 0.3]),
      fields: { Err: Float64Array.from([0, 0.1, 0.2, 0.1]) },
      units: { Err: "rad/s" },
    },
  },
  events: [],
  params: {},
  messageCounts: { PIDP: 4 },
  decodedFields: { PIDP: ["Err"] },
  warnings: [],
};

async function dropFile() {
  render(<DiagnosisPanel />);
  fireEvent.change(screen.getByTestId("diagnosis-file-input"), {
    target: { files: [new File(["x"], "a.bin")] },
  });
  await screen.findByTestId("diagnosis-report");
}

beforeEach(() => {
  runMock.mockReset();
});

describe("诊断结果 → 图表的数据透传", () => {
  it("runDiagnosis 返回 document 时，时序图取到信号并渲染（不是「无数据」占位）", async () => {
    runMock.mockResolvedValue({ report, document: logDocument });
    await dropFile();
    await waitFor(() =>
      expect(screen.getByTestId("diagnosis-chart")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("diagnosis-chart-empty")).toBeNull();
  });

  it("负向对照：缺 document 时明确显示「无数据」占位，不静默空白", async () => {
    runMock.mockResolvedValue({ report });
    await dropFile();
    expect(await screen.findByTestId("diagnosis-chart-empty")).toBeInTheDocument();
  });
});
