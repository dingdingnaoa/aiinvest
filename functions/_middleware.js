/**
 * 内部文件拦截 —— 兜底防线
 *
 * 正常情况下发布目录是 dist/，仓库内部文件（db/、scripts/、server.js、
 * sync_data.py、wrangler.toml、requirements.txt、README.md、.github/）物理上
 * 就不在产物里，这一层用不上。但只要发布目录被误设成仓库根（"."），它们就会
 * 全部变成可下载。本中间件专门堵这个口子。
 *
 * 为什么不用 _redirects：实测它会被百分号编码绕过 ——
 *   /wrangler.toml   → 302 拦截 ✅
 *   /%77rangler.toml → 200 原文件 ❌
 * 中间件拿到的是原始 pathname，因此这里先自行解码 + 归一化再比对。
 */

/** 目录级：整个前缀一律拒绝 */
const DENY_PREFIXES = [
  '/db/',
  '/scripts/',
  '/.github/',
  '/.git/',
  '/functions/',
];

/** 文件级：精确匹配 */
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
  '/_headers',
];

/** 后缀级：站点本身不会以这些类型对外提供资源 */
const DENY_EXTENSIONS = [
  '.py', '.sql', '.sh', '.toml',
  '.md', '.yml', '.yaml', '.txt',
  '.zip', '.log', '.bak',
];

/**
 * 把请求路径归一化成可比对的形式，堵住静态资源服务器的常见绕过写法：
 *   /%77rangler.toml      → 百分号编码
 *   /%2e%2e/wrangler.toml → 编码的点段
 *   //wrangler.toml       → 重复斜杠
 *   /./wrangler.toml      → 点段
 *   /db/../wrangler.toml  → 上跳
 */
function canonicalize(pathname) {
  let p = pathname;
  // 反复解码，覆盖 %2577 这类二次编码
  for (let i = 0; i < 4; i++) {
    let decoded;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      break; // 非法编码序列：停止解码，用现有结果比对
    }
    if (decoded === p) break;
    p = decoded;
  }

  p = p.replace(/\\/g, '/').replace(/\0/g, '');
  p = p.replace(/\/{2,}/g, '/');

  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return '/' + parts.join('/');
}

export async function onRequest(context) {
  try {
    const { pathname } = new URL(context.request.url);
    const p = canonicalize(pathname).toLowerCase();

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
