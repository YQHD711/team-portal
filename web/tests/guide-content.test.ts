import { describe, it, expect, beforeEach } from "vitest";
import { mergeTour, parseSteps } from "@/lib/tours/merge";
import { readCache, writeCache } from "@/lib/tours/progress";
import type { TourDef } from "@/lib/tours/types";

const base: TourDef = {
  key: "t",
  title: "默认标题",
  roles: ["member", "部长", "admin"],
  entry: "/t",
  autoStart: true,
  version: 3,
  steps: [{ id: "s1", target: "a", title: "标题一", body: "正文一", roles: ["部长", "admin"] }],
};

describe("后台覆盖合并", () => {
  it("没有覆盖时原样返回默认定义", () => {
    expect(mergeTour(base)).toBe(base);
  });

  it("覆盖标题与步骤，且继承默认步骤的 roles（后台编辑不携带权限）", () => {
    const merged = mergeTour(base, {
      tourKey: "t",
      title: "新标题",
      stepsJson: JSON.stringify([{ id: "s1", target: "a", title: "新标题一", body: "新正文一" }]),
      version: 4,
    });
    expect(merged.title).toBe("新标题");
    expect(merged.version).toBe(4);
    expect(merged.steps[0].title).toBe("新标题一");
    expect(merged.steps[0].roles).toEqual(["部长", "admin"]);
  });

  it("空标题 / 空步骤 / version=0 都回落默认值", () => {
    const merged = mergeTour(base, { tourKey: "t", title: "  ", stepsJson: "[]", version: 0 });
    expect(merged.title).toBe("默认标题");
    expect(merged.version).toBe(3);
    expect(merged.steps).toBe(base.steps);
  });

  it("非法 StepsJson 不会被采信", () => {
    const merged = mergeTour(base, { tourKey: "t", title: "x", stepsJson: "{broken", version: 1 });
    expect(merged.steps).toBe(base.steps);
  });

  it("parseSteps 严格校验字段类型", () => {
    expect(parseSteps('[{"id":1,"target":"a","title":"t","body":"b"}]')).toBeNull();
    expect(parseSteps('{"id":"a"}')).toBeNull();
    expect(parseSteps('[{"id":"s","target":"a","title":"t","body":"b"}]')).toHaveLength(1);
  });
});

describe("引导进度本地缓存", () => {
  beforeEach(() => localStorage.clear());

  it("按 userId 隔离，换账号读不到别人的进度", () => {
    writeCache(1, { welcome: { status: "done", stepIndex: 0, version: 1 } });
    expect(readCache(2)).toEqual({});
    expect(readCache(1).welcome.status).toBe("done");
  });

  it("损坏的缓存按空进度处理（不抛错）", () => {
    localStorage.setItem("tp.tours.v1.3", "{not json");
    expect(readCache(3)).toEqual({});
    localStorage.setItem("tp.tours.v1.4", JSON.stringify({ welcome: { status: "unknown" } }));
    expect(readCache(4)).toEqual({});
  });
});
