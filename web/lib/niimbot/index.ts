/**
 * 精臣 NIIMBOT 打印 SDK（vendor 自官方包 web-4.2.1_20260902）。
 * 只导出业务需要的入口，避免页面直接摸到底层 Socket/协议细节。
 */
export {
  NiimbotPrinter, parseUsbDevices, parseWifiDevices,
  type NiimbotClientOptions, type NiimbotPrintOptions, type NiimbotProgress,
} from "./client";
export { runPrintJob, runPrintJobPages, type PrintJobProgress } from "./printJob";
export { mapLabelToPrintPage, mapLabelElement, ptToMm, horizontalAlign, isK3wCommonSize, k3wSizeWarning, K3W_COMMON_SIZE } from "./labelMapping";
export { friendlyError, NiimbotError, noWifiDevicesError, serviceUnavailableError, type NiimbotStage } from "./errors";
export type { NiimbotPrintPage, NiimbotPrintElement, PrinterDevice, WifiPrinterDevice } from "./protocol";
