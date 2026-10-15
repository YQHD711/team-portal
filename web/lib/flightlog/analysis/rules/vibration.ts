/**
 * 规则 1：振动超标（分 IMU）—— 规则对象与编排。
 *
 * 构造拆在：
 *  - `vibrationFinding.ts`：常规飞行段（**已排除降落段**）的结论 + 图表 + 证据；
 *  - `vibrationLanding.ts`：降落/触地段的独立结论（真坠机/饱和冲击单列）。
 * 指标扫描在 `../vibrationIndicators.ts`（与滤波规则共用同一份证据）。
 *
 * 数据来源 VIBE（飞控内部在原始 1 kHz 加速度上算出的振动水平，日志里约 10 Hz）。
 * 三个独立信号交叉验证：① 各轴标准差（持续振动）② 峰值（瞬时冲击）③ clip 增量（饱和次数）。
 * 实测标定（6 份真实日志）：健康机 std 0.68~3.31、clip 恒为 0；故障机 clip 增量 62~192。
 */

import type { Finding } from "../../types/report";
import type { Rule } from "../../types/rule";
import { improvementStep, unknownWithAdvice } from "./tuningSteps";
import { scanVibration } from "../vibrationIndicators";
import { buildFinding, VIB_DOC, VIB_RULE_ID, VIB_TITLE } from "./vibrationFinding";
import { landingFinding } from "./vibrationLanding";

export const vibrationRule: Rule = {
  id: VIB_RULE_ID,
  title: VIB_TITLE,
  category: "vibration",
  appliesTo: [
    {
      platform: "ardupilot",
      requires: ["VIBE"],
      note: "ArduPilot 各机型均记录 VIBE；旧固件（<3.4）可能没有",
    },
  ],
  run(ctx) {
    const scan = scanVibration(ctx);
    if (scan.unavailable) {
      return [
        unknownWithAdvice({
          ruleId: VIB_RULE_ID,
          title: VIB_TITLE,
          status: "insufficient_data",
          reason: scan.unavailable,
          docLinks: [VIB_DOC],
          suggestions: [
            improvementStep({
              signature: "无法扫描振动（缺少 VIBE 或有效飞行段）",
              current: scan.unavailable,
              direction: "确认日志含 VIBE 且有一段有效 arm 窗口后复飞重采；若机型本身不记录 VIBE，则本条只能判「无法判断」",
              missing: "没有 VIBE 序列就无法给出任何振动数值",
              verify: "重采日志后本条从「无法判断」变为有依据的通过/警告",
              doc: VIB_DOC,
            }),
          ],
        }),
      ];
    }
    const imuCount = scan.indicators.length;
    const findings: Finding[] = [];
    for (const ind of scan.indicators) {
      findings.push(buildFinding(ind, imuCount));
      const landing = landingFinding(ind);
      if (landing) findings.push(landing);
    }
    return findings;
  },
};
