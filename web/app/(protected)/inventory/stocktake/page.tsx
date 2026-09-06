"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { ClipboardCheck, Plus, Check, Users, Package, ChevronRight, Loader2, ListChecks, Pause, Play, X, Trash2, Save } from "lucide-react";
import Link from "next/link";

interface Item { id: number; name: string; grade: string; quantity: number; locationCode?: string; }
interface UserBrief { id: number; username: string; role: string; department?: { id: number; name: string }; }
interface Stocktake {
  id: number; type: string; grade: string; status: string;
  startedAt: string; completedAt?: string;
  createdBy?: { id?: number; username: string };
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

const STATUS_LABEL: Record<string, string> = {
  in_progress: "进行中", paused: "已暂停", pending_merge: "待入账", completed: "已完成", cancelled: "已作废",
};
const STATUS_COLOR: Record<string, string> = {
  in_progress: "bg-warning/15 text-warning", paused: "bg-info/15 text-info",
  pending_merge: "bg-purple-500/15 text-purple-600", completed: "bg-success/15 text-success",
  cancelled: "bg-zinc-200 text-zinc-600",
};

export default function StocktakePage() {
  const { user } = useCurrentUser();
  const role = user?.role ?? "";
  const [tab, setTab] = useState<"list" | "my">("my");
  const [list, setList] = useState<Stocktake[]>([]);
  const [myTasks, setMyTasks] = useState<StocktakeItem[]>([]);
  const [members, setMembers] = useState<UserBrief[]>([]);
  const [inventory, setInventory] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Stocktake | null>(null);
  const [showNew, setShowNew] = useState(false);
  const isStaff = role === "admin" || role === "部长";
  const isAdmin = role === "admin";

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
  useEffect(() => { if (isStaff) { api.get<UserBrief[]>("/api/admin/users").then(us => setMembers(us.filter(u => u.role !== "admin"))).catch(() => {}); api.get<Item[]>("/api/inventory").then(setInventory).catch(() => {}); } }, [isStaff]);

  const loadDetail = async (id: number) => {
    const d = await api.get<Stocktake>(`/api/material/stocktake/${id}`);
    setSelected(d);
    return d;
  };

  const startStocktake = async (type: string, grade: string) => {
    try {
      const st = await api.post<Stocktake>("/api/material/stocktake/start", { type, grade });
      alert(`已创建盘点，共 ${st.items?.length || 0} 项，请点击进入分派`);
      setShowNew(false); fetchData();
    } catch { alert("发起失败"); }
  };

  const act = async (url: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    try { await api.post(url, {}); } catch (e) { alert(e instanceof Error ? e.message : "操作失败"); return; }
    fetchData();
    if (selected) loadDetail(selected.id);
  };

  const autoAssign = async (id: number) => {
    const userIds = members.filter(m => m.role === "部长" || m.role === "member").map(m => m.id);
    if (userIds.length === 0) { alert("没有可分配的队员"); return; }
    try { await api.post(`/api/material/stocktake/${id}/auto-assign`, { userIds }); fetchData(); loadDetail(id); }
    catch { alert("分派失败"); }
  };

  const reassign = async (stocktakeId: number, itemId: number, userId: number) => {
    try { await api.post(`/api/material/stocktake/${stocktakeId}/items/${itemId}/assign`, { userId }); loadDetail(stocktakeId); }
    catch (e) { alert(e instanceof Error ? e.message : "改派失败"); }
  };

  const saveItem = async (stocktakeId: number, itemId: number, qty: number | null, note: string | null) => {
    try { await api.put(`/api/material/stocktake/${stocktakeId}/item/${itemId}`, { actualQty: qty, note }); loadDetail(stocktakeId); }
    catch (e) { alert(e instanceof Error ? e.message : "保存失败"); }
  };

  const addItem = async (stocktakeId: number, itemId: number) => {
    try { await api.post(`/api/material/stocktake/${stocktakeId}/items`, { inventoryItemId: itemId }); loadDetail(stocktakeId); }
    catch (e) { alert(e instanceof Error ? e.message : "加入失败"); }
  };

  const removeItem = async (stocktakeId: number, itemId: number) => {
    if (!confirm("移除该盘点项？(未入账,不影响库存)")) return;
    try { await api.delete(`/api/material/stocktake/${stocktakeId}/items/${itemId}`); loadDetail(stocktakeId); }
    catch { alert("移除失败"); }
  };

  const delStocktake = async (id: number) => {
    if (!confirm("删除该盘点及其明细？(不可恢复)")) return;
    try { await api.delete(`/api/material/stocktake/${id}`); setSelected(null); fetchData(); }
    catch { alert("删除失败"); }
  };

  const reportItem = async (stocktakeId: number, itemId: number, qty: number) => {
    try { await api.post(`/api/material/stocktake/${stocktakeId}/batch-check`, { results: [{ itemId, actualQty: qty, note: null }] }); fetchData(); }
    catch (e) { alert(e instanceof Error ? e.message : "提交失败"); }
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

  // ── 盘点详情(仅 staff) ──
  if (selected && isStaff) {
    const total = selected.items?.length || 0;
    const done = selected.items?.filter(i => i.actualQty != null).length || 0;
    const diffs = selected.items?.filter(i => i.difference != null && i.difference !== 0) || [];
    const editable = selected.status === "in_progress" || selected.status === "paused";
    const manager = isAdmin || (!!selected.createdBy?.id && user?.id === selected.createdBy.id);
    const candidates = inventory.filter(i => i.grade === selected.grade && !selected.items?.some(x => x.inventoryItemId === i.id));

    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { setSelected(null); }} className="text-sm text-muted">&larr; 返回</button>
          <h1 className="text-xl font-bold">{selected.type === "semester" ? "学期大盘" : "周盘点"} — {gradeLabel(selected.grade)}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[selected.status] || "bg-surface-hover"}`}>
            {STATUS_LABEL[selected.status] || selected.status}{editable ? ` ${done}/${total}` : ""}
          </span>
          {!manager && <span className="text-xs text-faint">(发起者可管理)</span>}
        </div>

        {manager && editable && (
          <div className="flex flex-wrap gap-2">
            {selected.status === "in_progress" && assignedCount(selected) < total && (
              <button onClick={() => autoAssign(selected.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover">
                <Users className="h-4 w-4" />自动分派
              </button>
            )}
            {selected.status === "in_progress"
              ? <button onClick={() => act(`/api/material/stocktake/${selected.id}/pause`)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-surface-hover"><Pause className="h-4 w-4" />暂停</button>
              : <button onClick={() => act(`/api/material/stocktake/${selected.id}/resume`)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-surface-hover"><Play className="h-4 w-4" />恢复</button>}
            <button onClick={() => act(`/api/material/stocktake/${selected.id}/cancel`, "确认作废该盘点？(不改库存,记录保留)")} className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger/5"><X className="h-4 w-4" />取消</button>
            <button onClick={() => delStocktake(selected.id)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-red-50 text-danger"><Trash2 className="h-4 w-4" />删除</button>
          </div>
        )}
        {manager && selected.status === "pending_merge" && (
          <button onClick={() => act(`/api/material/stocktake/${selected.id}/merge`, `确认将 ${diffs.length} 项差异合并入库存？`) }
            className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white hover:bg-success"><Check className="h-4 w-4" />合并入库（{diffs.length} 项差异）</button>
        )}
        {manager && (selected.status === "cancelled") && (
          <button onClick={() => delStocktake(selected.id)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-red-50 text-danger"><Trash2 className="h-4 w-4" />删除记录</button>
        )}
        {selected.status === "completed" && diffs.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{diffs.length} 项差异已入账</div>
        )}

        {manager && editable && candidates.length > 0 && (
          <div className="rounded-xl border bg-surface p-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">补入零件:</span>
            {candidates.slice(0, 12).map(c => (
              <button key={c.id} onClick={() => addItem(selected.id, c.id)}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs hover:bg-surface-hover"><Plus className="h-3 w-3" />{c.name}</button>
            ))}
            {candidates.length > 12 && <span className="text-xs text-faint">+{candidates.length - 12}…</span>}
          </div>
        )}

        <div className="rounded-xl border overflow-x-auto bg-surface">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr className="border-b bg-surface-subtle">
              <th className="px-4 py-3 text-left">零件</th><th className="px-4 py-3">等级</th>
              <th className="px-4 py-3 text-right">系统</th><th className="px-4 py-3 text-right">实盘</th>
              <th className="px-4 py-3 text-right">差异</th><th className="px-4 py-3 text-xs">核查人</th>
              {manager && editable && <th className="px-4 py-3 text-right">操作</th>}
            </tr></thead>
            <tbody className="divide-y">
              {selected.items?.map(si => (
                <Row key={si.inventoryItemId} si={si}
                  members={members.filter(m => m.id !== user?.id)} manager={manager} editable={editable}
                  onSave={(q, n) => saveItem(selected.id, si.inventoryItemId, q, n)}
                  onAssign={(uid) => reassign(selected.id, si.inventoryItemId, uid)}
                  onRemove={() => removeItem(selected.id, si.inventoryItemId)} />
              ))}
            </tbody>
          </table>
        </div>

        {manager && editable && done === total && total > 0 && (
          <button onClick={() => act(`/api/material/stocktake/${selected.id}/finalize`, `冻结盘点结果（${diffs.length} 项差异待入账）？`) }
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white hover:bg-accent-hover">
            <Check className="h-4 w-4 inline mr-2" />完成盘点 · 冻结结果
          </button>
        )}
        {!manager && !editable && selected.status !== "completed" && (
          <p className="text-sm text-faint">盘点已{STATUS_LABEL[selected.status] || selected.status}，等待发起者处理</p>
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
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-muted">{si.inventoryItem?.grade}</span>
                      <span className="text-xs text-faint">{si.stocktake?.type === "semester" ? "学期盘" : "周盘"}</span>
                      {si.stocktake?.status === "paused" && <span className="text-xs text-info font-medium">(已暂停)</span>}
                    </div>
                    <div className="text-xs text-muted">系统库存: <span className="font-mono font-medium">{si.systemQty}</span>{si.inventoryItem?.locationCode && <> · 库位: {si.inventoryItem.locationCode}</>}</div>
                  </div>
                  {si.stocktake?.status === "in_progress" ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <input type="number" min={0} placeholder="实盘" id={`qty-${si.stocktakeId}-${si.inventoryItemId}`}
                        className="w-20 rounded-lg border px-2 py-1.5 text-sm text-right font-mono" />
                      <button onClick={() => {
                        const el = document.getElementById(`qty-${si.stocktakeId}-${si.inventoryItemId}`) as HTMLInputElement;
                        const v = parseInt(el?.value || "");
                        if (isNaN(v)) { alert("请输入数量"); return; }
                        reportItem(si.stocktakeId!, si.inventoryItemId, v);
                      }} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-accent-hover whitespace-nowrap">提交</button>
                    </div>
                  ) : (
                    <span className="text-xs text-faint shrink-0">盘点暂停或已结束，暂不可提交</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "list" && isStaff && (
        <div className="rounded-xl border bg-surface overflow-hidden">
          {loading ? <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> :
           list.length === 0 ? <div className="p-8 text-center text-faint"><ClipboardCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无盘点</div> :
           <div className="divide-y">
            {list.map(st => (
              <button key={st.id} onClick={async () => { try { await loadDetail(st.id); } catch { setSelected(st); } }}
                className="w-full p-4 text-left hover:bg-zinc-50 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{st.type === "semester" ? "学期大盘" : "周盘点"} — {gradeLabel(st.grade)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[st.status] || "bg-surface-hover"}`}>{STATUS_LABEL[st.status] || st.status}</span>
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

function assignedCount(st: Stocktake): number {
  return st.items?.filter(i => i.checkedByUserId != null).length || 0;
}

/** 盘点明细行(发起者/admin 可编辑实盘/备注、改派、移除) */
function Row({ si, members, manager, editable, onSave, onAssign, onRemove }: {
  si: StocktakeItem;
  members: UserBrief[];
  manager: boolean;
  editable: boolean;
  onSave: (qty: number | null, note: string | null) => void;
  onAssign: (userId: number) => void;
  onRemove: () => void;
}) {
  const [q, setQ] = useState<string>(si.actualQty != null ? String(si.actualQty) : "");
  const [note, setNote] = useState<string>(si.note || "");
  return (
    <tr className={si.difference ? "bg-amber-50/50" : ""}>
      <td className="px-4 py-3 font-medium">{si.inventoryItem?.name || `#${si.inventoryItemId}`}</td>
      <td className="px-4 py-3 text-center"><span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-surface-hover text-muted">{si.inventoryItem?.grade}</span></td>
      <td className="px-4 py-3 text-right tabular-nums">{si.systemQty}</td>
      <td className="px-4 py-3 text-right">
        {manager && editable ? (
          <input type="number" min={0} value={q} onChange={e => setQ(e.target.value)}
            className="w-20 rounded-lg border px-2 py-1 text-right font-mono text-sm" />
        ) : (si.actualQty ?? "—")}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${si.difference && si.difference > 0 ? "text-success" : si.difference && si.difference < 0 ? "text-danger" : ""}`}>
        {si.difference != null ? (si.difference > 0 ? `+${si.difference}` : si.difference) : "—"}
      </td>
      <td className="px-4 py-3 text-xs">
        {manager && editable ? (
          <select value={si.checkedByUserId ?? ""} onChange={e => { if (e.target.value) onAssign(Number(e.target.value)); }}
            className="rounded-lg border px-1 py-1 text-xs max-w-[110px]">
            <option value="">未指派</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.username}</option>)}
          </select>
        ) : (si.checkedBy?.username || (si.checkedByUserId ? `#${si.checkedByUserId}` : "未派"))}
      </td>
      {manager && editable && (
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="备注"
              className="w-24 rounded-lg border px-2 py-1 text-xs" />
            <button onClick={() => onSave(q === "" ? null : parseInt(q), note || null)}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover"><Save className="h-3 w-3" />保存</button>
            <button onClick={onRemove} className="p-1 rounded hover:bg-red-50 text-danger" title="移除"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </td>
      )}
    </tr>
  );
}
