"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ArrowLeft, User, GraduationCap, Trophy, Save, Loader2, Plus, Trash2, Pencil, BadgeCheck, Tag } from "lucide-react";
import { CertificationPanel, ExamPassView } from "@/components/profile/CertificationPanel";

const LEVELS = ["学员", "初级", "中级", "高级", "教练"];
const FLIGHT_TYPES = ["固定翼", "多旋翼", "穿越机", "凤凰飞行器", "龙飞行器", "直升机", "其他"];
const LEVEL_COLORS: Record<string, string> = {
  "学员": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "初级": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "中级": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "高级": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "教练": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

interface FullProfile {
  id: number; userId: number; username: string; role: string; department: string | null;
  level: string; totalFlightHours: number; firstFlightDate: string | null;
  bio: string | null; emergencyContact: string | null; emergencyPhone: string | null; flightTypes: string | null; skills: string | null; updatedAt: string;
  trainingRecords: TrainingRecord[]; competitionRecords: CompetitionRecord[];
}
interface TrainingRecord { id: number; courseName: string; score: number | null; examDate: string; examiner: string | null; notes: string | null; createdAt: string; }
interface CompetitionRecord { id: number; competitionName: string; date: string; event: string | null; ranking: string | null; certificate: string | null; notes: string | null; createdAt: string; }

export default function AdminProfileDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = Number(params.userId);

  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"info" | "training" | "competitions" | "certifications">("info");
  const [editInfo, setEditInfo] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form
  const [level, setLevel] = useState("");
  const [flightHours, setFlightHours] = useState("");
  const [firstFlight, setFirstFlight] = useState("");
  const [bio, setBio] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [flightTypes, setFlightTypes] = useState<string[]>([]);
  const [skills, setSkills] = useState("");

  // Training form
  const [showTrainingForm, setShowTrainingForm] = useState(false);
  const [trainCourse, setTrainCourse] = useState("");
  const [trainScore, setTrainScore] = useState("");
  const [trainDate, setTrainDate] = useState(new Date().toISOString().slice(0, 10));
  const [trainExaminer, setTrainExaminer] = useState("");
  const [trainNotes, setTrainNotes] = useState("");
  const [editTrainId, setEditTrainId] = useState<number | null>(null);

  // Competition form
  const [showCompForm, setShowCompForm] = useState(false);
  const [compName, setCompName] = useState("");
  const [compDate, setCompDate] = useState(new Date().toISOString().slice(0, 10));
  const [compEvent, setCompEvent] = useState("");
  const [compRanking, setCompRanking] = useState("");
  const [compCert, setCompCert] = useState("");
  const [compNotes, setCompNotes] = useState("");
  const [editCompId, setEditCompId] = useState<number | null>(null);

  // 团队认证(考核通过记录,只读)
  const [certItems, setCertItems] = useState<ExamPassView[]>([]);
  const [certsLoading, setCertsLoading] = useState(false);

  const fetchProfile = () => {
    api.get<FullProfile>(`/api/admin/profiles/${userId}`).then(data => {
      setProfile(data);
      setLevel(data.level);
      setFlightHours(String(data.totalFlightHours));
      setFirstFlight(data.firstFlightDate ? data.firstFlightDate.slice(0, 10) : "");
      setBio(data.bio || "");
      setEmergencyContact(data.emergencyContact || "");
      setEmergencyPhone(data.emergencyPhone || "");
      setFlightTypes(data.flightTypes ? data.flightTypes.split(",").filter(Boolean) : []);
      setSkills(data.skills || "");
    }).catch(() => router.push("/admin/profiles")).finally(() => setLoading(false));
  };

  useEffect(() => { fetchProfile(); }, [userId]);

  // 切换认证 tab 时拉取该队员的考核通过记录(管理端全部,前端按 userId 过滤)
  useEffect(() => {
    if (tab !== "certifications") return;
    setCertsLoading(true);
    api.get<ExamPassView[]>("/api/admin/exams/passes")
      .then(all => setCertItems(all.filter(p => p.userId === userId)))
      .catch(() => setCertItems([]))
      .finally(() => setCertsLoading(false));
  }, [tab, userId]);

  // Save profile info
  const saveInfo = async () => {
    setSaving(true);
    await api.put(`/api/admin/profiles/${userId}`, {
      level, flightHours: parseFloat(flightHours) || 0,
      firstFlight: firstFlight || null, bio: bio || null,
      emergencyContact: emergencyContact || null, emergencyPhone: emergencyPhone || null,
      flightTypes: flightTypes.join(",") || null,
      skills: skills || null
    });
    setEditInfo(false); setSaving(false);
    fetchProfile();
  };

  // Save training
  const saveTraining = async () => {
    if (!trainCourse) return;
    setSaving(true);
    const body = { courseName: trainCourse, score: parseFloat(trainScore) || null, examDate: trainDate, examiner: trainExaminer || null, notes: trainNotes || null };
    if (editTrainId) {
      await api.put(`/api/admin/profiles/${userId}/training/${editTrainId}`, body);
    } else {
      await api.post(`/api/admin/profiles/${userId}/training`, body);
    }
    setShowTrainingForm(false); setEditTrainId(null);
    setTrainCourse(""); setTrainScore(""); setTrainExaminer(""); setTrainNotes("");
    setSaving(false); fetchProfile();
  };

  const deleteTraining = async (id: number) => {
    if (!confirm("确定删除？")) return;
    await api.delete(`/api/admin/profiles/${userId}/training/${id}`);
    fetchProfile();
  };

  const editTraining = (t: TrainingRecord) => {
    setEditTrainId(t.id); setTrainCourse(t.courseName);
    setTrainScore(t.score !== null ? String(t.score) : "");
    setTrainDate(t.examDate.slice(0, 10)); setTrainExaminer(t.examiner || "");
    setTrainNotes(t.notes || ""); setShowTrainingForm(true);
  };

  // Save competition
  const saveCompetition = async () => {
    if (!compName) return;
    setSaving(true);
    const body = { competitionName: compName, date: compDate, event: compEvent || null, ranking: compRanking || null, certificate: compCert || null, notes: compNotes || null };
    if (editCompId) {
      await api.put(`/api/admin/profiles/${userId}/competitions/${editCompId}`, body);
    } else {
      await api.post(`/api/admin/profiles/${userId}/competitions`, body);
    }
    setShowCompForm(false); setEditCompId(null);
    setCompName(""); setCompEvent(""); setCompRanking(""); setCompCert(""); setCompNotes("");
    setSaving(false); fetchProfile();
  };

  const deleteCompetition = async (id: number) => {
    if (!confirm("确定删除？")) return;
    await api.delete(`/api/admin/profiles/${userId}/competitions/${id}`);
    fetchProfile();
  };

  const editCompetition = (c: CompetitionRecord) => {
    setEditCompId(c.id); setCompName(c.competitionName);
    setCompDate(c.date.slice(0, 10)); setCompEvent(c.event || "");
    setCompRanking(c.ranking || ""); setCompCert(c.certificate || "");
    setCompNotes(c.notes || ""); setShowCompForm(true);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>;
  if (!profile) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => router.push("/admin/profiles")} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700">
        <ArrowLeft className="h-4 w-4" />返回队员列表
      </button>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white text-xl font-bold shadow-lg">
          {profile.username[0]?.toUpperCase() || "?"}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{profile.username}</h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500">
            <span>{profile.department || "未分配部门"}</span>
            <span>·</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[profile.level]}`}>{profile.level}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1">
        {[
          { key: "info", label: "基本信息", icon: User },
          { key: "training", label: `培训 (${profile.trainingRecords.length})`, icon: GraduationCap },
          { key: "competitions", label: `参赛 (${profile.competitionRecords.length})`, icon: Trophy },
          { key: "certifications", label: "技能认证", icon: BadgeCheck },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Tab: Info */}
      {tab === "info" && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          {editInfo ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">飞手等级</label><select value={level} onChange={e => setLevel(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">{LEVELS.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
                <div><label className="block text-sm font-medium mb-1">飞行小时</label><input type="number" step="0.5" value={flightHours} onChange={e => setFlightHours(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">首飞日期</label><input type="date" value={firstFlight} onChange={e => setFirstFlight(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">紧急联系人</label><input value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">紧急电话</label><input value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">飞行种类</label>
                <div className="flex flex-wrap gap-2">
                  {FLIGHT_TYPES.map(ft => {
                    const checked = flightTypes.includes(ft);
                    return (
                      <label key={ft} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${checked ? "bg-sky-50 border-sky-300 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700"}`}>
                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => setFlightTypes(prev => prev.includes(ft) ? prev.filter(f => f !== ft) : [...prev, ft])} />
                        {ft}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div><label className="block text-sm font-medium mb-1">技能标签</label><input value={skills} onChange={e => setSkills(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="逗号分隔,如: STM32,焊接,PCB设计" /></div>
              <div><label className="block text-sm font-medium mb-1">简介</label><textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditInfo(false)} className="px-4 py-2 rounded-lg text-sm border">取消</button>
                <button onClick={saveInfo} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存</button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-zinc-500">角色</span><p className="font-medium mt-0.5">{profile.role}</p></div>
                <div><span className="text-zinc-500">部门</span><p className="font-medium mt-0.5">{profile.department || "-"}</p></div>
                <div><span className="text-zinc-500">飞手等级</span><p className="font-medium mt-0.5">{profile.level}</p></div>
                <div><span className="text-zinc-500">飞行小时</span><p className="font-medium mt-0.5">{profile.totalFlightHours}h</p></div>
                <div><span className="text-zinc-500">首飞日期</span><p className="font-medium mt-0.5">{profile.firstFlightDate ? new Date(profile.firstFlightDate).toLocaleDateString("zh-CN") : "-"}</p></div>
                <div><span className="text-zinc-500">紧急联系人</span><p className="font-medium mt-0.5">{profile.emergencyContact || "-"}</p></div>
                <div><span className="text-zinc-500">紧急电话</span><p className="font-medium mt-0.5">{profile.emergencyPhone || "-"}</p></div>
              </div>
              {profile.flightTypes && (
                <div>
                  <span className="text-zinc-500 text-sm">飞行种类</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {profile.flightTypes.split(",").filter(Boolean).map(ft => (
                      <span key={ft} className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{ft}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile.skills && (
                <div>
                  <span className="text-zinc-500 text-sm">技能标签</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {profile.skills.split(",").map(s => s.trim()).filter(Boolean).map(s => (
                      <span key={s} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><Tag className="h-3 w-3 opacity-60" />{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile.bio && <div><span className="text-zinc-500 text-sm">简介</span><p className="mt-1 text-sm">{profile.bio}</p></div>}
              <div className="flex justify-end"><button onClick={() => setEditInfo(true)} className="px-4 py-2 rounded-lg text-sm bg-sky-500 text-white hover:bg-sky-600">编辑档案</button></div>
            </>
          )}
        </div>
      )}

      {/* Tab: Training */}
      {tab === "training" && (
        <div className="space-y-4">
          <button onClick={() => { setShowTrainingForm(!showTrainingForm); setEditTrainId(null); setTrainCourse(""); setTrainScore(""); setTrainExaminer(""); setTrainNotes(""); }}
            className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 font-medium">
            <Plus className="h-4 w-4" />添加培训记录
          </button>
          {showTrainingForm && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium mb-1">课程名称 *</label><input value={trainCourse} onChange={e => setTrainCourse(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">成绩</label><input type="number" step="0.5" value={trainScore} onChange={e => setTrainScore(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">考核日期</label><input type="date" value={trainDate} onChange={e => setTrainDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">考官</label><input value={trainExaminer} onChange={e => setTrainExaminer(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="block text-xs font-medium mb-1">备注</label><input value={trainNotes} onChange={e => setTrainNotes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowTrainingForm(false); setEditTrainId(null); }} className="px-3 py-1.5 rounded-lg text-sm border">取消</button>
                <button onClick={saveTraining} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm bg-sky-500 text-white hover:bg-sky-600">{editTrainId ? "更新" : "添加"}</button>
              </div>
            </div>
          )}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
            {profile.trainingRecords.length === 0 ? (
              <div className="p-12 text-center text-zinc-400"><GraduationCap className="h-10 w-10 mx-auto mb-2 text-zinc-300" /><p>暂无培训记录</p></div>
            ) : profile.trainingRecords.map(t => (
              <div key={t.id} className="p-4 flex items-start justify-between">
                <div>
                  <div className="font-medium">{t.courseName}</div>
                  <div className="text-sm text-zinc-500 mt-0.5">{new Date(t.examDate).toLocaleDateString("zh-CN")}{t.examiner && ` · ${t.examiner}`}</div>
                  {t.notes && <div className="text-sm text-zinc-400 mt-1">{t.notes}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.score !== null && t.score !== undefined && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${t.score >= 80 ? "bg-green-100 text-green-700" : t.score >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>{t.score}</span>
                  )}
                  <button onClick={() => editTraining(t)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => deleteTraining(t.id)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Competitions */}
      {tab === "competitions" && (
        <div className="space-y-4">
          <button onClick={() => { setShowCompForm(!showCompForm); setEditCompId(null); setCompName(""); setCompEvent(""); setCompRanking(""); setCompCert(""); setCompNotes(""); }}
            className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 font-medium">
            <Plus className="h-4 w-4" />添加参赛记录
          </button>
          {showCompForm && (
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
                <button onClick={() => { setShowCompForm(false); setEditCompId(null); }} className="px-3 py-1.5 rounded-lg text-sm border">取消</button>
                <button onClick={saveCompetition} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm bg-sky-500 text-white hover:bg-sky-600">{editCompId ? "更新" : "添加"}</button>
              </div>
            </div>
          )}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
            {profile.competitionRecords.length === 0 ? (
              <div className="p-12 text-center text-zinc-400"><Trophy className="h-10 w-10 mx-auto mb-2 text-zinc-300" /><p>暂无参赛记录</p></div>
            ) : profile.competitionRecords.map(c => (
              <div key={c.id} className="p-4 flex items-start justify-between">
                <div>
                  <div className="font-medium">{c.competitionName}</div>
                  <div className="text-sm text-zinc-500 mt-0.5">{new Date(c.date).toLocaleDateString("zh-CN")}{c.event && ` · ${c.event}`}{c.ranking && <span className="ml-2 font-medium text-amber-600">🏆 {c.ranking}</span>}</div>
                  {c.notes && <div className="text-sm text-zinc-400 mt-1">{c.notes}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.certificate && <a href={c.certificate} target="_blank" className="text-xs text-sky-500 hover:underline">证书</a>}
                  <button onClick={() => editCompetition(c)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => deleteCompetition(c.id)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Certifications */}
      {tab === "certifications" && (
        <CertificationPanel items={certItems} loading={certsLoading} />
      )}
    </div>
  );
}
