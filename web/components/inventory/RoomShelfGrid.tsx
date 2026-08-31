/** 物料布局：单房间货架网格渲染（架 × 层 × 位） */
export interface GridItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  locationCode?: string;
  unitPrice: number;
}

export function parseLocCode(code?: string) {
  const parts = (code || "").split("-");
  return { room: parts[0] || "", cabinet: parts[1] || "", shelf: parts[2] || "", pos: parts[3] || "" };
}

export function buildLocCode(room: string, cab: string, shelf: string, pos: string) {
  const parts = [room, cab.padStart(2, "0"), shelf, pos.padStart(2, "0")].filter(Boolean);
  return parts.join("-");
}

interface RoomShelfGridProps {
  layout: { roomCode: string; cabinetCount: number; shelfCount: number; positionCount: number };
  items: GridItem[];
}

export function RoomShelfGrid({ layout, items }: RoomShelfGridProps) {
  const byPos = new Map<string, GridItem[]>();
  items.forEach(i => {
    const { cabinet, shelf, pos } = parseLocCode(i.locationCode);
    if (!cabinet || !shelf || !pos) return;
    const code = buildLocCode(layout.roomCode, cabinet, shelf, pos);
    const list = byPos.get(code);
    if (list) list.push(i);
    else byPos.set(code, [i]);
  });

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {Array.from({ length: layout.cabinetCount }, (_, ci) => {
        const cab = String(ci + 1).padStart(2, "0");
        return (
          <div key={cab} className="shrink-0 w-64 rounded-xl border border-border bg-surface p-3">
            <div className="text-xs font-medium text-muted mb-2">货架 {cab}</div>
            <div className="space-y-1.5">
              {Array.from({ length: layout.shelfCount }, (_, si) => {
                const shelf = String(si + 1);
                return (
                  <div key={shelf} className="flex items-center gap-1.5">
                    <div className="w-6 shrink-0 text-[10px] text-faint text-right">{shelf}层</div>
                    <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${layout.positionCount}, minmax(0, 1fr))` }}>
                      {Array.from({ length: layout.positionCount }, (_, pi) => {
                        const pos = String(pi + 1).padStart(2, "0");
                        const code = buildLocCode(layout.roomCode, cab, shelf, pos);
                        const cell = byPos.get(code) || [];
                        if (cell.length === 0)
                          return <div key={pos} className="h-10 rounded bg-surface-subtle border border-border dark:border-zinc-700/50" title={`${code} 空位`} />;
                        const total = cell.reduce((s, i) => s + i.quantity, 0);
                        return (
                          <div key={pos}
                            title={`${code}\n${cell.map(i => `${i.name} ×${i.quantity}`).join("\n")}`}
                            className={`h-10 rounded border px-0.5 flex flex-col items-center justify-center overflow-hidden cursor-default ${
                              total < 3
                                ? "bg-amber-100 dark:bg-amber-950 border-amber-300 dark:border-amber-700"
                                : "bg-sky-100 dark:bg-sky-950 border-sky-300 dark:border-sky-700"
                            }`}>
                            <span className="w-full text-center text-[9px] leading-none truncate">{cell[0].name}</span>
                            <span className="text-[11px] font-bold leading-tight">{total}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
