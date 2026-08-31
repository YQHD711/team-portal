"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { User, GraduationCap, Trophy, Save, Loader2, BadgeCheck, Tag } from "lucide-react";
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

interface Profile { id: number; userId: number; level: string; totalFlightHours: number; firstFlightDate: string | null; bio: string | null; emergencyContact: string | null; emergencyPhone: string | null; flightTypes: string | null; skills: string | null; updatedAt: string; trainingRecords: TrainingRecord[]; competitionRecords: CompetitionRecord[]; }
interface TrainingRecord { id: number; courseName: string; score: number | null; examDate: string; examiner: string | null; notes: string | null; createdAt: string; }
interface CompetitionRecord { id: number; competitionName: string; date: string; event: string | null; ranking: string | null; certificate: string | null; notes: string | null; createdAt: string; }

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"info" | "training" | "competitions" | "certifications">("info");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [level, setLevel] = useState("");
  const [flightHours, setFlightHours] = useState("");
  const [firstFlight, setFirstFlight] = useState("");
  const [bio, setBio] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [flightTypes, setFlightTypes] = useState<string[]>([]);
  const [skills, setSkills] = useState("");
  // 团队认证(考核通过记录,只读)
  const [certItems, setCertItems] = useState<ExamPassView[]>([]);
  const [certsLoading, setCertsLoading] = useState(false);

  useEffect(() => {
    api.get<Profile>("/api/profile").then(data => {
      setProfile(data);
      setLevel(data.level);
      setFlightHours(String(data.totalFlightHours));
      setFirstFlight(data.firstFlightDate ? data.firstFlightDate.slice(0, 10) : "");
      setBio(data.bio || "");
      setEmergencyContact(data.emergencyContact || "");
      setEmergencyPhone(data.emergencyPhone || "");
      setFlightTypes(data.flightTypes ? data.flightTypes.split(",").filter(Boolean) : []);
      setSkills(data.skills || "");
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // 切换认证 tab 时拉取自己的考核通过记录
  useEffect(() => {
    if (tab !== "certifications") return;
    setCertsLoading(true);
    api.get<ExamPassView[]>("/api/profile/exam-passes")
      .then(setCertItems)
      .catch(() => setCertItems([]))
      .finally(() => setCertsLoading(false));
  }, [tab]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/api/profile", {
        level, flightHours: parseFloat(flightHours) || 0,
        firstFlight: firstFlight || null, bio: bio || null,
        emergencyContact: emergencyContact || null, emergencyPhone: emergencyPhone || null,
        flightTypes: flightTypes.join(",") || null,
        skills: skills || null
      });
      setProfile(prev => prev ? {
        ...prev, level, totalFlightHours: parseFloat(flightHours) || 0,
        firstFlightDate: firstFlight || null, bio, emergencyContact, emergencyPhone,
        flightTypes: flightTypes.join(",") || null, skills: skills || null
      } : null);
      setEditMode(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xl font-bold shadow-lg">
          <User className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">我的档案</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[profile?.level || "学员"]}`}>
              {profile?.level || "学员"}
            </span>
            <span className="text-sm text-muted">{profile?.totalFlightHours || 0} 飞行小时</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
        {[
          { key: "info", label: "基本信息", icon: User },
          { key: "training", label: "培训记录", icon: GraduationCap },
          { key: "competitions", label: "参赛记录", icon: Trophy },
          { key: "certifications", label: "我的认证", icon: BadgeCheck },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Tab: Info */}
      {tab === "info" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          {editMode ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">飞手等级</label>
                  <select value={level} onChange={e => setLevel(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
                    {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">累计飞行小时</label>
                  <input type="number" step="0.5" value={flightHours} onChange={e => setFlightHours(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">首次飞行日期</label>
                  <input type="date" value={firstFlight} onChange={e => setFirstFlight(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">紧急联系人</label>
                  <input value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="姓名" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">紧急联系电话</label>
                  <input value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="手机号" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">飞行种类</label>
                <div className="flex flex-wrap gap-2">
                  {FLIGHT_TYPES.map(ft => {
                    const checked = flightTypes.includes(ft);
                    return (
                      <label key={ft} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${checked ? "bg-sky-50 border-sky-300 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300" : "border-border text-muted hover:border-border"}`}>
                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => setFlightTypes(prev => prev.includes(ft) ? prev.filter(f => f !== ft) : [...prev, ft])} />
                        {ft}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">技能标签</label>
                <input value={skills} onChange={e => setSkills(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="逗号分隔,如: STM32,焊接,PCB设计 / PS,视频剪辑" />
                <p className="text-xs text-faint mt-1">展示在组织架构与队员档案卡片上</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">个人简介</label>
                <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="介绍一下自己..." />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditMode(false)} className="px-4 py-2 rounded-lg text-sm border hover:bg-surface-hover">取消</button>
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted">飞手等级</span><p className="font-medium mt-0.5">{profile?.level || "-"}</p></div>
                <div><span className="text-muted">累计飞行小时</span><p className="font-medium mt-0.5">{profile?.totalFlightHours || 0} 小时</p></div>
                <div><span className="text-muted">首次飞行日期</span><p className="font-medium mt-0.5">{profile?.firstFlightDate ? new Date(profile.firstFlightDate).toLocaleDateString("zh-CN") : "-"}</p></div>
                <div><span className="text-muted">最后更新</span><p className="font-medium mt-0.5">{profile?.updatedAt ? new Date(profile.updatedAt).toLocaleString("zh-CN") : "-"}</p></div>
                <div><span className="text-muted">紧急联系人</span><p className="font-medium mt-0.5">{profile?.emergencyContact || "-"}</p></div>
                <div><span className="text-muted">紧急联系电话</span><p className="font-medium mt-0.5">{profile?.emergencyPhone || "-"}</p></div>
              </div>
              {profile?.flightTypes && (
                <div>
                  <span className="text-muted text-sm">飞行种类</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {profile.flightTypes.split(",").filter(Boolean).map(ft => (
                      <span key={ft} className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{ft}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile?.skills && (
                <div>
                  <span className="text-muted text-sm">技能标签</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {profile.skills.split(",").map(s => s.trim()).filter(Boolean).map(s => (
                      <span key={s} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><Tag className="h-3 w-3 opacity-60" />{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile?.bio && <div><span className="text-muted text-sm">个人简介</span><p className="mt-1 text-sm">{profile.bio}</p></div>}
              <div className="flex justify-end">
                <button onClick={() => setEditMode(true)} className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-accent-hover">编辑档案</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Training */}
      {tab === "training" && (
        <div className="rounded-xl border border-border bg-surface divide-y divide-border-subtle">
          {profile?.trainingRecords?.length === 0 ? (
            <div className="p-12 text-center text-faint">
              <GraduationCap className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
              <p>暂无培训记录</p>
              <p className="text-xs mt-1">请联系部长或管理员添加</p>
            </div>
          ) : profile?.trainingRecords?.map(t => (
            <div key={t.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{t.courseName}</div>
                  <div className="text-sm text-muted mt-0.5">
                    {new Date(t.examDate).toLocaleDateString("zh-CN")}
                    {t.examiner && ` · 考官: ${t.examiner}`}
                  </div>
                  {t.notes && <div className="text-sm text-faint mt-1">{t.notes}</div>}
                </div>
                {t.score !== null && t.score !== undefined && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${t.score >= 80 ? "bg-green-100 text-green-700" : t.score >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                    {t.score}分
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Competitions */}
      {tab === "competitions" && (
        <div className="rounded-xl border border-border bg-surface divide-y divide-border-subtle">
          {profile?.competitionRecords?.length === 0 ? (
            <div className="p-12 text-center text-faint">
              <Trophy className="h-10 w-10 mx-auto mb-2 text-zinc-300" />
              <p>暂无参赛记录</p>
              <p className="text-xs mt-1">请联系部长或管理员添加</p>
            </div>
          ) : profile?.competitionRecords?.map(c => (
            <div key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{c.competitionName}</div>
                  <div className="text-sm text-muted mt-0.5">
                    {new Date(c.date).toLocaleDateString("zh-CN")}
                    {c.event && ` · ${c.event}`}
                    {c.ranking && <span className="ml-2 font-medium text-warning">🏆 {c.ranking}</span>}
                  </div>
                  {c.notes && <div className="text-sm text-faint mt-1">{c.notes}</div>}
                </div>
                {c.certificate && (
                  <a href={c.certificate} target="_blank" className="text-xs text-sky-500 hover:underline shrink-0">查看证书</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Certifications */}
      {tab === "certifications" && (
        <CertificationPanel items={certItems} loading={certsLoading} />
      )}
    </div>
  );
}
