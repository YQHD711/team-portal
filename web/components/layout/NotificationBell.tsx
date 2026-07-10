"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { Bell, Check, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Notif { id: number; title: string; message: string; link: string | null; isRead: boolean; createdAt: string; }

export function NotificationBell() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetch = () => {
    api.get<Notif[]>("/api/notifications").then(d => { setNotifs(d); setUnread(d.filter(n => !n.isRead).length); }).catch(() => {});
  };

  useEffect(() => { fetch(); const t = setInterval(fetch, 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = async (id: number) => { await api.post(`/api/notifications/${id}/read`, {}); fetch(); };
  const markAll = async () => { await api.post("/api/notifications/read-all", {}); fetch(); };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="relative p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4.5 h-4.5 text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)} />
          <div className="fixed left-4 right-4 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-80 max-w-sm mx-auto sm:mx-0 rounded-2xl border border-border bg-surface shadow-2xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm">通知</h3>
              <div className="flex items-center gap-2">
                {unread > 0 && <button onClick={markAll} className="text-xs text-blue-500 hover:underline">全部已读</button>}
                <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-zinc-400">✕</button>
              </div>
            </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifs.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted">暂无通知</div>
            ) : notifs.map(n => (
              <div key={n.id} className={`px-4 py-3 text-sm ${n.isRead ? "" : "bg-blue-50/50 dark:bg-blue-950/20"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-xs sm:text-sm">{n.title}</div>
                    <div className="text-xs text-muted mt-0.5 line-clamp-2">{n.message}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {n.link && <Link href={n.link} onClick={() => setOpen(false)} className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1 py-0.5"><ExternalLink className="h-3 w-3" />查看</Link>}
                    </div>
                  </div>
                  {!n.isRead && <button onClick={() => markRead(n.id)} className="shrink-0 p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500"><Check className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
