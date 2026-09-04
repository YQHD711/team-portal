import Link from "next/link";
import { Bird } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="text-center">
        <div className="flex items-center justify-center w-14 h-14 mx-auto mb-4 rounded-2xl bg-surface-hover">
          <Bird className="h-7 w-7 text-faint" />
        </div>
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="text-sm text-muted mb-4">页面不存在或已被移除</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
