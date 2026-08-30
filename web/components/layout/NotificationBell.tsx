"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useNotifications } from "@/lib/hooks";
import { Bell, Check, ExternalLink, Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import Link from "next/link";

/** Level → 渲染配置:图标 / 颜色 / 是否需要 toast 强提示 */
const LEVEL_META: Record<string, { Icon: typeof Info; color: string; border: string; bg: string; pulse: boolean; needPermission: boolean }> = {
  info:     { Icon: Info,           color: "text-muted",  border: "border-border",         bg: "bg-surface",         pulse: false, needPermission: false },
  success:  { Icon: CheckCircle2,   color: "text-success",border: "border-success/30",     bg: "bg-success/5",       pulse: false, needPermission: false },
  warning:  { Icon: AlertTriangle,  color: "text-warning",border: "border-warning/30",     bg: "bg-warning/5",       pulse: true,  needPermission: true  },
  critical: { Icon: XCircle,        color: "text-danger", border: "border-danger/40",      bg: "bg-danger/10",       pulse: true,  needPermission: true  },
};

export function NotificationBell() {
  const { notifications: notifs, unreadCount: unread, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seenCriticalRef = useRef<Set<number>>(new Set());

  // critical 级别通知:浏览器原生通知 + 申请 Notification 权限
  useEffect(() => {
    const critical = notifs.filter(n => !n.isRead && (n.level === "critical" || n.level === "warning") && !seenCriticalRef.current.has(n.id));
    if (critical.length === 0) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const meta = LEVEL_META[critical[0].level];

    const show = (perm: NotificationPermission) => {
      if (perm !== "granted") return;
      for (const n of critical) {
        if (seenCriticalRef.current.has(n.id)) continue;
        seenCriticalRef.current.add(n.id);
        try {
          new Notification(n.title, {
            body: n.message,
            icon: "/logo.png",
            tag: `notif-${n.id}`,
          });
        } catch { /* 忽略无头浏览器/沙箱环境 */ }
      }
    };

    if (Notification.permission === "granted") show("granted");
    else if (Notification.permission !== "denied" && meta.needPermission)
      Notification.requestPermission().then(show);
  }, [notifs]);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = async (id: number) => { await api.post(`/api/notifications/${id}/read`, {}); refresh(); };
  const markAll = async () => { await api.post("/api/notifications/read-all", {}); refresh(); };

  // 徽标按最高未读级别着色(critical > warning > info)
  const topLevel = notifs.reduce<string>((acc, n) => {
    if (n.isRead) return acc;
    const order = { info: 0, success: 1, warning: 2, critical: 3 } as Record<string, number>;
    return (order[n.level] ?? 0) > (order[acc] ?? 0) ? n.level : acc;
  }, "info");
  const badgeColor = topLevel === "critical" ? "bg-danger" : topLevel === "warning" ? "bg-warning" : topLevel === "success" ? "bg-success" : "bg-danger";

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="relative p-2 rounded-xl hover:bg-surface-hover transition-colors">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white rounded-full leading-none ${badgeColor}`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)} />
          <div className="fixed left-4 right-4 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-96 max-w-sm mx-auto sm:mx-0 rounded-2xl border border-border bg-surface shadow-2xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm">通知</h3>
              <div className="flex items-center gap-2">
                {unread > 0 && <button onClick={markAll} className="text-xs text-primary hover:underline">全部已读</button>}
                <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded hover:bg-surface-hover text-faint">✕</button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-border">
              {notifs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">暂无通知</div>
              ) : notifs.map(n => {
                const meta = LEVEL_META[n.level] ?? LEVEL_META.info;
                const { Icon } = meta;
                return (
                  <div key={n.id} className={`px-4 py-3 text-sm ${n.isRead ? "" : `${meta.bg} ${meta.border} border-l-2`} ${!n.isRead && meta.pulse ? "animate-pulse" : ""}`}>
                    <div className="flex items-start gap-3">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate text-xs sm:text-sm">{n.title}</div>
                          {!n.isRead && (
                            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}>
                              {n.level}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted mt-0.5 line-clamp-2">{n.message}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          {n.link && <Link href={n.link} onClick={() => { markRead(n.id); setOpen(false); }} className="text-xs text-primary hover:underline inline-flex items-center gap-1 py-0.5"><ExternalLink className="h-3 w-3" />查看</Link>}
                        </div>
                      </div>
                      {!n.isRead && (
                        <button onClick={() => markRead(n.id)} aria-label="标记已读" className="shrink-0 p-1 rounded hover:bg-surface-hover text-faint hover:text-foreground">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}