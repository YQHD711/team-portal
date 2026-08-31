import { GraduationCap, Plus, Pencil, Trash2 } from "lucide-react";
import type { TrainingRecord } from "./profileTypes";

interface Props {
  records: TrainingRecord[];
  showForm: boolean;
  onToggleForm: () => void;
  trainCourse: string; setTrainCourse: (v: string) => void;
  trainScore: string; setTrainScore: (v: string) => void;
  trainDate: string; setTrainDate: (v: string) => void;
  trainExaminer: string; setTrainExaminer: (v: string) => void;
  trainNotes: string; setTrainNotes: (v: string) => void;
  editTrainId: number | null;
  saving: boolean;
  onSave: () => void;
  onCancelForm: () => void;
  onEdit: (t: TrainingRecord) => void;
  onDelete: (id: number) => void;
}

/** 培训记录 Tab（添加表单 + 记录列表 + 编辑/删除） */
export default function ProfileTrainingsTab({ records, showForm, onToggleForm, trainCourse, setTrainCourse, trainScore, setTrainScore, trainDate, setTrainDate, trainExaminer, setTrainExaminer, trainNotes, setTrainNotes, editTrainId, saving, onSave, onCancelForm, onEdit, onDelete }: Props) {
  return (
    <div className="space-y-4">
      <button onClick={onToggleForm}
        className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 font-medium">
        <Plus className="h-4 w-4" />添加培训记录
      </button>
      {showForm && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium mb-1">课程名称 *</label><input value={trainCourse} onChange={e => setTrainCourse(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium mb-1">成绩</label><input type="number" step="0.5" value={trainScore} onChange={e => setTrainScore(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium mb-1">考核日期</label><input type="date" value={trainDate} onChange={e => setTrainDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium mb-1">考官</label><input value={trainExaminer} onChange={e => setTrainExaminer(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
          </div>
          <div><label className="block text-xs font-medium mb-1">备注</label><input value={trainNotes} onChange={e => setTrainNotes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
          <div className="flex gap-2 justify-end">
            <button onClick={onCancelForm} className="px-3 py-1.5 rounded-lg text-sm border">取消</button>
            <button onClick={onSave} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm bg-primary text-white hover:bg-accent-hover">{editTrainId ? "更新" : "添加"}</button>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-border bg-surface divide-y divide-border-subtle">
        {records.length === 0 ? (
          <div className="p-12 text-center text-faint"><GraduationCap className="h-10 w-10 mx-auto mb-2 text-zinc-300" /><p>暂无培训记录</p></div>
        ) : records.map(t => (
          <div key={t.id} className="p-4 flex items-start justify-between">
            <div>
              <div className="font-medium">{t.courseName}</div>
              <div className="text-sm text-muted mt-0.5">{new Date(t.examDate).toLocaleDateString("zh-CN")}{t.examiner && ` · ${t.examiner}`}</div>
              {t.notes && <div className="text-sm text-faint mt-1">{t.notes}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {t.score !== null && t.score !== undefined && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${t.score >= 80 ? "bg-green-100 text-green-700" : t.score >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>{t.score}</span>
              )}
              <button onClick={() => onEdit(t)} className="p-1 rounded hover:bg-surface-hover text-faint"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => onDelete(t.id)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
