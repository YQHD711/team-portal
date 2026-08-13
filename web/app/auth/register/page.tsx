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
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">{teamName}</h1>
          <p className="text-sm text-muted mt-1">队员注册</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
            {success && <div className="rounded-xl bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 p-3 text-sm text-green-600 dark:text-green-400">{success}</div>}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">用户名</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="至少2个字符" required minLength={2}
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少6个字符" required minLength={6}
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium">邀请码 <span className="text-zinc-400 font-normal">（选填）</span></label>
              <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="如有邀请码请输入"
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:from-blue-700 hover:to-cyan-600 disabled:opacity-50 transition-all shadow-lg flex items-center justify-center gap-2">
              <UserPlus className="h-4 w-4" />{loading ? "注册中..." : "注册"}
            </button>
          </form>
        </div>

        <div className="text-center mt-4">
          <Link href="/auth/login" className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600">
            <ArrowLeft className="h-3 w-3" />返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
