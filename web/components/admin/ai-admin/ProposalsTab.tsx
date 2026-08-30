import { Check, FileText, RefreshCw, X } from "lucide-react";
import type { Proposal } from "./aiAdminTypes";

interface Props {
  proposals: Proposal[];
  onAction: (id: string, action: "approve" | "reject" | "retry" | "revert") => void;
  onRefresh: () => void;
}

/** AI 代码改进提案 Tab（提案列表 + 按状态显示操作按钮） */
export default function ProposalsTab({ proposals, onAction, onRefresh }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-bold">AI 代码改进提案</h3>
        <button onClick={onRefresh} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4 text-muted" /></button>
      </div>
      {proposals.length === 0 ? (
        <div className="text-center py-12 text-muted"><FileText className="h-8 w-8 mx-auto mb-2" />暂无提案。在分析对话中 AI 会自动生成改进提案。</div>
      ) : proposals.map(p => (
        <div key={p.id} className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="font-semibold">{p.title}</h4>
              <div className="text-xs text-muted mt-0.5">{p.filePath} · {new Date(p.createdAt).toLocaleString("zh-CN")}</div>
            </div>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              p.status === "pending" ? "bg-amber-100 text-amber-700" :
              p.status === "approved" ? "bg-blue-100 text-blue-700" :
              p.status === "applied" ? "bg-green-100 text-green-700" :
              p.status === "failed" ? "bg-red-100 text-red-700" :
              p.status === "reverted" ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-600"
            }`}>{p.status === "pending" ? "待审批" : p.status === "approved" ? "已批准" : p.status === "applied" ? "已应用" : p.status === "failed" ? "失败" : p.status === "reverted" ? "已回滚" : "已拒绝"}</span>
          </div>
          <p className="text-sm text-muted mb-3">{p.description}</p>
          {p.suggestedCode && (
            <div className="rounded-xl bg-slate-900 text-slate-300 p-3 text-xs font-mono overflow-x-auto max-h-40 mb-3">
              <pre>{p.suggestedCode.substring(0, 1000)}</pre>
            </div>
          )}
          {/* Error message */}
          {p.status === "failed" && p.errorMessage && (
            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/50 rounded-lg p-2 mb-2 font-mono">{p.errorMessage}</div>
          )}

          {/* Action buttons by status */}
          <div className="flex gap-2">
            {p.status === "pending" && (
              <>
                <button onClick={() => onAction(p.id, "approve")} className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600">
                  <Check className="h-3 w-3" />批准
                </button>
                <button onClick={() => onAction(p.id, "reject")} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs">
                  <X className="h-3 w-3" />拒绝
                </button>
              </>
            )}
            {p.status === "rejected" && (
              <button onClick={() => onAction(p.id, "retry")} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">
                <RefreshCw className="h-3 w-3" />重新提交
              </button>
            )}
            {p.status === "failed" && (
              <button onClick={() => onAction(p.id, "retry")} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">
                <RefreshCw className="h-3 w-3" />重试
              </button>
            )}
            {p.status === "applied" && (
              <button onClick={() => onAction(p.id, "revert")} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
                <RefreshCw className="h-3 w-3" />回滚
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
