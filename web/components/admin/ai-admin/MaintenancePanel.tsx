import { FileText, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  result: string;
  setResult: React.Dispatch<React.SetStateAction<string>>;
  onProposalsChanged: () => void;
}

/** 维护模式面板（一键编译应用已批准提案 / 回滚 / 变更历史） */
export default function MaintenancePanel({ result, setResult, onProposalsChanged }: Props) {
  return (
    <div className="rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-purple-500" />维护模式
        </h3>
        <span className="text-xs text-muted">一键编译 · 自动回滚</span>
      </div>
      {/* Maintenance result message */}
      {result && (
        <div className={`text-sm p-3 rounded-xl whitespace-pre-wrap font-mono ${
          result.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" :
          result.startsWith("❌") ? "bg-red-50 dark:bg-red-950 text-danger" :
          result.startsWith("🔨") ? "bg-blue-50 dark:bg-blue-950 text-primary" :
          "bg-slate-50 dark:bg-slate-800 text-muted"
        }`}>{result}</div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button onClick={async () => {
          if (!confirm("编译并应用所有【已批准】提案？\n成功→代码生效，需手动重启后端\n失败→自动 git 回滚")) return;
          setResult("🔨 正在编译...（可能需要10-30秒）");
          try {
            const res = await api.post<{success:boolean, message:string, error?:string, fullOutput?:string}>("/api/admin/maintenance/apply", {});
            if (res.success) {
              setResult(`✅ ${res.message}`);
            } else if (res.message?.includes("没有待应用")) {
              setResult(`ℹ️ ${res.message}`);
            } else {
              setResult(`❌ ${res.message}\n\n错误：${res.error || '未知'}\n\n详情：${(res.fullOutput || '').substring(0, 500)}`);
            }
            onProposalsChanged();
          } catch (e: any) { setResult("❌ 维护操作失败: " + (e?.message || '网络错误')); }
        }} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">
          <RefreshCw className="h-3 w-3" />应用（需手动重启）
        </button>
        <button onClick={async () => {
          if (!confirm("⚠️ 回滚到上次编译前状态？")) return;
          try {
            const res = await api.post<{success:boolean, message:string}>("/api/admin/maintenance/rollback", {});
            setResult(res.success ? `✅ ${res.message}` : `❌ ${res.message}`);
            onProposalsChanged();
          } catch { setResult("❌ 回滚失败"); }
        }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-danger hover:bg-red-50 dark:hover:bg-red-950">
          <RefreshCw className="h-3 w-3" />回滚
        </button>
        <button onClick={async () => {
          try {
            const res = await api.get<{log:string, status:string}>("/api/admin/maintenance");
            setResult("📋 变更历史:\n" + res.log);
          } catch (e: any) { setResult("❌ 获取历史失败: " + (e?.message || "")); }
        }} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs">
          <FileText className="h-3 w-3" />变更历史
        </button>
      </div>
    </div>
  );
}
