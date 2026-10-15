/** 平面图编辑器快捷键：Ctrl+Z/Y 撤销重做、Ctrl+C/V 复制粘贴、Delete 删除选中
 *  ⚠️ 所有快捷键共用一个焦点守卫 `shouldIgnoreClipboard`：焦点在 input/textarea/select/
 *  contenteditable 时必须**整体让路**——否则用户在输入框里复制物料名称、按 Ctrl+Z 都会被劫持。 */
import { useEffect } from "react";
import { shouldIgnoreClipboard } from "./layoutClipboard";

export function usePlannerShortcuts(
  selected: string | null,
  onUndo: () => void,
  onRedo: () => void,
  onDelete: () => void,
  onCopy?: () => void,
  onPaste?: () => void,
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreClipboard(e.target as Element | null)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
      } else if (mod && key === "y") {
        e.preventDefault();
        onRedo();
      } else if (mod && key === "c") {
        if (!onCopy) return;
        e.preventDefault();
        onCopy();
      } else if (mod && key === "v") {
        if (!onPaste) return;
        e.preventDefault();
        onPaste();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        onDelete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onUndo, onRedo, onDelete, onCopy, onPaste]);
}
