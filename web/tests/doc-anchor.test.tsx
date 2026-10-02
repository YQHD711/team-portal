import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { decodeAnchor, findAnchorTarget } from "@/lib/docAnchor";
import { StudyLessonView } from "@/components/study/StudyLessonView";
import { HIGHLIGHT_TESTID } from "@/lib/mdHighlight";
import type { StudyLesson, StudyScope } from "@/lib/studyNav";

const LESSON: StudyLesson = { title: "认识航模", path: "飞训部/学习库/01-入门筑基/01-认识航模.md", canEdit: true };
const scope: StudyScope = {
  scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit: false,
  overviewPath: null, stages: [{
    title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit: false, descriptionPath: null,
    lessons: [LESSON],
  }],
};

describe("锚点查找（findAnchorTarget）", () => {
  it("按 id 精确命中，中文与百分号编码都能对上", () => {
    const { container } = render(<div><h2 id="小节标题">小节标题</h2></div>);
    expect(findAnchorTarget(container, "小节标题")).toHaveProperty("id", "小节标题");
    expect(findAnchorTarget(container, "#小节标题")).toHaveProperty("id", "小节标题");
    expect(findAnchorTarget(container, "%E5%B0%8F%E8%8A%82%E6%A0%87%E9%A2%98")).toHaveProperty("id", "小节标题");
  });

  it("回退到 slugify 后的 id（作者写的是标题原文）", () => {
    const { container } = render(<div><h2 id="1-小节-标题">1. 小节 标题</h2></div>);
    expect(findAnchorTarget(container, "1. 小节 标题")).toHaveProperty("id", "1-小节-标题");
  });

  it("找不到 / 空锚点 → null", () => {
    const { container } = render(<div><h2 id="别的">别的</h2></div>);
    expect(findAnchorTarget(container, "小节标题")).toBeNull();
    expect(findAnchorTarget(container, "")).toBeNull();
    expect(findAnchorTarget(null, "x")).toBeNull();
    expect(decodeAnchor("#")).toBe("");
  });
});

describe("StudyLessonView：滚动落点（锚点 > 搜索命中 > 开头）", () => {
  beforeEach(() => {
    // jsdom 没有 scrollIntoView；用普通 vi.fn 挂到原型上，好从 instances 里看出滚的是谁
    Element.prototype.scrollIntoView = vi.fn();
  });

  const renderView = (props: { content: string; highlight?: string; scrollToId?: string | null }) =>
    render(<StudyLessonView scope={scope} stageTitle="入门筑基" lesson={LESSON} content={props.content}
      loading={false} prev={null} next={null} total={1} onOpen={vi.fn()} onBackToPath={vi.fn()} onToggle={vi.fn()}
      highlight={props.highlight} scrollToId={props.scrollToId} />);

  const scrolledTo = () => {
    const spy = Element.prototype.scrollIntoView as unknown as { mock: { instances: HTMLElement[] } };
    return spy.mock.instances.at(-1);
  };

  it("带 #锚点：滚到那一节（不是回到开头）", () => {
    renderView({ content: "# 顶\n\n正文\n\n## 小节标题\n\n小节正文", scrollToId: "小节标题" });

    expect(scrolledTo()?.id).toBe("小节标题");
  });

  it("带搜索词：滚到第一处命中", () => {
    renderView({ content: "# 顶部\n\n正文里有中等两个字。", highlight: "中等" });

    const el = scrolledTo();
    expect(el?.getAttribute("data-testid")).toBe(HIGHLIGHT_TESTID);
  });

  it("既没锚点也没搜索词：回到正文开头（article）", () => {
    renderView({ content: "# 顶\n\n正文" });

    expect(scrolledTo()?.tagName).toBe("ARTICLE");
  });
});
