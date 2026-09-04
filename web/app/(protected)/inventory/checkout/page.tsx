"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { Package } from "lucide-react";
import Link from "next/link";
import CheckoutForm from "@/components/inventory/CheckoutForm";
import CheckoutList from "@/components/inventory/CheckoutList";
import ReturnModal from "@/components/inventory/ReturnModal";
import type { CheckoutReq, Item } from "@/components/inventory/checkoutTypes";

export default function CheckoutPage() {
  const [tab, setTab] = useState<"my" | "pending">("my");
  const [my, setMy] = useState<CheckoutReq[]>([]);
  const [pending, setPending] = useState<CheckoutReq[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, loading: userLoading } = useCurrentUser();
  const role = user?.role ?? "";
  const isStaff = role === "admin" || role === "部长";
  const isAdmin = role === "admin";
  const [showNew, setShowNew] = useState(false);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [newForm, setNewForm] = useState({ itemId: 0, quantity: 1, note: "" });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [myList, items] = await Promise.all([
        api.get<CheckoutReq[]>("/api/material/checkout/my"),
        api.get<Item[]>("/api/inventory"),
      ]);
      setMy(myList);
      setAllItems(items.filter(i => i.quantity > 0));
      if (isStaff) {
        const p = await api.get<CheckoutReq[]>("/api/material/checkout/pending");
        setPending(p);
      }
    } catch { }
    setLoading(false);
  };

  // 等用户信息就绪后再拉数据，保证 isStaff 判断正确（首次进入只拉一次）
  useEffect(() => { if (!userLoading) fetchData(); }, [userLoading, isStaff]);

  const submitNew = async () => {
    if (!newForm.itemId) { alert("请选择物料"); return; }
    try {
      const res = await fetch("/api/material/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ itemId: newForm.itemId, quantity: newForm.quantity, note: newForm.note || null }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.detail || "提交失败"); return; }
      if (data.status === "approved") alert("C级物料，领用成功！");
      else alert(`${data.grade}级物料，已提交审批。`);
      setShowNew(false); setNewForm({ itemId: 0, quantity: 1, note: "" });
      fetchData();
    } catch { alert("提交失败"); }
  };

  const approveDept = async (id: number) => {
    try { await api.post(`/api/material/checkout/${id}/approve-dept`, {}); fetchData(); }
    catch { alert("审批失败"); }
  };
  const approveAdmin = async (id: number) => {
    try { await api.post(`/api/material/checkout/${id}/approve-admin`, {}); fetchData(); }
    catch { alert("审批失败"); }
  };
  const reject = async (id: number) => {
    const reason = prompt("驳回原因（可选）：");
    try { await api.post(`/api/material/checkout/${id}/reject`, { reason: reason || "未说明原因" }); fetchData(); }
    catch { alert("驳回失败"); }
  };
  // ── 归还弹窗(A级物料:管理员/部长操作,需上传照片+功能测试说明) ──
  const [checkinTarget, setCheckinTarget] = useState<CheckoutReq | null>(null);
  const [ckCondition, setCkCondition] = useState<"normal" | "damaged">("normal");
  const [ckNotes, setCkNotes] = useState("");
  const [ckPhotoUrl, setCkPhotoUrl] = useState<string | null>(null);
  const [ckPhotoName, setCkPhotoName] = useState("");
  const [ckUploading, setCkUploading] = useState(false);
  const [ckSubmitting, setCkSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openCheckin = (r: CheckoutReq) => {
    setCheckinTarget(r);
    setCkCondition("normal");
    setCkNotes("");
    setCkPhotoUrl(null);
    setCkPhotoName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const uploadCheckinPhoto = async (file: File) => {
    setCkUploading(true);
    try {
      const token = localStorage.getItem("token");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/files/upload?visibility=department`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const data = await res.json();
      if (!res.ok) { alert(data.detail || "照片上传失败"); return; }
      setCkPhotoUrl(`/api/files/${data.id}/download`);
      setCkPhotoName(data.originalName || file.name);
    } catch { alert("照片上传失败"); }
    finally { setCkUploading(false); }
  };

  const submitCheckin = async () => {
    if (!checkinTarget) return;
    if (checkinTarget.grade === "A" && !ckPhotoUrl) { alert("A级物料归还必须上传照片"); return; }
    if (checkinTarget.grade === "A" && !ckNotes.trim()) { alert("A级物料归还需填写功能测试说明"); return; }
    setCkSubmitting(true);
    try {
      await api.post(`/api/material/checkout/${checkinTarget.id}/checkin`, {
        condition: ckCondition, hasPhoto: !!ckPhotoUrl,
        testNotes: ckNotes.trim() || null, photoUrl: ckPhotoUrl,
      });
      setCheckinTarget(null);
      fetchData();
    } catch (e: any) { alert(e.message || "归还失败"); }
    finally { setCkSubmitting(false); }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">领用管理</h1>
          <p className="text-sm text-muted">物料领用申请与审批</p>
        </div>
        <Link href="/inventory" className="text-sm text-sky-500 hover:text-sky-600 flex items-center gap-1">
          <Package className="h-4 w-4" /> 返回库存
        </Link>
      </div>

      {/* 新建领用 */}
      <CheckoutForm showNew={showNew} onOpen={() => setShowNew(true)} onClose={() => setShowNew(false)}
        allItems={allItems} itemSearch={itemSearch} onItemSearch={setItemSearch}
        newForm={newForm} setNewForm={setNewForm} onSubmit={submitNew} />

      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
        <button onClick={() => setTab("my")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${tab === "my" ? "bg-surface shadow-sm" : "text-muted"}`}>
          我的领用 ({my.length})
        </button>
        {isStaff && (
          <button onClick={() => setTab("pending")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${tab === "pending" ? "bg-surface shadow-sm" : "text-muted"}`}>
            待审批 ({pending.length})
          </button>
        )}
      </div>

      {tab === "my" && (
        <CheckoutList tab="my" loading={loading} my={my} pending={pending} isStaff={isStaff} isAdmin={isAdmin}
          onCheckin={openCheckin} onApproveDept={approveDept} onApproveAdmin={approveAdmin} onReject={reject} />
      )}

      {tab === "pending" && isStaff && (
        <CheckoutList tab="pending" loading={loading} my={my} pending={pending} isStaff={isStaff} isAdmin={isAdmin}
          onCheckin={openCheckin} onApproveDept={approveDept} onApproveAdmin={approveAdmin} onReject={reject} />
      )}

      {/* ── 归还弹窗(A级:管理员/部长操作,上传照片+功能测试说明) ── */}
      {checkinTarget && (
        <ReturnModal target={checkinTarget} condition={ckCondition} onCondition={setCkCondition}
          notes={ckNotes} onNotes={setCkNotes} photoUrl={ckPhotoUrl} photoName={ckPhotoName}
          uploading={ckUploading} submitting={ckSubmitting} fileRef={fileRef}
          onUpload={uploadCheckinPhoto} onClose={() => setCheckinTarget(null)} onSubmit={submitCheckin} />
      )}
    </div>
  );
}
