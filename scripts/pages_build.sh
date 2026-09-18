#!/usr/bin/env bash
# ============================================================
# Cloudflare Pages 构建脚本
#
# 只把「站点静态资源」复制到 dist/，使仓库内部文件（db/、scripts/、
# server.js、sync_data.py、wrangler.toml、requirements.txt、README.md、
# .github/ 等）不进入发布目录，从而不会被任何人通过 HTTP 下载。
#
# 配套 Pages 项目设置：
#   Build command          = bash scripts/pages_build.sh
#   Build output directory = dist
#
# 注意：functions/ 必须留在仓库根目录（Cloudflare 自行读取），
#       不要复制进 dist/。
# ============================================================
set -euo pipefail

OUT="dist"

echo "→ 清理并重建 $OUT/"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "→ 复制站点静态资源"
cp index.html admin.html "$OUT"/
cp -r css js data "$OUT"/

echo "→ 产物清单（$OUT/）"
find "$OUT" -type f | sort
echo "→ 文件数：$(find "$OUT" -type f | wc -l | tr -d ' ')"
