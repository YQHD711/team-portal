import { describe, it, expect } from "vitest";
import { extractToc, flattenLessons, lessonOrdinal, slugify, type StudyStage } from "@/lib/studyNav";

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
