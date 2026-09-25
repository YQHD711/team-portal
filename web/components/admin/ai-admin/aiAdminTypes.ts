/* AI 系统管理员页面共享类型（ai-admin 页面及其子组件共用） */

export interface MemoryStats { total: number; summaries: number; byRole: { role: string; count: number }[]; }

/** 助手可用工具（GET /api/admin/agent/tools） */
export interface AgentTool { name: string; description: string; }

/** 管理员手册章节（GET /api/admin/agent/guide） */
export interface GuideSection { topic: string; content: string; }

export interface ChatEntry { role: string; content: string; }
