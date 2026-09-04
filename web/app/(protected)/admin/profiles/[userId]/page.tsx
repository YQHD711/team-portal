"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ArrowLeft, User, GraduationCap, Trophy, Loader2, BadgeCheck } from "lucide-react";
import { CertificationPanel, ExamPassView } from "@/components/profile/CertificationPanel";
import ProfileHeader from "@/components/profile/ProfileHeader";
import ProfileInfoTab from "@/components/profile/ProfileInfoTab";
import ProfileTrainingsTab from "@/components/profile/ProfileTrainingsTab";
import ProfileCompetitionsTab from "@/components/profile/ProfileCompetitionsTab";
import { type CompetitionRecord, type FullProfile, type TrainingRecord } from "@/components/profile/profileTypes";

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
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [password, setPassword] = useState("");
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

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
      setUsername(data.username);
      setRole(data.role);
      setDepartmentId(data.departmentId ? String(data.departmentId) : "");
    }).catch(() => router.push("/admin/profiles")).finally(() => setLoading(false));
  };

  useEffect(() => { fetchProfile(); }, [userId]);

  useEffect(() => { api.get<{ id: number; name: string }[]>("/api/admin/departments").then(setDepartments).catch(() => {}); }, []);

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
    await api.put(`/api/admin/users/${userId}`, {
      username: username || null, role: role || null,
      departmentId: departmentId ? Number(departmentId) : null,
      password: password || null
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

  // 打开/收起培训表单（原按钮内联逻辑抽为回调）
  const toggleTrainingForm = () => { setShowTrainingForm(!showTrainingForm); setEditTrainId(null); setTrainCourse(""); setTrainScore(""); setTrainExaminer(""); setTrainNotes(""); };
  const cancelTrainingForm = () => { setShowTrainingForm(false); setEditTrainId(null); };

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

  // 打开/收起参赛表单（原按钮内联逻辑抽为回调）
  const toggleCompForm = () => { setShowCompForm(!showCompForm); setEditCompId(null); setCompName(""); setCompEvent(""); setCompRanking(""); setCompCert(""); setCompNotes(""); };
  const cancelCompForm = () => { setShowCompForm(false); setEditCompId(null); };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;
  if (!profile) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => router.push("/admin/profiles")} className="inline-flex items-center gap-1 text-sm text-muted hover:text-zinc-700">
        <ArrowLeft className="h-4 w-4" />返回队员列表
      </button>

      {/* Header */}
      <ProfileHeader profile={profile} />

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
        {[
          { key: "info", label: "基本信息", icon: User },
          { key: "training", label: `培训 (${profile.trainingRecords.length})`, icon: GraduationCap },
          { key: "competitions", label: `参赛 (${profile.competitionRecords.length})`, icon: Trophy },
          { key: "certifications", label: "技能认证", icon: BadgeCheck },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Tab: Info */}
      {tab === "info" && (
        <ProfileInfoTab profile={profile}
          editInfo={editInfo} onStartEdit={() => setEditInfo(true)} onCancelEdit={() => setEditInfo(false)}
          level={level} setLevel={setLevel} flightHours={flightHours} setFlightHours={setFlightHours}
          firstFlight={firstFlight} setFirstFlight={setFirstFlight}
          emergencyContact={emergencyContact} setEmergencyContact={setEmergencyContact}
          emergencyPhone={emergencyPhone} setEmergencyPhone={setEmergencyPhone}
          flightTypes={flightTypes} setFlightTypes={setFlightTypes}
          skills={skills} setSkills={setSkills} bio={bio} setBio={setBio}
          username={username} setUsername={setUsername} role={role} setRole={setRole}
          departmentId={departmentId} setDepartmentId={setDepartmentId} password={password} setPassword={setPassword}
          departments={departments}
          saving={saving} onSave={saveInfo} />
      )}

      {/* Tab: Training */}
      {tab === "training" && (
        <ProfileTrainingsTab records={profile.trainingRecords}
          showForm={showTrainingForm} onToggleForm={toggleTrainingForm}
          trainCourse={trainCourse} setTrainCourse={setTrainCourse} trainScore={trainScore} setTrainScore={setTrainScore}
          trainDate={trainDate} setTrainDate={setTrainDate} trainExaminer={trainExaminer} setTrainExaminer={setTrainExaminer}
          trainNotes={trainNotes} setTrainNotes={setTrainNotes} editTrainId={editTrainId}
          saving={saving} onSave={saveTraining} onCancelForm={cancelTrainingForm}
          onEdit={editTraining} onDelete={deleteTraining} />
      )}

      {/* Tab: Competitions */}
      {tab === "competitions" && (
        <ProfileCompetitionsTab records={profile.competitionRecords}
          showForm={showCompForm} onToggleForm={toggleCompForm}
          compName={compName} setCompName={setCompName} compDate={compDate} setCompDate={setCompDate}
          compEvent={compEvent} setCompEvent={setCompEvent} compRanking={compRanking} setCompRanking={setCompRanking}
          compCert={compCert} setCompCert={setCompCert} compNotes={compNotes} setCompNotes={setCompNotes}
          editCompId={editCompId} saving={saving} onSave={saveCompetition} onCancelForm={cancelCompForm}
          onEdit={editCompetition} onDelete={deleteCompetition} />
      )}

      {/* Tab: Certifications */}
      {tab === "certifications" && (
        <CertificationPanel items={certItems} loading={certsLoading} />
      )}
    </div>
  );
}
