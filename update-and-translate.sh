#!/bin/bash
# ArduPilot 文档多子站增量翻译(容器内 ENTRYPOINT)
#
# 用法:
#   DEEPSEEK_API_KEY=sk-xxx \
#   SRC_DIR=/work/src OUT_DIR=/work/out \
#     update-and-translate.sh
#
# 自动检测 SRC_DIR 下所有含 source/conf.py + source/index.rst 的子站,
# 对每个跑 sphinx-build → translate_html.py(增量) → 复制资源。
#
# 目录结构:
#   $SRC_DIR/{wiki}/source/        ← sphinx 源码
#   $OUT_DIR/{wiki}/build/doctrees/  ← sphinx 增量缓存(保留)
#   $OUT_DIR/{wiki}/build/html/    ← 英文 HTML(中间产物,跑完清理)
#   $OUT_DIR/{wiki}.zh/build/html/ ← 中文 HTML(nginx serve)

set -e

SRC_DIR="${SRC_DIR:-/work/src}"
OUT_DIR="${OUT_DIR:-/work/out}"

if [ ! -d "$SRC_DIR" ]; then
    echo "ERROR: SRC_DIR=$SRC_DIR 不存在"
    exit 1
fi
mkdir -p "$OUT_DIR"

# WIKIS 环境变量可手动指定子站(逗号分隔),用于测试或单子站重译
# 不指定则自动检测 SRC_DIR 下所有含 source/conf.py + source/index.rst 的子目录
if [ -n "${WIKIS:-}" ]; then
    IFS=',' read -ra wikis <<< "$WIKIS"
    echo "WIKIS 手动指定: ${wikis[*]}"
else
    wikis=()
    for src in "$SRC_DIR"/*/source; do
        [ -f "$src/conf.py" ] || continue
        [ -f "$src/index.rst" ] || continue
        wiki=$(basename "$(dirname "$src")")
        wikis+=("$wiki")
    done
fi

if [ ${#wikis[@]} -eq 0 ]; then
    echo "ERROR: 未检测到任何子站(无 source/conf.py + source/index.rst,且 WIKIS 未指定)"
    exit 1
fi

echo "待翻译子站 ${#wikis[@]} 个: ${wikis[*]}"
echo ""

fail_count=0
for wiki in "${wikis[@]}"; do
    src="$SRC_DIR/$wiki/source"
    en="$OUT_DIR/$wiki/build/html"
    doctrees="$OUT_DIR/$wiki/build/doctrees"
    zh="$OUT_DIR/$wiki.zh/build/html"

    echo "================================================"
    echo "  [$wiki] sphinx-build"
    echo "================================================"
    mkdir -p "$en" "$doctrees"
    if ! sphinx-build -b html -d "$doctrees" "$src" "$en" 2>&1 | tail -8; then
        echo "  [$wiki] sphinx-build 失败,跳过翻译"
        fail_count=$((fail_count + 1))
        rm -rf "$en"
        continue
    fi

    echo "  [$wiki] translate (增量,跳过 hash 未变的 HTML)"
    mkdir -p "$zh"
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:?required}" \
    python3 /usr/local/bin/translate_html.py "$en" "$zh" || true

    echo "  [$wiki] copy resources"
    for d in _images _static _video_thumbnail; do
        if [ -d "$en/$d" ]; then
            cp -r "$en/$d" "$zh/"
        fi
    done

    # 清理中间英文 HTML(保留 doctrees 加速下次 build)
    rm -rf "$en"
    echo ""
done

echo "================================================"
echo "  全部完成"
echo "================================================"
echo "产物:"
ls -1 "$OUT_DIR" | sed 's/^/  /'
echo ""
echo "失败子站数: $fail_count / ${#wikis[@]}"
exit 0
