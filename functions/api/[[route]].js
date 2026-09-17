/* ============================================================
 * functions/api/[[route]].js — AI Invest 账号系统后端
 * 平台:Cloudflare Pages Functions + D1(SQLite)
 *
 * 端点:
 *   POST /api/register   开放注册(任何人可注册)
 *   POST /api/login      登录 → httpOnly Cookie 会话
 *   POST /api/logout     退出
 *   GET  /api/me         当前会话信息
 *   GET  /api/holdings   读自己的持仓
 *   PUT  /api/holdings   保存自己的持仓(≤128KB)
 *   GET  /api/admin/users       (admin)用户列表
 *   DELETE /api/admin/users/:id (admin)删除用户
 *
 * 安全:
 *   - 密码 PBKDF2-SHA256 25000 迭代(Workers 免费 CPU 限额内)
 *   - 会话 token 32B 随机,存 D1,7 天过期,httpOnly Cookie
 *   - 注册/登录限速(D1 计数)
 * ============================================================ */

const COOKIE = 'aiinvest_session';
const SESSION_DAYS = 7;
const PBKDF2_ITER = 25000;
const MAX_HOLDINGS_BYTES = 128 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function err(msg, status = 400) { return json({ error: msg }, status); }

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBuf(saltHex), iterations: PBKDF2_ITER },
    key, 256);
  return toHex(bits);
}

function randomHex(nBytes) { return toHex(crypto.getRandomValues(new Uint8Array(nBytes))); }

function sessionCookie(token, days) {
  const maxAge = Math.floor(days * 86400);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function getSession(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})'));
  if (!m) return null;
  const row = await env.DB.prepare(
    `SELECT s.token, s.expires_at, u.id, u.username, u.display_name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(m[1]).first();
  return row || null;
}

/* ---------- 限速(key = ip:action,滑动窗口计数) ---------- */
async function rateLimited(env, ip, action, limit, windowMin) {
  const key = `${ip}:${action}`;
  await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, datetime('now'), 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN datetime('now','localtime') > datetime(window_start, 'localtime', '+${windowMin} minutes')
                    THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN datetime('now','localtime') > datetime(window_start,'localtime','+${windowMin} minutes')
                    THEN datetime('now') ELSE window_start END`
  ).bind(key).run();
  const row = await env.DB.prepare(`SELECT count FROM rate_limits WHERE key = ?`).bind(key).first();
  return !row || row.count > limit;
}

function getIp(request) {
  return (request.headers.get('CF-Connecting-IP') || 'unknown').trim();
}

const USERNAME_RE = /^[\w\u4e00-\u9fa5]{2,20}$/u;

/* ============================================================ */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method.toUpperCase();

  if (!env.DB) return err('数据库未绑定(检查 D1 binding: DB)', 500);

  try {
    /* ---------- 注册 ---------- */
    if (route === 'register' && method === 'POST') {
      const ip = getIp(request);
      if (await rateLimited(env, ip, 'register', 10, 60)) return err('注册过于频繁,请一小时后再试', 429);

      const body = await request.json().catch(() => null);
      const username = (body?.username || '').trim();
      const password = body?.password || '';
      const displayName = (body?.display_name || '').trim().slice(0, 20);

      if (!USERNAME_RE.test(username)) return err('用户名需 2-20 位(中文/字母/数字/下划线)');
      if (password.length < 8) return err('密码至少 8 位');
      if (password.length > 72) return err('密码过长');

      const exists = await env.DB.prepare(`SELECT id FROM users WHERE username = ?`).bind(username).first();
      if (exists) return err('用户名已被注册');

      const salt = randomHex(16);
      const hash = await hashPassword(password, salt);
      const r = await env.DB.prepare(
        `INSERT INTO users (username, display_name, role, pwd_salt, pwd_hash)
         VALUES (?, ?, 'user', ?, ?)`
      ).bind(username, displayName || username, salt, hash).run();

      const token = randomHex(32);
      await env.DB.prepare(
        `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
      ).bind(token, r.meta.last_row_id).run();

      await env.DB.prepare(
        `INSERT INTO holdings (user_id, data) VALUES (?, ?)`
      ).bind(r.meta.last_row_id, JSON.stringify({ positions: [], trades: [], updated_at: new Date().toISOString().slice(0, 10) })).run();

      return json({ ok: true, user: { id: r.meta.last_row_id, username, display_name: displayName || username, role: 'user' } },
        201, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS) });
    }

    /* ---------- 登录 ---------- */
    if (route === 'login' && method === 'POST') {
      const ip = getIp(request);
      if (await rateLimited(env, ip, 'login', 30, 60)) return err('尝试过于频繁,请一小时后再试', 429);

      const body = await request.json().catch(() => null);
      const username = (body?.username || '').trim();
      const password = body?.password || '';
      if (!username || !password) return err('请输入用户名和密码');

      const u = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first();
      if (!u) return err('用户名或密码错误', 401);
      const hash = await hashPassword(password, u.pwd_salt);
      if (hash !== u.pwd_hash) return err('用户名或密码错误', 401);

      const token = randomHex(32);
      await env.DB.prepare(
        `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
      ).bind(token, u.id).run();

      return json({ ok: true, user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role } },
        200, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS) });
    }

    /* ---------- 退出 ---------- */
    if (route === 'logout' && method === 'POST') {
      const cookie = request.headers.get('Cookie') || '';
      const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})'));
      if (m) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(m[1]).run();
      return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
    }

    /* ---------- 会话信息 ---------- */
    if (route === 'me' && method === 'GET') {
      const s = await getSession(env, request);
      if (!s) return err('未登录', 401);
      return json({ ok: true, user: { id: s.id, username: s.username, display_name: s.display_name, role: s.role } });
    }

    /* ---------- 持仓读取 ---------- */
    if (route === 'holdings' && method === 'GET') {
      const s = await getSession(env, request);
      if (!s) return err('未登录', 401);
      const row = await env.DB.prepare(`SELECT data, updated_at FROM holdings WHERE user_id = ?`).bind(s.id).first();
      return json({ ok: true, data: row ? JSON.parse(row.data) : { positions: [], trades: [] }, updated_at: row?.updated_at || null });
    }

    /* ---------- 持仓保存 ---------- */
    if (route === 'holdings' && method === 'PUT') {
      const s = await getSession(env, request);
      if (!s) return err('未登录', 401);
      const raw = await request.text();
      if (raw.length > MAX_HOLDINGS_BYTES) return err('数据过大(上限 128KB)', 413);
      let data;
      try { data = JSON.parse(raw); } catch { return err('JSON 格式错误'); }
      if (!Array.isArray(data.positions) || !Array.isArray(data.trades)) return err('数据缺少 positions/trades 字段');
      data.updated_at = new Date().toISOString().slice(0, 10);
      await env.DB.prepare(
        `INSERT INTO holdings (user_id, data, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
      ).bind(s.id, JSON.stringify(data)).run();
      return json({ ok: true });
    }

    /* ---------- admin:用户列表 ---------- */
    if (route === 'admin/users' && method === 'GET') {
      const s = await getSession(env, request);
      if (!s) return err('未登录', 401);
      if (s.role !== 'admin') return err('需要管理员权限', 403);
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.created_at,
                length(h.data) AS holdings_size, h.updated_at AS holdings_updated_at
         FROM users u LEFT JOIN holdings h ON h.user_id = u.id
         ORDER BY u.role DESC, u.created_at ASC`
      ).all();
      return json({ ok: true, users: results });
    }

    /* ---------- admin:删除用户 ---------- */
    const delMatch = route.match(/^admin\/users\/(\d+)$/);
    if (delMatch && method === 'DELETE') {
      const s = await getSession(env, request);
      if (!s) return err('未登录', 401);
      if (s.role !== 'admin') return err('需要管理员权限', 403);
      const id = parseInt(delMatch[1], 10);
      if (id === s.id) return err('不能删除自己的账号');
      const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(id).first();
      if (!target) return err('用户不存在', 404);
      if (target.role === 'admin') return err('不能删除其他管理员');
      await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }

    return err('未知接口: ' + method + ' /api/' + route, 404);
  } catch (e) {
    return err('服务器错误: ' + (e.message || String(e)), 500);
  }
}
