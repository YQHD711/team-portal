"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useBrand } from "@/lib/brand";

export default function LoginPage() {
  const router = useRouter();
  const { teamName, teamSubtitle } = useBrand();
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
      setToken(data.token);
      router.replace("/");
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center px-4 overflow-hidden">
      {/* 背景径向光晕（品牌色，跟随主题） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 400px at 50% 30%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div
            className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg mx-auto mb-4 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, var(--primary), var(--accent))",
              boxShadow: "0 12px 28px -12px color-mix(in srgb, var(--primary) 60%, transparent)",
            }}
          >
            <img src="/logo.png" alt={teamName} className="w-11 h-11 object-contain relative z-10" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{teamName}</h1>
          <p className="text-sm text-muted mt-1">队员协作 · 知识共享 · 飞行分析</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-black/5 dark:shadow-black/20">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">用户名</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入用户名" required autoComplete="username"
                className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">密码</label>
              <div className="relative">
                <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" required autoComplete="current-password"
                  className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow" />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
              <LogIn className="h-4 w-4" />{loading ? "登录中..." : "登录"}
            </button>
          </form>
        </div>

        <div className="text-center mt-4 space-y-2">
          <Link href="/auth/register" className="text-sm text-primary hover:text-accent-hover">还没有账号？注册</Link>
          <p className="text-xs text-muted">{teamName}{teamSubtitle} · 内部系统</p>
        </div>
      </div>
    </div>
  );
}
