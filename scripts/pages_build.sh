#!/usr/bin/env bash
# ============================================================
# Cloudflare Pages 构建脚本（占位，实际已无需构建步骤）
#
# 仓库结构已调整为：dist/ 就是站点发布目录本身
#   dist/index.html、dist/admin.html、dist/css/、dist/js/、dist/data/
#
# wrangler.toml 里 pages_build_output_dir = "dist"，Pages 直接发布该目录，
# 所以不再需要任何复制步骤。
#
# 本文件保留，仅为兼容「Pages 项目里可能残留的 Build command 配置」：
# 万一 Dashboard 的 Build command 指向本脚本，它会正常退出（exit 0），
# 不改变发布结果。
#
# 仓库内部文件（db/、scripts/、server.js、sync_data.py、wrangler.toml、
# requirements.txt、README.md、.github/）全部位于 dist/ 之外，不会进入产物。
# ============================================================
set -euo pipefail

OUT="dist"

if [ ! -d "$OUT" ]; then
  echo "✗ 未找到发布目录 $OUT/ —— 它必须存在于仓库中" >&2
  exit 1
fi

echo "→ $OUT/ 即站点发布目录，无需构建"
echo "→ 产物文件数：$(find "$OUT" -type f | wc -l | tr -d ' ')"
