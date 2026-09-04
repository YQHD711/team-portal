import { ArrowLeft, Cloud, Download, File, Folder, Link, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { formatSize, type BaiduFile } from "./cloudTypes";

interface Props {
  files: BaiduFile[];
  loading: boolean;
  currentDir: string;
  dragOver: boolean;
  uploading: boolean;
  uploadProgress: number;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onNavigate: (dir: string) => void;
  onGoBack: () => void;
  onRefresh: () => void;
  onDownload: (file: BaiduFile) => void;
  onDelete: (path: string) => void;
  onCopyLink: (file: BaiduFile) => void;
}

/** 网盘文件列表（面包屑导航 + 拖拽上传 + 文件操作） */
export default function CloudFileList({ files, loading, currentDir, dragOver, uploading, uploadProgress, onDragOver, onDragLeave, onDrop, onNavigate, onGoBack, onRefresh, onDownload, onDelete, onCopyLink }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {currentDir !== "/" && (
            <button onClick={onGoBack} className="p-1 rounded hover:bg-surface-hover"><ArrowLeft className="h-4 w-4 text-muted" /></button>
          )}
          <span className="font-semibold text-sm">文件列表 ({files.length})</span>
        </div>
        <button onClick={onRefresh} className="p-1 rounded hover:bg-surface-hover"><RefreshCw className="h-4 w-4 text-muted" /></button>
      </div>
      {/* Breadcrumb */}
      <div className="px-4 py-1.5 text-xs text-muted border-b border-border flex items-center gap-1 flex-wrap">
        <button onClick={() => onNavigate("/")} className="hover:text-blue-500">根目录</button>
        {currentDir.split("/").filter(Boolean).map((part, i, arr) => (
          <span key={i} className="flex items-center gap-1">
            <span>/</span>
            <button onClick={() => onNavigate("/" + arr.slice(0, i + 1).join("/"))} className="hover:text-blue-500 truncate max-w-[100px]">{part}</button>
          </span>
        ))}
      </div>
      <div className={`divide-y divide-border relative ${dragOver ? "ring-2 ring-sky-400 bg-sky-50 dark:bg-sky-950/20" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}>
        {uploading && uploadProgress > 0 && (
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />上传中 {uploadProgress}%
            </div>
            <div className="h-1.5 rounded-full bg-blue-200 dark:bg-blue-900 mt-1"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} /></div>
          </div>
        )}
        {dragOver && <div className="absolute inset-0 z-10 flex items-center justify-center bg-sky-100/80 dark:bg-sky-900/50 rounded-xl"><p className="text-sky-600 font-medium">释放文件以上传</p></div>}
        {loading ? <div className="p-8 text-center text-muted"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div> :
         files.length === 0 ? <div className="p-8 text-center text-muted"><Cloud className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无文件</div> :
         files.map(f => (
          <div key={f.path}
            onClick={() => f.isDir ? onNavigate(f.path) : undefined}
            className={`flex items-center gap-3 px-4 py-3 transition-colors ${f.isDir ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950" : "hover:bg-surface-hover"}`}>
            {f.isDir ? <Folder className="h-5 w-5 text-amber-500 shrink-0" /> : <File className="h-5 w-5 text-blue-500 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{f.name}</div>
              <div className="text-xs text-muted">{f.isDir ? "文件夹" : formatSize(f.size) + " · " + new Date(f.modified * 1000).toLocaleString("zh-CN")}</div>
            </div>
            {!f.isDir && (
              <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => onCopyLink(f)} className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-950 text-success" title="复制链接"><Link className="h-4 w-4" /></button>
                <button onClick={() => onDownload(f)} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-500" title="下载"><Download className="h-4 w-4" /></button>
                <button onClick={() => onDelete(f.path)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-danger" title="删除"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
