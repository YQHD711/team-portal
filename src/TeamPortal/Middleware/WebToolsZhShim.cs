using System.Text.RegularExpressions;

namespace TeamPortal.Middleware;

/// <summary>
/// WebTools 中文界面补充（注入脚本）。
///
/// 背景：WebTools 有 20+ 个工具页，其中一部分已人工汉化（index/大部分工具），
/// 仍有页面（如 AirspeedFit）和零散标签是英文。这里不做整页重写，而是注入一个**精确匹配**的
/// 词典翻译层：只翻译词典里完全一致的文本节点/placeholder/title/aria-label，
/// 数字、参数名、URL、用户数据不会被误翻；MutationObserver 覆盖动态渲染的节点。
///
/// 右侧固定「EN / 中文」按钮可切换并写入 localStorage；默认跟随浏览器语言（zh 开头则翻译）。
/// 词典维护：新增条目即可，无需改动页面 HTML。
/// </summary>
public static class WebToolsZhShim
{
    internal const string Marker = "<!-- webtools-zh-shim -->";

    /// <summary>英文原文 → 简体中文。键必须与页面文本完全一致（区分大小写）。</summary>
    internal const string DictionaryJson = "{\"ArduPilot AirspeedFit in flight airspeed calibration\":\"ArduPilot AirspeedFit 飞行空速校准\",\"This tool takes a .bin log and estimates the airspeed ratio calibration (ARSPD_RATIO) for each airspeed sensor. The GPS/EKF ground velocity minus an estimated wind gives the true airspeed used as the truth source, and the ratio is fitted so each sensor's airspeed matches it over the selected window.\":\"本工具读取 .bin 日志，为每个空速传感器估算空速比例校准值（ARSPD_RATIO）。用 GPS/EKF 地速减去估算风速得到真实空速作为基准，在所选时间窗口内拟合比例，使各传感器空速与基准一致。\",\"Setup\":\"设置\",\"Analysis time\":\"分析时间\",\"Start (s)\":\"开始 (秒)\",\"End (s)\":\"结束 (秒)\",\"Velocity source\":\"速度来源\",\"Air temperature\":\"空气温度\",\"Source\":\"来源\",\"°C at ground\":\"地面温度 (°C)\",\"Flight Data\":\"飞行数据\",\"Airspeed sensors\":\"空速传感器\",\"Expected vs measured airspeed\":\"期望空速与实际空速对比\",\"Residuals\":\"残差\",\"Calibration RMS error\":\"校准 RMS 误差\",\"Wind model\":\"风模型\",\"Wind process noise q\":\"风过程噪声 q\",\"Hit Calculate to see results.\":\"点击「计算」查看结果。\",\"Calculate\":\"计算\",\"Choose file\":\"选择文件\",\"Open In\":\"打开到\",\"Log\":\"日志\",\"Linear\":\"线性\",\"Reference\":\"参考\",\"Reference Box\":\"参考框\",\"Popper Box\":\"弹窗框\",\"un-wrapped\":\"未缠绕\",\"Phase scale\":\"相位刻度\",\"Number of Motors\":\"电机数量\",\"Throttle Based\":\"基于油门\",\"ESC Telemetry\":\"电调遥测\",\"ESC RPM\":\"电调转速\",\"RPM/EFI Based\":\"基于转速/EFI\",\"Throttle\":\"油门\",\"Attitude Controller Notch Parameters\":\"姿态控制器陷波参数\",\"Bare Aircraft\":\"裸机\",\"Frequency scale\":\"频率刻度\",\"Attitude Disturbance Rejection\":\"姿态抗扰\",\"INS Settings\":\"INS 设置\",\"Gain scale\":\"增益刻度\",\"Rate Stability\":\"角速率稳定性\",\"Attitude Controller with Feedforward\":\"带前馈的姿态控制器\",\"Attitude Controller without feedforward\":\"不带前馈的姿态控制器\",\"System ID Runs\":\"系统辨识运行\",\"Calculated vs. Predicted Comparison\":\"计算值与预测值对比\",\"Use Attitude to Improve Coherence\":\"用姿态数据提高相干性\",\"Attitude Stability\":\"姿态稳定性\",\"Entire System Stability\":\"全系统稳定性\",\"Graph Settings\":\"图表设置\",\"Input Shaping\":\"输入整形\",\"Rate Controller\":\"角速率控制器\",\"Attitude Controller Parameters\":\"姿态控制器参数\",\"Control Loop\":\"控制回路\",\"Gyro 1\":\"陀螺仪 1\",\"Gyro 2\":\"陀螺仪 2\",\"Gyro 3\":\"陀螺仪 3\",\"Gyro instance\":\"陀螺仪实例\",\"Axis\":\"轴\",\"Notch 1\":\"陷波 1\",\"Notch 2\":\"陷波 2\",\"Window size (s):\":\"窗口大小 (秒)：\",\"Frequency resolution:\":\"频率分辨率：\",\"Logging rate:\":\"记录速率：\",\"Raw IMU Logging setup\":\"原始 IMU 记录设置\",\"Show individual components\":\"显示各分量\",\"Loop Rate\":\"循环速率\",\"PID component\":\"PID 分量\",\"Filtering\":\"滤波\",\"Title\":\"标题\",\"Pre\":\"前\",\"Post\":\"后\",\"Pitch\":\"俯仰\",\"Roll\":\"横滚\",\"Yaw\":\"偏航\",\"Composition\":\"构成\",\"Message Rates\":\"消息速率\",\"Time and size\":\"时间与大小\",\"Bits per second\":\"比特率\",\"Messages per second\":\"每秒消息数\",\"Total Rate\":\"总速率\",\"Connection Settings\":\"连接设置\",\"Dashboard settings\":\"仪表盘设置\",\"Widget Editor\":\"组件编辑器\",\"Save and load\":\"保存与加载\",\"Server address\":\"服务器地址\",\"Background color:\":\"背景色：\",\"Columns:\":\"列数：\",\"Rows:\":\"行数：\",\"Enable widget edit:\":\"启用组件编辑：\",\"Save dashboard:\":\"保存仪表盘：\",\"Load dashboard or widget:\":\"加载仪表盘或组件：\",\"FPS:\":\"帧率：\",\"FPS\":\"帧率\",\"Codec:\":\"编码：\",\"Flight time:\":\"飞行时间：\",\"Date:\":\"日期：\",\"Synchronise ArduPilot DataFlash log telemetry with video footage and export a composited video with telemetry overlay. Load a .bin log file and video, arrange widgets, set the sync offset, then export.\":\"将 ArduPilot DataFlash 日志遥测与视频画面对齐，并导出带遥测叠加的合成视频。加载 .bin 日志与视频，布置组件、设置同步偏移后导出。\",\"Output:\":\"输出：\",\"Outputs:\":\"输出：\",\"Transfer function\":\"传递函数\",\"State Space\":\"状态空间\",\"Numerator:\":\"分子：\",\"Denominator:\":\"分母：\",\"Symbolic params:\":\"符号参数：\",\"Number of params:\":\"参数数量：\",\"Number of Constraints:\":\"约束数量：\",\"Generate fields\":\"生成字段\",\"Start frequency (rad/sec):\":\"起始频率 (rad/秒)：\",\"End frequency (rad/sec):\":\"结束频率 (rad/秒)：\",\"Submit\":\"提交\",\"The following form will display the attenuation and phase lag for an ArduPilot 4.2 filter setup.\":\"下面的表单显示 ArduPilot 4.2 滤波器设置的衰减与相位滞后。\",\"Many thanks to\":\"特别感谢\",\"for the DFU code!\":\"提供的 DFU 代码！\",\"Hide Visual Test\":\"隐藏可视化测试\",\"Basic Visual Test\":\"基础可视化测试\",\"Rad/s\":\"弧度/秒\",\"ArduPilot DFU Uploader\":\"ArduPilot DFU 上传器\",\"This tool takes a .bin log and estimates the airspeed ratio calibration (ARSPD_RATIO) for each airspeed sensor. The GPS/EKF ground velocity minus an estimated wind gives the true airspeed used as the truth source, and the ratio is fitted so each sensor's airspeed matches it over the selected window. This is the same relationship ArduPilot's in-flight autocalibration uses, but solved offline (forward and backward in time). For best results select a window with heading changes (turns or a loiter); a single straight cruise leg cannot separate the wind from the airspeed scale.\":\"本工具读取 .bin 日志，为每个空速传感器估算空速比例校准值（ARSPD_RATIO）。用 GPS/EKF 地速减去估算风速得到真实空速作为基准，在所选时间窗口内拟合比例，使各传感器空速与基准一致。这与 ArduPilot 飞行中的自动校准原理相同，只是离线求解（在时间上前后双向拟合）。为获得最佳结果，请选择包含航向变化（转弯或盘旋）的时间窗口；单段直线巡航无法区分风速与空速比例。\"}";

    internal static readonly string Script = Marker + "\n" + Js.Replace("__DICT__", DictionaryJson) + "\n";

    private const string Js = @"<script>
(function () {
  var DICT = __DICT__;
  var KEY = ""webtools-zh"";
  var enabled = (function () {
    try {
      var v = localStorage.getItem(KEY);
      if (v === ""0"") return false;
      if (v === ""1"") return true;
    } catch (e) { /* 隐私模式 */ }
    return (navigator.language || """").toLowerCase().indexOf(""zh"") === 0;
  })();
  var SKIP = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, NOSCRIPT: 1, SVG: 1, CANVAS: 1 };
  var origText = new WeakMap();
  var origAttrs = new WeakMap();
  var ATTRS = [""placeholder"", ""title"", ""aria-label""];
  function tr(v) {
    if (typeof v !== ""string"") return null;
    var lead = v.match(/^\s*/)[0];
    var tail = v.match(/\s*$/)[0];
    var core = v.trim();
    if (!core) return null;
    var hit = DICT[core];
    return hit === undefined ? null : lead + hit + tail;
  }
  function doText(node) {
    if (!enabled) return;
    var p = node.parentNode;
    if (!p || SKIP[p.nodeName]) return;
    var r = tr(node.nodeValue);
    if (r === null) return;
    if (!origText.has(node)) origText.set(node, node.nodeValue);
    node.nodeValue = r;
  }
  function doEl(el) {
    if (!enabled) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      var r = tr(v);
      if (r === null) continue;
      var m = origAttrs.get(el) || {};
      if (!(a in m)) m[a] = v;
      origAttrs.set(el, m);
      el.setAttribute(a, r);
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP[root.nodeName]) return;
    doEl(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else if (!SKIP[n.nodeName]) doEl(n);
    }
  }
  function start() {
    walk(document.body);
    var obs = new MutationObserver(function (list) {
      if (!enabled) return;
      var added = [];
      for (var i = 0; i < list.length; i++) {
        var ns = list[i].addedNodes;
        for (var j = 0; j < ns.length; j++) {
          var n = ns[j];
          if (n.nodeType === 1 || n.nodeType === 3) added.push(n);
        }
      }
      if (!added.length) return;
      window.clearTimeout(window.__webtoolsZhTimer);
      window.__webtoolsZhTimer = window.setTimeout(function () {
        for (var k = 0; k < added.length; k++) walk(added[k]);
      }, 100);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    var btn = document.createElement(""button"");
    btn.type = ""button"";
    btn.textContent = enabled ? ""EN"" : ""中文"";
    btn.title = enabled ? ""切换为英文"" : ""切换为中文"";
    btn.setAttribute(""data-webtools-zh-toggle"", ""1"");
    btn.style.cssText = ""position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:999px;border:1px solid rgba(0,0,0,.2);background:#fff;color:#0f172a;font:12px/1 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.15);cursor:pointer;opacity:.85"";
    btn.onclick = function () {
      try { localStorage.setItem(KEY, enabled ? ""0"" : ""1""); } catch (e) { /* ignore */ }
      location.reload();
    };
    document.body.appendChild(btn);
  }
  if (document.body) start();
  else document.addEventListener(""DOMContentLoaded"", start);
})();
</script>";

    private static readonly Regex HeadOpen = new(@"<head\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>注入翻译脚本（幂等）。优先 head 之后，其次 &lt;/body&gt; 前，最后追加。</summary>
    internal static string Inject(string html)
    {
        if (string.IsNullOrEmpty(html) || html.Contains(Marker, StringComparison.Ordinal)) return html;

        var head = HeadOpen.Match(html);
        if (head.Success) return html.Insert(head.Index + head.Length, "\n" + Script);

        var bodyClose = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (bodyClose >= 0) return html.Insert(bodyClose, Script);

        return html + Script;
    }
}
