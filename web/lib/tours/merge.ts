import type { TourDef, TourStep } from "./types";

/** 后端 /api/content/guides 下发的一条覆盖（停用的不会下发） */
export interface GuideOverride {
  tourKey: string;
  title: string;
  stepsJson: string;
  version: number;
}

/**
 * 把后台覆盖合并进代码默认定义。
 *
 * 规则：
 * - 标题为空 → 用默认标题
 * - StepsJson 解析失败/空数组 → 用默认步骤
 * - version=0（未声明）→ 用默认版本
 * - 覆盖步骤不携带 roles/action：按 id 从默认步骤继承，避免后台编辑把权限弄丢
 */
export function mergeTour(def: TourDef, override?: GuideOverride): TourDef {
  if (!override) return def;

  const steps = parseSteps(override.stepsJson);
  const merged: TourDef = {
    ...def,
    title: override.title?.trim() ? override.title : def.title,
    version: override.version > 0 ? override.version : def.version,
  };
  if (steps) {
    merged.steps = steps.map((step) => {
      const base = def.steps.find((d) => d.id === step.id);
      return base ? { ...step, roles: base.roles, action: base.action } : step;
    });
  }
  return merged;
}

/** 严格校验：必须是数组，且每项都有字符串 id/target/title/body；任何一项不合法就整体回落默认 */
export function parseSteps(json: string): TourStep[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const steps: TourStep[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) return null;
      const s = item as Record<string, unknown>;
      if (typeof s.id !== "string" || typeof s.target !== "string") return null;
      if (typeof s.title !== "string" || typeof s.body !== "string") return null;
      steps.push({
        id: s.id,
        target: s.target,
        title: s.title,
        body: s.body,
        placement: typeof s.placement === "string" ? (s.placement as TourStep["placement"]) : undefined,
        desktopOnly: s.desktopOnly === true,
      });
    }
    return steps;
  } catch {
    return null;
  }
}
