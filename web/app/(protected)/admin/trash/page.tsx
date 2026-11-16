"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Trash2, RotateCcw, XCircle, Loader2, AlertTriangle } from "lucide-react";

interface TrashItem {
  id: number; originalTable: string; originalId: number; title: string;
  deletedByName: string; deletedAt: string;
}

const tableLabels: Record<string, string> = {
  InventoryItem: "零件", BatteryRecord: "电池", IncidentRecord: "事故记录", backup: "备份文件",
  PurchaseRequest: "采购申请", KnowledgePath: "知识库文档", WikiTask: "Wiki 项目", SharedFile: "共享文件",
};

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchItems = () => {
    setLoading(true);
    setLoadError("");
    api.get<{ items: TrashItem[] }>("/api/admin/trash")
      .then(r => setItems(r.items))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, []);

  const flash = (ok: boolean, text: string) => {
    setActionMsg({ ok, text });
    setTimeout(() => setActionMsg(null), 3000);
  };

  const restore = async (id: number) => {
    try {
      await api.post("/api/admin/trash/" + id + "/restore", {});
      flash(true, "已恢复");
      fetchItems();
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "恢复失败");
    }
  };

  const deleteForever = async (id: number) => {
    if (!confirm("确定永久删除？不可恢复！")) return;
    try {
      await api.delete("/api/admin/trash/" + id);
      flash(true, "已永久删除");
      fetchItems();
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "删除失败");
    }
  };

  const cleanup = async () => {
    if (!confirm("清理 30 天前的所有记录？")) return;
    try {
      const r = await api.post<{ message: string }>("/api/admin/trash/cleanup", {});
      flash(true, r.message);
      fetchItems();
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "清理失败");
    }
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

      {actionMsg && (
        <div className={actionMsg.ok
          ? "p-3 rounded-xl bg-success/10 text-success text-sm"
          : "p-3 rounded-xl bg-danger/10 text-danger text-sm"}>
          {actionMsg.text}
        </div>
      )}

      {loadError ? (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-8 text-center">
          <AlertTriangle className="h-10 w-10 mx-auto mb-2 text-danger/60" />
          <p className="text-sm font-medium text-danger">加载失败：{loadError}</p>
          <button onClick={fetchItems} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">重试</button>
        </div>
      ) : (
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
      )}
    </div>
  );
}