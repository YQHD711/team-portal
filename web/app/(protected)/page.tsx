"use client";

import { useState, useEffect } from "react";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { api } from "@/lib/api";
import { Bird, AlertTriangle, FileText, TrendingUp, Sparkles, Bell, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Stats { userCount: number; inventoryCount: number; inventoryTotal: number; departmentCount: number; }
interface NotifItem { id: number; title: string; message: string; link: string | null; createdAt: string; isRead: boolean; }
interface TaskInfo { id: string; projectName: string; status: string; createdAt: string; }
interface InventoryItem { id: number; name: string; quantity: number; category: string; }

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [lowStock, setLowStock] = useState<InventoryItem[]>([]);

  useEffect(() => {
    api.get<Stats>("/api/admin/stats").then(setStats).catch(() => {});
    api.get<NotifItem[]>("/api/notifications").then(d => setNotifs(d.slice(0, 6))).catch(() => {});
    api.get<TaskInfo[]>("/api/wiki/tasks").then(d => setTasks(d.filter(t => t.status === "completed").slice(0, 3))).catch(() => {});
    api.get<InventoryItem[]>("/api/inventory").then(items => setLowStock(items.filter(i => i.quantity < 5 && i.quantity > 0))).catch(() => {});
  }, []);

  const activeMembers = stats?.userCount ?? "—";
  const totalParts = stats?.inventoryTotal ?? "—";

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6 sm:p-8 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur">
              <Bird className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">雏鹰之翼 · 航模队</h1>
              <p className="text-blue-200/80 text-sm mt-1">队员协作平台 — 知识共享 · 库存追踪 · 飞行分析</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="text-center px-4 py-2 rounded-xl bg-white/10">
              <div className="text-2xl font-bold">{activeMembers}</div>
              <div className="text-xs text-blue-200/60">团队成员</div>
            </div>
            <div className="text-center px-4 py-2 rounded-xl bg-white/10">
              <div className="text-2xl font-bold">{totalParts}</div>
              <div className="text-xs text-blue-200/60">零件库存</div>
            </div>
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/10 text-xs text-blue-200">
            <Sparkles className="h-3 w-3" /> AI 驱动
          </div>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — alerts & recent activity */}
        <div className="lg:col-span-2 space-y-3">
          {/* Alerts */}
          {lowStock.length > 0 && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-amber-800 dark:text-amber-200">库存不足警告</div>
                <div className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {lowStock.map(i => `${i.name}(余${i.quantity})`).join("、")}
                </div>
              </div>
              <Link href="/inventory" className="shrink-0 text-xs text-amber-600 hover:underline mt-0.5">查看</Link>
            </div>
          )}

          {/* Recent notifications */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="h-4 w-4 text-muted" />
              <h3 className="font-semibold text-sm">团队动态</h3>
            </div>
            <div className="space-y-1.5">
              {notifs.map(n => (
                <div key={n.id} className="flex items-start gap-3 text-sm p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-blue-400" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{n.title}</span>
                      <span className="text-xs text-muted shrink-0">{new Date(n.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="text-xs text-muted mt-0.5">{n.message}</div>
                  </div>
                  {n.link && <Link href={n.link} className="shrink-0 text-xs text-blue-500 hover:underline mt-0.5">查看</Link>}
                </div>
              ))}
              {notifs.length === 0 && <div className="text-sm text-muted py-6 text-center">暂无团队动态</div>}
            </div>
          </div>
        </div>

        {/* Right column — wiki docs + quick links */}
        <div className="space-y-4">
          {/* Wiki projects */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-muted" />
              <h3 className="font-semibold text-sm">Wiki 文档</h3>
            </div>
            {tasks.length > 0 ? (
              <div className="space-y-2">
                {tasks.map(t => (
                  <Link key={t.id} href={`/wiki/${t.id}`}
                    className="flex items-center gap-2 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate group-hover:text-blue-600 transition-colors">{t.projectName}</div>
                      <div className="text-xs text-muted">{new Date(t.createdAt).toLocaleDateString("zh-CN")}</div>
                    </div>
                    <ExternalLink className="h-3 w-3 text-muted opacity-0 group-hover:opacity-100" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted py-4 text-center">
                暂无完成的项目<br />
                <Link href="/wiki/import" className="text-xs text-blue-500 hover:underline mt-1 inline-block">导入代码生成文档</Link>
              </div>
            )}
            {tasks.length > 0 && (
              <Link href="/wiki" className="block text-center text-xs text-blue-500 hover:underline mt-2 pt-2 border-t border-border">
                查看全部 Wiki 项目
              </Link>
            )}
          </div>

          {/* Quick links */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <h3 className="font-semibold text-sm mb-3">快捷操作</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/knowledge", label: "知识库", icon: FileText, color: "bg-blue-500/10 text-blue-600" },
                { href: "/inventory", label: "库存管理", icon: TrendingUp, color: "bg-amber-500/10 text-amber-600" },
                { href: "/flightlog", label: "飞行日志", icon: TrendingUp, color: "bg-emerald-500/10 text-emerald-600" },
                { href: "/admin/users", label: "用户管理", icon: Bird, color: "bg-purple-500/10 text-purple-600" },
              ].map(item => (
                <Link key={item.href} href={item.href}
                  className="card-hover flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${item.color}`}>
                    <item.icon className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Chat */}
      <ChatPanel />
    </div>
  );
}
