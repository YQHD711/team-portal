"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bird, LogIn, Eye, EyeOff, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await api.post<{ token: string }>("/api/auth/login", { username, password });
      setToken(data.token); router.replace("/");
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-500 to-blue-600 text-white shadow-2xl shadow-blue-500/25 mx-auto mb-4">
            <div className="absolute inset-0 rounded-2xl bg-white/10 backdrop-blur" />
            <Bird className="h-9 w-9 relative z-10" />
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-cyan-400 rounded-full flex items-center justify-center shadow-lg">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">雏鹰之翼</h1>
          <p className="text-sm text-muted mt-1">航模队智能管理系统</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-slate-900/5 dark:shadow-black/20">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">用户名</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入用户名" required autoComplete="username"
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-shadow" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">密码</label>
              <div className="relative">
                <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" required autoComplete="current-password"
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-shadow" />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:from-blue-700 hover:to-cyan-600 disabled:opacity-50 transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2">
              <LogIn className="h-4 w-4" />{loading ? "登录中..." : "登录"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted mt-4">雏鹰之翼航模队 · 内部系统</p>
      </div>
    </div>
  );
}
