"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { CATALOG, COPY_GROUPS } from "@/lib/copy/catalog";
import { Loader2, RotateCcw, Save, Search } from "lucide-react";

interface OverrideRow {
  key: string;
  value: string;
  group: string;
  updatedAt: string;
}

type Drafts = Record<string, string>;

/**
 * 界面文案管理：列出全部可配置 key 的默认值与当前覆盖值。
 *
 * 保存语义：值等于默认值或留空 → 提交空串，即删除覆盖行（回到代码默认值）。
 * 只有"和默认不同"的 key 才会写库，避免数据库里堆无意义的复制品。
 */
export function TextsTab() {
  const [overrides, setOverrides] = useState<Drafts>({});
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("全部");

  const load = useCallback(async () => {
    try {
      const rows = await api.get<OverrideRow[]>("/api/admin/content/texts");
      const map: Drafts = {};
      for (const r of rows) map[r.key] = r.value;
      setOverrides(map);
      setDrafts({ ...map });
    } catch {
      setMsg("❌ 加载失败：仅管理员可访问");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allKeys = useMemo(() => Object.keys(CATALOG), []);

  /** 输入框里显示"当前生效值"：有覆盖用覆盖，否则用默认值 */
  const valueOf = (key: string) => drafts[key] ?? CATALOG[key].text;

  /** 实际要提交的改动：生效值与当前覆盖值不同 */
  const dirty = useMemo(
    () => allKeys.filter((k) => {
      const effective = drafts[k] ?? CATALOG[k].text;
      const current = overrides[k] ?? "";
      return effective !== current && (effective !== "" || current !== "");
    }),
    [allKeys, drafts, overrides],
  );

  const keys = useMemo(() => allKeys.filter((k) => {
    const entry = CATALOG[k];
    if (group !== "全部" && entry.group !== group) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return k.toLowerCase().includes(needle) || entry.text.toLowerCase().includes(needle) || entry.group.includes(needle);
  }), [allKeys, group, q]);

  async function save() {
    if (dirty.length === 0 || saving) return;
    setSaving(true);
    setMsg("");
    try {
      const items = dirty.map((key) => {
        const effective = drafts[key] ?? CATALOG[key].text;
        // 等于默认值 → 传空串，服务端删除覆盖行
        return { key, value: effective === CATALOG[key].text ? "" : effective };
      });
      const res = await api.put<{ saved: number; removed: number }>("/api/admin/content/texts", { items });
      setMsg(`✅ 已保存（新增/更新 ${res.saved}，恢复默认 ${res.removed}）`);
      await load();
    } catch {
      setMsg("❌ 保存失败，请检查长度或稍后重试");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-muted"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 key / 文案"
            className="w-56 rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm" />
        </div>
        <select value={group} onChange={(e) => setGroup(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
          <option value="全部">全部分组</option>
          {COPY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="text-xs text-muted">共 {keys.length} 条</span>
        <button onClick={save} disabled={dirty.length === 0 || saving}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存{dirty.length > 0 ? `（${dirty.length}）` : ""}
        </button>
      </div>

      {msg && <div className="rounded-lg bg-surface px-3 py-2 text-sm text-muted">{msg}</div>}

      <div className="space-y-2">
        {keys.map((key) => {
          const entry = CATALOG[key];
          const overridden = key in overrides && overrides[key] !== "";
          const value = valueOf(key);
          const tooLong = entry.max ? value.length > entry.max : false;
          return (
            <div key={key} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-faint">{key}</span>
                <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted">{entry.group}</span>
                {overridden && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">已修改</span>}
                <button onClick={() => setDrafts((d) => {
                  const next = { ...d };
                  delete next[key];   // 删除草稿 = 回落到默认值
                  return next;
                })}
                  className="ml-auto flex items-center gap-1 text-[11px] text-muted hover:text-foreground" title="恢复代码默认值">
                  <RotateCcw className="h-3 w-3" />恢复默认
                </button>
              </div>
              <input value={value} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm" />
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-faint">
                {entry.desc && <span>{entry.desc}</span>}
                <span>默认：{entry.text}</span>
                {entry.max && <span className={tooLong ? "text-danger" : ""}>{value.length}/{entry.max}</span>}
              </div>
            </div>
          );
        })}
        {keys.length === 0 && <div className="p-8 text-center text-sm text-faint">没有匹配的文案</div>}
      </div>
    </div>
  );
}
