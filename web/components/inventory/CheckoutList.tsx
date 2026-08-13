import { ArrowLeftRight, Check, Clock, X } from "lucide-react";
import { statusLabels, type CheckoutReq } from "./checkoutTypes";

interface Props {
  tab: "my" | "pending";
  loading: boolean;
  my: CheckoutReq[];
  pending: CheckoutReq[];
  isStaff: boolean;
  isAdmin: boolean;
  onCheckin: (r: CheckoutReq) => void;
  onApproveDept: (id: number) => void;
  onApproveAdmin: (id: number) => void;
  onReject: (id: number) => void;
}

/** 领用记录列表（我的领用 / 待审批两个视图，由 tab 决定） */
export default function CheckoutList({ tab, loading, my, pending, isStaff, isAdmin, onCheckin, onApproveDept, onApproveAdmin, onReject }: Props) {
  if (tab === "my") {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? <div className="p-8 text-center text-zinc-400">加载中...</div> :
         my.length === 0 ? <div className="p-8 text-center text-zinc-400"><ArrowLeftRight className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无领用记录</div> :
         <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {my.map(r => (
            <div key={r.id} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.item?.name || `#${r.inventoryItemId}`}</span>
                    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${r.grade === "A" ? "bg-red-100 text-red-700" : r.grade === "B" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"}`}>{r.grade}级</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${r.status === "approved" ? "bg-green-100 text-green-700" : r.status === "rejected" ? "bg-red-100 text-red-700" : r.status === "returned" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{statusLabels[r.status] || r.status}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {r.quantity} 件 · {r.note || "无备注"} · {new Date(r.createdAt).toLocaleString("zh-CN")}
                  </div>
                  {r.rejectReason && <div className="text-xs text-red-500 mt-1">驳回原因: {r.rejectReason}</div>}
                  {r.status === "returned" && r.checkin && (
                    <div className="text-xs text-blue-500 mt-1">归还: {r.checkin.condition === "damaged" ? "⚠️ 有损坏" : "✅ 完好"} · {new Date(r.checkin.createdAt).toLocaleString("zh-CN")}</div>
                  )}
                </div>
                {r.status === "approved" && isStaff && (
                  <button onClick={() => onCheckin(r)} className="ml-2 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 shrink-0">
                    归还
                  </button>
                )}
                {r.status === "approved" && !isStaff && r.grade === "A" && (
                  <span className="ml-2 text-[11px] text-zinc-400 shrink-0 self-center">A级归还需管理员/部长操作</span>
                )}
              </div>
            </div>
          ))}
         </div>
        }
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {pending.length === 0 ? <div className="p-8 text-center text-zinc-400"><Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无待审批申请</div> :
       <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {pending.map(r => (
          <div key={r.id} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.item?.name}</span>
                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${r.grade === "A" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{r.grade}级</span>
                  <span className="text-xs text-zinc-500">→ {statusLabels[r.status]}</span>
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {r.requester?.username} 申请 {r.quantity} 件 · {r.note || "无备注"} · {new Date(r.createdAt).toLocaleString("zh-CN")}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(r.status === "pending_dept" || (r.status === "pending_admin" && isAdmin)) && (
                  <>
                    {r.status === "pending_dept" && (
                      <button onClick={() => onApproveDept(r.id)} className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600"><Check className="h-3 w-3 inline mr-1" />批准</button>
                    )}
                    {r.status === "pending_admin" && isAdmin && (
                      <button onClick={() => onApproveAdmin(r.id)} className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600"><Check className="h-3 w-3 inline mr-1" />终审通过</button>
                    )}
                    <button onClick={() => onReject(r.id)} className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"><X className="h-3 w-3 inline mr-1" />驳回</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
       </div>
      }
    </div>
  );
}
