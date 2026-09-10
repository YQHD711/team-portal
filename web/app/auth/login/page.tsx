"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn, Eye, EyeOff, User, Lock, AlertCircle, Loader2 } from "lucide-react";
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
    setError("");
    setLoading(true);
    try {
      const data = await api.post<{ token: string }>("/api/auth/login", { username, password });
      setToken(data.token);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center overflow-hidden px-4 py-12">
      {/* ───────── 背景装饰层 ───────── */}
      {/* 点阵网格（中心渐隐） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--foreground) 10%, transparent) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, black 20%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, black 20%, transparent 75%)",
        }}
      />
      {/* 品牌色主光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(800px 480px at 50% 28%, color-mix(in srgb, var(--primary) 15%, transparent), transparent 70%)",
        }}
      />
      {/* 双色漂浮光斑 */}
      <div
        aria-hidden
        className="anim-drift-a pointer-events-none absolute -left-28 -top-28 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}
      />
      <div
        aria-hidden
        className="anim-drift-b pointer-events-none absolute -bottom-32 -right-28 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "color-mix(in srgb, var(--primary) 40%, transparent)" }}
      />

      <div className="anim-fade-up relative w-full max-w-sm">
        {/* ───────── 品牌区 ───────── */}
        <div className="mb-8 text-center">
          <div
            className="anim-float relative mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl"
            style={{
              background: "linear-gradient(135deg, var(--primary), var(--accent))",
              boxShadow:
                "0 12px 28px -10px color-mix(in srgb, var(--primary) 65%, transparent), inset 0 1px 0 rgba(255,255,255,.25)",
            }}
          >
            {/* 顶部玻璃高光 */}
            <span
              className="absolute inset-x-0 top-0 h-1/2"
              style={{ background: "linear-gradient(to bottom, rgba(255,255,255,.25), transparent)" }}
            />
            {/* 循环扫光 */}
            <span className="anim-shine absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            <img src="/logo.png" alt={teamName} className="relative z-10 h-11 w-11 object-contain drop-shadow" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{teamName}</h1>
          <p className="mt-1 text-sm text-muted">队员协作 · 知识共享 · 飞行分析</p>
        </div>

        {/* ───────── 登录卡片（毛玻璃） ───────── */}
        <div
          className="relative overflow-hidden rounded-2xl border border-border p-6 shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/30 sm:p-7"
          style={{ background: "color-mix(in srgb, var(--surface) 88%, transparent)" }}
        >
          {/* 顶部品牌色描边高光 */}
          <span
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, color-mix(in srgb, var(--primary) 60%, transparent), transparent)",
            }}
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 错误提示（抖动入场） */}
            {error && (
              <div className="anim-shake flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 用户名 */}
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="block text-sm font-medium">
                用户名
              </label>
              <div className="group relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted transition-colors duration-300 group-focus-within:text-primary" />
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  required
                  autoComplete="username"
                  className="w-full rounded-xl border border-border bg-surface-subtle py-2.5 pl-10 pr-4 text-sm transition-all duration-300 placeholder:text-muted hover:border-primary/40 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
                />
              </div>
            </div>

            {/* 密码 */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-sm font-medium">
                密码
              </label>
              <div className="group relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted transition-colors duration-300 group-focus-within:text-primary" />
                <input
                  id="login-password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-border bg-surface-subtle py-2.5 pl-10 pr-11 text-sm transition-all duration-300 placeholder:text-muted hover:border-primary/40 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  aria-label={showPwd ? "隐藏密码" : "显示密码"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 登录按钮（渐变 + 悬停扫光） */}
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full overflow-hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/35 active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))" }}
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
              <span className="relative flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    登录中…
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    登录
                  </>
                )}
              </span>
            </button>
          </form>
        </div>

        {/* ───────── 底部链接 ───────── */}
        <div className="mt-5 space-y-2 text-center">
          <p className="text-sm text-muted">
            还没有账号？
            <Link
              href="/auth/register"
              className="ml-1 font-medium text-primary underline-offset-4 transition-colors hover:text-accent-hover hover:underline"
            >
              立即注册
            </Link>
          </p>
          <p className="text-xs text-muted">
            {teamName}
            {teamSubtitle} · 内部系统
          </p>
        </div>
      </div>

      {/* 动画定义（建议移入 globals.css） */}
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes floatY { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes drift { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(26px, -34px) scale(1.08); } 66% { transform: translate(-18px, 18px) scale(0.94); } }
        @keyframes shine { 0% { transform: translateX(-120%); } 55%, 100% { transform: translateX(220%); } }
        @keyframes shake { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(2px); } 30%, 50%, 70% { transform: translateX(-4px); } 40%, 60% { transform: translateX(4px); } }

        .anim-fade-up { animation: fadeUp 0.6s ease-out both; }
        .anim-float { animation: floatY 5s ease-in-out infinite; }
        .anim-drift-a { animation: drift 16s ease-in-out infinite; }
        .anim-drift-b { animation: drift 20s ease-in-out infinite reverse; }
        .anim-shine { animation: shine 3s ease-in-out infinite; }
        .anim-shake { animation: shake 0.45s ease-in-out; }

        @media (prefers-reduced-motion: reduce) {
          .anim-fade-up, .anim-float, .anim-drift-a, .anim-drift-b, .anim-shine { animation: none; }
        }
      `}</style>
    </div>
  );
}
