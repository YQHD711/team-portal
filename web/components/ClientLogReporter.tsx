"use client";

/**
 * 客户端错误上报挂载点（layout 里渲染，本身不产出任何 DOM）。
 *
 * 放在根布局而不是某个业务页面：渲染崩溃、路由 chunk 加载失败都发生在页面组件之外，
 * 只有全局监听才抓得到。安装逻辑在 lib/clientLog.ts（幂等，React StrictMode 双执行也安全）。
 */
import { useEffect } from "react";
import { installClientErrorLogging, stopClientErrorLogging } from "@/lib/clientLog";

export default function ClientLogReporter() {
  useEffect(() => {
    installClientErrorLogging();
    return () => stopClientErrorLogging();
  }, []);
  return null;
}
