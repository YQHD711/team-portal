"use client";

import { useState } from "react";
import { History, Activity } from "lucide-react";
import OperationLogsTab from "@/components/admin/logs/OperationLogsTab";
import RequestLogsTab from "@/components/admin/logs/RequestLogsTab";

export default function LogsPage() {
  const [tab, setTab] = useState<"operation" | "request">("operation");

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">系统日志</h1>
          <p className="text-sm text-muted">操作审计与系统运行日志分离查看</p>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-1 w-fit">
        <button onClick={() => setTab("operation")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${tab === "operation" ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
          <History className="h-4 w-4" />操作日志
        </button>
        <button onClick={() => setTab("request")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${tab === "request" ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
          <Activity className="h-4 w-4" />请求日志
        </button>
      </div>

      {tab === "operation" ? <OperationLogsTab /> : <RequestLogsTab />}
    </div>
  );
}
