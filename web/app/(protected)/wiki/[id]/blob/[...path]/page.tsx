"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getToken } from "@/lib/auth";
import { ArrowLeft, Loader2 } from "lucide-react";

interface BlobData { path: string; content: string; language: string; lines: number; }

export default function BlobViewerPage() {
  const params = useParams();
  const taskId = params.id as string;
  const filePath = (params.path as string[]).join("/");

  const [data, setData] = useState<BlobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getToken();
    if (!token) { setError("请先登录"); setLoading(false); return; }

    fetch(`/api/wiki/tasks/${taskId}/blob/${filePath}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, filePath]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-faint" /></div>;
  if (error) return <div className="text-center py-16 text-muted">{error}</div>;
  if (!data) return null;

  const lines = data.content.split("\n");

  return (
    <div className="space-y-2 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <Link href={`/wiki/${taskId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-sky-600">
          <ArrowLeft className="h-4 w-4" /> 返回文档
        </Link>
        <span className="text-xs text-faint">{data.language} · {data.lines} 行</span>
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-[#1e1e1e] text-[#d4d4d4]">
        <div className="px-4 py-2 border-b border-zinc-700 bg-[#252526] flex items-center justify-between">
          <span className="text-sm font-mono text-[#4fc3f7]">{filePath}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="hover:bg-white/5">
                  <td className="w-12 text-right pr-0 pl-2 py-0 text-[#858585] border-r border-[#333] select-none text-xs leading-5 align-top">{i + 1}</td>
                  <td className="pl-3 pr-4 py-0 text-xs leading-5 align-top whitespace-pre font-mono">{l || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
