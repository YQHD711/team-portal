/**
 * 诊断历史：最近几次诊断的落库记录（可回看结论摘要与 warnings），并与**同一文件**的更早记录对比。
 *
 * 加载策略：本组件只在报告已经渲染出来之后才挂载 → 不拖慢首屏。
 * 接口未上线/失败 → 可读状态，绝不白屏。
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import type { FlightDiagnosisRecord } from "@/lib/flightDiagnosesApi";
import { listFlightDiagnoses } from "@/lib/flightDiagnosesApi";
import { SEVERITY_LABEL, statusLabel } from "./format";

const fmtTime = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
};

/** 同一 fileName 的"更早一次"（按 createdAt 升序排在当前记录之前的那条） */
export function previousSameFile(items: readonly FlightDiagnosisRecord[], index: number): FlightDiagnosisRecord | null {
  const current = items[index];
  const earlier = items
    .filter(r => r.fileName === current.fileName && r.createdAt < current.createdAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return earlier[0] ?? null;
}

export function DiagnosisHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<FlightDiagnosisRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(false);
    listFlightDiagnoses({ limit: 20 })
      .then(res => { if (!cancelled) setItems(res.items); })
      .catch(() => { if (!cancelled) { setItems([]); setError(true); } });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <section data-testid="diagnosis-history" className="rounded-xl border border-border bg-surface p-4">
      <header className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted" />
        <h3 className="text-sm font-semibold">诊断历史</h3>
        <span className="text-xs text-faint">最近 20 条（管理员/部长可见全部，队员只看自己）</span>
      </header>

      {items === null && <p data-testid="history-loading" className="mt-3 text-xs text-faint">加载中…</p>}

      {items !== null && error && (
        <p data-testid="history-error"
          className="mt-3 rounded-lg border-l-4 border-warning bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          诊断历史接口不可用（可能尚未上线）；本次诊断不受影响。
        </p>
      )}

      {items !== null && !error && items.length === 0 && (
        <p data-testid="history-empty" className="mt-3 text-xs text-faint">还没有历史记录。</p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((r, i) => {
            const prev = previousSameFile(items, i);
            const open = openId === r.id;
            return (
              <li key={r.id} data-testid="history-item" data-record-id={r.id} data-file-name={r.fileName}
                className="rounded-lg border border-border">
                <button type="button" data-testid="history-toggle" onClick={() => setOpenId(open ? null : r.id)}
                  aria-expanded={open} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover">
                  {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  <span className="font-mono text-faint">{fmtTime(r.createdAt)}</span>
                  <span className="font-medium">{r.fileName}</span>
                  <span className="text-muted">{r.vehicle} {r.firmwareVersion}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-danger">严重 {r.critical}</span>
                    <span className="text-warning">警告 {r.warning}</span>
                    <span className="text-muted">无法判断 {r.unknown}</span>
                    <span className="text-faint">总计 {Math.round((r.parseMs + r.analyzeMs))} ms</span>
                  </span>
                </button>

                {prev && (
                  <p data-testid="history-compare" className="px-3 pb-2 text-[11px] text-muted">
                    较上次（{fmtTime(prev.createdAt)}）：严重 {prev.critical}→{r.critical}、警告 {prev.warning}→{r.warning}
                  </p>
                )}

                {open && (
                  <div data-testid="history-detail" className="space-y-2 border-t border-border px-3 py-2">
                    <div>
                      <h5 className="text-[11px] font-medium text-muted">结论摘要</h5>
                      <ul className="mt-1 space-y-0.5">
                        {(r.findings ?? []).map(f => (
                          <li key={f.ruleId} className="text-xs">
                            <span className="text-faint">{SEVERITY_LABEL[f.severity]}</span>
                            {" · "}{f.title}
                            {" "}<span className="text-muted">（{statusLabel(f.status)}）</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {(r.warnings ?? []).length > 0 && (
                      <div>
                        <h5 className="text-[11px] font-medium text-muted">解析警告 {r.warnings.length} 条</h5>
                        <ul className="mt-1 space-y-0.5">
                          {r.warnings.map((w, k) => (
                            <li key={k} className="font-mono text-[11px] break-all text-muted">{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
