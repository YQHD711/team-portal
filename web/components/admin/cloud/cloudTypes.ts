/* 云存储页面共享类型与工具函数（cloud 页面及其子组件共用） */

export interface Quota { total: number; used: number; free: number; }
export interface BaiduFile { path: string; name: string; size: number; isDir: boolean; modified: number; fsId: number; }

export function formatSize(b: number) {
  return b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : b < 1073741824 ? `${(b/1048576).toFixed(1)}MB` : `${(b/1073741824).toFixed(2)}GB`;
}
