import { ExternalLink, Key } from "lucide-react";

interface Props {
  authUrl: string;
  authCode: string;
  onAuthCode: (v: string) => void;
  authMsg: string;
  loadingAuthUrl: boolean;
  onGetAuthUrl: () => void;
  onSubmitCode: () => void;
}

/** 百度网盘首次授权面板（获取授权链接 → 粘贴授权码确认） */
export default function CloudAuthPanel({ authUrl, authCode, onAuthCode, authMsg, loadingAuthUrl, onGetAuthUrl, onSubmitCode }: Props) {
  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/10 p-5 space-y-4">
      <div className="flex items-center gap-2 text-warning font-semibold"><Key className="h-5 w-5" />需要授权</div>
      <p className="text-sm text-warning">首次使用需授权百度网盘访问权限（仅需一次，之后自动续期）。</p>
      {!authUrl ? (
        <button onClick={onGetAuthUrl} disabled={loadingAuthUrl} className="rounded-xl bg-warning px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {loadingAuthUrl ? "获取中..." : "获取授权链接"}
        </button>
      ) : (
        <div className="space-y-3">
          <a href={authUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">打开授权页面 <ExternalLink className="h-3 w-3" /></a>
          <div className="flex gap-2">
            <input value={authCode} onChange={e => onAuthCode(e.target.value)} placeholder="粘贴授权码" className="flex-1 rounded-lg border px-3 py-2 text-sm" />
            <button onClick={onSubmitCode} className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:opacity-90">确认</button>
          </div>
          {authMsg && <div className="text-sm">{authMsg}</div>}
        </div>
      )}
    </div>
  );
}
