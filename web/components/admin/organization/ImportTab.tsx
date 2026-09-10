"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

export function ImportTab({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvMsg, setCsvMsg] = useState("");
  const [initPassword, setInitPassword] = useState("");

  const handleCsvImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const token = localStorage.getItem("token");
    const fd = new FormData();
    fd.append("file", file);
    // 初始密码走 POST 表单体:放 URL query 会进浏览器历史/访问日志/Referer
    fd.append("password", initPassword);
    const res = await fetch(`/api/admin/users/import-csv`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const data = await res.json().catch(() => ({}));
    setCsvMsg(res.ok ? (data.message || `导入完成: ${data.imported} 人`) : (data.detail || data.message || "导入失败"));
    if (res.ok) onImported();
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">上传 CSV 文件</label>
        <p className="text-xs text-faint mb-2">CSV 格式：队员名,部门名（部门名为可选列，不存在则忽略）</p>
        <input ref={fileRef} type="file" accept=".csv" className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-sky-50 file:text-sky-700" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-2">初始密码（留空则逐个生成随机密码）</label>
        <input type="password" value={initPassword} onChange={(e) => setInitPassword(e.target.value)}
          autoComplete="new-password" placeholder="留空 = 随机初始密码"
          className="w-full rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm" />
      </div>
      <button onClick={handleCsvImport} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
        <Upload className="h-4 w-4" />导入队员
      </button>
      {csvMsg && <div className={`text-sm p-2 rounded-lg ${csvMsg.includes("成功") || csvMsg.includes("完成") ? "bg-green-50 text-green-700" : "bg-red-50 text-danger"}`}>{csvMsg}</div>}
    </div>
  );
}
