"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Save, Server, Shield, Brain, Cloud, Settings2, Loader2, Palette, Check, RotateCcw } from "lucide-react";
import { useBrand } from "@/lib/brand";

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

/** 4 套预设主题（与 globals.css 的 data-theme 对应） */
const THEMES = [
  { key: "indigo", name: "深空靛蓝", dot: "linear-gradient(135deg,#5e6ad2,#7170ff)", light: false },
  { key: "sky", name: "深空天青", dot: "linear-gradient(135deg,#0ea5e9,#38bdf8)", light: false },
  { key: "light", name: "日光蓝", dot: "linear-gradient(135deg,#ffffff,#ffffff)", light: true },
  { key: "warm", name: "暖白", dot: "linear-gradient(135deg,#9c4d10,#b25e15)", light: false },
];

export default function SettingsPage() {
  const { refresh } = useBrand();
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // 品牌主色草稿（原生 color input 需受控值，留空用主题默认）
  const [colorDraft, setColorDraft] = useState("#5e6ad2");

  useEffect(() => {
    api.get<SettingsMap>("/api/admin/settings")
      .then(setSettings)
      .catch(() => setMsg("❌ 加载设置失败"))
      .finally(() => setLoading(false));
  }, []);

  // 已存储的品牌主色 —— 同步到 color input 草稿（hooks 必须位于早期 return 之前）
  const storedColor = settings["品牌"]?.find(s => s.key === "Brand:PrimaryColor")?.value ?? "";
  useEffect(() => {
    if (storedColor) setColorDraft(storedColor);
  }, [storedColor]);

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
      refresh();
    } catch {
      setMsg("❌ 保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 选中即存 Brand:Theme 并立即应用全局配色
  const applyTheme = async (theme: string) => {
    updateValue("品牌", "Brand:Theme", theme);
    setMsg("");
    try {
      await api.put("/api/admin/settings", { "Brand:Theme": theme });
      refresh();
      setMsg(`✅ 已切换至 ${THEMES.find(t => t.key === theme)?.name ?? theme}`);
    } catch {
      setMsg("❌ 主题保存失败");
    }
  };

  // 应用品牌主色（留空随主题）
  const applyColor = async (color: string) => {
    updateValue("品牌", "Brand:PrimaryColor", color);
    setMsg("");
    try {
      await api.put("/api/admin/settings", { "Brand:PrimaryColor": color });
      refresh();
      setMsg(color ? "✅ 品牌主色已应用" : "✅ 已恢复随主题默认");
    } catch {
      setMsg("❌ 主色保存失败");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-muted" />
    </div>
  );

  const brandCategory = settings["品牌"] ?? [];
  const themeKey = brandCategory.find(s => s.key === "Brand:Theme")?.value ?? "indigo";

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
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 shadow-sm"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "保存中..." : "保存全部"}
        </button>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-3 rounded-xl border ${
          msg.startsWith("✅") ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
        }`}>{msg}</div>
      )}

      {/* ── 配色主题选择 ── */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-surface-subtle">
          <Palette className="h-4 w-4 text-muted" />
          <div>
            <h2 className="font-semibold text-sm">配色主题</h2>
            <p className="text-xs text-muted">由管理员统一决定团队主题，保存后全局立即生效</p>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {THEMES.map((t) => {
              const active = themeKey === t.key;
              return (
                <button key={t.key} onClick={() => applyTheme(t.key)}
                  className={`flex flex-col items-center gap-2 px-3 py-4 rounded-xl border transition-colors ${
                    active ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 bg-surface-subtle"
                  }`}>
                  <span
                    className="w-7 h-7 rounded-full shrink-0"
                    style={{ background: t.dot, ...(t.light ? { border: "1px solid var(--border)" } : {}) }}
                  />
                  <span className="text-xs font-medium">{t.name}</span>
                  {active && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })}
          </div>

          {/* 品牌主色 */}
          <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-border-subtle">
            <span className="text-xs text-muted">品牌主色（留空随主题，设置后覆盖主题主色）：</span>
            <div className="flex items-center gap-2">
              <input type="color" value={colorDraft} onChange={e => setColorDraft(e.target.value)}
                className="w-9 h-9 rounded-lg border border-border bg-transparent cursor-pointer p-0" />
              <span className="text-xs font-mono text-muted">{colorDraft}</span>
            </div>
            <button onClick={() => applyColor(colorDraft)}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-accent-hover transition-colors">
              应用主色
            </button>
            <button onClick={() => { setColorDraft("#5e6ad2"); applyColor(""); }}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border text-muted hover:text-foreground hover:bg-surface-hover transition-colors">
              <RotateCcw className="h-3 w-3" />恢复默认
            </button>
          </div>
        </div>
      </div>

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
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-surface-subtle">
                  <Icon className="h-4 w-4 text-muted" />
                  <h2 className="font-semibold text-sm">{cat}</h2>
                </div>
                <div className="divide-y divide-border">
                  {items.map(s => {
                    const isSecret = s.key.includes("Key") || s.key.includes("Secret") || s.key.includes("Sign");
                    return (
                      <div key={s.key} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-hover/50">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{s.description}</div>
                          <div className="text-xs text-muted font-mono mt-0.5">{s.key}</div>
                        </div>
                        <input
                          type={isSecret ? "password" : "text"}
                          value={s.value}
                          onChange={e => updateValue(cat, s.key, e.target.value)}
                          className="w-64 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
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
          <div className="mt-1 text-faint">敏感配置（密钥/密码）可通过环境变量覆盖，优先级高于此页面设置。</div>
        </div>
      </div>
    </div>
  );
}
