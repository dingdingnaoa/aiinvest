/**
 * 内部文件拦截 —— 兜底防线
 *
 * 正常情况下发布目录是 dist/，仓库内部文件根本不在产物里，这一层用不上。
 * 但只要发布目录被误设成仓库根（"."），db/、scripts/、server.js、sync_data.py、
 * wrangler.toml 等就会全部变成可下载。本中间件专门堵这个口子。
 *
 * 为什么不用 _redirects：实测它会被百分号编码绕过 ——
 *   /wrangler.toml   → 302 拦截 ✅
 *   /%77rangler.toml → 200 原文件 ❌
 * 中间件拿到的是运行时解码后的 pathname，不存在这个问题。
 */

// 目录级：整个前缀一律拒绝
const DENY_PREFIXES = [
  '/db/',
  '/scripts/',
  '/.github/',
  '/.git/',
  '/functions/',
];

// 文件级：精确匹配
const DENY_FILES = [
  '/wrangler.toml',
  '/server.js',
  '/sync_data.py',
  '/requirements.txt',
  '/README.md',
  '/.gitignore',
  '/.nojekyll',
  '/_redirects',
  '/_routes.json',
];

// 后缀级：站点本身不会有这些类型的可访问资源
const DENY_EXTENSIONS = [
  '.py', '.sql', '.sh', '.toml',
  '.md', '.yml', '.yaml', '.txt',
  '.zip', '.log', '.bak',
];

export async function onRequest(context) {
  try {
    const { pathname } = new URL(context.request.url);
    const p = pathname.toLowerCase();

    const blocked =
      DENY_PREFIXES.some((x) => p.startsWith(x)) ||
      DENY_FILES.includes(p) ||
      DENY_EXTENSIONS.some((x) => p.endsWith(x));

    if (blocked) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  } catch {
    // 兜底逻辑本身出错时不要影响站点，直接放行
  }
  return context.next();
}
