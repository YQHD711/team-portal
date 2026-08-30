"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Trash2, RotateCcw, XCircle, Loader2, AlertTriangle } from "lucide-react";

interface TrashItem {
  id: number; originalTable: string; originalId: number; title: string;
  deletedByName: string; deletedAt: string;
}

const tableLabels: Record<string, string> = {
  InventoryItem: "零件", BatteryRecord: "电池", IncidentRecord: "事故记录",
};

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState("");

  const fetchItems = () => {
    setLoading(true);
    api.get<{ items: TrashItem[] }>("/api/admin/trash").then(r => setItems(r.items)).catch(()=>{}).finally(()=>setLoading(false));
  };

  useEffect(() => { fetchItems(); }, []);

  const restore = async (id: number) => {
    await api.post(`/api/admin/trash/${id}/restore`, {});
    setActionMsg("已恢复"); setTimeout(() => setActionMsg(""), 2000);
    fetchItems();
  };

  const deleteForever = async (id: number) => {
    if (!confirm("确定永久删除？不可恢复！")) return;
    await api.delete(`/api/admin/trash/${id}`);
    setActionMsg("已永久删除"); setTimeout(() => setActionMsg(""), 2000);
    fetchItems();
  };

  const cleanup = async () => {
    if (!confirm("清理 30 天前的所有记录？")) return;
    const r = await api.post<{ message: string }>("/api/admin/trash/cleanup", {});
    setActionMsg(r.message); setTimeout(() => setActionMsg(""), 3000);
    fetchItems();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">回收站</h1>
          <p className="text-sm text-muted">已删除的数据保留 30 天，过期自动清理</p>
        </div>
        <button onClick={cleanup} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-red-200 text-danger hover:bg-red-50">
          <AlertTriangle className="h-4 w-4" />清理过期记录
        </button>
      </div>

      {actionMsg && <div className="p-3 rounded-xl bg-success/10 text-success text-sm">{actionMsg}</div>}

      <div className="rounded-xl border border-border bg-surface divide-y divide-border-subtle">
        {items.length === 0 ? (
          <div className="p-12 text-center text-faint">
            <Trash2 className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
            <p>回收站为空</p>
            <p className="text-xs mt-1">删除的数据会出现在这里</p>
          </div>
        ) : items.map(item => (
          <div key={item.id} className="flex items-center justify-between p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{item.title}</div>
              <div className="text-xs text-faint mt-0.5">
                <span>{tableLabels[item.originalTable] || item.originalTable}</span>
                <span className="mx-1">·</span>
                <span>{new Date(item.deletedAt).toLocaleString("zh-CN")}</span>
                <span className="mx-1">·</span>
                <span>{item.deletedByName}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <button onClick={() => restore(item.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-success/10 text-success hover:bg-success/20">
                <RotateCcw className="h-3.5 w-3.5" />恢复
              </button>
              <button onClick={() => deleteForever(item.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-danger/10 text-danger hover:bg-danger/20">
                <XCircle className="h-3.5 w-3.5" />永久删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
