import { Save, Loader2, Tag } from "lucide-react";
import { FLIGHT_TYPES, LEVELS, type FullProfile } from "./profileTypes";

interface Props {
  profile: FullProfile;
  editInfo: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  level: string; setLevel: (v: string) => void;
  flightHours: string; setFlightHours: (v: string) => void;
  firstFlight: string; setFirstFlight: (v: string) => void;
  emergencyContact: string; setEmergencyContact: (v: string) => void;
  emergencyPhone: string; setEmergencyPhone: (v: string) => void;
  flightTypes: string[]; setFlightTypes: React.Dispatch<React.SetStateAction<string[]>>;
  skills: string; setSkills: (v: string) => void;
  bio: string; setBio: (v: string) => void;
  username: string; setUsername: (v: string) => void;
  role: string; setRole: (v: string) => void;
  departmentId: string; setDepartmentId: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  departments: { id: number; name: string }[];
  saving: boolean;
  onSave: () => void;
  /** 只读模式(无权编辑该成员时):隐藏编辑入口 */
  readOnly?: boolean;
}

/** 基本信息 Tab（查看模式 + 编辑模式） */
export default function ProfileInfoTab({ profile, editInfo, onStartEdit, onCancelEdit, level, setLevel, flightHours, setFlightHours, firstFlight, setFirstFlight, emergencyContact, setEmergencyContact, emergencyPhone, setEmergencyPhone, flightTypes, setFlightTypes, skills, setSkills, bio, setBio, username, setUsername, role, setRole, departmentId, setDepartmentId, password, setPassword, departments, saving, onSave, readOnly = false }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      {editInfo ? (
        <>
          {/* 账号信息（管理员编辑） */}
          <div className="space-y-3 border-b border-border pb-4 mb-1">
            <h3 className="text-sm font-semibold text-muted">账号信息</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">用户名</label><input value={username} onChange={e => setUsername(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
              <div><label className="block text-sm font-medium mb-1">角色</label><select value={role} onChange={e => setRole(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value="member">成员</option><option value="部长">部长</option><option value="admin">管理员</option></select></div>
              <div><label className="block text-sm font-medium mb-1">部门</label><select value={departmentId} onChange={e => setDepartmentId(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value="">未分配</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <div><label className="block text-sm font-medium mb-1">重置密码</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空不修改" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" /></div>
            </div>
          </div>
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
                  <label key={ft} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${checked ? "bg-sky-50 border-sky-300 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300" : "border-border text-muted hover:border-border"}`}>
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
            <button onClick={onCancelEdit} className="px-4 py-2 rounded-lg text-sm border">取消</button>
            <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存</button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted">角色</span><p className="font-medium mt-0.5">{profile.role}</p></div>
            <div><span className="text-muted">部门</span><p className="font-medium mt-0.5">{profile.department || "-"}</p></div>
            <div><span className="text-muted">飞手等级</span><p className="font-medium mt-0.5">{profile.level}</p></div>
            <div><span className="text-muted">飞行小时</span><p className="font-medium mt-0.5">{profile.totalFlightHours}h</p></div>
            <div><span className="text-muted">首飞日期</span><p className="font-medium mt-0.5">{profile.firstFlightDate ? new Date(profile.firstFlightDate).toLocaleDateString("zh-CN") : "-"}</p></div>
            <div><span className="text-muted">紧急联系人</span><p className="font-medium mt-0.5">{profile.emergencyContact || "-"}</p></div>
            <div><span className="text-muted">紧急电话</span><p className="font-medium mt-0.5">{profile.emergencyPhone || "-"}</p></div>
          </div>
          {profile.flightTypes && (
            <div>
              <span className="text-muted text-sm">飞行种类</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {profile.flightTypes.split(",").filter(Boolean).map(ft => (
                  <span key={ft} className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{ft}</span>
                ))}
              </div>
            </div>
          )}
          {profile.skills && (
            <div>
              <span className="text-muted text-sm">技能标签</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {profile.skills.split(",").map(s => s.trim()).filter(Boolean).map(s => (
                  <span key={s} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><Tag className="h-3 w-3 opacity-60" />{s}</span>
                ))}
              </div>
            </div>
          )}
          {profile.bio && <div><span className="text-muted text-sm">简介</span><p className="mt-1 text-sm">{profile.bio}</p></div>}
          <div className="flex justify-end">{readOnly
            ? <span className="text-xs text-faint">仅管理员和本部门部长可编辑</span>
            : <button onClick={onStartEdit} className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-accent-hover">编辑档案</button>}
          </div>
        </>
      )}
    </div>
  );
}
