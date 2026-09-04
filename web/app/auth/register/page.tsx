"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import Link from "next/link";
import { useBrand } from "@/lib/brand";

export default function RegisterPage() {
  const router = useRouter();
  const { teamName } = useBrand();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    try {
      await api.post("/api/auth/register", { username, password, inviteCode: inviteCode || null });
      setSuccess("注册成功！即将跳转到登录页...");
      setTimeout(() => router.push("/auth/login"), 2000);
    } catch (err) { setError(err instanceof Error ? err.message : "注册失败"); }
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
        <div className="text-center mb-8">
          <div
            className="relative inline-flex items-center justify-center w-14 h-14 rounded-2xl shadow-lg mx-auto mb-4 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, var(--primary), var(--accent))",
              boxShadow: "0 12px 28px -12px color-mix(in srgb, var(--primary) 60%, transparent)",
            }}
          >
            <img src="/logo.png" alt={teamName} className="w-10 h-10 object-contain relative z-10" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{teamName}</h1>
          <p className="text-sm text-muted mt-1">队员注册</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-black/5 dark:shadow-black/20">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
            {success && <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">{success}</div>}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">用户名</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="至少2个字符" required minLength={2}
                className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少6个字符" required minLength={6}
                className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">邀请码 <span className="text-muted font-normal">（选填）</span></label>
              <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="如有邀请码请输入"
                className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
              <UserPlus className="h-4 w-4" />{loading ? "注册中..." : "注册"}
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
