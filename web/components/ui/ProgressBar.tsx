"use client";

/**
 * 进度条。percent 为 null 表示总长度未知（分块传输），显示不确定态。
 * 纯展示组件：文案由调用方给，避免 UI 组件反向依赖业务模块。
 */
export function ProgressBar({
  percent,
  label,
  left,
  right,
}: {
  percent: number | null;
  label?: string;
  left?: string;
  right?: string;
}) {
  const clamped = percent === null ? null : Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-label={label ?? "进度"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped ?? undefined}
        aria-valuetext={left}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-hover"
      >
        {clamped === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        ) : (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
      {(left || right) && (
        <div className="flex justify-between gap-3 text-xs text-faint">
          <span className="truncate">{left}</span>
          <span className="shrink-0">{right}</span>
        </div>
      )}
    </div>
  );
}
