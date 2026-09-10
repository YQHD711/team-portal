/** 与后端 StorageLayout 一致的房间布局记录（/api/storage/layouts 返回项） */
export interface RoomLayoutRow {
  id: number;
  roomCode: string;
  roomName: string;
  floor: number;
  cabinetCount: number;
  shelfCount: number;
  positionCount: number;
  description?: string;
  updatedAt: string;
  layoutJson?: string | null;
}
