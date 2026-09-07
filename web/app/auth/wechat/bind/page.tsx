"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import { wechat } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useBrand } from "@/lib/brand";

/** 绑定页内容（独立组件供 Suspense 包裹 —— Next 16 中 useSearchParams 需要 Suspense 边界） */
function WeChatBindContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { teamName } = useBrand();
  const bindingToken = searchParams.get("binding") ?? "";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 缺 binding 票据：直接引导回登录页
    if (!bindingToken) {
      setError("微信登录票据缺失或已过期，请重新通过公众号进入");
      const t = setTimeout(() => router.replace("/auth/login"), 3000);
      return () => clearTimeout(t);
    }
  }, [bindingToken, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await wechat.bind(bindingToken, username, password);
      setToken(data.token);
      router.replace("/");
    } catch (err) { setError(err instanceof Error ? err.message : "绑定失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center px-4 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 400px at 50% 30%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg mx-auto mb-4 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, var(--primary), var(--accent))",
              boxShadow: "0 12px 28px -12px color-mix(in srgb, var(--primary) 60%, transparent)",
            }}
          >
            <MessageCircle className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">绑定已有账号</h1>
          <p className="text-sm text-muted mt-1">首次使用微信登录 {teamName}，请绑定你的账号</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-black/5 dark:shadow-black/20">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">用户名</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入系统用户名" required autoComplete="username"
                className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入系统密码" required autoComplete="current-password"
                className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow" />
            </div>

            <button type="submit" disabled={loading || !bindingToken}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "绑定并登录"}
            </button>
          </form>
        </div>

        <div className="text-center mt-4">
          <Link href="/auth/login" className="inline-flex items-center gap-1 text-sm text-primary hover:text-accent-hover">
            <ArrowLeft className="h-3 w-3" />返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function WeChatBindPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-muted">加载中...</div>}>
      <WeChatBindContent />
    </Suspense>
  );
}