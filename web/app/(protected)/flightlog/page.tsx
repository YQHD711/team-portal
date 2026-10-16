"use client";

import { useState } from "react";
import { Cpu, Stethoscope } from "lucide-react";
import { FirmwarePanel } from "@/components/flightlog/FirmwarePanel";
import { DiagnosisPanel } from "@/components/flightlog/diagnosis/DiagnosisPanel";

// 「日志文件」Tab 已随日志上传功能下线（解析已改为纯客户端，不再需要上传/服务端存日志）。
// 默认标签改为「诊断」：它是本页主力功能，且避免一进页面就挂载依赖接口数据的固件面板。
type Tab = "diagnosis" | "firmware";

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: "diagnosis", label: "诊断", icon: Stethoscope },
  { id: "firmware", label: "固件下载", icon: Cpu },
];

export default function FlightLogPage() {
  const [tab, setTab] = useState<Tab>("diagnosis");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">飞行日志 / 固件</h1>
        <p className="text-sm text-muted">飞控日志诊断与 ArduPilot / PX4 固件下载</p>
      </div>

      <div role="tablist" aria-label="飞行日志与固件" className="flex gap-1 border-b">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* 只挂载当前 Tab 的组件，避免未激活面板在后台打接口 */}
      {tab === "diagnosis" ? <DiagnosisPanel /> : <FirmwarePanel />}
    </div>
  );
}
