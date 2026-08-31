"use client";

/** 库存分类环形图(性能 #10:recharts ~400KB 懒加载)
 * 从 dashboard / inventory 页 next/dynamic 引入 */
import { useEffect, useState } from "react";

interface CategoryDatum { name: string; value: number }
interface ChartProps {
  data: CategoryDatum[];
  total?: number;
  height?: number;
  width?: number;
}

const COLORS = ["var(--accent)", "var(--success)", "var(--info)", "var(--warning)", "var(--danger)"];

export default function CategoryDonut({ data, total, height = 150, width = 160 }: ChartProps) {
  const [Recharts, setRecharts] = useState<typeof import("recharts") | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("recharts");
      if (!cancelled) setRecharts(mod);
    })();
    return () => { cancelled = true; };
  }, []);

  const sum = total ?? data.reduce((s, d) => s + d.value, 0);

  if (!Recharts) {
    return (
      <div className="relative shrink-0" style={{ width, height }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-faint text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  const { PieChart, Pie, Cell } = Recharts as any;
  return (
    <div className="relative shrink-0" style={{ width, height }}>
      <PieChart width={width} height={height}>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          innerRadius={52} outerRadius={70} paddingAngle={2} stroke="none">
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
      </PieChart>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[26px] font-extrabold tracking-[-0.03em] leading-none">{sum}</span>
        <span className="text-[11px] text-muted mt-1">种物料</span>
      </div>
    </div>
  );
}