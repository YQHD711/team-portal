"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { TOURS } from "@/lib/tours/registry";
import type { TourStep } from "@/lib/tours/types";
import { GuideStepList } from "./GuideStepList";
import { useTour } from "@/components/tour/TourProvider";
import { useContentRefresh } from "@/components/content/ContentProvider";
import { Loader2, Play, Pencil, RotateCcw, Save, X } from "lucide-react";

interface GuideRow {
  tourKey: string;
  title: string;
  stepsJson: string;
  enabled: boolean;
  version: number;
  updatedAt: string;
}

interface Draft {
  title: string;
  steps: TourStep[];
  enabled: boolean;
  version: number;
}

/** 解析覆盖的 StepsJson；空数组或非法值时回落到代码默认步骤 */
function parseSteps(json: string, fallback: TourStep[]): TourStep[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as TourStep[]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 引导内容管理：代码里定义的每条引导都列出来，可改标题/步骤/启停/版本。
 * 保存写覆盖行；重置删除覆盖行，回到代码默认内容。
 */
export function GuidesTab() {
  const [saved, setSaved] = useState<Record<string, GuideRow>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"all" | "member" | "部长" | "admin">("all");
  const { start } = useTour();
  const refreshContent = useContentRefresh();

  const visible = useMemo(
    () => TOURS.filter((t) => roleFilter === "all" || t.roles.includes(roleFilter)),
    [roleFilter],
  );

  /** 预览：先刷新内容（让刚保存的改动生效），再启动引导；不在目标页时引导引擎会自动跳转 */
  async function preview(key: string) {
    await refreshContent();
    start(key);
  }

  function rolesLabel(roles: readonly string[]): string {
    if (roles.length >= 3) return "全部角色";
    return roles.map((r) => (r === "admin" ? "管理员" : r === "部长" ? "部长" : "成员")).join("、");
  }

  const load = useCallback(async () => {
    try {
      const rows = await api.get<GuideRow[]>("/api/admin/content/guides");
      const map: Record<string, GuideRow> = {};
      for (const r of rows) map[r.tourKey] = r;
      setSaved(map);
    } catch {
      setMsg("❌ 加载失败：仅管理员可访问");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(key: string) {
    const def = TOURS.find((t) => t.key === key);
    if (!def) return;
    const row = saved[key];
    setEditing(key);
    setDraft({
      title: row?.title || def.title,
      steps: row ? parseSteps(row.stepsJson, def.steps) : def.steps.map((s) => ({ ...s })),
      enabled: row ? row.enabled : true,
      version: row && row.version > 0 ? row.version : def.version,
    });
  }

  async function save() {
    if (!editing || !draft || saving) return;
    setSaving(true);
    setMsg("");
    try {
      await api.put(`/api/admin/content/guides/${editing}`, {
        title: draft.title,
        stepsJson: JSON.stringify(draft.steps),
        enabled: draft.enabled,
        version: draft.version,
      });
      setMsg("✅ 已保存");
      setEditing(null);
      setDraft(null);
      await load();
    } catch {
      setMsg("❌ 保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function reset(key: string) {
    setSaving(true);
    try {
      await api.delete(`/api/admin/content/guides/${key}`);
      setMsg("✅ 已恢复默认");
      if (editing === key) { setEditing(null); setDraft(null); }
      await load();
    } catch {
      setMsg("❌ 恢复失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-muted"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        下面是队员第一次进入各功能时看到的分步引导。可以改每一步的标题和说明、调整顺序、暂时停用；
        高亮到哪个按钮由技术人员在代码里指定（编辑器里会显示成"高亮位置"）。点「预览」会直接播放这条引导。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {([["all", "全部角色"], ["member", "成员"], ["部长", "部长"], ["admin", "管理员"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setRoleFilter(key)}
            className={
              "rounded-lg border px-2.5 py-1 text-xs transition-colors " +
              (roleFilter === key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-foreground")
            }>
            {label}
          </button>
        ))}
        <span className="text-xs text-muted">共 {visible.length} 条</span>
      </div>

      {msg && <div className="rounded-lg bg-surface px-3 py-2 text-sm text-muted">{msg}</div>}
      <div className="space-y-2">
        {visible.map((tour) => {
          const row = saved[tour.key];
          const isEditing = editing === tour.key;
          return (
            <div key={tour.key} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{tour.title}</span>
                <span className="font-mono text-[11px] text-faint">{tour.key}</span>
                <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted">{tour.steps.length} 步</span>
                <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted">{rolesLabel(tour.roles)}</span>
                {row && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">已覆盖</span>}
                {row?.enabled === false && <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">已停用</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => void preview(tour.key)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-foreground"
                    title="在真实页面上播放这条引导（会跳转到目标页）">
                    <Play className="h-3 w-3" />预览
                  </button>
                  <button onClick={() => (isEditing ? (setEditing(null), setDraft(null)) : startEdit(tour.key))}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-foreground">
                    {isEditing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}{isEditing ? "取消" : "编辑"}
                  </button>
                  {row && (
                    <button onClick={() => reset(tour.key)} disabled={saving}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-foreground">
                      <RotateCcw className="h-3 w-3" />恢复默认
                    </button>
                  )}
                </div>
              </div>

              {isEditing && draft && (
                <div className="mt-3 space-y-2 border-t border-border-subtle pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="引导标题" className="min-w-40 flex-1 rounded border border-border bg-background px-2 py-1 text-sm" />
                    <label className="flex items-center gap-1 text-xs text-muted">
                      <input type="checkbox" checked={draft.enabled}
                        onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />启用
                    </label>
                    <label className="flex items-center gap-1 text-xs text-muted" title="内容改动较大时 +1：队员会看到「引导已更新」，但不会被强制重播">
                      版本
                      <input type="number" min={0} value={draft.version}
                        onChange={(e) => setDraft({ ...draft, version: Number(e.target.value) || 0 })}
                        className="w-16 rounded border border-border bg-background px-1.5 py-1 text-xs" />
                    </label>
                  </div>
                  <GuideStepList steps={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} />
                  <button onClick={save} disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
