export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-3 border-blue-500/30 border-t-blue-500 animate-spin" />
        <span className="text-sm text-muted">加载中...</span>
      </div>
    </div>
  );
}
