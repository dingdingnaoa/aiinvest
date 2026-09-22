/* ============================================================
 * auth.js — 云端账号系统(前端部分)
 * v5: 账号与持仓全部存储在云端数据库(Cloudflare D1),
 *     任何人可自助注册;登录后会话由 httpOnly Cookie 维持(7 天)。
 *
 * 接口形状保持与旧版一致(app.js / portfolio.js 依赖):
 *   Auth.current = { user, display_name, data }   data = { positions, trades, updated_at }
 *   await Auth.login(user, password)              -> { ok: true } 或 throw Error(message)
 *   await Auth.register(username, password, disp) -> 注册成功并直接登录
 *   await Auth.restoreSession()                   -> true/false(Cookie 会话自动恢复)
 *   await Auth.logout()
 *   await Auth.syncHoldings({positions, trades})  -> 持仓上云
 * ============================================================ */
(function () {
  'use strict';

  var SESSION_KEY = 'gsw_session_v1'; // 旧版本地键名,仅用于启动时清理

  /** 统一 API 调用:非 2xx 时 throw Error(服务端 error 信息) */
  async function api(path, opts) {
    var resp = await fetch('/api/' + path, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }, opts || {}));
    var body = null;
    try { body = await resp.json(); } catch (e) { body = null; }
    if (!resp.ok) {
      var msg = (body && body.error) || ('请求失败 (' + resp.status + ')');
      var err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    return body || {};
  }

  function emptyData() {
    return { positions: [], trades: [], updated_at: '' };
  }

  /** 拉取当前账号的云端持仓;失败不抛出(登录优先成功) */
  async function fetchHoldings() {
    try {
      var h = await api('holdings');
      if (h && h.data && Array.isArray(h.data.positions)) return h.data;
    } catch (e) { /* 持仓读取失败不阻塞登录 */ }
    return emptyData();
  }

  function setCurrent(userObj, data) {
    Auth.current = {
      user: userObj.username,
      display_name: userObj.display_name || userObj.username,
      role: userObj.role || 'user',
      data: data || emptyData()
    };
    cacheIdentity();
  }

  /** 本地轻量缓存:仅身份信息(用于瞬时 UI 显示;持仓以云端为准) */
  function cacheIdentity() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        user: Auth.current.user,
        display_name: Auth.current.display_name
      }));
    } catch (e) { /* 忽略存储失败 */ }
  }

  var Auth = {
    current: null, // { user, display_name, role, data }

    /** 登录:POST /api/login → GET /api/holdings 填充 Auth.current.data */
    async login(user, password) {
      var d = await api('login', {
        method: 'POST',
        body: JSON.stringify({ username: user, password: password })
      });
      var data = await fetchHoldings();
      setCurrent(d.user, data);
      return { ok: true };
    },

    /** 注册:POST /api/register → 自动登录(服务端直接下发会话) */
    async register(username, password, displayName) {
      var d = await api('register', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password, display_name: displayName || '' })
      });
      var data = await fetchHoldings();
      setCurrent(d.user, data);
      return { ok: true };
    },

    /** 会话恢复:GET /api/me(Cookie 有效则免登录)+ 持仓 */
    async restoreSession() {
      try {
        var me = await api('me');
        var data = await fetchHoldings();
        setCurrent(me.user, data);
        return true;
      } catch (e) {
        Auth.current = null;
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e2) { /* 忽略 */ }
        return false;
      }
    },

    /** 退出登录 */
    async logout() {
      try { await api('logout', { method: 'POST' }); } catch (e) { /* 网络失败也照常清理本地 */ }
      Auth.current = null;
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 忽略 */ }
    },

    /** 持仓上云:PUT /api/holdings(成功后同步更新 Auth.current.data) */
    async syncHoldings(payload) {
      var data = {
        positions: Array.isArray(payload.positions) ? payload.positions : [],
        trades: Array.isArray(payload.trades) ? payload.trades : []
      };
      await api('holdings', { method: 'PUT', body: JSON.stringify(data) });
      if (Auth.current && Auth.current.data) {
        Auth.current.data.positions = data.positions;
        Auth.current.data.trades = data.trades;
        Auth.current.data.updated_at = new Date().toISOString().slice(0, 10);
      }
      return { ok: true };
    },

    /** 修改密码:POST /api/password(需登录;成功后服务端会吊销该账号的其他设备会话) */
    async changePassword(currentPassword, newPassword) {
      await api('password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword })
      });
      return { ok: true };
    },

    /** 当前账号是否管理员 */
    isAdmin: function () {
      return !!(Auth.current && Auth.current.role === 'admin');
    }
  };

  window.Auth = Auth;
  /* 挂到 AIInvest 命名空间,保证 app.js 等模块的 global.Auth 引用可用 */
  if (typeof window.AIInvest !== 'undefined') { window.AIInvest.Auth = Auth; }
})();
