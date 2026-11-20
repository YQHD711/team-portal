"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Loader2, RotateCcw, Save } from "lucide-react";

interface PermissionItem { key: string; label: string; desc: string | null }
interface PermissionGroup { group: string; items: PermissionItem[] }
interface Payload {
  roles: string[];
  groups: PermissionGroup[];
  matrix: Record<string, Record<string, boolean>>;
  defaults: Record<string, string[]>;
  overrides: { role: string; permission: string; allowed: boolean }[];
}

const ROLE_LABEL: Record<string, string> = { member: "成员", "部长": "部长", admin: "管理员" };

/**
 * 权限矩阵：行=权限点，列=角色。
 *
 * 保存时只提交与当前矩阵不同的格子；空值/与默认相同由服务端换算成"删覆盖行"，
 * 所以「恢复默认」不需要单独的数据迁移。
 */
export function PermissionMatrix() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Payload>("/api/admin/permissions");
      setData(res);
      const flat: Record<string, boolean> = {};
      for (const role of res.roles) {
        for (const [perm, allowed] of Object.entries(res.matrix[role] ?? {})) {
          flat[role + "|" + perm] = allowed;
        }
      }
      setDraft(flat);
    } catch {
      setMsg("❌ 加载失败：仅具备「权限管理」权限的人可访问");
    } finally {
      setLoading(false);
    }
  }

  // 挂载时加载一次；load 内部会 setState，不能放在 useMemo 里（会触发渲染期副作用告警）
  useEffect(() => { void load(); }, []);

  const changed = useMemo(() => {
    if (!data) return [] as { role: string; permission: string; allowed: boolean }[];
    const list: { role: string; permission: string; allowed: boolean }[] = [];
    for (const role of data.roles) {
      for (const group of data.groups) {
        for (const item of group.items) {
          const key = role + "|" + item.key;
          const now = draft[key] ?? false;
          if (now !== (data.matrix[role]?.[item.key] ?? false)) {
            list.push({ role, permission: item.key, allowed: now });
          }
        }
      }
    }
    return list;
  }, [data, draft]);

  async function save() {
    if (!data || changed.length === 0 || saving) return;
    setSaving(true);
    setMsg("");
    try {
      await api.put("/api/admin/permissions", changed);
      setMsg("✅ 已保存，权限立即生效");
      await load();
    } catch (e) {
      setMsg("❌ 保存失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setSaving(false);
    }
  }

  async function resetRole(role: string) {
    if (!window.confirm(`恢复「${ROLE_LABEL[role] ?? role}」的全部默认权限？`)) return;
    setSaving(true);
    try {
      await api.delete(`/api/admin/permissions/${encodeURIComponent(role)}`);
      setMsg("✅ 已恢复默认");
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
  if (!data) {
    return <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">{msg || "无法加载权限矩阵"}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">共 {data.roles.length} 个角色 · 改动 {changed.length} 项</span>
        <button onClick={save} disabled={changed.length === 0 || saving}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存
        </button>
      </div>
      {msg && <div className="rounded-lg bg-surface px-3 py-2 text-sm text-muted">{msg}</div>}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">权限</th>
              {data.roles.map((r) => (
                <th key={r} className="px-3 py-2 text-center font-medium">
                  {ROLE_LABEL[r] ?? r}
                  <button onClick={() => resetRole(r)} className="ml-1 text-faint hover:text-foreground" title="恢复该角色默认">
                    <RotateCcw className="inline h-3 w-3" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group) => (
              <PermissionGroupRows key={group.group} group={group} roles={data.roles} draft={draft}
                onToggle={(role, perm) => setDraft((d) => ({ ...d, [role + "|" + perm]: !(d[role + "|" + perm] ?? false) }))} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-faint">
        说明：菜单与按钮会按这里的权限显示/隐藏；后端接口同样按权限校验。改完立即生效，用户刷新页面即可看到新菜单。
      </p>
    </div>
  );
}

function PermissionGroupRows({ group, roles, draft, onToggle }: {
  group: PermissionGroup;
  roles: string[];
  draft: Record<string, boolean>;
  onToggle: (role: string, permission: string) => void;
}) {
  return (
    <>
      <tr className="bg-surface-hover/60">
        <td colSpan={roles.length + 1} className="px-3 py-1.5 text-[11px] font-medium text-muted">{group.group}</td>
      </tr>
      {group.items.map((item) => (
        <tr key={item.key} className="border-t border-border-subtle">
          <td className="px-3 py-2">
            <div>{item.label}</div>
            <div className="font-mono text-[10px] text-faint">{item.key}{item.desc ? " · " + item.desc : ""}</div>
          </td>
          {roles.map((role) => {
            const key = role + "|" + item.key;
            return (
              <td key={role} className="px-3 py-2 text-center">
                <input type="checkbox" checked={draft[key] ?? false} onChange={() => onToggle(role, item.key)}
                  aria-label={`${role} ${item.label}`} className="h-4 w-4 accent-[var(--primary)]" />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
