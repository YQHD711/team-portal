import { api } from "@/lib/api";

export interface MissingInfo {
  total: number;
  missing: string[];
  missingCount: number;
}

export interface WikiDocStatus {
  path: string;
  relativeFile: string;
  exists: boolean;
  historyVersions: number;
}

export interface WikiDiagnostics {
  targetFolder: string;
  projectName: string;
  projectDir: string;
  kbRoot: string;
  workspacePath: string | null;
  workspaceExists: boolean;
  documents: WikiDocStatus[];
  missing: string[];
  recoverableFromHistory: string[];
}

/** 诊断：文档该存在哪、缺了哪些、哪些能从 .history 零成本恢复（纯文件检查，不产生 AI 调用）。 */
export function diagnoseTask(taskId: string): Promise<WikiDiagnostics> {
  return api.get<WikiDiagnostics>(`/api/wiki/tasks/${taskId}/diagnose`);
}

/** 从知识库 .history 的历史版本恢复缺失文档：不调用 AI、无费用。 */
export async function restoreFromHistory(taskId: string, recoverable: number): Promise<string> {
  if (recoverable === 0) {
    return "没有可从历史版本恢复的文档（这些文档从未写入成功过），需要用「补齐缺失文档」重新生成。";
  }
  const confirmed = window.confirm(
    `将从知识库的 .history 备份恢复 ${recoverable} 篇缺失文档。\n` +
      "这一步只复制本地文件，不调用 AI、不产生任何费用。确定继续？"
  );
  if (!confirmed) return "";
  const res = await api.post<{ message?: string }>(`/api/wiki/tasks/${taskId}/restore-from-history`, {});
  return res.message ?? "已从历史版本恢复";
}

/**
 * 补齐缺失文档：先预览「要补几篇」（纯文件检查，不产生 AI 调用），再让用户确认。
 *
 * 为什么要有这一步：大仓库全量重跑成本很高，而缺的往往只是几篇；后端只对缺失项调用 AI、
 * 复用已存目录与工作区，所以这里必须把范围讲清楚，避免用户以为要重跑整个项目而不敢点。
 *
 * @returns 给用户看的结果文案；用户取消时返回空字符串（不发起请求）。
 */
export async function retryMissingDocuments(taskId: string, projectName: string): Promise<string> {
  const info = await api.get<MissingInfo>(`/api/wiki/tasks/${taskId}/missing`);

  if (info.missingCount === 0) return `${projectName} 的 ${info.total} 篇文档都在，无需补齐。`;

  const list = info.missing.slice(0, 5).map(p => `· ${p}`).join("\n");
  const more = info.missingCount > 5 ? `\n…另有 ${info.missingCount - 5} 篇` : "";
  const confirmed = window.confirm(
    `只补齐缺失的 ${info.missingCount}/${info.total} 篇文档：\n${list}${more}\n\n` +
      "已生成的文档不会重跑，目录也不会重新生成，也不需要重新下载源码，" +
      "所以费用只与缺失篇数相关（不是整个仓库）。确定继续？"
  );
  if (!confirmed) return "";

  const res = await api.post<{ message?: string }>(`/api/wiki/tasks/${taskId}/retry-missing`, {});
  return res.message ?? "已开始补齐缺失文档";
}
