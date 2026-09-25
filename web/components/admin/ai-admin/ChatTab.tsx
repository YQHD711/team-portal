import { Brain, Database, Loader2, Send, Trash2 } from "lucide-react";
import type { ChatEntry, MemoryStats } from "./aiAdminTypes";

/** 预设运维任务：全部是「读数据 + 给结论」，不涉及任何写操作。 */
const presets = [
  { label: "系统健康巡检", task: "请做一次系统健康巡检：数据库连通性、日志写入通道积压、磁盘剩余空间、进程运行情况，并检查最近的错误日志。给出结论和需要注意的地方。" },
  { label: "排查最近报错", task: "请查看最近 24 小时的错误与警告日志，按分类归纳，指出最值得关注的问题和可能的根因，以及管理员下一步该做什么。" },
  { label: "备份是否正常", task: "请检查备份情况：最近一次备份是什么时间、备份数量与大小是否正常、有没有需要管理员注意的风险。" },
  { label: "知识库现状", task: "请统计知识库各目录的文档数量和最近更新时间，指出哪些目录还是空的，并给出维护建议。" },
  { label: "团队与库存概览", task: "请给出团队与业务概览：各部门人数与角色分布、低于库存阈值的零件、Wiki 任务状态分布与最近的失败任务。" },
];

interface Props {
  history: ChatEntry[];
  loading: boolean;
  memory: MemoryStats | null;
  task: string;
  onTask: (v: string) => void;
  onRun: (t: string) => void;
  onClearMemory: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

/** 运维对话 Tab（预设任务 + 聊天区 + 自定义输入） */
export default function ChatTab({ history, loading, memory, task, onTask, onRun, onClearMemory, chatEndRef }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Presets */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">常用巡检</h3>
        {presets.map(p => (
          <button key={p.label} onClick={() => onRun(p.task)}
            disabled={loading}
            className="w-full text-left p-3 rounded-xl border border-border hover:bg-surface-hover transition-colors disabled:opacity-50">
            <div className="text-sm font-medium">{p.label}</div>
            <div className="text-xs text-muted mt-0.5 truncate">{p.task.substring(0, 50)}...</div>
          </button>
        ))}
      </div>

      {/* Chat area */}
      <div className="lg:col-span-2 rounded-2xl border border-border bg-surface flex flex-col" style={{ minHeight: "60vh" }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-purple-50/50 dark:bg-purple-950/20">
          <div className="flex items-center gap-2 text-xs">
            <Database className="h-3 w-3 text-purple-500" />
            <span className="text-muted">
              连续记忆 · {memory?.total ?? "?"} 条消息
              {memory && memory.summaries > 0 && <span className="text-purple-500 ml-1">({memory.summaries}次压缩)</span>}
            </span>
          </div>
          <button onClick={onClearMemory} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-muted hover:text-danger" title="清除记忆">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {/* System messages (compressed memory) shown as collapsible cards */}
          {history.filter(m => m.role === "system").slice(-3).map((msg, i) => (
            <div key={"sys"+i} className="text-xs text-muted bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-1.5 border border-amber-200 dark:border-amber-800">
              {msg.content}
            </div>
          ))}
          {/* Only show last 12 messages, rest auto-compressed */}
          {history.filter(m => m.role !== "system").slice(-12).map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : ""}`}>
              <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[80%] shadow-sm ${
                msg.role === "user" ? "rounded-br-md bg-gradient-to-br from-primary to-accent text-white" : "rounded-bl-md bg-slate-50 dark:bg-slate-800 border border-border"
              }`}>
                {msg.role === "user" && <div className="font-medium text-xs mb-1 opacity-70">管理员指令</div>}
                <div className="whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">{msg.content}</div>
              </div>
            </div>
          ))}
          {history.filter(m => m.role !== "system").length > 12 && (
            <div className="text-center text-xs text-muted py-1 border-t border-border">
              ↑ 以上仅显示最近12条消息，更早内容已压缩为记忆摘要
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />AI 正在读取系统数据...</div>
          )}
          {history.length === 0 && !loading && (
            <div className="flex items-center justify-center h-full text-muted text-sm">
              <div className="text-center">
                <Brain className="h-10 w-10 mx-auto mb-2 text-purple-300" />
                选择左侧巡检任务，或用下方输入框提问<br />
                <span className="text-xs text-muted mt-1">助手只读取数据做诊断与答疑，不会修改任何内容</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Custom input */}
        <div className="p-3 border-t border-border">
          <form onSubmit={e => { e.preventDefault(); if (task.trim()) { onRun(task); onTask(""); } }} className="flex gap-2">
            <input value={task} onChange={e => onTask(e.target.value)} placeholder="提问，例如「最近为什么有人登录失败」..."
              className="flex-1 rounded-xl border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            <button type="submit" disabled={loading || !task.trim()} className="rounded-xl bg-primary px-4 py-2 text-white hover:bg-accent-hover disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </form>
          <p className="text-xs text-muted mt-2">只读助手：不修改数据、不改代码、不编译、不重启服务。</p>
        </div>
      </div>
    </div>
  );
}
