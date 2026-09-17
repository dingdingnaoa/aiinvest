/**
 * admin-accounts.js — 用户管理面板(管理员专属)
 * v5: 云端账号系统——调用 /api/admin/users 查看全部注册用户、删除违规账号;
 *     数据存储在云端 D1 数据库,所有注册用户一览。
 * 依赖:auth.js(需先加载)
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(s) {
    if (!s) return '--';
    // D1 datetime('now') 为 UTC "YYYY-MM-DD HH:MM:SS",展示为本地可读格式
    return String(s).replace('T', ' ').slice(0, 16);
  }

  function fmtSize(n) {
    if (n == null) return '--';
    if (n < 1024) return n + ' B';
    return (n / 1024).toFixed(1) + ' KB';
  }

  async function loadUsers() {
    const tbody = $('userTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">加载中...</td></tr>';
    try {
      const r = await fetch('/api/admin/users', { credentials: 'same-origin' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || ('请求失败 (' + r.status + ')'));
      renderUsers(d.users || []);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">⚠️ ' + esc(e.message || '加载失败') + '</td></tr>';
    }
  }

  function renderUsers(users) {
    const tbody = $('userTableBody');
    if (!tbody) return;
    const count = $('adminUserCount');
    if (count) count.textContent = '共 ' + users.length + ' 个账号';
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无注册用户</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(function (u) {
      const isAdmin = u.role === 'admin';
      return '<tr>'
        + '<td><b>' + esc(u.username) + '</b>' + (isAdmin ? ' <span class="section-tag">管理员</span>' : '') + '</td>'
        + '<td>' + esc(u.display_name || '--') + '</td>'
        + '<td>' + esc(fmtDate(u.created_at)) + '</td>'
        + '<td>' + esc(fmtSize(u.holdings_size)) + '</td>'
        + '<td>' + esc(fmtDate(u.holdings_updated_at)) + '</td>'
        + '<td>' + (isAdmin
            ? '<span style="color:var(--text-tertiary)">—</span>'
            : '<button class="btn-danger" data-del="' + u.id + '" data-name="' + esc(u.username) + '">删除</button>')
        + '</td>'
        + '</tr>';
    }).join('');
    tbody.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { deleteUser(b.dataset.del, b.dataset.name); });
    });
  }

  async function deleteUser(id, name) {
    if (!confirm('确认删除用户「' + name + '」?\n\n其云端持仓数据将被一并删除,不可恢复!')) return;
    try {
      const r = await fetch('/api/admin/users/' + id, { method: 'DELETE', credentials: 'same-origin' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || ('删除失败 (' + r.status + ')'));
      loadUsers();
    } catch (e) {
      alert('删除失败:' + (e.message || e));
    }
  }

  // script 位于 body 尾部,DOM 已就绪,直接绑定
  const refreshBtn = $('adminUsersRefresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadUsers);

  /** admin 面板显隐由 app.applyAuthState 调用 */
  window.AIInvest = window.AIInvest || {};
  window.AIInvest.AccountAdmin = {
    /** 登录态变化时调用:仅 admin 显示用户管理并拉取列表 */
    applyVisibility: function (currentUser) {
      const card = $('adminAccountsCard');
      if (card) card.style.display = currentUser === 'admin' ? '' : 'none';
      if (currentUser === 'admin') loadUsers();
    }
  };
})();
