"use client";

import { CheckCircle, XCircle, Clock, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { ProgressBar } from "@/components/ui/ProgressBar";

export interface WikiTaskProgress {
  stage: string;
  done: number;
  total: number;
  note: string | null;
  updatedAt: string;
}

export interface WikiTaskInfo {
  id: string;
  type: string;
  projectName: string;
  status: string;
  visibility: string;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  progress?: WikiTaskProgress | null;
}

/** 每个任务类型的阶段顺序（用于步骤条）。 */
const STAGES: Record<string, { key: string; label: string }[]> = {
  translate: [
    { key: "preparing", label: "准备" },
    { key: "cloning", label: "克隆" },
    { key: "translating", label: "翻译" },
    { key: "completed", label: "完成" },
  ],
  default: [
    { key: "preparing", label: "准备" },
    { key: "catalog", label: "目录" },
    { key: "documents", label: "文档" },
    { key: "reviewing", label: "审查" },
    { key: "completed", label: "完成" },
  ],
};

const ACTIVE = new Set(["pending", "preparing", "cloning", "catalog", "documents", "translating", "reviewing"]);

export function isActiveTask(status: string): boolean {
  return ACTIVE.has(status);
}

export function stagesFor(type: string) {
  return STAGES[type] ?? STAGES.default;
}

function statusLabel(task: WikiTaskInfo): string {
  switch (task.status) {
    case "completed": return "已完成";
    case "failed": return "失败";
    case "pending": return "排队中（后台每 30 秒取一次任务）";
    case "preparing": return "准备中";
    case "cloning": return "克隆仓库";
    case "translating": return "翻译中";
    case "catalog": return "生成目录";
    case "documents": return "生成文档";
    case "reviewing": return "审查文档";
    default: return task.status;
  }
}

function statusIcon(s: string) {
  if (s === "completed") return <CheckCircle className="h-4 w-4 text-success" />;
  if (s === "failed") return <XCircle className="h-4 w-4 text-danger" />;
  if (s === "pending") return <Clock className="h-4 w-4 text-amber-500" />;
  return <Loader2 className="h-4 w-4 animate-spin text-sky-500" />;
}

/** 已用时长：进行中按当前时间算，已完成按 CompletedAt。 */
function elapsedText(task: WikiTaskInfo): string {
  const start = new Date(task.createdAt).getTime();
  const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || end <= start) return "";
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分 ${sec % 60} 秒`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}

/** 阶段步骤条：已走完的阶段打勾，当前阶段高亮（失败时把卡住的那个阶段标红）。 */
function StageBar({ type, status, stage }: { type: string; status: string; stage?: string | null }) {
  const stages = stagesFor(type);
  const failed = status === "failed";
  // 失败/完成时 status 本身不在阶段表里，用进度上报的 stage 定位卡在哪一步
  const current = stages.findIndex(s => s.key === (failed ? stage ?? "" : status));

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
      {stages.map((s, i) => {
        const passed = current > i || status === "completed";
        const active = current === i && status !== "completed";
        return (
          <span key={s.key} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-faint">›</span>}
            <span
              className={
                failed && active
                  ? "rounded px-1.5 py-0.5 bg-danger/10 text-danger font-medium"
                  : passed
                    ? "rounded px-1.5 py-0.5 bg-success/10 text-success"
                    : active
                      ? "rounded px-1.5 py-0.5 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium"
                      : "rounded px-1.5 py-0.5 text-faint"
              }
            >
              {s.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** 进度条：有 total 时确定态，否则不确定态（目录生成这类单次 AI 调用没有可数单元）。 */
function TaskProgress({ task }: { task: WikiTaskInfo }) {
  const p = task.progress;
  if (task.status === "completed") {
    return <ProgressBar percent={100} label={`${task.projectName} 生成进度`} left="已完成" right={elapsedText(task)} />;
  }
  if (!p) {
    return isActiveTask(task.status)
      ? <ProgressBar percent={null} label={`${task.projectName} 生成进度`} left={statusLabel(task)} right="等待后台进度上报…" />
      : null;
  }
  const percent = p.total > 0 ? (p.done / p.total) * 100 : null;
  return (
    <ProgressBar
      percent={percent}
      label={`${task.projectName} 生成进度`}
      left={p.total > 0 ? `${p.done} / ${p.total} ${p.note ? "· " + p.note : ""}` : (p.note ?? statusLabel(task))}
      right={elapsedText(task)}
    />
  );
}

export function TaskQueue({
  tasks, isStaff, onRefresh, onDelete,
}: {
  tasks: WikiTaskInfo[];
  isStaff: boolean;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-bold">任务队列</h2>
        <button onClick={onRefresh} className="p-1 rounded hover:bg-surface-hover" title="立即刷新">
          <RefreshCw className="h-4 w-4 text-faint" />
        </button>
        {tasks.some(t => isActiveTask(t.status)) && (
          <span className="text-xs text-faint">进行中的任务每 5 秒自动刷新</span>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface divide-y divide-border-subtle">
        {tasks.length === 0 ? (
          <div className="p-8 text-center text-faint">暂无任务</div>
        ) : (
          tasks.map(t => (
            <div key={t.id} data-testid={`wiki-task-${t.id}`} className="p-3 space-y-2">
              <div className="flex items-center gap-3">
                {statusIcon(t.status)}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {t.projectName}
                    <span className="text-xs text-faint ml-1">
                      ({t.visibility === "department" ? "部门" : t.visibility === "personal" ? "个人" : "公共"})
                    </span>
                  </div>
                  <div className="text-xs text-muted">{statusLabel(t)}</div>
                </div>
                <div className="text-xs text-faint shrink-0">{new Date(t.createdAt).toLocaleString("zh-CN")}</div>
                {isStaff && (
                  <button
                    onClick={() => onDelete(t.id)}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-faint hover:text-danger shrink-0"
                    title="删除任务"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {t.errorMessage && (
                <div className="text-xs text-danger rounded-lg bg-danger/5 px-2 py-1">{t.errorMessage}</div>
              )}

              <StageBar type={t.type} status={t.status} stage={t.progress?.stage} />
              <TaskProgress task={t} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
