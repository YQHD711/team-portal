"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Search, AlertTriangle } from "lucide-react";

interface InventoryItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  location: string;
  status: string;
  updatedAt: string;
}

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#7c3aed", "#0891b2"];
const LOW_THRESHOLD = 5;

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItems();
  }, [search, category]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);

      const data = await api.get<InventoryItem[]>(
        `/api/inventory?${params.toString()}`
      );
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
  const chartData = categories.map((cat) => ({
    name: cat,
    value: items.filter((i) => i.category === cat).reduce((s, i) => s + i.quantity, 0),
  }));

  const lowItems = items.filter((i) => i.quantity < LOW_THRESHOLD);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">零件库存</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="搜索零件名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
        >
          <option value="">全部分类</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Low stock warning */}
      {lowItems.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" />
            库存不足警告：{lowItems.length} 种零件低于阈值（{LOW_THRESHOLD}）
          </div>
        </div>
      )}

      {/* Content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Table */}
        <div className="lg:col-span-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">分类</th>
                <th className="px-4 py-3 font-medium text-right">数量</th>
                <th className="px-4 py-3 font-medium">位置</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-zinc-200 dark:border-zinc-800">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    暂无数据
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-t border-zinc-200 dark:border-zinc-800 ${
                      item.quantity < LOW_THRESHOLD
                        ? "bg-amber-50 dark:bg-amber-950/20"
                        : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {item.category}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        item.quantity < LOW_THRESHOLD
                          ? "text-amber-600 dark:text-amber-400 font-semibold"
                          : item.quantity === 0
                          ? "text-red-600 dark:text-red-400"
                          : ""
                      }`}
                    >
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {item.location}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.status === "available"
                            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                            : item.status === "in_use"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {item.status === "available" ? "可用" : item.status === "in_use" ? "使用中" : item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pie chart */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <h3 className="font-medium mb-3">分类分布</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""} (${value ?? 0})`}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-zinc-400 text-sm">
              暂无数据
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
