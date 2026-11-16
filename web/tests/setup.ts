/** jsdom 缺失的浏览器 API 垫片：组件用 ResizeObserver 重测锚点，测试环境只需它存在即可 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}

/**
 * localStorage 垫片：部分 jsdom 版本/环境下 localStorage 未挂载，
 * 而组件（deviceApi 的会话缓存）依赖它。缺失时补内存版，行为与浏览器一致。
 */
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    writable: true,
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}
