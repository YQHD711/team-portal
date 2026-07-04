import { ChatPanel } from "@/components/ai/ChatPanel";
import { Bird, Users, BookOpen, Package } from "lucide-react";

const stats = [
  { label: "知识库文档", value: "—", icon: BookOpen, color: "text-blue-600 bg-blue-100 dark:bg-blue-950" },
  { label: "库存零件", value: "—", icon: Package, color: "text-amber-600 bg-amber-100 dark:bg-amber-950" },
  { label: "飞行日志", value: "—", icon: Bird, color: "text-sky-600 bg-sky-100 dark:bg-sky-950" },
];

export default function Home() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Welcome */}
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-lg shadow-sky-500/25">
          <Bird className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">雏鹰之翼航模队</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            高校航模队管理与运营系统
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:shadow-md transition-shadow"
          >
            <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Chat */}
      <ChatPanel />
    </div>
  );
}
