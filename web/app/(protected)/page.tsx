"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { api } from "@/lib/api";
import { isStaff as checkIsStaff } from "@/lib/auth";
import { useBrand } from "@/lib/brand";
import { useNotifications } from "@/lib/hooks";
import { Users, Package, DollarSign, Receipt, Sparkles, ShieldAlert, AlertTriangle } from "lucide-react";

// 性能 #10:recharts ~400KB 懒加载(登录后首屏)→ 仅在仪表盘渲染时才下载
const CategoryDonut = dynamic(() => import("@/components/inventory/CategoryDonut"), {
  ssr: false,
  loading: () => <div className="w-[160px] h-[150px] flex items-center justify-center text-faint text-sm">图表加载中...</div>,
});
import Link from "next/link";

interface DashData {
  users: number;
  inventory: number;
  inventoryTotal: number;
  departments: number;
  monthNewItems: number;
  lowStock: { id: number; name: string; quantity: number; category: string }[];
  activeWiki: { id: string; projectName: string; status: string; createdAt: string }[];
  recentIncidents: { id: number; type: string; severity: string; description: string; date: string }[];
  completedWiki: number;
  categoryCounts: { name: string; count: number }[];
  // Staff-only fields — backend omits them for regular members
  pendingPurchases?: number;
  monthSpent?: number;
  inventoryValue?: number;
}

/** 分类环形图调色板（跟随主题 CSS 变量） */
const DONUT_COLORS = ["var(--accent)", "var(--success)", "var(--info)", "var(--warning)", "var(--danger)"]; // 保留兼容:低库存横条渐变备用

/** 库存分级：1→危险, 2~3→警告, 4+→提示 */
function lowStockTier(qty: number) {
  if (qty <= 1) return { color: "var(--danger)", label: "danger" };
  if (qty <= 3) return { color: "var(--warning)", label: "warning" };
  return { color: "var(--info)", label: "info" };
}

function formatMoney(v: number | undefined) {
  if (v == null) return "-";
  if (v >= 1000) return `¥${(v / 1000).toFixed(1)}k`;
  return `¥${v.toLocaleString("zh-CN")}`;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

const Skeleton = ({ w = "w-16", h = "h-6" }: { w?: string; h?: string }) =>
  <span className={`inline-block ${w} ${h} bg-surface-hover rounded animate-pulse`} />;

export default function Home() {
  const { teamName, teamSubtitle } = useBrand();
  const [data, setData] = useState<DashData | null>(null);
  const [donut, setDonut] = useState<{ name: string; value: number }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const { notifications: notifs } = useNotifications();

  useEffect(() => { setIsStaff(checkIsStaff()); }, []);

  useEffect(() => {
    api.get<DashData>("/api/dashboard").then(setData).catch(() => null).finally(() => setLoaded(true));
  }, []);

  // 性能 #15:环形图数据直接来自 /api/dashboard.categoryCounts,不再拉全量库存列表
  useEffect(() => {
    if (!data?.categoryCounts) return;
    let arr = [...data.categoryCounts].sort((a, b) => b.count - a.count);
    if (arr.length > 5) {
      const head = arr.slice(0, 4);
      const rest = arr.slice(4);
      head.push({ name: "其他", count: rest.reduce((s, x) => s + x.count, 0) } as any);
      arr = head;
    }
    setDonut(arr.map(d => ({ name: d.name, value: d.count })));
  }, [data?.categoryCounts]);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  // 统计卡配置：staff 展示财务卡，普通成员展示物料类卡（后端只给可见字段）
  const stats = [
    { label: "团队成员", value: data?.users, icon: Users, color: "bg-primary/15 text-primary", foot: <span className="text-faint">{data?.departments ?? 0} 个部门</span> },
    { label: "库存物料", value: data?.inventoryTotal, icon: Package, color: "bg-info/15 text-info",
      foot: isStaff
        ? (data?.lowStock?.length ?? 0) > 0
          ? <span className="text-danger font-semibold">↓ {data?.lowStock.length} 项低库存</span>
          : <span className="text-success">库存充足</span>
        : <span className="text-faint">库存实时同步</span> },
    ...(isStaff
      ? [
          { label: "库存总价值", value: data ? formatMoney(data.inventoryValue) : null, icon: DollarSign, color: "bg-success/15 text-success", foot: <span className="text-faint">按单价 × 数量估算</span> },
          { label: "本月支出", value: data ? formatMoney(data.monthSpent) : null, icon: Receipt, color: "bg-warning/15 text-warning", foot: <span className="text-faint">待审批 {data?.pendingPurchases ?? 0} 单</span> },
        ]
      : [
          { label: "物料种类", value: data?.inventory, icon: Package, color: "bg-primary/15 text-primary", foot: <span className="text-faint">共 {data?.inventoryTotal ?? 0} 件</span> },
          { label: "本月新增", value: data?.monthNewItems, icon: Sparkles, color: "bg-info/15 text-info", foot: <span className="text-faint">本月入库</span> },
        ]),
  ];

  const totalMaterial = donut.reduce((s, d) => s + d.value, 0);

  const quickActions = [
    { href: "/inventory/checkout", label: "发起领用", icon: Package },
    { href: "/admin/knowledge", label: "上传文档", icon: Sparkles },
    { href: "/flightlog", label: "记飞行日志", icon: ShieldAlert },
    { href: "/profile", label: "我的档案", icon: Users },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greeting}，{teamName}</h1>
        <p className="text-sm text-muted mt-1">航模队运行总览 · 数据实时同步</p>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-surface p-4 card-hover">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{s.label}</span>
              <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${s.color}`}>
                <s.icon className="h-4 w-4" />
              </span>
            </div>
            <div className="text-[30px] font-extrabold tracking-[-0.03em] mt-2 leading-none">
              {loaded ? (s.value ?? "-") : <Skeleton h="h-8" />}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px]">{s.foot}</div>
          </div>
        ))}
      </div>

      {/* 库存分布(全员可见);低库存预警仅 staff 展示 */}
      <div className={`grid gap-4 ${isStaff ? "lg:grid-cols-[1.15fr_0.85fr]" : ""}`}>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold tracking-tight">库存分布</h3>
            <Link href="/inventory" className="text-xs text-primary font-medium">全部 →</Link>
          </div>
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
            <CategoryDonut data={donut} total={totalMaterial} />
            <div className="w-full sm:flex-1 space-y-2.5">
              {donut.length === 0 && <div className="text-sm text-faint">{loaded ? "暂无物料数据" : <Skeleton />}</div>}
              {donut.map((d, i) => {
                const pct = totalMaterial ? Math.round((d.value / totalMaterial) * 100) : 0;
                const color = ["var(--accent)", "var(--success)", "var(--info)", "var(--warning)", "var(--danger)"][i % 5];
                return (
                  <div key={d.name} className="flex items-center gap-2.5 text-xs">
                    <span className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: color }} />
                    <span className="text-foreground flex-1 truncate">{d.name}</span>
                    <span className="text-foreground font-semibold">{d.value}</span>
                    <span className="text-faint w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {isStaff && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold tracking-tight">低库存预警</h3>
            <span className="text-xs text-warning font-medium">{data?.lowStock.length ?? 0} 项</span>
          </div>
          {data?.lowStock && data.lowStock.length > 0 ? (
            <div>
              {data.lowStock.map((item) => {
                const tier = lowStockTier(item.quantity);
                return (
                  <div key={item.id} className="py-2.5 border-b border-border-subtle last:border-none">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-foreground">{item.name}</span>
                      <span className="text-muted">余 {item.quantity}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--faint) 20%, transparent)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(item.quantity * 8, 100)}%`, background: tier.color }} />
                    </div>
                  </div>
                );
              })}
              <Link href="/inventory" className="block text-center text-xs text-primary font-medium mt-3">去补货 →</Link>
            </div>
          ) : (
            <div className="text-sm text-faint py-4">{loaded ? "暂无低库存物料" : <Skeleton />}</div>
          )}
        </div>
        )}
      </div>

      {/* 团队动态 + 最近事故 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold tracking-tight">团队动态</h3>
            <Link href="/admin/logs" className="text-xs text-primary font-medium">全部 →</Link>
          </div>
          <div>
            {notifs.length === 0 && <div className="text-sm text-faint text-center py-6">{loaded ? "暂无团队动态" : <Skeleton />}</div>}
            {notifs.slice(0, 6).map((n) => (
              <div key={n.id} className="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-surface-hover transition-colors">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-subtle border border-border-subtle text-sm shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground truncate">{n.title}</div>
                  <div className="text-[11px] text-faint mt-0.5 line-clamp-1">{n.message}</div>
                </div>
                <span className="text-[11px] text-faint shrink-0">{relativeTime(n.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold tracking-tight">最近事故</h3>
            <Link href="/incidents" className="text-xs text-primary font-medium">全部 →</Link>
          </div>
          {data?.recentIncidents && data.recentIncidents.length > 0 ? (
            <div>
              {data.recentIncidents.map((i) => (
                <div key={i.id} className="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-surface-hover transition-colors">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-subtle border border-border-subtle text-sm shrink-0">
                    {i.severity === "high" ? <AlertTriangle className="h-3.5 w-3.5 text-danger" /> : <ShieldAlert className="h-3.5 w-3.5 text-warning" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-foreground truncate">{i.type}</div>
                    <div className="text-[11px] text-faint mt-0.5 line-clamp-1">{i.description}</div>
                  </div>
                  <span className="text-[11px] text-faint shrink-0">{new Date(i.date).toLocaleDateString("zh-CN")}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-3 px-2 py-2.5">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-subtle border border-border-subtle text-sm shrink-0">✅</span>
              <div><div className="text-[13px] text-foreground">暂无未处理事故</div><div className="text-[11px] text-faint mt-0.5">安全记录良好</div></div>
            </div>
          )}

          <div className="h-px bg-border-subtle my-3" />
          <h3 className="text-sm font-semibold tracking-tight mb-3">快捷操作</h3>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((a) => (
              <Link key={a.href} href={a.href}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-surface-subtle text-xs text-foreground hover:border-primary hover:text-primary transition-colors">
                <a.icon className="h-3.5 w-3.5" />{a.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* AI 助手（渐变边框光晕卡片） */}
      <ChatPanel />
    </div>
  );
}
