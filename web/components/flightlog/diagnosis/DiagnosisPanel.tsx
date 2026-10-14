"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileWarning, Loader2, Upload } from "lucide-react";
import type { DiagnosisReport } from "@/lib/flightlog/types/report";
import type { LogDocument } from "@/lib/flightlog/types/log";
import { runDiagnosis, type DiagnosisProgress } from "@/lib/flightlog/runDiagnosis";
import { ReportHeader } from "./ReportHeader";
import { FindingList } from "./FindingList";

type Status = "idle" | "running" | "done" | "error";

/** 诊断容器：拖拽/选择文件 → runDiagnosis → 报告 / 进度 / 错误 */
export function DiagnosisPanel({ document: documentProp }: { document?: LogDocument }) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<DiagnosisProgress | null>(null);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [document, setDocument] = useState<LogDocument | undefined>(documentProp);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const analyze = useCallback(async (file: File) => {
    if (status === "running") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFileName(file.name);
    setStatus("running");
    setError("");
    setReport(null);
    setDocument(undefined);
    setProgress({ phase: "parsing", percent: 0, message: "开始解析日志…" });

    try {
      const result = await runDiagnosis(file, { onProgress: setProgress, signal: controller.signal });
      setReport(result.report);
      // 时序图的原始信号来自这里；谱图点已在 ChartRequest.spectrum 里
      setDocument(result.document);
      setStatus("done");
    } catch (err) {
      // 未接线/解析失败都必须让用户看到原因（不允许静默失败）
      setError(err instanceof Error ? err.message : "诊断失败：未知错误");
      setStatus("error");
    } finally {
      setProgress(null);
    }
  }, [status]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0] ?? (e.dataTransfer?.items?.[0]?.getAsFile() ?? null);
    if (file) void analyze(file);
  };

  return (
    <div className="space-y-4">
      <div data-testid="diagnosis-dropzone"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-surface-hover"
        }`}>
        <Upload className="mx-auto mb-2 h-6 w-6 text-muted" />
        <p className="text-sm font-medium">把 .bin / .log 飞控日志拖到这里</p>
        <p className="mt-1 text-xs text-faint">或点击选择文件；解析与规则全部在本地进行</p>
        <input ref={inputRef} data-testid="diagnosis-file-input" type="file" className="hidden"
          accept=".bin,.log,.BIN,.LOG" onChange={e => { const f = e.target.files?.[0]; if (f) void analyze(f); }} />
      </div>

      {status === "running" && (
        <div data-testid="diagnosis-progress" className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{progress?.message ?? "分析中…"}</span>
            <span className="ml-auto font-mono text-xs text-muted">{progress?.percent ?? 0}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-faint">{fileName} · {progress?.phase === "analyzing" ? "规则分析" : "解析"}</p>
        </div>
      )}

      {status === "error" && (
        <div data-testid="diagnosis-error" className="flex gap-2 rounded-xl border-l-4 border-danger bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">诊断失败</p>
            <p className="mt-1 text-xs leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {status === "done" && report && (
        <div data-testid="diagnosis-report" className="space-y-4">
          <ReportHeader report={report} />
          <FindingList report={report} doc={document} />
        </div>
      )}

      {status === "idle" && (
        <p data-testid="diagnosis-empty" className="flex items-center justify-center gap-2 py-6 text-xs text-faint">
          <FileWarning className="h-4 w-4" />还没有诊断结果 —— 拖一份日志进来即可出首屏报告
        </p>
      )}
    </div>
  );
}
