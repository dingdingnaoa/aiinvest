# AI Invest — 行研网站

个人研究型投资网站：全球 12 产业集群行研、公司卡片、估值追踪、组合管理（加密保险箱）、每日全球市场脉搏（GLOBAL MARKET PULSE）、云端账号系统（Cloudflare D1）。

## 仓库结构

> **`dist/` 是站点发布目录本身。** `wrangler.toml` 里 `pages_build_output_dir = "dist"`，
> Cloudflare Pages 直接发布该目录内容，不需要任何构建步骤。
> 仓库内部文件全部位于 `dist/` 之外，因此不可能被通过 HTTP 下载。

```
aiinvest/
├── dist/                       # ★ 发布目录（站点源码就在这里，直接改这里）
│   ├── index.html              # 主站（含登录门控 + 管理员面板）
│   ├── admin.html              # 本地管理后台（集群规则与筛选）
│   ├── css/style.css
│   ├── js/                     # 前端模块（app/auth/admin-accounts/portfolio/research/market-pulse/…）
│   └── data/                   # 网站数据（JSON）
│       ├── clusters.json / companies.json / meta.json / news.json
│       ├── research_reports.json / valuations.json
│       └── market_pulse.json   # GitHub Action 按交易时段自动刷新
│
├── functions/                  # ★ Cloudflare Pages Functions（必须在仓库根目录）
│   ├── _middleware.js          # 内部文件拦截兜底（发布目录被误设成根目录时仍不泄露）
│   └── api/[[route]].js        # 账号系统 API：注册/登录/持仓云端存取/用户管理
│
├── wrangler.toml               # ★ Pages 唯一配置源（发布目录 + D1 绑定）
├── db/                         # D1 建表与种子 SQL（内部文件）
├── scripts/                    # 运维脚本（内部文件）
│   ├── fetch_market_pulse.py   # 市场脉搏快照生成器（纯标准库）
│   ├── build_standalone.py     # 单文件版构建器（前台/后台）
│   └── pages_build.sh          # 兼容用的占位脚本（现已无需构建步骤）
├── server.js                   # 本地保存服务（只服务 dist/）
├── sync_data.py                # 方法论数据提取同步
└── .github/workflows/
    └── market-pulse.yml        # 按交易时段自动刷新快照
```

## Cloudflare Pages 配置

`wrangler.toml` 是该 Pages 项目的**唯一配置源**。只要这个文件存在，Dashboard 上的
「绑定」与「构建配置」都会显示为**只读（灰色）** —— 这是 Cloudflare 的预期行为，
不是故障。要改绑定或发布目录，请改 `wrangler.toml` 并提交，不要在 Dashboard 里改。

| 配置项 | 值 |
| --- | --- |
| 发布目录 | `dist`（由 `wrangler.toml` 的 `pages_build_output_dir` 指定） |
| 构建命令 | 空（无需构建） |
| D1 绑定变量 | `DB`（顶层 `[[d1_databases]]` 声明，同时作用于 local / 预览 / 生产） |

## 每日自动刷新

`.github/workflows/market-pulse.yml` 按交易时段定时运行 `scripts/fetch_market_pulse.py`，
把最新快照提交回 `dist/data/market_pulse.json`：

- A股/港股盘中（CST 09:00–17:00）：工作日每 30 分钟
- 美股盘中（CST 21:30–04:00）：工作日每 30 分钟
- 支持 `workflow_dispatch` 手动触发

前端优先直连数据源实时渲染，快照作为回退与历史序列（最长 120 天）累积。

## 本地运行

```bash
python3 -m http.server 8080 --directory dist   # 纯静态预览
node server.js                                 # 启用持仓保存接口（同样只服务 dist/）
# 打开 http://localhost:8080
```

## 隐私与数据边界

以下文件**永远不入库**（已在 `.gitignore` 排除），仅存在于本地：

- `dist/data/portfolio.json` — 个人持仓
- `dist/data/accounts.json` — 账号保险箱（PBKDF2 + AES-256-CTR 加密）

新仓库初始化后需本地自备这两个文件（或经后台单文件版生成）。
