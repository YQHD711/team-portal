"use client";

import { useState, useEffect } from "react";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { api } from "@/lib/api";
import { AlertTriangle, FileText, TrendingUp, Sparkles, Bell, ExternalLink, Package, BarChart3, Clock, History, Loader2, User, DollarSign, Crosshair } from "lucide-react";
import Link from "next/link";

interface DashData { users: number; inventory: number; inventoryTotal: number; departments: number; flights: number; flightsMonth: number; flightHours: number; flightHoursMonth: number; pendingPurchases: number; monthSpent: number; lowStock: { id:number;name:string;quantity:number;category:string }[]; recentFlights: { id:number;aircraftModel:string;takeoffTime:string;durationMinutes:number|null;pilotUserId:number }[]; activeWiki: { id:string;projectName:string;status:string }[]; recentIncidents: { id:number;type:string;severity:string;description:string;date:string }[]; completedWiki: number; }
interface NotifItem { id: number; title: string; message: string; link: string | null; createdAt: string; }

export default function Home() {
  const [data, setData] = useState<DashData | null>(null);
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [recentDocs, setRecentDocs] = useState<{ path: string; title: string; time: number }[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { try { setRecentDocs(JSON.parse(localStorage.getItem("recentDocs") || "[]")); } catch {} }, []);

  useEffect(() => {
    Promise.all([
      api.get<DashData>("/api/dashboard").catch(() => null),
      api.get<NotifItem[]>("/api/notifications").catch(() => []),
      api.get<{ role: string }>("/api/auth/me").then(u => setIsStaff(u.role === "admin" || u.role === "部长")).catch(() => {}),
    ]).then(([d, n]) => {
      if (d) setData(d);
      setNotifs((n as NotifItem[]).slice(0, 8));
      setLoaded(true);
    });
  }, []);

  const Skeleton = ({w="w-16",h="h-6"}:{w?:string;h?:string}) => <span className={`inline-block ${w} ${h} bg-slate-200 dark:bg-slate-700 rounded animate-pulse`} />;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6 sm:p-8 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur overflow-hidden">
              <img src="/logo.png" alt="雏鹰之翼" className="w-10 h-10 object-contain" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">雏鹰之翼 · 航模队</h1>
              <p className="text-blue-200/80 text-sm mt-1">队员协作平台 — 知识共享 · 库存追踪 · 飞行分析</p>
            </div>
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/10 text-xs text-blue-200"><Sparkles className="h-3 w-3" /> AI 驱动</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "团队人数", value: data?.users, icon: User, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
          { label: "零件库存", value: data?.inventoryTotal, icon: Package, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
          { label: "总飞行次数", value: data?.flights, icon: TrendingUp, color: "text-sky-600 bg-sky-50 dark:bg-sky-950/30" },
          { label: "飞行小时", value: data ? `${data.flightHours}h` : null, icon: Clock, color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
          { label: "本月飞行", value: data?.flightsMonth, icon: Crosshair, color: "text-purple-600 bg-purple-50 dark:bg-purple-950/30" },
          { label: "本月支出", value: data ? `¥${data.monthSpent}` : null, icon: DollarSign, color: "text-red-600 bg-red-50 dark:bg-red-950/30" },
        ].map((s, i) => (
          <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-center">
            <div className="text-xl font-bold">{loaded ? (s.value ?? "-") : <Skeleton />}</div>
            <div className="text-xs text-zinc-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left */}
        <div className="lg:col-span-2 space-y-4">
          {/* Alerts */}
          {data?.lowStock && data.lowStock.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-amber-800 dark:text-amber-200">库存不足警告</div>
                <div className="text-sm text-amber-700 dark:text-amber-300 mt-1">{data.lowStock.map(i => `${i.name}(余${i.quantity})`).join("、")}</div>
              </div>
              <Link href="/inventory" className="shrink-0 text-xs text-amber-600 hover:underline mt-0.5">补货</Link>
            </div>
          )}

          {/* Recent incidents */}
          {data?.recentIncidents && data.recentIncidents.length > 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4">
              <div className="flex items-center gap-2 mb-2"><AlertTriangle className="h-4 w-4 text-red-500" /><h3 className="font-semibold text-sm text-red-800 dark:text-red-200">最近事故</h3></div>
              <div className="space-y-2">
                {data.recentIncidents.map(i => (
                  <div key={i.id} className="flex items-center gap-2 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                    <span className="font-medium">{i.type}</span>
                    <span className="text-zinc-500 text-xs">{i.description.slice(0,40)}...</span>
                    <span className="text-zinc-400 text-xs ml-auto">{new Date(i.date).toLocaleDateString("zh-CN")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notifications */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center gap-2 mb-3"><Bell className="h-4 w-4 text-zinc-500" /><h3 className="font-semibold text-sm">团队动态</h3></div>
            <div className="space-y-1">
              {notifs.map(n => (
                <div key={n.id} className="flex items-start gap-3 text-sm p-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-blue-400" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="font-medium truncate">{n.title}</span><span className="text-xs text-zinc-400 shrink-0">{new Date(n.createdAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</span></div>
                    <div className="text-xs text-zinc-500 mt-0.5">{n.message}</div>
                  </div>
                  {n.link && <Link href={n.link} className="shrink-0 text-xs text-blue-500 hover:underline mt-0.5">查看</Link>}
                </div>
              ))}
              {notifs.length === 0 && <div className="text-sm text-zinc-400 py-6 text-center">{loaded ? "暂无团队动态" : "加载中..."}</div>}
            </div>
          </div>

          {/* Recent flights */}
          {data?.recentFlights && data.recentFlights.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="flex items-center gap-2 mb-3"><TrendingUp className="h-4 w-4 text-zinc-500" /><h3 className="font-semibold text-sm">最近飞行</h3></div>
              <div className="space-y-2">
                {data.recentFlights.map(f => (
                  <div key={f.id} className="flex items-center gap-3 text-sm p-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center text-sky-600 shrink-0"><TrendingUp className="h-4 w-4"/></div>
                    <div className="flex-1 min-w-0"><div className="font-medium truncate">{f.aircraftModel}</div><div className="text-xs text-zinc-400">{f.durationMinutes ? `${f.durationMinutes}min` : "-"}</div></div>
                    <span className="text-xs text-zinc-400 shrink-0">{new Date(f.takeoffTime).toLocaleDateString("zh-CN")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="space-y-4">
          {/* Active wiki */}
          {data?.activeWiki && data.activeWiki.length > 0 && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
              <div className="flex items-center gap-2 mb-3"><Clock className="h-4 w-4 text-blue-500" /><h3 className="font-semibold text-sm">进行中的 Wiki 任务</h3></div>
              <div className="space-y-2">
                {data.activeWiki.map(t => (
                  <Link key={t.id} href={`/wiki/${t.id}`} className="flex items-center gap-2 p-2 rounded-xl hover:bg-white dark:hover:bg-blue-900/20 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 shrink-0"><Loader2 className="h-4 w-4 animate-spin" /></div>
                    <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{t.projectName}</div><div className="text-xs text-blue-500">{t.status}</div></div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Recently viewed */}
          {recentDocs.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="flex items-center gap-2 mb-3"><History className="h-4 w-4 text-zinc-500" /><h3 className="font-semibold text-sm">最近浏览</h3></div>
              <div className="space-y-1">
                {recentDocs.slice(0, 5).map((d, i) => (
                  <Link key={i} href={`/knowledge/${d.path}`} className="block text-sm p-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-blue-500 truncate">{d.title || d.path}</Link>
                ))}
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <h3 className="font-semibold text-sm mb-3">快捷操作</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/knowledge", label: "知识库", icon: FileText, color: "bg-blue-50 text-blue-600" },
                { href: "/inventory", label: "库存管理", icon: Package, color: "bg-amber-50 text-amber-600" },
                { href: "/flightlog", label: "飞行中心", icon: BarChart3, color: "bg-emerald-50 text-emerald-600" },
                { href: "/finance", label: "采购申请", icon: DollarSign, color: "bg-purple-50 text-purple-600" },
                { href: "/profile", label: "我的档案", icon: User, color: "bg-sky-50 text-sky-600" },
                ...(isStaff ? [
                  { href: "/admin/users", label: "用户管理", icon: User, color: "bg-purple-50 text-purple-600" },
                  { href: "/wiki/import", label: "Wiki 导入", icon: FileText, color: "bg-green-50 text-green-600" },
                ] : []),
              ].map(item => (
                <Link key={item.href} href={item.href} className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${item.color}`}><item.icon className="h-4 w-4" /></div>
                  <span className="text-xs font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ChatPanel />
    </div>
  );
}
