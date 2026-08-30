import { Check, Loader2, Upload, X } from "lucide-react";
import type { CheckoutReq } from "./checkoutTypes";

interface Props {
  target: CheckoutReq;
  condition: "normal" | "damaged";
  onCondition: (v: "normal" | "damaged") => void;
  notes: string;
  onNotes: (v: string) => void;
  photoUrl: string | null;
  photoName: string;
  uploading: boolean;
  submitting: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (file: File) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** 归还弹窗（A级物料需上传照片 + 功能测试说明） */
export default function ReturnModal({ target, condition, onCondition, notes, onNotes, photoUrl, photoName, uploading, submitting, fileRef, onUpload, onClose, onSubmit }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-lg rounded-2xl bg-surface shadow-xl border border-border p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">归还物料</h2>
          <button onClick={() => !submitting && onClose()} className="p-1 rounded hover:bg-surface-hover"><X className="h-5 w-5" /></button>
        </div>

        <div className="text-sm text-muted mb-4">
          {target.item?.name || `物料 #${target.inventoryItemId}`}
          <span className={`ml-2 inline-flex rounded-full px-1.5 py-0.5 text-xs font-bold ${target.grade === "A" ? "bg-red-100 text-red-700" : target.grade === "B" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-muted"}`}>{target.grade}级</span>
          <span className="text-faint ml-2">× {target.quantity} 件</span>
        </div>

        {/* 照片上传 */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">
            归还照片 {target.grade === "A" && <span className="text-danger">* (A级必传)</span>}
          </label>
          <input ref={fileRef} type="file" accept="image/*" onChange={e => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
          }} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading || submitting}
            className="w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted hover:border-sky-400 hover:text-sky-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {photoName || (uploading ? "上传中..." : "点击上传照片")}
          </button>
          {photoUrl && <div className="mt-2 text-xs text-success flex items-center gap-1"><Check className="h-3 w-3" />已上传: {photoName}</div>}
        </div>

        {/* 功能测试说明 */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">
            功能测试说明 {target.grade === "A" && <span className="text-danger">* (A级必填)</span>}
          </label>
          <textarea value={notes} onChange={e => onNotes(e.target.value)} rows={3}
            placeholder="归还前功能测试结果,如: 通电正常、功能完好 / 某模块异常..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>

        {/* 归还状态 */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-1">归还状态</label>
          <div className="flex gap-2">
            <button onClick={() => onCondition("normal")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${condition === "normal" ? "bg-green-50 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300" : "border-border text-muted hover:border-border"}`}>✅ 完好</button>
            <button onClick={() => onCondition("damaged")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${condition === "damaged" ? "bg-red-50 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300" : "border-border text-muted hover:border-border"}`}>⚠️ 有损坏</button>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm border hover:bg-surface-hover disabled:opacity-50">取消</button>
          <button onClick={onSubmit} disabled={submitting || uploading}
            className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-primary disabled:opacity-50 inline-flex items-center gap-1">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}确认归还
          </button>
        </div>
      </div>
    </div>
  );
}
