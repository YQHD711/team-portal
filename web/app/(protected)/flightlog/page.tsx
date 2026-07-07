"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { TrendingUp, Battery, AlertTriangle, FileText, Loader2, Plus, Trash2, Pencil } from "lucide-react";

interface FlightRec { id: number; pilotUserId: number; pilot: { username: string } | null; aircraftModel: string; takeoffTime: string; landingTime: string | null; durationMinutes: number | null; location: string | null; weather: string | null; notes: string | null; logFileName: string | null; batteryNumber: string | null; }
interface BatteryRec { id: number; batteryNumber: string; cycleCount: number; capacityMAh: number | null; health: string; lastUsedDate: string | null; notes: string | null; }
interface IncidentRec { id: number; type: string; severity: string; description: string; date: string; relatedFlightId: number | null; resolution: string | null; reportedBy: string | null; }
interface FlightStats { totalFlights: number; thisMonthFlights: number; totalHours: number; thisMonthHours: number; }
interface User { id: number; username: string; }

const SEVERITY_COLORS: Record<string, string> = { "严重": "bg-red-100 text-red-700", "一般": "bg-yellow-100 text-yellow-700", "轻微": "bg-blue-100 text-blue-700" };
const INCIDENT_TYPES = ["设备故障", "操作失误", "天气原因", "信号干扰", "其他"];
const SEVERITIES = ["轻微", "一般", "严重"];

export default function FlightLogPage() {
  const [tab, setTab] = useState<string>("flights");
  const [flights, setFlights] = useState<FlightRec[]>([]);
  const [batteries, setBatteries] = useState<BatteryRec[]>([]);
  const [incidents, setIncidents] = useState<IncidentRec[]>([]);
  const [stats, setStats] = useState<FlightStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isStaff, setIsStaff] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  // Flight form
  const [showFlightForm, setShowFlightForm] = useState(false); const [editFlightId, setEditFlightId] = useState<number | null>(null);
  const [fPilot, setFPilot] = useState(""); const [fModel, setFModel] = useState(""); const [fTakeoff, setFTakeoff] = useState(new Date().toISOString().slice(0, 16));
  const [fLanding, setFLanding] = useState(""); const [fDuration, setFDuration] = useState(""); const [fLoc, setFLoc] = useState(""); const [fWeather, setFWeather] = useState(""); const [fNotes, setFNotes] = useState(""); const [fBattery, setFBattery] = useState("");

  // Battery form
  const [showBatForm, setShowBatForm] = useState(false); const [editBatId, setEditBatId] = useState<number | null>(null);
  const [bNum, setBNum] = useState(""); const [bCycles, setBCycles] = useState("0"); const [bCap, setBCap] = useState(""); const [bHealth, setBHealth] = useState("正常"); const [bNotes, setBNotes] = useState("");

  // Incident form
  const [showIncForm, setShowIncForm] = useState(false); const [editIncId, setEditIncId] = useState<number | null>(null);
  const [iType, setIType] = useState("设备故障"); const [iSev, setISev] = useState("一般"); const [iDesc, setIDesc] = useState(""); const [iDate, setIDate] = useState(new Date().toISOString().slice(0, 10)); const [iRes, setIRes] = useState(""); const [iReporter, setIReporter] = useState("");

  useEffect(() => {
    api.get<{role:string}>("/api/auth/me").then(u => { setIsStaff(u.role === "admin" || u.role === "部长"); if (u.role === "admin" || u.role === "部长") api.get<User[]>("/api/admin/users").then(setUsers).catch(()=>{}); }).catch(()=>{});
    fetchAll();
  }, []);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      api.get<FlightRec[]>("/api/flights").then(setFlights).catch(()=>{}),
      api.get<BatteryRec[]>("/api/batteries").then(setBatteries).catch(()=>{}),
      api.get<IncidentRec[]>("/api/incidents").then(setIncidents).catch(()=>{}),
      api.get<FlightStats>("/api/flights/stats").then(setStats).catch(()=>{}),
    ]).finally(() => setLoading(false));
  };

  const saveFlight = async () => {
    const body = { pilotUserId: parseInt(fPilot) || 0, aircraftModel: fModel, takeoffTime: fTakeoff, landingTime: fLanding || null, durationMinutes: parseFloat(fDuration) || null, location: fLoc || null, weather: fWeather || null, notes: fNotes || null, logFileName: null, batteryNumber: fBattery || null };
    if (editFlightId) await api.put(`/api/flights/${editFlightId}`, body); else await api.post("/api/flights", body);
    setShowFlightForm(false); setEditFlightId(null); fetchAll();
  };
  const editFlight = (f: FlightRec) => { setEditFlightId(f.id); setFPilot(String(f.pilotUserId)); setFModel(f.aircraftModel); setFTakeoff(f.takeoffTime.slice(0,16)); setFLanding(f.landingTime?.slice(0,16)||""); setFDuration(f.durationMinutes?String(f.durationMinutes):""); setFLoc(f.location||""); setFWeather(f.weather||""); setFNotes(f.notes||""); setFBattery(f.batteryNumber||""); setShowFlightForm(true); };
  const resetFlightForm = () => { setShowFlightForm(false); setEditFlightId(null); setFPilot(""); setFModel(""); setFTakeoff(new Date().toISOString().slice(0,16)); setFLanding(""); setFDuration(""); setFLoc(""); setFWeather(""); setFNotes(""); setFBattery(""); };

  const saveBattery = async () => {
    const body = { batteryNumber: bNum, cycleCount: parseInt(bCycles)||0, capacityMAh: parseFloat(bCap)||null, health: bHealth, notes: bNotes||null };
    if (editBatId) await api.put(`/api/batteries/${editBatId}`, body); else await api.post("/api/batteries", body);
    setShowBatForm(false); setEditBatId(null); fetchAll();
  };
  const editBattery = (b: BatteryRec) => { setEditBatId(b.id); setBNum(b.batteryNumber); setBCycles(String(b.cycleCount)); setBCap(b.capacityMAh?String(b.capacityMAh):""); setBHealth(b.health); setBNotes(b.notes||""); setShowBatForm(true); };
  const resetBatForm = () => { setShowBatForm(false); setEditBatId(null); setBNum(""); setBCycles("0"); setBCap(""); setBHealth("正常"); setBNotes(""); };

  const saveIncident = async () => {
    const body = { type: iType, severity: iSev, description: iDesc, date: iDate, relatedFlightId: null, resolution: iRes||null, reportedBy: iReporter||null };
    if (editIncId) await api.put(`/api/incidents/${editIncId}`, body); else await api.post("/api/incidents", body);
    setShowIncForm(false); setEditIncId(null); fetchAll();
  };
  const editIncident = (i: IncidentRec) => { setEditIncId(i.id); setIType(i.type); setISev(i.severity); setIDesc(i.description); setIDate(i.date.slice(0,10)); setIRes(i.resolution||""); setIReporter(i.reportedBy||""); setShowIncForm(true); };
  const resetIncForm = () => { setShowIncForm(false); setEditIncId(null); setIType("设备故障"); setISev("一般"); setIDesc(""); setIDate(new Date().toISOString().slice(0,10)); setIRes(""); setIReporter(""); };

  const tabs = [
    { key: "flights", label: "飞行记录", icon: TrendingUp },
    { key: "batteries", label: "电池管理", icon: Battery },
    { key: "incidents", label: "事故记录", icon: AlertTriangle },
    { key: "logs", label: "日志文件", icon: FileText },
  ] as const;

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-bold">飞行数据中心</h1><p className="text-sm text-zinc-500">飞行记录、电池、事故全生命周期管理</p></div>

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-xl border p-4 bg-white dark:bg-zinc-900"><div className="text-2xl font-bold text-sky-600">{stats.totalFlights}</div><div className="text-xs text-zinc-400 mt-1">总飞行次数</div></div>
          <div className="rounded-xl border p-4 bg-white dark:bg-zinc-900"><div className="text-2xl font-bold text-green-600">{stats.totalHours}h</div><div className="text-xs text-zinc-400 mt-1">总飞行小时</div></div>
          <div className="rounded-xl border p-4 bg-white dark:bg-zinc-900"><div className="text-2xl font-bold text-amber-600">{stats.thisMonthFlights}</div><div className="text-xs text-zinc-400 mt-1">本月飞行次数</div></div>
          <div className="rounded-xl border p-4 bg-white dark:bg-zinc-900"><div className="text-2xl font-bold text-purple-600">{stats.thisMonthHours}h</div><div className="text-xs text-zinc-400 mt-1">本月飞行小时</div></div>
        </div>
      )}

      <div className="flex gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Flights Tab */}
      {tab === "flights" && (
        <div className="space-y-4">
          {isStaff && <button onClick={() => { resetFlightForm(); setShowFlightForm(true); }} className="inline-flex items-center gap-1 text-sm text-sky-600 font-medium"><Plus className="h-4 w-4"/>添加飞行记录</button>}
          {showFlightForm && (
            <div className="rounded-xl border p-4 bg-white dark:bg-zinc-900 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-xs font-medium mb-1">飞行员</label><select value={fPilot} onChange={e=>setFPilot(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"><option value="">选择</option>{users.map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select></div>
                <div><label className="block text-xs font-medium mb-1">机型</label><input value={fModel} onChange={e=>setFModel(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="如 F450"/></div>
                <div><label className="block text-xs font-medium mb-1">起飞时间</label><input type="datetime-local" value={fTakeoff} onChange={e=>setFTakeoff(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">降落时间</label><input type="datetime-local" value={fLanding} onChange={e=>setFLanding(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">时长(分钟)</label><input type="number" value={fDuration} onChange={e=>setFDuration(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">地点</label><input value={fLoc} onChange={e=>setFLoc(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">天气</label><input value={fWeather} onChange={e=>setFWeather(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">电池编号</label><input value={fBattery} onChange={e=>setFBattery(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium mb-1">备注</label><input value={fNotes} onChange={e=>setFNotes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div className="flex gap-2 justify-end"><button onClick={resetFlightForm} className="px-3 py-1.5 rounded-lg text-sm border">取消</button><button onClick={saveFlight} className="px-3 py-1.5 rounded-lg text-sm bg-sky-500 text-white">{editFlightId?"更新":"添加"}</button></div>
            </div>
          )}
          <div className="rounded-xl border bg-white dark:bg-zinc-900 divide-y overflow-x-auto">
            <div className="grid grid-cols-8 gap-2 p-3 text-xs font-medium text-zinc-500 bg-zinc-50 dark:bg-zinc-800"><div>飞行员</div><div>机型</div><div>起飞时间</div><div>时长</div><div>地点</div><div>天气</div><div>电池</div><div>操作</div></div>
            {flights.length === 0 ? <div className="p-12 text-center text-zinc-400">暂无飞行记录</div> : flights.map(f => (
              <div key={f.id} className="grid grid-cols-8 gap-2 p-3 text-sm items-center">
                <div className="font-medium">{f.pilot?.username || `#${f.pilotUserId}`}</div><div>{f.aircraftModel}</div><div className="text-xs">{new Date(f.takeoffTime).toLocaleString("zh-CN")}</div>
                <div>{f.durationMinutes ? `${f.durationMinutes}min` : "-"}</div><div className="text-xs">{f.location || "-"}</div><div className="text-xs">{f.weather || "-"}</div><div className="text-xs">{f.batteryNumber || "-"}</div>
                <div className="flex gap-1">{isStaff && <button onClick={()=>editFlight(f)} className="p-1 hover:bg-zinc-100 rounded text-zinc-400"><Pencil className="h-3.5 w-3.5"/></button>}{isStaff && <button onClick={async ()=>{await api.delete(`/api/flights/${f.id}`);fetchAll();}} className="p-1 hover:bg-red-50 rounded text-red-400"><Trash2 className="h-3.5 w-3.5"/></button>}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batteries Tab */}
      {tab === "batteries" && (
        <div className="space-y-4">
          {isStaff && <button onClick={()=>{resetBatForm();setShowBatForm(true);}} className="inline-flex items-center gap-1 text-sm text-sky-600 font-medium"><Plus className="h-4 w-4"/>添加电池</button>}
          {showBatForm && (
            <div className="rounded-xl border p-4 bg-white dark:bg-zinc-900 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-xs font-medium mb-1">编号</label><input value={bNum} onChange={e=>setBNum(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
                <div><label className="block text-xs font-medium mb-1">循环次数</label><input type="number" value={bCycles} onChange={e=>setBCycles(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
                <div><label className="block text-xs font-medium mb-1">容量(mAh)</label><input type="number" value={bCap} onChange={e=>setBCap(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
                <div><label className="block text-xs font-medium mb-1">健康状态</label><select value={bHealth} onChange={e=>setBHealth(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"><option>正常</option><option>注意</option><option>需更换</option></select></div>
                <div><label className="block text-xs font-medium mb-1">备注</label><input value={bNotes} onChange={e=>setBNotes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              </div>
              <div className="flex gap-2 justify-end"><button onClick={resetBatForm} className="px-3 py-1.5 rounded-lg text-sm border">取消</button><button onClick={saveBattery} className="px-3 py-1.5 rounded-lg text-sm bg-sky-500 text-white">{editBatId?"更新":"添加"}</button></div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {batteries.map(b => (
              <div key={b.id} className="rounded-xl border p-4 bg-white dark:bg-zinc-900">
                <div className="flex justify-between items-start"><div className="font-bold text-lg">{b.batteryNumber}</div><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${b.health==="正常"?"bg-green-100 text-green-700":b.health==="注意"?"bg-yellow-100 text-yellow-700":"bg-red-100 text-red-700"}`}>{b.health}</span></div>
                <div className="text-sm text-zinc-500 mt-2 space-y-1"><div>循环: {b.cycleCount} 次</div>{b.capacityMAh && <div>容量: {b.capacityMAh} mAh</div>}{b.lastUsedDate && <div>最后使用: {new Date(b.lastUsedDate).toLocaleDateString("zh-CN")}</div>}{b.notes && <div className="text-zinc-400 text-xs">{b.notes}</div>}</div>
                {isStaff && <div className="flex gap-1 mt-3"><button onClick={()=>editBattery(b)} className="text-xs text-sky-500">编辑</button><button onClick={async()=>{await api.delete(`/api/batteries/${b.id}`);fetchAll();}} className="text-xs text-red-400 ml-2">删除</button></div>}
              </div>
            ))}
            {batteries.length === 0 && <div className="col-span-3 p-12 text-center text-zinc-400">暂无电池记录</div>}
          </div>
        </div>
      )}

      {/* Incidents Tab */}
      {tab === "incidents" && (
        <div className="space-y-4">
          {isStaff && <button onClick={()=>{resetIncForm();setShowIncForm(true);}} className="inline-flex items-center gap-1 text-sm text-sky-600 font-medium"><Plus className="h-4 w-4"/>记录事故</button>}
          {showIncForm && (
            <div className="rounded-xl border p-4 bg-white dark:bg-zinc-900 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium mb-1">类型</label><select value={iType} onChange={e=>setIType(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">{INCIDENT_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
                <div><label className="block text-xs font-medium mb-1">严重程度</label><select value={iSev} onChange={e=>setISev(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">{SEVERITIES.map(s=><option key={s}>{s}</option>)}</select></div>
                <div><label className="block text-xs font-medium mb-1">日期</label><input type="date" value={iDate} onChange={e=>setIDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
                <div><label className="block text-xs font-medium mb-1">报告人</label><input value={iReporter} onChange={e=>setIReporter(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              </div>
              <div><label className="block text-xs font-medium mb-1">描述</label><textarea value={iDesc} onChange={e=>setIDesc(e.target.value)} rows={2} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              <div><label className="block text-xs font-medium mb-1">处理结果</label><input value={iRes} onChange={e=>setIRes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm"/></div>
              <div className="flex gap-2 justify-end"><button onClick={resetIncForm} className="px-3 py-1.5 rounded-lg text-sm border">取消</button><button onClick={saveIncident} className="px-3 py-1.5 rounded-lg text-sm bg-sky-500 text-white">{editIncId?"更新":"记录"}</button></div>
            </div>
          )}
          <div className="rounded-xl border bg-white dark:bg-zinc-900 divide-y">
            {incidents.length === 0 ? <div className="p-12 text-center text-zinc-400">暂无事故记录</div> : incidents.map(i => (
              <div key={i.id} className="p-4"><div className="flex items-start justify-between"><div className="flex-1"><div className="flex items-center gap-2"><span className="font-medium">{i.type}</span><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[i.severity]}`}>{i.severity}</span><span className="text-xs text-zinc-400">{new Date(i.date).toLocaleDateString("zh-CN")}</span></div><div className="text-sm mt-1">{i.description}</div>{i.resolution && <div className="text-sm text-green-600 mt-1">✅ 处理: {i.resolution}</div>}{i.reportedBy && <div className="text-xs text-zinc-400 mt-1">报告人: {i.reportedBy}</div>}</div>{isStaff && <div className="flex gap-1"><button onClick={()=>editIncident(i)} className="text-xs text-sky-500">编辑</button><button onClick={async()=>{await api.delete(`/api/incidents/${i.id}`);fetchAll();}} className="text-xs text-red-400 ml-2">删除</button></div>}</div></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
