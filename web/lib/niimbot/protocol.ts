/**
 * 精臣（NIIMBOT）PC Web SDK 的协议类型。
 *
 * 来源：官方交付包 web-4.2.1_20260902/pc-react/src（Socket.ts / Print.ts /
 * PrintElementFactory.ts）。上游这些文件用 any 描述 WebSocket 报文；这里只做类型收窄，
 * **不改协议字段名**（例如历史拼写 DrawLable*、textAlignHorizonral、dpi 外的 displayScale），
 * 改字段名会直接导致本机打印服务不认。
 */

/** 发往本机打印服务的一条请求（ws://127.0.0.1:37989） */
export interface NiimbotRequest {
  apiName: string;
  parameter?: unknown;
  /** generateImagePreviewImage 的显示比例是顶层字段，不在 parameter 里 */
  displayScale?: number;
}

/** resultAck：打印服务的统一回包结构（字段随 API 不同而不同） */
export interface NiimbotResultAck {
  errorCode?: number;
  info?: string;
  result?: unknown;
  /** commitJob 主动上报里可能出现 */
  cacheStatus?: string;
  printPages?: number;
  printCopies?: number;
  [key: string]: unknown;
}

/** 打印服务主动推送 / API 响应 */
export interface NiimbotResponse {
  apiName?: string;
  resultAck?: NiimbotResultAck;
  [key: string]: unknown;
}

/** 通信层能力（Socket 的真实实现 + 测试用假实现共用） */
export interface NiimbotSocketLike {
  open(
    openChange?: (isOpen: boolean) => void,
    onMessageCallback?: (msg: NiimbotResponse) => void,
  ): Promise<unknown>;
  close(closing?: boolean): void;
  isOpen(): boolean;
  send(content: NiimbotRequest, timeout?: number | null): Promise<NiimbotResponse>;
  addPrintListener(callback: (msg: NiimbotResponse) => void): void;
  removePrintListener(callback: (msg: NiimbotResponse) => void): void;
  clearAllListeners(): void;
  /** 可选：调试/测试用 */
  getListenersCount?(): number;
  /** 可选：浏览器是否接受了 targetAddressSpace 本机回环权限选项 */
  readonly loopbackOptionAccepted?: boolean;
}

/** getAllPrinters 返回的 USB 设备（打印服务字段名） */
export interface PrinterDevice {
  name: string;
  port: number;
}

/** initSdk 参数 */
export interface InitSdkParam {
  /** 字体目录；当前服务版本不生效，传 "" 即可 */
  fontDir: string;
}

/** InitDrawingBoard 参数：尺寸单位为 mm，rotate 仅支持 0/90/180/270 */
export interface InitDrawingBoardParam {
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  path: string;
  verticalShift: number;
  HorizontalShift: number;
}

/** startJob 参数说明（实际是位置参数，这里仅作文档/校验用） */
export interface StartJobOptions {
  /** 打印浓度：K3/K3W 1~5，默认 3 */
  density: number;
  /** 1 间隙纸 / 2 黑标纸 / 3 连续纸 / 5 透明纸 / 10 黑标间隙纸 */
  labelType: number;
  /** 1 热敏（K3W 仅支持热敏） */
  printMode: number;
  /** 总份数 = 所有页份数之和 */
  count: number;
}

export type NiimbotElementType = "text" | "qrCode" | "qrCodeWithLogo" | "barCode" | "line" | "graph" | "image";

/** 单页打印数据：元素 type + 该元素传给 SDK 的参数 */
export interface NiimbotPrintElement {
  type: NiimbotElementType;
  json: Record<string, unknown>;
}

export interface NiimbotPrintPage {
  InitDrawingBoardParam: InitDrawingBoardParam;
  elements: NiimbotPrintElement[];
}
