/** 学习库的共享类型与纯函数（可单测）。 */

export interface StudyLesson { title: string; path: string; canEdit: boolean; completed?: boolean; }

export interface StudyStage {
  title: string;
  path: string;
  canEdit: boolean;
  descriptionPath: string | null;
  /** 「_阶段说明.md」正文（后端已剥离 front matter） */
  description?: string | null;
  duration?: string | null;
  goal?: string | null;
  completedCount?: number;
  lessons: StudyLesson[];
}

export interface StudyScope {
  scope: string;
  label: string;
  libraryPath: string;
  canEdit: boolean;
  overviewPath: string | null;
  overview?: string | null;
  duration?: string | null;
  goal?: string | null;
  completedCount?: number;
  lessonCount?: number;
  stages: StudyStage[];
}

export interface StudyStatsLesson { title: string; path: string; completedCount: number; }
export interface StudyStats { scope: string; memberCount: number; lessons: StudyStatsLesson[]; }

/** 按阶段顺序拉平全部课时 —— 上一课/下一课的遍历依据。 */
export function flattenLessons(stages: StudyStage[]): StudyLesson[] {
  return stages.flatMap(s => s.lessons);
}

/** 该课时在整个学习路径里的序号（从 1 开始）；找不到返回 0。 */
export function lessonOrdinal(stages: StudyStage[], path: string): number {
  return flattenLessons(stages).findIndex(l => l.path === path) + 1;
}

/**
 * 勾选/取消后就地更新结构（不改后端返回的原对象）。
 * 计数字段一并重算 —— 否则进度条会和勾选状态对不上。
 */
export function applyCompletion(scope: StudyScope, path: string, completed: boolean): StudyScope {
  const stages = scope.stages.map(stage => {
    const lessons = stage.lessons.map(l => (l.path === path ? { ...l, completed } : l));
    return { ...stage, lessons, completedCount: lessons.filter(l => l.completed).length };
  });

  return {
    ...scope,
    stages,
    completedCount: stages.reduce((n, s) => n + (s.completedCount ?? 0), 0),
    lessonCount: stages.reduce((n, s) => n + s.lessons.length, 0),
  };
}

/** 完成百分比（0–100 取整）；没有课时时返回 0 而不是 NaN。 */
export function percent(done: number | undefined, total: number | undefined): number {
  if (!total || total <= 0) return 0;
  return Math.round(((done ?? 0) / total) * 100);
}

export interface TocItem { level: number; text: string; id: string; }

/** 标题 → 锚点 id。中文按整字保留，标点与空白折叠成 '-'。 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 抽取 h2/h3 作为右侧大纲。
 * 必须跳过代码块 —— 否则代码注释里的 `## xxx` 会被当成标题混进目录。
 */
export function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*`_]/g, "").trim();
    if (text) items.push({ level: m[1].length, text, id: slugify(text) });
  }
  return items;
}
