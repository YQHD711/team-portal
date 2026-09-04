"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { ClipboardCheck, Plus, Check, Users, Package, ChevronRight, Loader2, ListChecks } from "lucide-react";
import Link from "next/link";

interface Item { id: number; name: string; grade: string; quantity: number; locationCode?: string; }
interface UserBrief { id: number; username: string; role: string; department?: { id: number; name: string }; }
interface Stocktake {
  id: number; type: string; grade: string; status: string;
  startedAt: string; completedAt?: string;
  createdBy?: { username: string };
  items?: StocktakeItem[];
}
interface StocktakeItem {
  stocktakeId: number; inventoryItemId: number; systemQty: number; actualQty?: number;
  difference?: number; note?: string;
  inventoryItem?: Item;
  checkedBy?: { username: string };
  checkedByUserId?: number;
  stocktake?: { id: number; type: string; grade: string; status: string; startedAt: string };
}

export default function StocktakePage() {
  const [tab, setTab] = useState<"list" | "my">("my");
  const [list, setList] = useState<Stocktake[]>([]);
  const [myTasks, setMyTasks] = useState<StocktakeItem[]>([]);
  const [members, setMembers] = useState<UserBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useCurrentUser();
  const role = user?.role ?? "";
  const [selected, setSelected] = useState<Stocktake | null>(null);
  const [showNew, setShowNew] = useState(false);
  const isStaff = role === "admin" || role === "部长";

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stList, myT] = await Promise.all([
        api.get<Stocktake[]>("/api/material/stocktake"),
        api.get<StocktakeItem[]>("/api/material/stocktake/my-tasks"),
      ]);
      setList(stList); setMyTasks(myT);
      if (!isStaff) setTab("my");
    } catch { }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // 队员名单仅 staff 需要，用户信息就绪后拉取一次
  useEffect(() => {
    if (!isStaff) return;
    api.get<UserBrief[]>("/api/admin/users").then(users => setMembers(users.filter(u => u.role !== "admin"))).catch(() => {});
  }, [isStaff]);

  const startStocktake = async (type: string, grade: string) => {
    try {
      const st = await api.post<Stocktake>("/api/material/stocktake/start", { type, grade });
      alert(`已创建盘点，共 ${st.items?.length || 0} 项，请点击进入分派`);
      setShowNew(false);
      fetchData();
    } catch { alert("发起失败"); }
  };

  const autoAssign = async (id: number) => {
    const userIds = members.filter(m => m.role === "部长" || m.role === "member").map(m => m.id);
    if (userIds.length === 0) { alert("没有可分配的队员"); return; }
    try {
      await api.post(`/api/material/stocktake/${id}/auto-assign`, { userIds });
      alert(`已自动分派给 ${userIds.length} 名队员`);
      fetchData();
      const detail = await api.get<Stocktake>(`/api/material/stocktake/${id}`);
      setSelected(detail);
    } catch { alert("分派失败"); }
  };

  const completeStocktake = async (id: number) => {
    if (!confirm("确认完成盘点？差异自动调整库存。")) return;
    try { await api.post(`/api/material/stocktake/${id}/complete`, {}); fetchData(); }
    catch { alert("完成失败"); }
  };

  const reportItem = async (stocktakeId: number, itemId: number, qty: number) => {
    try {
      await api.post(`/api/material/stocktake/${stocktakeId}/batch-check`, {
        results: [{ itemId, actualQty: qty, note: null }]
      });
      fetchData();
    } catch { alert("提交失败"); }
  };

  const gradeLabel = (g: string) => g === "A" ? "A级·关键" : g === "B" ? "B级·常规" : "C级·耗材";

  const tabBar = (
    <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
      <button onClick={() => setTab("my")}
        className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 ${tab === "my" ? "bg-surface shadow-sm" : "text-muted"}`}>
        <ListChecks className="h-4 w-4" />我的任务{myTasks.length > 0 && ` (${myTasks.length})`}
      </button>
      {isStaff && (
        <button onClick={() => setTab("list")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 ${tab === "list" ? "bg-surface shadow-sm" : "text-muted"}`}>
          <ClipboardCheck className="h-4 w-4" />全部盘点
        </button>
      )}
    </div>
  );

  // ── 管理员详情 ──
  if (selected && isStaff) {
    const total = selected.items?.length || 0;
    const assigned = selected.items?.filter(i => i.checkedByUserId != null).length || 0;
    const done = selected.items?.filter(i => i.actualQty != null).length || 0;
    const diffs = selected.items?.filter(i => i.difference != null && i.difference !== 0) || [];
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelected(null); }} className="text-sm text-muted">&larr; 返回</button>
          <h1 className="text-xl font-bold">{selected.type === "semester" ? "学期大盘" : "周盘点"} — {gradeLabel(selected.grade)}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${selected.status === "completed" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
            {selected.status === "completed" ? "已完成" : `进行中 ${done}/${total}`}
          </span>
        </div>

        {selected.status === "in_progress" && assigned < total && (
          <button onClick={() => autoAssign(selected.id)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Users className="h-4 w-4" />自动分派给 {members.filter(m => m.role !== "admin").length} 名队员
          </button>
        )}

        {diffs.length > 0 && selected.status === "completed" && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{diffs.length} 项差异已调库存</div>
        )}

        <div className="rounded-xl border overflow-x-auto bg-surface">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="border-b bg-surface-subtle">
              <th className="px-4 py-3 text-left">零件</th><th className="px-4 py-3">等级</th>
              <th className="px-4 py-3 text-right">系统</th><th className="px-4 py-3 text-right">实盘</th>
              <th className="px-4 py-3 text-right">差异</th><th className="px-4 py-3 text-xs">核查人</th>
            </tr></thead>
            <tbody className="divide-y">
              {selected.items?.map(si => (
                <tr key={si.inventoryItemId} className={si.difference ? "bg-amber-50/50" : ""}>
                  <td className="px-4 py-3 font-medium">{si.inventoryItem?.name || `#${si.inventoryItemId}`}</td>
                  <td className="px-4 py-3 text-center"><span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${si.inventoryItem?.grade === "A" ? "bg-danger/15 text-danger" : si.inventoryItem?.grade === "B" ? "bg-warning/15 text-warning" : "bg-surface-hover text-muted"}`}>{si.inventoryItem?.grade}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{si.systemQty}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{si.actualQty ?? "—"}</td>
                  <td className={`px-4 py-3 text-right font-medium ${si.difference && si.difference > 0 ? "text-success" : si.difference && si.difference < 0 ? "text-danger" : ""}`}>
                    {si.difference != null ? (si.difference > 0 ? `+${si.difference}` : si.difference) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-faint">{si.checkedBy?.username || (si.checkedByUserId ? `#${si.checkedByUserId}` : "未派")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected.status === "in_progress" && done === total && total > 0 && (
          <button onClick={() => completeStocktake(selected.id)}
            className="w-full rounded-xl bg-success px-4 py-3 text-sm font-medium text-white hover:bg-success">
            <Check className="h-4 w-4 inline mr-2" />完成盘点（{diffs.length} 项差异入账）
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">物料盘点</h1>
          <p className="text-sm text-muted">
            {isStaff ? "发起盘点并分派队员核查" : myTasks.length > 0 ? `${myTasks.length} 项待盘点` : "暂无待盘点任务"}
          </p>
        </div>
        <Link href="/inventory" className="text-sm text-faint hover:text-zinc-600"><Package className="h-4 w-4 inline" /> 库存</Link>
      </div>

      {/* Staff: create button */}
      {isStaff && !showNew && (
        <button onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover w-fit">
          <Plus className="h-4 w-4" />发起盘点
        </button>
      )}
      {isStaff && showNew && (
        <div className="rounded-xl border bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between"><h3 className="font-medium text-sm">发起新盘点</h3><button onClick={() => setShowNew(false)} className="text-faint text-xs">取消</button></div>
          <div className="flex flex-wrap gap-2">
            {(["A", "B", "C"] as const).map(g => (
              <div key={g} className="flex gap-1">
                <button onClick={() => startStocktake("weekly", g)} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-accent-hover"><Plus className="h-3.5 w-3.5 inline mr-1" />{gradeLabel(g)} 周盘</button>
                <button onClick={() => startStocktake("semester", g)} className="px-4 py-2 rounded-lg border text-sm hover:bg-surface-hover">学期盘</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tabBar}

      {/* ── Member: My Tasks ── */}
      {tab === "my" && (
        loading ? <div className="text-center py-16 text-faint"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> :
        myTasks.length === 0 ? (
          <div className="text-center py-16 text-faint">
            <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>暂无待盘点任务</p>
            <p className="text-xs mt-1">管理员发起盘点并分派后，这里会显示你的任务</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myTasks.map(si => (
              <div key={`${si.stocktakeId}-${si.inventoryItemId}`} className="rounded-xl border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{si.inventoryItem?.name}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${si.inventoryItem?.grade === "A" ? "bg-red-100 text-red-700" : si.inventoryItem?.grade === "B" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-muted"}`}>{si.inventoryItem?.grade}</span>
                      <span className="text-xs text-faint">{si.stocktake?.type === "semester" ? "学期盘" : "周盘"}</span>
                    </div>
                    <div className="text-xs text-muted">
                      系统库存: <span className="font-mono font-medium">{si.systemQty}</span>
                      {si.inventoryItem?.locationCode && <> · 库位: {si.inventoryItem.locationCode}</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input type="number" min={0} placeholder="实盘"
                      className="w-20 rounded-lg border px-2 py-1.5 text-sm text-right font-mono"
                      id={`qty-${si.stocktakeId}-${si.inventoryItemId}`} />
                    <button onClick={() => {
                      const el = document.getElementById(`qty-${si.stocktakeId}-${si.inventoryItemId}`) as HTMLInputElement;
                      const v = parseInt(el?.value || "");
                      if (isNaN(v)) { alert("请输入数量"); return; }
                      reportItem(si.stocktakeId!, si.inventoryItemId, v);
                    }} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-accent-hover whitespace-nowrap">
                      提交
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Staff: All list ── */}
      {tab === "list" && isStaff && (
        <div className="rounded-xl border bg-surface overflow-hidden">
          {loading ? <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> :
           list.length === 0 ? <div className="p-8 text-center text-faint"><ClipboardCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无盘点</div> :
           <div className="divide-y">
            {list.map(st => (
              <button key={st.id} onClick={async () => {
                try { const detail = await api.get<Stocktake>(`/api/material/stocktake/${st.id}`); setSelected(detail); }
                catch { setSelected(st); }
              }}
                className="w-full p-4 text-left hover:bg-zinc-50 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{st.type === "semester" ? "学期大盘" : "周盘点"} — {gradeLabel(st.grade)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.status === "completed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{st.status === "completed" ? "已完成" : "进行中"}</span>
                  </div>
                  <div className="text-xs text-muted mt-1">{new Date(st.startedAt).toLocaleString("zh-CN")} · {st.createdBy?.username}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-zinc-300" />
              </button>
            ))}
           </div>
          }
        </div>
      )}
    </div>
  );
}
