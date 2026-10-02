import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StudyLessonView } from "@/components/study/StudyLessonView";
import { StudyPath } from "@/components/study/StudyPath";
import type { StudyLesson, StudyScope } from "@/lib/studyNav";

/**
 * 接线测试：MarkdownRenderer 的 onNavigate 要真的接到学习库自己的导航回调上，
 * 否则组件单测全绿、用户点了还是没反应。
 */

const LESSON: StudyLesson = { title: "认识航模", path: "飞训部/学习库/01-入门筑基/01-认识航模.md", canEdit: true };

const scope: StudyScope = {
  scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit: false,
  overviewPath: "飞训部/学习库/README.md", overview: "[安全规范](01-入门筑基/02-安全规范.md)",
  stages: [{
    title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit: true,
    descriptionPath: "飞训部/学习库/01-入门筑基/_阶段说明.md",
    description: "[章程](../章程.md)",
    lessons: [LESSON],
  }],
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("学习库：文档互链接到自己的导航回调", () => {
  it("课时页正文里的相对 .md 引用走 onOpen（不跳浏览器）", () => {
    const onOpen = vi.fn();
    render(<StudyLessonView scope={scope} stageTitle="入门筑基" lesson={LESSON} content="[下一课](02-安全规范.md)"
      loading={false} prev={null} next={null} total={1} onOpen={onOpen} onBackToPath={vi.fn()} onToggle={vi.fn()} />);

    fireEvent.click(screen.getByRole("link", { name: "下一课" }));

    expect(onOpen).toHaveBeenCalledWith("飞训部/学习库/01-入门筑基/02-安全规范.md");
  });

  it("学习路径总览的正文与阶段说明都走 onOpenLesson（上跳 ../ 也对）", () => {
    const onOpenLesson = vi.fn();
    render(<StudyPath scope={scope} onOpenLesson={onOpenLesson} onToggle={vi.fn()} />);

    fireEvent.click(screen.getByRole("link", { name: "安全规范" }));
    expect(onOpenLesson).toHaveBeenCalledWith("飞训部/学习库/01-入门筑基/02-安全规范.md");

    // 阶段说明里是 ../章程.md —— 相对「阶段说明.md」所在目录解析
    fireEvent.click(screen.getByRole("link", { name: "章程" }));
    expect(onOpenLesson).toHaveBeenCalledWith("飞训部/学习库/章程.md");
  });
});
