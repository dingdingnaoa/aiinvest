# AI Invest — 行研网站

个人研究型投资网站:全球 12 产业集群行研、公司卡片、估值追踪、组合管理(加密保险箱)、每日全球市场脉搏(GLOBAL MARKET PULSE)。

## 仓库结构

```
aiinvest/
├── index.html                  # 主站(含登录门控 + 管理员面板)
├── admin.html                  # 本地管理后台(集群规则与筛选)
├── server.js                   # 本地保存服务(POST /api/save-portfolio)
├── sync_data.py                # 方法论数据提取同步
├── css/style.css
├── js/                         # 前端模块(app/auth/admin-accounts/portfolio/research/market-pulse/...)
├── data/                       # 网站数据(JSON)
│   ├── clusters.json / companies.json / meta.json / news.json
│   ├── research_reports.json / valuations.json
│   └── market_pulse.json       # GitHub Action 每日自动刷新
├── scripts/
│   ├── fetch_market_pulse.py   # 市场脉搏快照生成器(纯标准库)
│   └── build_standalone.py     # 单文件版构建器(前台/后台)
└── .github/workflows/
    └── market-pulse.yml        # 每日自动刷新 workflow
```

## 每日自动刷新

`.github/workflows/market-pulse.yml` 按交易时段定时运行 `scripts/fetch_market_pulse.py`,
把最新快照提交回 `data/market_pulse.json`:

- A股/港股盘中(CST 09:00–17:00):工作日每 30 分钟
- 美股盘中(CST 21:30–04:00):工作日每 30 分钟
- 支持 `workflow_dispatch` 手动触发

前端优先直连数据源实时渲染,快照作为回退与历史序列(最长 120 天)累积。

## 本地运行

```bash
python3 -m http.server 8080        # 或 node server.js(启用持仓保存接口)
# 打开 http://localhost:8080
```

## 隐私与数据边界

以下文件**永远不入库**(已在 `.gitignore` 排除),仅存在于本地:

- `data/portfolio.json` — 个人持仓
- `data/accounts.json` — 账号保险箱(PBKDF2 + AES-256-CTR 加密)

新仓库初始化后需本地自备这两个文件(或经后台单文件版生成)。
