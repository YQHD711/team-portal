"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BatteryCharging, KeyRound, Loader2, LogOut, RotateCcw, ScanLine, Settings2, UserRound } from "lucide-react";
import { DeviceCameraScanner } from "@/components/battery/DeviceCameraScanner";
import { extractBatteryCode } from "@/components/battery/batteryCode";
import {
  clearDeviceConfig, deviceBorrow, deviceGetBattery, deviceLogin, deviceLogout, deviceReturn,
  getDeviceConfig, getDeviceSession, saveDeviceConfig,
  type DeviceBattery, type DeviceConfig, type DeviceUser,
} from "@/components/battery/deviceApi";

/**
 * 设备终端：设备用 X-Device-Key/Secret 接入，在设备上登录使用人后扫码借还。
 * 不依赖用户 JWT，所以放在 (protected) 之外，免登录打开。
 */
export default function DeviceTerminalPage() {
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [user, setUser] = useState<DeviceUser | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [battery, setBattery] = useState<DeviceBattery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setConfig(getDeviceConfig());
    setUser(getDeviceSession().user);
  }, []);

  const saveConfig = () => {
    if (!keyInput.trim() || !secretInput.trim()) { setError("设备 Key 和 Secret 都要填"); return; }
    saveDeviceConfig(keyInput, secretInput);
    setConfig(getDeviceConfig());
    setError(null);
  };

  const resetConfig = () => {
    clearDeviceConfig();
    setConfig(null);
    setUser(null);
    setBattery(null);
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await deviceLogin(username.trim(), password);
      setUser(result.user);
      setUsername("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await deviceLogout();
    setUser(null);
    setBattery(null);
  };

  const lookup = useCallback(async (raw: string) => {
    const normalized = extractBatteryCode(raw);
    if (!normalized) return;
    setBusy(true);
    setError(null);
    setBattery(null);
    try {
      setBattery(await deviceGetBattery(normalized));
    } catch (e) {
      setError(e instanceof Error ? e.message : "没有找到这块电池");
    } finally {
      setBusy(false);
    }
  }, []);

  const act = async (kind: "borrow" | "return") => {
    if (!battery) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "borrow") await deviceBorrow(battery.code);
      else await deviceReturn(battery.code);
      setBattery(await deviceGetBattery(battery.code));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return <div className="p-8 text-center text-muted">加载中…</div>;

  return (
    <div className="mx-auto max-w-xl space-y-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">设备终端 · 电池借还</h1>
          <p className="text-sm text-muted">设备凭据接入，使用人在设备上登录后扫码借还</p>
        </div>
        {config && (
          <button onClick={resetConfig} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted">
            <Settings2 className="h-3.5 w-3.5" />重新配置
          </button>
        )}
      </div>

      {error && <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      {!config && (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" />配置本设备</div>
          <p className="text-xs text-faint">从管理端「系统设置 → 设备管理」创建设备后，把 DeviceKey 和 Secret 填入下面（只在本设备保存）。</p>
          <label className="block text-xs font-medium">
            Device Key
            <input value={keyInput} onChange={e => setKeyInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm" placeholder="dev_xxxxxxxx" />
          </label>
          <label className="block text-xs font-medium">
            Device Secret
            <input value={secretInput} onChange={e => setSecretInput(e.target.value)} type="password"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm" placeholder="48 位十六进制" />
          </label>
          <button onClick={saveConfig} className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white">保存设备配置</button>
        </div>
      )}

      {config && !user && (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium"><UserRound className="h-4 w-4" />使用人登录</div>
          <p className="text-xs text-faint">登录后，接下来的借还都会记录到这个账号名下。</p>
          <label className="block text-xs font-medium">
            用户名
            <input value={username} onChange={e => setUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium">
            密码
            <input value={password} onChange={e => setPassword(e.target.value)} type="password"
              onKeyDown={e => { if (e.key === "Enter") login(); }}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <button onClick={login} disabled={busy} className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "登录中…" : "登录"}
          </button>
        </div>
      )}

      {user && (
        <>
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <UserRound className="h-4 w-4 text-muted" />
              当前使用人：<span className="font-medium">{user.username}</span>
            </div>
            <button onClick={logout} className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
              <LogOut className="h-3.5 w-3.5" />登出
            </button>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input autoFocus value={code} onChange={e => setCode(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") lookup(code); }}
                  className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 font-mono text-sm"
                  placeholder="扫电池标签 / 输入编码后回车" />
              </div>
              <button onClick={() => lookup(code)} disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">查询</button>
            </div>
            <DeviceCameraScanner onScan={lookup} disabled={busy} />
          </div>

          {battery && (
            <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm text-faint">{battery.code}</div>
                  <div className="text-lg font-bold">{battery.model || "未填型号"}</div>
                </div>
                <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs">{battery.status === "in_stock" ? "在库" : battery.status === "borrowed" ? "借出" : battery.status}</span>
              </div>
              {battery.status === "borrowed" && battery.borrower && (
                <div className="text-sm text-muted">当前借用人：{battery.borrower}</div>
              )}
              <div className="space-y-2">
                {battery.status === "in_stock" && (
                  <button onClick={() => act("borrow")} disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-medium text-white disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BatteryCharging className="h-4 w-4" />}借出
                  </button>
                )}
                {battery.status === "borrowed" && (
                  <button onClick={() => act("return")} disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}归还
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="text-center text-xs text-faint">
        <Link href="/" className="underline">返回网页版</Link>
        <span className="mx-2">·</span>
        设备模式不需要网页登录；会话 12 小时后自动失效
      </div>
    </div>
  );
}
