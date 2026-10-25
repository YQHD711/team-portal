import { describe, it, expect } from "vitest";
import type { LabelData, LabelTemplate } from "@/lib/labelTemplate";
import { mapLabelToPrintPage } from "@/lib/niimbot/labelMapping";
import { NiimbotPrinter, parseWifiDevices } from "@/lib/niimbot/client";
import { NiimbotError } from "@/lib/niimbot/errors";
import type { NiimbotRequest, NiimbotResponse, NiimbotSocketLike } from "@/lib/niimbot/protocol";

/**
 * 用假 WebSocket 层跑完整状态机：连接 → 发现 → initSdk → 绘制 → 预览；
 * 以及 startJob → commitJob ok! → 绘制 → commitJob → 进度 → endJob。
 * 不连真硬件、不碰浏览器 WebSocket。
 */

const data: LabelData = {
  code: "BAT-LIPO-6S3300MAH-2026-0007",
  url: "https://team.example.com/i/BAT-LIPO-6S3300MAH-2026-0007",
  name: "6S 3300mAh 电池",
  grade: "A",
  locationCode: "201-A-3-05",
  category: "电池电源",
};

const template: LabelTemplate = {
  id: 1, name: "K3W 50×30", widthMm: 50, heightMm: 30, dpi: 200, background: "#FFFFFF",
  elements: [
    { id: "qr", type: "qr", x: 2, y: 2, w: 20, h: 20 },
    { id: "code", type: "text", x: 24, y: 4, w: 24, h: 5, field: "code", fontSizePt: 8 },
  ],
};

const page = mapLabelToPrintPage(template, data);

class FakeSocket implements NiimbotSocketLike {
  readonly requests: NiimbotRequest[] = [];
  opened = false;
  loopbackOptionAccepted = true;
  private listeners = new Set<(msg: NiimbotResponse) => void>();
  private openChange: ((open: boolean) => void) | null = null;

  constructor(private readonly options: {
    devices?: Record<string, number>;
    preview?: string;
    wifiDevices?: unknown[];
  } = {}) {}

  open(openChange?: (open: boolean) => void): Promise<unknown> {
    this.openChange = openChange ?? null;
    this.opened = true;
    openChange?.(true);
    return Promise.resolve({});
  }

  close(): void {
    this.opened = false;
    this.openChange?.(false);
  }

  isOpen(): boolean {
    return this.opened;
  }

  async send(request: NiimbotRequest): Promise<NiimbotResponse> {
    this.requests.push(request);
    if (request.apiName === "getAllPrinters") {
      return {
        apiName: "getAllPrinters",
        resultAck: { errorCode: 0, info: JSON.stringify(this.options.devices ?? { "NIIMBOT K3W": 1 }) },
      };
    }
    if (request.apiName === "scanWifiPrinter") {
      const wifiDevices = this.options.wifiDevices
        ?? [{ deviceName: "NIIMBOT K3W", tcpPort: 9100, ipAddress: "192.168.1.50" }];
      return {
        apiName: "scanWifiPrinter",
        resultAck: { errorCode: 0, info: JSON.stringify(wifiDevices) },
      };
    }
    if (request.apiName === "generateImagePreviewImage") {
      return {
        apiName: "generateImagePreviewImage",
        resultAck: { errorCode: 0, info: JSON.stringify({ mimeType: "image/png", ImageData: this.options.preview ?? "QUJD" }) },
      };
    }
    if (request.apiName === "commitJob") {
      return { apiName: "commitJob", resultAck: { errorCode: 0, info: "commitJobApi Success!" } };
    }
    return { apiName: request.apiName, resultAck: { errorCode: 0, info: "" } };
  }

  addPrintListener(callback: (msg: NiimbotResponse) => void): void { this.listeners.add(callback); }
  removePrintListener(callback: (msg: NiimbotResponse) => void): void { this.listeners.delete(callback); }
  clearAllListeners(): void { this.listeners.clear(); }
  getListenersCount(): number { return this.listeners.size; }
  emit(msg: NiimbotResponse): void { [...this.listeners].forEach(listener => listener(msg)); }
  sent(apiName: string): boolean { return this.requests.some(r => r.apiName === apiName); }
}

class FailingSocket implements NiimbotSocketLike {
  constructor(readonly loopbackOptionAccepted: boolean) {}
  open(openChange?: (open: boolean) => void): Promise<unknown> {
    openChange?.(false);
    return Promise.reject(new Error("connect refused"));
  }
  close(): void {}
  isOpen(): boolean { return false; }
  send(request: NiimbotRequest): Promise<NiimbotResponse> { return Promise.resolve({ apiName: request.apiName }); }
  addPrintListener(): void {}
  removePrintListener(): void {}
  clearAllListeners(): void {}
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error(`等待超时: ${label}`);
}

describe("精臣 K3W 客户端 · 连接", () => {
  it("构造时不自动连接；显式 connect 才连服务→发现→选机→initSdk", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket });

    expect(socket.opened).toBe(false);
    expect(client.isConnected).toBe(false);

    const device = await client.connect();

    expect(device).toEqual({ name: "NIIMBOT K3W", port: 1 });
    expect(client.isConnected).toBe(true);
    expect(client.deviceName).toBe("NIIMBOT K3W");
    expect(client.connectionMode).toBe("usb");
    expect(socket.requests.map(r => r.apiName)).toEqual(["getAllPrinters", "selectPrinter", "initSdk"]);
  });

  it("连不上服务：提示打印服务/权限/端口检测，并给出导出 PDF 退路", async () => {
    const client = new NiimbotPrinter({ socketFactory: () => new FailingSocket(false), connectTimeoutMs: 200 });
    const error = await client.connect().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(NiimbotError);
    const e = error as NiimbotError;
    expect(e.message).toContain("无法连接本机打印服务");
    expect(e.recovery).toContain("Test-NetConnection 127.0.0.1 -Port 37989");
    expect(e.recovery).toContain("导出 PDF");
    expect(e.recovery).toContain("Chrome/Edge 154");
  });

  it("新浏览器接受 targetAddressSpace 时，提示改为本地设备权限", async () => {
    const client = new NiimbotPrinter({ socketFactory: () => new FailingSocket(true), connectTimeoutMs: 200 });
    const error = (await client.connect().catch((err: unknown) => err)) as NiimbotError;

    expect(error.recovery).toContain("访问本地设备");
    expect(error.recovery).toContain("重新授权");
  });

  it("未发现 USB 打印机：给开机/线缆/驱动排查建议", async () => {
    const socket = new FakeSocket({ devices: {} });
    const client = new NiimbotPrinter({ socketFactory: () => socket });
    const error = (await client.connect().catch((err: unknown) => err)) as NiimbotError;

    expect(error.message).toContain("未发现 USB 打印机");
    expect(error.recovery).toContain("USB");
  });
});

describe("精臣 K3W 客户端 · 预览与打印", () => {
  it("预览：先 InitDrawingBoard + 绘制元素，再取 Base64 预览图", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket });
    await client.connect();

    const url = await client.preview(page);

    expect(url).toBe("data:image/png;base64,QUJD");
    const names = socket.requests.map(r => r.apiName);
    expect(names).toContain("InitDrawingBoard");
    expect(names).toContain("DrawLableQrCode");
    expect(names).toContain("DrawLableText");
    expect(names).toContain("generateImagePreviewImage");
  });

  it("打印生命周期：startJob → 等 commitJob ok! → 绘制 → commitJob → 进度 → endJob", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket, jobTimeoutMs: 1000 });
    await client.connect();
    const progress: string[] = [];

    const printing = client.print(page, { copies: 2, onProgress: p => progress.push(p.message) });

    await until(() => socket.sent("startJob"), "startJob 请求");
    socket.emit({ apiName: "commitJob", resultAck: { errorCode: 0, info: "commitJob ok!" } });

    await until(() => socket.sent("commitJob"), "commitJob 请求");
    socket.emit({ apiName: "commitJob", resultAck: { errorCode: 0, printPages: 1, printCopies: 2 } });

    await printing;
    expect(socket.sent("endJob")).toBe(true);
    expect(progress.some(message => message.includes("打印完成"))).toBe(true);
    // 顺序约束：commitJob 必须在绘制之后，endJob 必须在 commitJob 之后
    const names = socket.requests.map(r => r.apiName);
    expect(names.lastIndexOf("InitDrawingBoard")).toBeGreaterThan(names.indexOf("startJob"));
    expect(names.indexOf("commitJob")).toBeGreaterThan(names.lastIndexOf("DrawLableText"));
    expect(names.indexOf("endJob")).toBeGreaterThan(names.indexOf("commitJob"));
  });

  it("多页打印：startJob(页数×份数) → 逐页 commitJob(每页份数) → endJob", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket, jobTimeoutMs: 2000 });
    await client.connect();
    const page2 = mapLabelToPrintPage(template, {
      ...data, code: "BAT-002", url: "https://team.example.com/i/BAT-002",
    });
    const progress: string[] = [];

    const printing = client.printPages([page, page2], { copies: 2, onProgress: p => progress.push(p.message) });

    const commitCount = () => socket.requests.filter(r => r.apiName === "commitJob").length;
    const commitQuantity = (index: number) => {
      const commits = socket.requests.filter(r => r.apiName === "commitJob");
      const parameter = commits[index]?.parameter as { printerImageProcessingInfo?: { printQuantity?: number } } | undefined;
      return parameter?.printerImageProcessingInfo?.printQuantity;
    };

    await until(() => socket.sent("startJob"), "startJob 请求");
    const start = socket.requests.find(r => r.apiName === "startJob");
    expect((start?.parameter as { count: number }).count).toBe(4); // 2 页 × 2 份

    socket.emit({ apiName: "commitJob", resultAck: { errorCode: 0, info: "commitJob ok!" } });
    await until(() => commitCount() === 1, "第 1 页 commitJob");
    expect(commitQuantity(0)).toBe(2);

    socket.emit({ apiName: "commitJob", resultAck: { errorCode: 0, printPages: 1, printCopies: 2 } });
    socket.emit({ apiName: "commitJob", resultAck: { errorCode: 0, info: "commitJob ok!" } });
    await until(() => commitCount() === 2, "第 2 页 commitJob");
    expect(commitQuantity(1)).toBe(2);

    socket.emit({ apiName: "commitJob", resultAck: { errorCode: 0, printPages: 2, printCopies: 2 } });
    await printing;

    expect(socket.sent("endJob")).toBe(true);
    expect(socket.requests.filter(r => r.apiName === "InitDrawingBoard")).toHaveLength(2);
    expect(progress.some(m => m.includes("2 页"))).toBe(true);
  });

  it("打印异常（缺纸）：翻译成中文错误并停止任务", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket, jobTimeoutMs: 1000 });
    await client.connect();

    const printing = client.print(page, { copies: 1 });
    await until(() => socket.sent("startJob"), "startJob 请求");
    socket.emit({ apiName: "commitJob", resultAck: { errorCode: 0, info: "commitJob ok!" } });
    await until(() => socket.sent("commitJob"), "commitJob 请求");
    socket.emit({ apiName: "OnPauseStatus", resultAck: { errorCode: 2, info: "Paper out" } });

    await expect(printing).rejects.toThrow(/标签纸/);
    expect(socket.sent("stopPrint")).toBe(true);
  });

  it("disconnect 关闭打印机与本地 WebSocket", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket });
    await client.connect();

    await client.disconnect();

    expect(client.isConnected).toBe(false);
    expect(socket.opened).toBe(false);
    expect(socket.sent("closePrinter")).toBe(true);
  });
});

describe("精臣 K3W 客户端 · Wi-Fi", () => {
  const responseWith = (info: unknown): NiimbotResponse => ({
    resultAck: { errorCode: 0, info: info as string },
  });

  it("parseWifiDevices：数组 / JSON 字符串 / 大小写 / 缺字段 / 空", () => {
    const raw = [
      { deviceName: "K3W-A", tcpPort: 9100, ipAddress: "192.168.1.5" },
      { DeviceName: "K3W-B", TcpPort: "9101" },
      { deviceName: "", tcpPort: 9102 },
      { deviceName: "no-port" },
      { deviceName: "bad-port", tcpPort: "not-a-number" },
    ];

    expect(parseWifiDevices(responseWith(raw))).toEqual([
      { deviceName: "K3W-A", tcpPort: 9100, ipAddress: "192.168.1.5" },
      { deviceName: "K3W-B", tcpPort: 9101 },
    ]);
    expect(parseWifiDevices(responseWith(JSON.stringify(raw)))).toHaveLength(2);
    expect(parseWifiDevices(responseWith([]))).toEqual([]);
    expect(parseWifiDevices(responseWith("[]"))).toEqual([]);
    expect(parseWifiDevices(responseWith("not-json"))).toEqual([]);
    expect(parseWifiDevices({ resultAck: { errorCode: 0 } })).toEqual([]);
    expect(parseWifiDevices({})).toEqual([]);
  });

  it("discoverWifi 走 scanWifiPrinter（不是 getAllPrinters）", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket });

    const devices = await client.discoverWifi();

    expect(devices).toEqual([{ deviceName: "NIIMBOT K3W", tcpPort: 9100, ipAddress: "192.168.1.50" }]);
    expect(socket.requests.map(r => r.apiName)).toEqual(["scanWifiPrinter"]);
  });

  it("connectWifi 顺序：connectWifiPrinter → initSdk，且绝不调用 selectPrinter", async () => {
    const socket = new FakeSocket();
    const client = new NiimbotPrinter({ socketFactory: () => socket });
    const [device] = await client.discoverWifi();

    await client.connectWifi(device);

    expect(socket.requests.map(r => r.apiName)).toEqual([
      "scanWifiPrinter", "connectWifiPrinter", "initSdk",
    ]);
    expect(client.isConnected).toBe(true);
    expect(client.connectionMode).toBe("wifi");
    expect(client.deviceName).toBe("NIIMBOT K3W");
    // 关键回归：走 selectPrinter 正是用户之前报错误码 23 的原因
    expect(socket.sent("selectPrinter")).toBe(false);
    expect(socket.sent("getAllPrinters")).toBe(false);
  });

  it("discoverWifi 无设备：可读错误覆盖 2.4GHz / 同网段 / 防火墙", async () => {
    const client = new NiimbotPrinter({ socketFactory: () => new FakeSocket({ wifiDevices: [] }) });
    const error = (await client.discoverWifi().catch((err: unknown) => err)) as NiimbotError;

    expect(error).toBeInstanceOf(NiimbotError);
    expect(error.message).toContain("未发现 Wi-Fi 打印机");
    expect(error.recovery).toContain("2.4GHz");
    expect(error.recovery).toContain("同一局域网");
    expect(error.recovery).toContain("防火墙");
  });
});
