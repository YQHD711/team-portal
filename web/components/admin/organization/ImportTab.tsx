"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

export function ImportTab({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvMsg, setCsvMsg] = useState("");

  const handleCsvImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const token = localStorage.getItem("token");
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/admin/users/import-csv?password=team123`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const data = await res.json();
    setCsvMsg(data.message || `导入完成: ${data.imported} 人`);
    onImported();
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">上传 CSV 文件</label>
        <p className="text-xs text-zinc-400 mb-2">CSV 格式：队员名,部门名（部门名为可选列，不存在则忽略）</p>
        <input ref={fileRef} type="file" accept=".csv" className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-sky-50 file:text-sky-700" />
      </div>
      <button onClick={handleCsvImport} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600">
        <Upload className="h-4 w-4" />导入队员
      </button>
      {csvMsg && <div className={`text-sm p-2 rounded-lg ${csvMsg.includes("成功") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{csvMsg}</div>}
    </div>
  );
}
