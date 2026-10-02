/**
 * Markdown 按「块」切片 —— 块级就地编辑的地基。
 *
 * 核心不变量：`splitMarkdownBlocks(src).map(b => b.text).join("") === src`
 * （每个字符恰好属于一个块；start/end 是原始下标）。
 * 所以"改一块"= 只替换那一段切片，**从不重新序列化整篇**：没碰过的块逐字不变，
 * mermaid、代码块、表格、自定义语法都不会被重排；行尾（CRLF）也原样保留。
 */

export type MdBlockKind = "heading" | "fence" | "table" | "list" | "quote" | "blank" | "paragraph";

export interface MdBlock {
  /** 起始下标（含） */
  start: number;
  /** 结束下标（不含） */
  end: number;
  /** 原始切片（逐字，含块尾空行） */
  text: string;
  kind: MdBlockKind;
}

/** 围栏行（``` / ~~~，允许缩进）返回围栏字符，否则 null */
function fenceMarker(line: string): string | null {
  const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
  return m ? m[1][0] : null;
}

function kindOf(line: string): MdBlockKind {
  if (!line.trim()) return "blank";
  if (fenceMarker(line)) return "fence";
  if (/^\s{0,3}#{1,6}\s/.test(line)) return "heading";
  if (/^\s*\|/.test(line)) return "table";
  if (/^\s{0,3}>/.test(line)) return "quote";
  if (/^\s*([-*+]|\d+[.)])\s/.test(line)) return "list";
  return "paragraph";
}

/**
 * 切块规则（够用且可预测）：
 * - 围栏代码块：从开围栏到闭围栏算一块，内部绝不切（mermaid 也在里面）
 * - 标题（ATX）：每行单独成块
 * - 其余：连续同类型的非空行算一块（段落 / 列表 / 引用 / 表格）
 * - 空行粘在**前一块**尾巴上 → 切片首尾相接，拼起来就是原文
 */
export function splitMarkdownBlocks(source: string): MdBlock[] {
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const blocks: MdBlock[] = [];
  let cur: { start: number; text: string; kind: MdBlockKind } | null = null;
  let fence: string | null = null;
  let offset = 0;
  /** 当前块后面是否已经出现过空行（空行是块的分隔符，不能再往后并块） */
  let separated = false;

  const flush = () => {
    if (cur) blocks.push({ start: cur.start, end: cur.start + cur.text.length, text: cur.text, kind: cur.kind });
    cur = null;
    separated = false;
  };
  const open = (line: string, kind: MdBlockKind) => { flush(); cur = { start: offset, text: line, kind }; };

  for (const line of lines) {
    const marker = fenceMarker(line);
    if (fence) {
      cur!.text += line;
      if (marker === fence) { fence = null; flush(); }
    } else if (marker) {
      open(line, "fence");
      fence = marker;
    } else if (!line.trim()) {
      if (cur) { cur.text += line; separated = true; }
      else cur = { start: offset, text: line, kind: "blank" };
    } else {
      const kind = kindOf(line);
      if (cur && !separated && cur.kind === kind && kind !== "heading") cur.text += line;
      else open(line, kind);
      separated = false;
    }
    offset += line.length;
  }
  flush();
  return blocks;
}

/** 块的正文部分（去掉尾部的换行与空行）—— 编辑框里给用户看的就是它 */
export function blockContent(block: MdBlock): string {
  const contentEnd = block.text.search(/\s*$/);
  return contentEnd === -1 ? block.text : block.text.slice(0, contentEnd);
}

/**
 * 用新的块内容替换原切片：其余字符**逐字**（含行尾与空行）保留。
 * 新内容尾部的空白会被裁掉，并沿用原来的行尾（\n 还是 \r\n）与空行数量。
 */
export function replaceBlock(source: string, block: MdBlock, next: string): string {
  const contentEnd = block.text.search(/\s*$/);
  const trailing = block.text.slice(contentEnd === -1 ? block.text.length : contentEnd);
  const nl = trailing.startsWith("\r\n") ? "\r\n" : trailing.includes("\n") ? "\n" : "";
  const blank = nl ? trailing.slice(nl.length) : trailing;
  const cleaned = next.replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
  return source.slice(0, block.start) + cleaned + nl + blank + source.slice(block.end);
}
