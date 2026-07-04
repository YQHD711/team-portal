"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Search, AlertTriangle, Package, Filter } from "lucide-react";

interface InventoryItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  location: string;
  status: string;
  updatedAt: string;
}

const COLORS = ["#0284c7", "#f59e0b", "#16a34a", "#dc2626", "#7c3aed", "#0891b2"];
const LOW_THRESHOLD = 5;

const statusLabels: Record<string, string> = {
  available: "可用",
  in_use: "使用中",
  broken: "损坏",
};

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => fetchItems(), 300);
    return () => clearTimeout(timer);
  }, [search, category]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      const data = await api.get<InventoryItem[]>(`/api/inventory?${params.toString()}`);
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
  const chartData = categories.map((cat) => ({
    name: cat || "未分类",
    value: items.filter((i) => i.category === cat).reduce((s, i) => s + i.quantity, 0),
  }));

  const lowItems = items.filter((i) => i.quantity < LOW_THRESHOLD);
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">零件库存</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {items.length} 种零件 · 共 {totalItems} 件
          </p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="sm:hidden inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm"
        >
          <Filter className="h-4 w-4" />
          筛选
        </button>
      </div>

      {/* Low stock alert */}
      {lowItems.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            <strong>{lowItems.length}</strong> 种零件库存不足（低于 {LOW_THRESHOLD} 件）
          </span>
        </div>
      )}

      {/* Filters */}
      <div className={`flex flex-wrap gap-3 ${showFilters ? "block" : "hidden sm:flex"}`}>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="搜索零件..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <option value="">全部分类</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Table */}
        <div className="lg:col-span-2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">名称</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 hidden sm:table-cell">分类</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">数量</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 hidden md:table-cell">位置</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center">
                      <Package className="h-8 w-8 mx-auto mb-2 text-zinc-300" />
                      <span className="text-zinc-500">暂无零件数据</span>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors ${
                        item.quantity < LOW_THRESHOLD ? "bg-amber-50/50 dark:bg-amber-950/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium">{item.name}</span>
                        <span className="block text-xs text-zinc-400 sm:hidden">{item.category}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 hidden sm:table-cell">{item.category}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${
                        item.quantity === 0 ? "text-red-600" : item.quantity < LOW_THRESHOLD ? "text-amber-600" : ""
                      }`}>
                        {item.quantity}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 hidden md:table-cell">{item.location || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.status === "available"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                            : item.status === "in_use"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}>
                          {statusLabels[item.status] || item.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pie chart */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <h3 className="font-medium text-sm mb-3">分类分布</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  dataKey="value"
                  label={({ name, value }) => `${name ?? ""} ${value ?? 0}`}
                  labelLine={false}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-zinc-400 text-sm">
              暂无数据
            </div>
          )}
          {/* Legend */}
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            {chartData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span className="w-3 h-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                {d.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
