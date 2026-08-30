"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Save, Server, Shield, Brain, Cloud, Settings2, Loader2, Palette } from "lucide-react";

interface SystemSetting {
  key: string; value: string; category: string; description: string;
}

type SettingsMap = Record<string, SystemSetting[]>;

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  "认证安全": Shield,
  "AI 服务": Brain,
  "百度网盘": Cloud,
  "系统参数": Settings2,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get<SettingsMap>("/api/admin/settings")
      .then(setSettings)
      .catch(() => setMsg("❌ 加载设置失败"))
      .finally(() => setLoading(false));
  }, []);

  const updateValue = (category: string, key: string, value: string) => {
    setSettings(prev => {
      const updated = { ...prev };
      updated[category] = updated[category].map(s =>
        s.key === key ? { ...s, value } : s
      );
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true); setMsg("");
    try {
      const updates: Record<string, string> = {};
      for (const items of Object.values(settings)) {
        for (const s of items) {
          updates[s.key] = s.value;
        }
      }
      await api.put("/api/admin/settings", updates);
      setMsg("✅ 设置已保存");
    } catch {
      setMsg("❌ 保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-muted" />
    </div>
  );

  const categories = Object.keys(settings);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">系统设置</h1>
          <p className="text-sm text-muted mt-1">全局配置 — 所有参数均可在线调整，无需修改代码或重启</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 shadow-sm"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "保存中..." : "保存全部"}
        </button>
      </div>

      {msg && (
        <div className={`text-sm p-3 rounded-xl ${
          msg.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" : "bg-red-50 dark:bg-red-950 text-red-600"
        }`}>{msg}</div>
      )}

      {categories.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <Server className="h-10 w-10 mx-auto mb-2 opacity-30" />
          暂无配置项
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map(cat => {
            const Icon = CATEGORY_ICONS[cat] || Settings2;
            const items = settings[cat];
            return (
              <div key={cat} className="rounded-2xl border border-border bg-surface overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-slate-50 dark:bg-slate-900">
                  <Icon className="h-4 w-4 text-muted" />
                  <h2 className="font-semibold text-sm">{cat}</h2>
                </div>
                <div className="divide-y divide-border">
                  {items.map(s => {
                    const isSecret = s.key.includes("Key") || s.key.includes("Secret") || s.key.includes("Sign");
                    return (
                      <div key={s.key} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{s.description}</div>
                          <div className="text-xs text-muted font-mono mt-0.5">{s.key}</div>
                        </div>
                        <input
                          type={isSecret ? "password" : "text"}
                          value={s.value}
                          onChange={e => updateValue(cat, s.key, e.target.value)}
                          className="w-64 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* System info footer */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 mb-2">
          <Server className="h-4 w-4 text-muted" />
          <h3 className="font-semibold text-sm">环境信息</h3>
        </div>
        <div className="text-xs text-muted space-y-0.5">
          <div>后端：ASP.NET Core 10 + SQLite</div>
          <div>前端：Next.js 16 + Tailwind CSS 4</div>
          <div>AI 服务：Python FastAPI + DeepSeek</div>
          <div className="mt-1 text-zinc-400">敏感配置（密钥/密码）可通过环境变量覆盖，优先级高于此页面设置。</div>
        </div>
      </div>
    </div>
  );
}
