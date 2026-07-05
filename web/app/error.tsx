"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="text-center max-w-sm">
        <div className="flex items-center justify-center w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-100 dark:bg-red-950/50">
          <AlertTriangle className="h-7 w-7 text-red-500" />
        </div>
        <h2 className="text-lg font-bold mb-2">页面加载出错</h2>
        <p className="text-sm text-muted mb-4">
          {error.message || "发生了意外错误，请尝试刷新页面。"}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          重试
        </button>
      </div>
    </div>
  );
}
