"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { User, LogOut, Key, X } from "lucide-react";
import { removeToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";

export function UserMenu() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [pwd, setPwd] = useState({ current: "", newPwd: "" });
  const [pwdMsg, setPwdMsg] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // 加载失败时按原逻辑清除 token（未登录时 removeToken 为无操作）
  useEffect(() => { if (!loading && !user) removeToken(); }, [loading, user]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleLogout = () => { removeToken(); router.push("/auth/login"); };

  const handleChangePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.put("/api/auth/change-password", pwd); setPwdMsg("✅ 修改成功"); setShowPwd(false); }
    catch { setPwdMsg("❌ 当前密码错误"); }
  };

  if (!user) {
    return (
      <div className="flex items-center gap-2 pl-2 border-l border-zinc-200 dark:border-zinc-700">
        <User className="h-5 w-5 text-zinc-500" />
        <span className="text-sm text-zinc-600 dark:text-zinc-400 hidden sm:block">
          未登录
        </span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex items-center gap-2 pl-2 border-l border-border">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg px-2 py-1 transition-colors">
        <User className="h-5 w-5 text-muted" />
        <span className="text-sm hidden sm:block">{user.username}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-64 rounded-2xl border border-border bg-surface shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="font-medium text-sm">{user.username}</div>
            <div className="text-xs text-muted">{user.role === "admin" ? "管理员" : user.role === "部长" ? "部长" : "成员"}</div>
          </div>

          {!showPwd ? (
            <div className="py-1">
              <button onClick={() => { setShowPwd(true); setPwdMsg(""); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <Key className="h-4 w-4 text-muted" />修改密码
              </button>
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
                <LogOut className="h-4 w-4" />退出登录
              </button>
            </div>
          ) : (
            <form onSubmit={handleChangePwd} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">修改密码</h4>
                <button type="button" onClick={() => setShowPwd(false)} className="p-0.5 rounded hover:bg-slate-100"><X className="h-4 w-4" /></button>
              </div>
              <input type="password" placeholder="当前密码" value={pwd.current} onChange={e => setPwd({ ...pwd, current: e.target.value })} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50" />
              <input type="password" placeholder="新密码(至少6位)" value={pwd.newPwd} onChange={e => setPwd({ ...pwd, newPwd: e.target.value })} required minLength={6} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50" />
              <button type="submit" className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600">确认修改</button>
              {pwdMsg && <div className={`text-xs ${pwdMsg.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>{pwdMsg}</div>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
