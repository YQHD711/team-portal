"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { AlertTriangle, Battery, Loader2, Plus, Trash2, Pencil } from "lucide-react";

interface BatteryRec { id: number; batteryNumber: string; health: string; incidentDate: string; notes: string | null; }
interface IncidentRec { id: number; type: string; severity: string; description: string; date: string; resolution: string | null; reportedBy: string | null; }

const SEVERITY_COLORS: Record<string, string> = { "严重": "bg-danger/15 text-danger", "一般": "bg-warning/15 text-warning", "轻微": "bg-info/15 text-info" };
const INCIDENT_TYPES = ["设备故障", "操作失误", "天气原因", "信号干扰", "其他"];
const SEVERITIES = ["轻微", "一般", "严重"];
const BATTERY_HEALTH = ["正常", "鼓包", "漏液", "过放", "报废"];

export default function IncidentsPage() {
  const [tab, setTab] = useState<string>("battery");
  const [batteries, setBatteries] = useState<BatteryRec[]>([]);
  const [incidents, setIncidents] = useState<IncidentRec[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "部长";

  // Battery form
  const [showBatForm, setShowBatForm] = useState(false); const [editBatId, setEditBatId] = useState<number | null>(null);
  const [bNum, setBNum] = useState(""); const [bHealth, setBHealth] = useState("正常"); const [bDate, setBDate] = useState(new Date().toISOString().slice(0, 10)); const [bNotes, setBNotes] = useState("");

  // Incident form
  const [showIncForm, setShowIncForm] = useState(false); const [editIncId, setEditIncId] = useState<number | null>(null);
  const [iType, setIType] = useState("设备故障"); const [iSev, setISev] = useState("一般"); const [iDesc, setIDesc] = useState(""); const [iDate, setIDate] = useState(new Date().toISOString().slice(0, 10)); const [iRes, setIRes] = useState(""); const [iReporter, setIReporter] = useState("");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      api.get<BatteryRec[]>("/api/batteries").then(setBatteries).catch(()=>{}),
      api.get<IncidentRec[]>("/api/incidents").then(setIncidents).catch(()=>{}),
    ]).finally(() => setLoading(false));
  };

  // ── Battery ──
  const saveBattery = async () => {
    const body = { batteryNumber: bNum, health: bHealth, incidentDate: bDate, notes: bNotes || null };
    if (editBatId) await api.put(`/api/batteries/${editBatId}`, body); else await api.post("/api/batteries", body);
    setShowBatForm(false); setEditBatId(null); fetchAll();
  };
  const editBattery = (b: BatteryRec) => { setEditBatId(b.id); setBNum(b.batteryNumber); setBHealth(b.health); setBDate(b.incidentDate?.slice(0,10) || ""); setBNotes(b.notes||""); setShowBatForm(true); };
  const resetBatForm = () => { setShowBatForm(false); setEditBatId(null); setBNum(""); setBHealth("正常"); setBDate(new Date().toISOString().slice(0,10)); setBNotes(""); };

  // ── Incident ──
  const saveIncident = async () => {
    const body = { type: iType, severity: iSev, description: iDesc, date: iDate, resolution: iRes||null, reportedBy: iReporter||null };
    if (editIncId) await api.put(`/api/incidents/${editIncId}`, body); else await api.post("/api/incidents", body);
    setShowIncForm(false); setEditIncId(null); fetchAll();
  };
  const editIncident = (i: IncidentRec) => { setEditIncId(i.id); setIType(i.type); setISev(i.severity); setIDesc(i.description); setIDate(i.date.slice(0,10)); setIRes(i.resolution||""); setIReporter(i.reportedBy||""); setShowIncForm(true); };
  const resetIncForm = () => { setShowIncForm(false); setEditIncId(null); setIType("设备故障"); setISev("一般"); setIDesc(""); setIDate(new Date().toISOString().slice(0,10)); setIRes(""); setIReporter(""); };

  const tabs = [
    { key: "battery", label: "电池事故", icon: Battery },
    { key: "flight", label: "飞行事故", icon: AlertTriangle },
  ] as const;

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-faint" /></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-bold">事故与安全</h1><p className="text-sm text-muted">电池事故记录、飞行事故记录</p></div>

      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-zinc-700"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Battery Tab */}
      {tab === "battery" && (
        <div className="space-y-4">
          {isStaff && <button onClick={()=>{resetBatForm();setShowBatForm(true);}} className="inline-flex items-center gap-1 text-sm text-sky-600 font-medium"><Plus className="h-4 w-4"/>记录电池事故</button>}
          {showBatForm && (
            <div className="rounded-xl border p-4 bg-surface space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium mb-1">电池编号</label><input value={bNum} onChange={e=>setBNum(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="如 BAT-001"/></div>
                <div><label className="block text-xs font-medium mb-1">状态</label><select value={bHealth} onChange={e=>setBHealth(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">{BATTERY_HEALTH.map(h=><option key={h}>{h}</option>)}</select></div>
                <div><label className="block text-xs font-medium mb-1">日期</label><input type="date" value={bDate} onChange={e=>setBDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              </div>
              <div><label className="block text-xs font-medium mb-1">备注</label><input value={bNotes} onChange={e=>setBNotes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="事故描述..."/></div>
              <div className="flex gap-2 justify-end"><button onClick={resetBatForm} className="px-3 py-1.5 rounded-lg text-sm border">取消</button><button onClick={saveBattery} className="px-3 py-1.5 rounded-lg text-sm bg-primary text-white">{editBatId?"更新":"记录"}</button></div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {batteries.map(b => (
              <div key={b.id} className="rounded-xl border p-4 bg-surface">
                <div className="flex justify-between items-start">
                  <div className="font-bold text-lg">{b.batteryNumber}</div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${b.health==="正常"?"bg-green-100 text-green-700":b.health==="报废"?"bg-red-100 text-red-700":"bg-yellow-100 text-yellow-700"}`}>{b.health}</span>
                </div>
                <div className="text-sm text-muted mt-2 space-y-1">
                  <div>日期: {b.incidentDate ? new Date(b.incidentDate).toLocaleDateString("zh-CN") : "-"}</div>
                  {b.notes && <div className="text-faint text-xs">{b.notes}</div>}
                </div>
                {isStaff && <div className="flex gap-1 mt-3"><button onClick={()=>editBattery(b)} className="text-xs text-sky-500">编辑</button><button onClick={async()=>{await api.delete(`/api/batteries/${b.id}`);fetchAll();}} className="text-xs text-red-400 ml-2">删除</button></div>}
              </div>
            ))}
            {batteries.length === 0 && <div className="col-span-3 p-12 text-center text-faint">暂无电池事故记录</div>}
          </div>
        </div>
      )}

      {/* Flight Incident Tab */}
      {tab === "flight" && (
        <div className="space-y-4">
          {isStaff && <button onClick={()=>{resetIncForm();setShowIncForm(true);}} className="inline-flex items-center gap-1 text-sm text-sky-600 font-medium"><Plus className="h-4 w-4"/>记录事故</button>}
          {showIncForm && (
            <div className="rounded-xl border p-4 bg-surface space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium mb-1">类型</label><select value={iType} onChange={e=>setIType(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">{INCIDENT_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
                <div><label className="block text-xs font-medium mb-1">严重程度</label><select value={iSev} onChange={e=>setISev(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">{SEVERITIES.map(s=><option key={s}>{s}</option>)}</select></div>
                <div><label className="block text-xs font-medium mb-1">日期</label><input type="date" value={iDate} onChange={e=>setIDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
                <div><label className="block text-xs font-medium mb-1">报告人</label><input value={iReporter} onChange={e=>setIReporter(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              </div>
              <div><label className="block text-xs font-medium mb-1">描述</label><textarea value={iDesc} onChange={e=>setIDesc(e.target.value)} rows={2} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              <div><label className="block text-xs font-medium mb-1">处理结果</label><input value={iRes} onChange={e=>setIRes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              <div className="flex gap-2 justify-end"><button onClick={resetIncForm} className="px-3 py-1.5 rounded-lg text-sm border">取消</button><button onClick={saveIncident} className="px-3 py-1.5 rounded-lg text-sm bg-primary text-white">{editIncId?"更新":"记录"}</button></div>
            </div>
          )}
          <div className="rounded-xl border bg-surface divide-y">
            {incidents.length === 0 ? <div className="p-12 text-center text-faint">暂无飞行事故记录</div> : incidents.map(i => (
              <div key={i.id} className="p-4"><div className="flex items-start justify-between"><div className="flex-1"><div className="flex items-center gap-2"><span className="font-medium">{i.type}</span><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[i.severity]}`}>{i.severity}</span><span className="text-xs text-faint">{new Date(i.date).toLocaleDateString("zh-CN")}</span></div><div className="text-sm mt-1">{i.description}</div>{i.resolution && <div className="text-sm text-success mt-1">✅ 处理: {i.resolution}</div>}{i.reportedBy && <div className="text-xs text-faint mt-1">报告人: {i.reportedBy}</div>}</div>{isStaff && <div className="flex gap-1"><button onClick={()=>editIncident(i)} className="text-xs text-sky-500">编辑</button><button onClick={async()=>{await api.delete(`/api/incidents/${i.id}`);fetchAll();}} className="text-xs text-red-400 ml-2">删除</button></div>}</div></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
