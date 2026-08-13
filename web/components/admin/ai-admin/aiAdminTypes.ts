/* AI 系统管理员页面共享类型（ai-admin 页面及其子组件共用） */

export interface Proposal { id: string; title: string; description: string; filePath: string; suggestedCode: string | null; status: string; createdAt: string; errorMessage?: string | null; }
export interface MemoryStats { total: number; summaries: number; byRole: { role: string; count: number }[]; }
