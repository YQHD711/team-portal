import { describe, it, expect } from "vitest";
import { applyCompletion, extractToc, flattenLessons, lessonOrdinal, percent, slugify, type StudyScope, type StudyStage } from "@/lib/studyNav";

const stage = (title: string, lessonTitles: string[]): StudyStage => ({
  title, path: `公共/学习库/${title}`, canEdit: false, descriptionPath: null,
  lessons: lessonTitles.map(t => ({ title: t, path: `公共/学习库/${title}/${t}.md`, canEdit: false })),
});

describe("学习库导航（纯逻辑）", () => {
  const stages = [stage("入门筑基", ["认识航模", "安全规范"]), stage("进阶实战", ["装机"])];

  it("按阶段顺序拉平课时（上一课/下一课的遍历依据）", () => {
    expect(flattenLessons(stages).map(l => l.title)).toEqual(["认识航模", "安全规范", "装机"]);
  });

  it("课时序号从 1 开始，跨阶段连续", () => {
    expect(lessonOrdinal(stages, "公共/学习库/入门筑基/认识航模.md")).toBe(1);
    expect(lessonOrdinal(stages, "公共/学习库/进阶实战/装机.md")).toBe(3);
  });

  it("找不到的课时返回 0（而不是 1，避免误显示成第一课）", () => {
    expect(lessonOrdinal(stages, "公共/学习库/不存在.md")).toBe(0);
  });

  it("抽取 h2/h3 作为大纲", () => {
    const toc = extractToc("# 标题(不算)\n\n## 第一节\n\n正文\n\n### 小节\n\n## 第二节");

    expect(toc.map(t => [t.level, t.text])).toEqual([[2, "第一节"], [3, "小节"], [2, "第二节"]]);
  });

  it("跳过代码块内的 # —— 否则代码注释会混进目录", () => {
    const md = "## 真标题\n\n```bash\n## 这是注释\n```\n\n## 另一个真标题";

    expect(extractToc(md).map(t => t.text)).toEqual(["真标题", "另一个真标题"]);
  });

  it("去掉标题里的强调符号与结尾 #", () => {
    expect(extractToc("## **加粗**的标题 ##").map(t => t.text)).toEqual(["加粗的标题"]);
  });

  it("中文标题生成可用的锚点 id（保留汉字）", () => {
    expect(slugify("认识 航模!")).toBe("认识-航模");
    expect(extractToc("## 认识航模").at(0)?.id).toBe("认识航模");
  });
});

describe("进度与完成度（纯逻辑）", () => {
  const scopeWith = (completed: string[]): StudyScope => {
    const done = new Set(completed);
    const lessons = [
      { title: "认识航模", path: "公共/学习库/01/01-认识航模.md", canEdit: false, completed: done.has("公共/学习库/01/01-认识航模.md") },
      { title: "安全规范", path: "公共/学习库/01/02-安全规范.md", canEdit: false, completed: done.has("公共/学习库/01/02-安全规范.md") },
    ];
    return {
      scope: "公共", label: "公共学习库", libraryPath: "公共/学习库", canEdit: false, overviewPath: null,
      completedCount: lessons.filter(l => l.completed).length, lessonCount: lessons.length,
      stages: [{ title: "入门", path: "公共/学习库/01", canEdit: false, descriptionPath: null, completedCount: lessons.filter(l => l.completed).length, lessons }],
    };
  };

  it("勾选后就地更新课时与各级计数（进度条不能和勾选状态对不上）", () => {
    const updated = applyCompletion(scopeWith([]), "公共/学习库/01/01-认识航模.md", true);

    expect(updated.completedCount).toBe(1);
    expect(updated.lessonCount).toBe(2);
    expect(updated.stages[0].completedCount).toBe(1);
    expect(updated.stages[0].lessons[0].completed).toBe(true);
  });

  it("取消勾选后计数回落", () => {
    const updated = applyCompletion(scopeWith(["公共/学习库/01/01-认识航模.md"]), "公共/学习库/01/01-认识航模.md", false);

    expect(updated.completedCount).toBe(0);
    expect(updated.stages[0].lessons[0].completed).toBe(false);
  });

  it("不改动原对象（避免 React 状态被就地修改）", () => {
    const original = scopeWith([]);

    applyCompletion(original, "公共/学习库/01/01-认识航模.md", true);

    expect(original.stages[0].lessons[0].completed).toBe(false);
    expect(original.completedCount).toBe(0);
  });

  it("百分比取整；没有课时时返回 0 而不是 NaN", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(3, 3)).toBe(100);
    expect(percent(0, 2)).toBe(0);
    expect(percent(0, 0)).toBe(0);
    expect(percent(undefined, undefined)).toBe(0);
  });
});
