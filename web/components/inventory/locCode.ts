/** 库位编码（室-架/柜-层-位 四段）构造与解析：库存页录入与画布格位共用同一格式 */

export interface LocParts {
  room: string;
  cabinet: string;
  shelf: string;
  pos: string;
}

/** 解析四段编码：201-01-A-03 → { room:"201", cabinet:"01", shelf:"A", pos:"03" } */
export function parseLocParts(code?: string): LocParts {
  const parts = (code || "").split("-");
  return { room: parts[0] || "", cabinet: parts[1] || "", shelf: parts[2] || "", pos: parts[3] || "" };
}

/** 构造编码：架号/位号左侧补零（201-01-A-03） */
export function buildLocCode(room: string, cab: string, shelf: string, pos: string): string {
  return [room, cab.padStart(2, "0"), shelf, pos.padStart(2, "0")].filter(Boolean).join("-");
}

/** 编码所属房间（第一段） */
export function locationRoom(code?: string): string {
  return (code || "").split("-")[0] || "";
}
