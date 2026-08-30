import { Trophy, Plus, Pencil, Trash2 } from "lucide-react";
import type { CompetitionRecord } from "./profileTypes";

interface Props {
  records: CompetitionRecord[];
  showForm: boolean;
  onToggleForm: () => void;
  compName: string; setCompName: (v: string) => void;
  compDate: string; setCompDate: (v: string) => void;
  compEvent: string; setCompEvent: (v: string) => void;
  compRanking: string; setCompRanking: (v: string) => void;
  compCert: string; setCompCert: (v: string) => void;
  compNotes: string; setCompNotes: (v: string) => void;
  editCompId: number | null;
  saving: boolean;
  onSave: () => void;
  onCancelForm: () => void;
  onEdit: (c: CompetitionRecord) => void;
  onDelete: (id: number) => void;
}

/** 参赛记录 Tab（添加表单 + 记录列表 + 编辑/删除） */
export default function ProfileCompetitionsTab({ records, showForm, onToggleForm, compName, setCompName, compDate, setCompDate, compEvent, setCompEvent, compRanking, setCompRanking, compCert, setCompCert, compNotes, setCompNotes, editCompId, saving, onSave, onCancelForm, onEdit, onDelete }: Props) {
  return (
    <div className="space-y-4">
      <button onClick={onToggleForm}
        className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 font-medium">
        <Plus className="h-4 w-4" />添加参赛记录
      </button>
      {showForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium mb-1">比赛名称 *</label><input value={compName} onChange={e => setCompName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium mb-1">日期</label><input type="date" value={compDate} onChange={e => setCompDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium mb-1">参赛项目</label><input value={compEvent} onChange={e => setCompEvent(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium mb-1">名次</label><input value={compRanking} onChange={e => setCompRanking(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium mb-1">证书链接</label><input value={compCert} onChange={e => setCompCert(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium mb-1">备注</label><input value={compNotes} onChange={e => setCompNotes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onCancelForm} className="px-3 py-1.5 rounded-lg text-sm border">取消</button>
            <button onClick={onSave} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm bg-sky-500 text-white hover:bg-sky-600">{editCompId ? "更新" : "添加"}</button>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {records.length === 0 ? (
          <div className="p-12 text-center text-zinc-400"><Trophy className="h-10 w-10 mx-auto mb-2 text-zinc-300" /><p>暂无参赛记录</p></div>
        ) : records.map(c => (
          <div key={c.id} className="p-4 flex items-start justify-between">
            <div>
              <div className="font-medium">{c.competitionName}</div>
              <div className="text-sm text-zinc-500 mt-0.5">{new Date(c.date).toLocaleDateString("zh-CN")}{c.event && ` · ${c.event}`}{c.ranking && <span className="ml-2 font-medium text-amber-600">🏆 {c.ranking}</span>}</div>
              {c.notes && <div className="text-sm text-zinc-400 mt-1">{c.notes}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {c.certificate && <a href={c.certificate} target="_blank" className="text-xs text-sky-500 hover:underline">证书</a>}
              <button onClick={() => onEdit(c)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => onDelete(c.id)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
