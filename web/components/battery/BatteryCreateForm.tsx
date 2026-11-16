"use client";

import { useState } from "react";

interface Props {
  onSubmit: (form: { code: string; model: string; health: string; notes: string }) => Promise<void>;
  onCancel: () => void;
}

/** 新增电池表单（staff）：编码留空自动生成。 */
export function BatteryCreateForm({ onSubmit, onCancel }: Props) {
  const [form, setForm] = useState({ code: "", model: "", health: "正常", notes: "" });
  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium">
          编码（留空自动生成）
          <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="BAT-0001" />
        </label>
        <label className="block text-xs font-medium">
          型号
          <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="6S 3300mAh" />
        </label>
        <label className="block text-xs font-medium">
          健康度
          <select value={form.health} onChange={e => setForm({ ...form, health: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
            {["正常", "鼓包", "漏液", "过放", "报废"].map(h => <option key={h}>{h}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium">
          备注
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-sm">取消</button>
        <button onClick={() => onSubmit(form)} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">保存</button>
      </div>
    </div>
  );
}