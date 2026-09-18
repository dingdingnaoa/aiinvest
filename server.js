/**
 * AI Invest 本地保存服务
 * - 静态托管本仓库目录
 * - POST /api/save-portfolio : 接收网页保存的持仓，写入 data/portfolio.json 并记录日志
 * - GET  /api/status          : 健康检查
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SITE = path.join(ROOT, 'dist');   // 站点发布目录（与 Cloudflare Pages 的发布目录一致）
const PORT = parseInt(process.env.PORT || '8080', 10);
const LOG = '/tmp/portfolio_saves.log';
const PORTFOLIO = path.join(SITE, 'data', 'portfolio.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* ignore */ }
}

const server = http.createServer((req, res) => {
  // CORS：允许 file:// (Origin: null) 与任何来源
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'gansiwande-save', port: PORT }));
  }

  if (req.method === 'POST' && url === '/api/save-portfolio') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!Array.isArray(data.holdings)) throw new Error('holdings 必须为数组');
        // 清洗：只保留必要字段，防止注入任意字段
        const holdings = data.holdings.map(p => ({
          id: String(p.id || ''), name: String(p.name || ''),
          ticker: String(p.ticker || ''), shares: Number(p.shares) || null,
          cost: Number(p.cost) || null, note: String(p.note || ''),
          createdAt: p.createdAt || null, updatedAt: p.updatedAt || null
        }));
        const clean = {
          version: '1.0',
          updated_at: new Date().toISOString().slice(0, 19),
          note: '用户实际持仓数据库（网页一键保存）',
          holdings
        };
        fs.writeFileSync(PORTFOLIO, JSON.stringify(clean, null, 2), 'utf-8');
        log(`SAVE holdings=${holdings.length} names=${holdings.map(h => h.name).join(',')}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, updated_at: clean.updated_at, count: holdings.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  // 静态文件（只服务 dist/，仓库内部文件永不对外）
  const rel = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '');
  let filePath = path.join(SITE, rel);
  if (!filePath.startsWith(SITE)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found: ' + url); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => log(`server listening on :${PORT} site=${SITE}`));
