"use client";

/**
 * 共享数据请求 hook — 模块级缓存 + in-flight 去重。
 * 同一页面树中多个组件同时挂载时只发一次请求，30 秒内的重复挂载复用缓存，
 * refresh() 强制绕过缓存重新拉取（如通知已读后、用户修改档案后调用）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";

/** 缓存有效期：30 秒内复用，之后重新请求 */
const CACHE_TTL = 30_000;

/** 与后端 GET /api/auth/me 返回结构一致 */
export interface CurrentUser {
  id: number;
  username: string;
  role: string;
  department: string | null;
}

/** 与后端 GET /api/notifications 返回结构一致 */
export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  /** info | success | warning | critical — UI 渲染用 */
  level: string;
  /** JSON 扩展数据,客户端可解析后做跳转路由参数等 */
  payloadJson: string | null;
  createdAt: string;
}

// ── 当前用户 ──────────────────────────────────────────────────

let userCache: { token: string | null; data: CurrentUser; at: number } | null = null;
let userInflight: Promise<CurrentUser | null> | null = null;

/** 获取当前用户；无 token 或加载失败时返回 null（不缓存失败结果） */
function fetchCurrentUser(force: boolean): Promise<CurrentUser | null> {
  const token = getToken();
  if (!token) return Promise.resolve(null); // 未登录：不发请求

  // 登录/登出后 token 变化，旧缓存作废
  if (userCache && userCache.token !== token) userCache = null;
  // 命中 30s 缓存直接复用（强制刷新跳过缓存）
  if (!force && userCache && Date.now() - userCache.at < CACHE_TTL) return Promise.resolve(userCache.data);
  // 强制刷新先清缓存，失败时不残留旧数据
  if (force) userCache = null;
  // in-flight 去重：同屏多个组件同时挂载只发一次请求
  if (userInflight) return userInflight;

  userInflight = api.get<CurrentUser>("/api/auth/me")
    .then(u => {
      userCache = { token, data: u, at: Date.now() };
      return u;
    })
    .catch(() => null)
    .finally(() => { userInflight = null; });
  return userInflight;
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchCurrentUser(false).then(u => {
      if (!mounted.current) return;
      setUser(u);
      setLoading(false);
    });
    return () => { mounted.current = false; };
  }, []);

  /** 手动刷新（如修改档案后）：绕过缓存重新请求 */
  const refresh = useCallback(() => {
    setLoading(true);
    fetchCurrentUser(true).then(u => {
      if (!mounted.current) return;
      setUser(u);
      setLoading(false);
    });
  }, []);

  return { user, loading, refresh };
}

// ── 通知列表 ──────────────────────────────────────────────────

let notifCache: { token: string | null; data: NotificationItem[]; at: number } | null = null;
let notifInflight: Promise<NotificationItem[]> | null = null;

/** 获取通知列表；加载失败返回空数组（不缓存失败结果） */
function fetchNotifications(force: boolean): Promise<NotificationItem[]> {
  const token = getToken();

  // 登录/登出后 token 变化，旧缓存作废
  if (notifCache && notifCache.token !== token) notifCache = null;
  // 命中 30s 缓存直接复用（强制刷新跳过缓存）
  if (!force && notifCache && Date.now() - notifCache.at < CACHE_TTL) return Promise.resolve(notifCache.data);
  // 强制刷新先清缓存，失败时不残留旧数据
  if (force) notifCache = null;
  // in-flight 去重：通知铃与页面同时挂载只发一次请求
  if (notifInflight) return notifInflight;

  notifInflight = api.get<NotificationItem[]>("/api/notifications")
    .then(d => {
      notifCache = { token, data: d, at: Date.now() };
      return d;
    })
    .catch(() => [])
    .finally(() => { notifInflight = null; });
  return notifInflight;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchNotifications(false).then(d => {
      if (!mounted.current) return;
      setNotifications(d);
      setLoading(false);
    });
    return () => { mounted.current = false; };
  }, []);

  /** 手动刷新（如通知已读后）：绕过缓存重新请求 */
  const refresh = useCallback(() => {
    setLoading(true);
    fetchNotifications(true).then(d => {
      if (!mounted.current) return;
      setNotifications(d);
      setLoading(false);
    });
  }, []);

  // SSE 实时订阅:SSE 失败/断开时 fallback 到 30s 轮询;新通知自动入列
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    // 浏览器 EventSource 不支持自定义 Authorization 头,改用 cookie 鉴权?
    // 当前 JWT 在 localStorage → 用 fetch + ReadableStream 走 SSE
    const startSse = async () => {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        if (!token) return startPolling();
        const res = await fetch("/api/notifications/stream", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // 解析 SSE 帧(event:/data:/id: + 空行)
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = frame.split("\n");
            const evtLine = lines.find(l => l.startsWith("event: "));
            const dataLine = lines.find(l => l.startsWith("data: "));
            if (evtLine?.slice(7) === "notification" && dataLine) {
              try {
                const n: NotificationItem = JSON.parse(dataLine.slice(6));
                if (mounted.current) {
                  setNotifications(prev => prev.some(p => p.id === n.id) ? prev : [n, ...prev]);
                }
              } catch { /* ignore parse */ }
            }
          }
        }
        // 流结束 → fallback
        if (!closed) startPolling();
      } catch {
        if (!closed) startPolling();
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => { if (mounted.current) refresh(); }, 30000);
    };

    void startSse();
    return () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      // fetch 的 ReadableStream 由 reader.read() 抛错自然终止
    };
  }, [refresh]);

  const unreadCount = notifications.filter(n => !n.isRead).length;
  return { notifications, unreadCount, loading, refresh };
}
