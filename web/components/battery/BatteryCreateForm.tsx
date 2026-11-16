"use client";

import { useState } from "react";

interface FormState {
  code: string; model: string; health: string; notes: string; count: number;
}

interface Props {
  onSubmit: (form: FormState) => Promise<void>;
  onCancel: () => void;
}

/**
 * 新增电池表单（staff）：数量=1 走单块（可自定义编码）；数量>1 走批量（连续编码、同型号）。
 */
export function BatteryCreateForm({ onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<FormState>({ code: "", model: "", health: "正常", notes: "", count: 1 });
  const batch = form.count > 1;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium">
          数量（{"＞1 = 批量连续编码"}）
          <input type="number" min={1} max={500} value={form.count}
            onChange={e => setForm({ ...form, count: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-medium">
          编码（批量时自动生成）
          <input value={batch ? "自动生成 BAT-xxxx" : form.code} disabled={batch}
            onChange={e => setForm({ ...form, code: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm disabled:text-faint" placeholder="BAT-0001" />
        </label>
        <label className="block text-xs font-medium">
          型号（批量时全部相同）
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
        <label className="block text-xs font-medium sm:col-span-2">
          备注
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-faint">{batch ? "将批量创建 " + form.count + " 块，编码连续生成" : "单块录入"}</span>
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-sm">取消</button>
          <button onClick={() => onSubmit(form)} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">保存</button>
        </div>
      </div>
    </div>
  );
}
