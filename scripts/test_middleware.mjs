/**
 * 中间件回归测试 —— functions/_middleware.js
 *
 * 用法：node scripts/test_middleware.mjs
 *
 * 校验两件事：
 *   1) 仓库内部文件（含各种编码/归一化绕过写法）必须被拦截 → 404
 *   2) 站点正常资源（页面 / 样式 / 脚本 / 数据 JSON / 研报 MD / API）必须放行
 *
 * 一旦有人放宽中间件规则导致内部文件可下载，本测试会立刻失败。
 */

import { onRequest } from '../functions/_middleware.js';

/** 必须拦截：仓库内部文件，含常见绕过写法 */
const SHOULD_BLOCK = [
  // 精确文件
  '/wrangler.toml', '/%77rangler.toml', '/%2577rangler.toml', '//wrangler.toml',
  '/./wrangler.toml', '/db/../wrangler.toml', '/wrangler.toml/', '/WRANGLER.TOML',
  '/server.js', '/SERVER.JS', '/%73erver.js', '/sync_data.py', '/requirements.txt',
  '/README.md', '/readme.md', '/.gitignore', '/.nojekyll',
  '/_redirects', '/_routes.json', '/_headers',
  // 目录前缀
  '/db/seed.sql', '/db/schema.sql', '/db/seed.sql/', '/%64b/seed.sql', '/db%2Fseed.sql',
  '/scripts/pages_build.sh', '/scripts/fetch_market_pulse.py', '/scripts/..%2Fserver.js',
  '/.github/workflows/market-pulse.yml', '/.git/config',
  '/functions/api/[[route]].js',
];

/** 必须放行：站点正常资源 */
const SHOULD_PASS = [
  '/', '/index.html', '/admin.html',
  '/css/style.css',
  '/js/app.js', '/js/market-pulse.js', '/js/research.js',
  '/data/clusters.json', '/data/valuations.json', '/data/market_pulse.json',
  // 研报内容：前端 research.js 会按需读取，不能拦
  '/data/reports/v5.0/小米/05_策略裁决_小米.md',
  '/data/reports/v5.3/台积电_TSM/投资决策报告_TSMC_20260914.md',
  // API
  '/api/me', '/api/holdings', '/api/admin/users',
  // SPA 兜底与站点图标
  '/nonexistent-page', '/favicon.ico',
];

let failed = 0;

for (const [list, expect] of [[SHOULD_BLOCK, 'BLOCK'], [SHOULD_PASS, 'PASS']]) {
  for (const path of list) {
    const res = await onRequest({
      request: new Request('https://site.test' + path),
      next: () => new Response('next', { status: 200 }),
    });
    const got = res.status === 404 ? 'BLOCK' : 'PASS';
    if (got !== expect) {
      failed++;
      console.log(`❌ ${path}  期望 ${expect}，实际 ${got}`);
    }
  }
}

if (failed === 0) {
  console.log(
    `✅ 中间件回归测试全通过（拦截 ${SHOULD_BLOCK.length} 项 / 放行 ${SHOULD_PASS.length} 项）`
  );
  process.exit(0);
} else {
  console.log(`❌ 失败 ${failed} 项`);
  process.exit(1);
}
