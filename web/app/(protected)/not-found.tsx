import Link from "next/link";

export default function ProtectedNotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="text-sm text-muted mb-4">页面不存在或已被移除</p>
        <Link href="/" className="text-sm text-blue-500 hover:underline">
          返回首页
        </Link>
      </div>
    </div>
  );
}
