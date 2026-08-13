import { Brain, Database, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import type { MemoryStats } from "./aiAdminTypes";

const presets = [
  { label: "系统健康检查", task: "请对系统进行全面健康检查：分析最近的日志、错误率、数据库大小、API响应情况。给出诊断报告和改进建议。" },
  { label: "团队分析报告", task: "请分析团队的使用情况：活跃成员数、知识库使用频率、库存变化趋势。给出团队发展建议。" },
  { label: "代码质量审查", task: "请审查项目的主要代码文件，找出潜在问题、性能瓶颈、安全隐患。给出具体的改进建议。" },
  { label: "功能完善建议", task: "基于当前系统功能和使用数据，分析哪些功能需要完善或新增，按优先级排序。" },
];

interface Props {
  history: { role: string; content: string }[];
  loading: boolean;
  memory: MemoryStats | null;
  task: string;
  onTask: (v: string) => void;
  onRun: (t: string) => void;
  onClearMemory: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

/** 分析对话 Tab（预设任务 + 聊天区 + 自定义输入） */
export default function ChatTab({ history, loading, memory, task, onTask, onRun, onClearMemory, chatEndRef }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Presets */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">分析任务</h3>
        {presets.map(p => (
          <button key={p.label} onClick={() => onRun(p.task)}
            disabled={loading}
            className="w-full text-left p-3 rounded-xl border border-border hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
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
          <button onClick={onClearMemory} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-muted hover:text-red-500" title="清除记忆">
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
                msg.role === "user" ? "rounded-br-md bg-gradient-to-br from-purple-500 to-purple-600 text-white" : "rounded-bl-md bg-slate-50 dark:bg-slate-800 border border-border"
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
            <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />AI 正在分析系统数据...</div>
          )}
          {history.length === 0 && !loading && (
            <div className="flex items-center justify-center h-full text-muted text-sm">
              <div className="text-center">
                <Brain className="h-10 w-10 mx-auto mb-2 text-purple-300" />
                选择左侧分析任务或输入自定义指令<br />
                <span className="text-xs text-muted mt-1">所有对话在一个记忆体中，超过45条自动压缩</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Custom input */}
        <div className="p-3 border-t border-border">
          <form onSubmit={e => { e.preventDefault(); if (task.trim()) { onRun(task); onTask(""); } }} className="flex gap-2">
            <input value={task} onChange={e => onTask(e.target.value)} placeholder="输入自定义分析指令..."
              className="flex-1 rounded-xl border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
            <button type="submit" disabled={loading || !task.trim()} className="rounded-xl bg-purple-500 px-4 py-2 text-white hover:bg-purple-600 disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      </div>
    </div>
  );
}
