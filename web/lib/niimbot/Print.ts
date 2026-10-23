/**
 * 精臣 PC Web SDK 打印服务 API（vendor 自官方包
 * web-4.2.1_20260902/pc-react/src/Print.ts）。
 *
 * 与上游差异：
 *  1. 上游把绘制参数声明成 String，实际调用方传的是对象；这里改成对象，避免类型撒谎。
 *     仍兼容旧调用：传字符串会在发送前 JSON.parse 成对象（服务端要的是 JSON 对象）。
 *  2. 不再用 (socket as any) 读私有字段，改走 NiimbotSocketLike.isOpen()。
 *  3. 参数/回包类型收窄为 unknown 系，协议字段名（DrawLable*、textAlignHorizonral 等）不变。
 */
import PrintElementFactory from "./PrintElementFactory";
import type {
  InitDrawingBoardParam, InitSdkParam, NiimbotElementType, NiimbotRequest,
  NiimbotResponse, NiimbotSocketLike,
} from "./protocol";

type ElementParam = Record<string, unknown>;

/** 兼容历史调用：字符串按 JSON 解析，对象原样返回 */
function asElementParam(input: ElementParam | string): ElementParam {
  if (typeof input !== "string") return input;
  const parsed: unknown = JSON.parse(input);
  return parsed && typeof parsed === "object" ? (parsed as ElementParam) : {};
}

export default class NMPrintSocket {
  private readonly printSocket: NiimbotSocketLike;

  constructor(printSocket: NiimbotSocketLike) {
    this.printSocket = printSocket;
  }

  /** 打印服务 WebSocket 是否已连接（readyState OPEN） */
  public printSocketStatus(): boolean {
    return this.printSocket.isOpen();
  }

  public async initSdk(json: InitSdkParam): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "initSdk", parameter: json });
  }

  public async getAllPrinters(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "getAllPrinters" });
  }

  public async selectPrinter(printerName: string, port: number): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "selectPrinter", parameter: { printerName, port } });
  }

  public async scanWifiPrinter(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "scanWifiPrinter" }, 25000);
  }

  public async connectWifiPrinter(printerName: string, tcpPort: number): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "connectWifiPrinter", parameter: { printerName, port: tcpPort } }, 25000);
  }

  /** K3W 配网：必须先 USB 连接，且只支持 2.4GHz */
  public async configurationWifi(wifiName: string, wifiPassword: string): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "configurationWifi", parameter: { wifiName, wifiPassword } }, 25000);
  }

  public async getWifiConfiguration(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "getWifiConfiguration" });
  }

  public async closePrinter(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "closePrinter" });
  }

  /**
   * 启动打印任务。
   * @param printDensity K3/K3W 取 1~5（默认 3）
   * @param printLabelType 1 间隙纸 / 2 黑标 / 3 连续纸 / 5 透明纸 / 10 黑标间隙纸
   * @param printMode 1 热敏（K3W 只支持热敏）
   * @param count 所有页份数之和
   */
  public async startJob(printDensity: number, printLabelType: number, printMode: number, count: number): Promise<NiimbotResponse> {
    return this.printSocket.send({
      apiName: "startJob",
      parameter: { printDensity, printLabelType, printMode, count },
    });
  }

  /**
   * 提交当前画板。
   * @param printData 上游传 null（绘制内容已由 DrawLable* 写入画板）
   * @param printerImageProcessingInfo JSON 字符串：{"printerImageProcessingInfo":{"printQuantity":1}}
   */
  public async commitJob(printData: string | null, printerImageProcessingInfo: string): Promise<NiimbotResponse> {
    const parsed: unknown = printData ? JSON.parse(printData) : undefined;
    const quantity = (JSON.parse(printerImageProcessingInfo) as { printerImageProcessingInfo?: unknown })
      .printerImageProcessingInfo;
    return this.printSocket.send({
      apiName: "commitJob",
      parameter: { printData: parsed, printerImageProcessingInfo: quantity },
    });
  }

  public async endJob(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "endJob" });
  }

  public async pausePrint(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "pausePrint" });
  }

  public async resumePrint(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "resumePrint" });
  }

  public async cancelJob(): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "stopPrint" });
  }

  /** 初始化画板：mm 坐标、rotate 仅支持 0/90/180/270；调用会清空上次内容 */
  public async InitDrawingBoard(json: InitDrawingBoardParam): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "InitDrawingBoard", parameter: json });
  }

  private draw(type: NiimbotElementType, json: ElementParam | string): Promise<NiimbotResponse> {
    const element = PrintElementFactory.createElement(type, asElementParam(json));
    const request: NiimbotRequest = { apiName: PrintElementFactory.apiNameOf(type), parameter: element.json };
    return this.printSocket.send(request);
  }

  public DrawLableText(json: ElementParam | string): Promise<NiimbotResponse> {
    return this.draw("text", json);
  }

  public DrawLableQrCode(json: ElementParam | string): Promise<NiimbotResponse> {
    return this.draw("qrCode", json);
  }

  public DrawLableQrCodeWithLogo(json: ElementParam | string): Promise<NiimbotResponse> {
    return this.draw("qrCodeWithLogo", json);
  }

  public DrawLableBarCode(json: ElementParam | string): Promise<NiimbotResponse> {
    return this.draw("barCode", json);
  }

  public DrawLableLine(json: ElementParam | string): Promise<NiimbotResponse> {
    return this.draw("line", json);
  }

  public DrawLableGraph(json: ElementParam | string): Promise<NiimbotResponse> {
    return this.draw("graph", json);
  }

  public DrawLableImage(json: ElementParam | string): Promise<NiimbotResponse> {
    return this.draw("image", json);
  }

  /** 生成预览图：displayScale 是每毫米像素数（200dpi 用 8，300dpi 用 11.81） */
  public async generateImagePreviewImage(displayScale: number): Promise<NiimbotResponse> {
    return this.printSocket.send({ apiName: "generateImagePreviewImage", displayScale });
  }

  public addPrintListener(callback: (msg: NiimbotResponse) => void): void {
    this.printSocket.addPrintListener(callback);
  }

  public removePrintListener(callback: (msg: NiimbotResponse) => void): void {
    this.printSocket.removePrintListener(callback);
  }

  public clearAllListeners(): void {
    this.printSocket.clearAllListeners();
  }

  public getListenersCount(): number {
    return this.printSocket.getListenersCount?.() ?? 0;
  }
}
