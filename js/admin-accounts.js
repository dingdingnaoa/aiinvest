/**
 * admin-accounts.js — 账号功能 UI
 * 1) 主账号(admin)专属「账号管理」面板:开新号 → 生成开通码
 * 2) 登录门「开通码激活」入口:粘贴开通码 → 本机激活登录
 * 依赖:auth.js(需先加载)
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function showErr(id, msg) {
    var el = $(id);
    if (!el) return;
    if (msg) { el.textContent = msg; el.style.display = 'block'; }
    else { el.style.display = 'none'; }
  }

  /** 生成 16 位无易混淆字符的强密码 */
  function genStrongPassword() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    var n = 16, out = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var buf = new Uint32Array(n);
      crypto.getRandomValues(buf);
      for (var i = 0; i < n; i++) out += alphabet[buf[i] % alphabet.length];
    } else {
      for (var j = 0; j < n; j++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // file:// 兜底:select + execCommand
    var ta = $('activationCode');
    if (ta) { ta.focus(); ta.select(); document.execCommand('copy'); }
    return Promise.resolve();
  }

  function bindAdminPanel() {
    var genBtn = $('genRandPassBtn'), createBtn = $('createAcctBtn'),
        copyBtn = $('copyCodeBtn');
    if (genBtn) genBtn.addEventListener('click', function () {
      var p = $('newAcctPass');
      if (p) { p.value = genStrongPassword(); p.type = 'text'; showErr('adminAcctError', null); }
    });

    if (createBtn) createBtn.addEventListener('click', function () {
      var user = ($('newAcctUser') || {}).value || '';
      var display = ($('newAcctDisplay') || {}).value || '';
      var pass = ($('newAcctPass') || {}).value || '';
      if (!window.Auth) { showErr('adminAcctError', 'Auth 模块未加载'); return; }
      createBtn.disabled = true; createBtn.textContent = '生成中...(数秒)';
      showErr('adminAcctError', null);
      // PBKDF2 31 万次,让 UI 先刷新
      setTimeout(function () {
        try {
          var r = Auth.createAccount({ user: user, display_name: display.trim(), password: pass });
          if (r.ok) {
            // 开号即在本机登记(密文入 localStorage),重名检查立即生效
            try { Auth.activateWithCode(r.code); } catch (e) { /* 忽略 */ }
            var box = $('codeBox'), ta = $('activationCode');
            if (ta) ta.value = r.code;
            if (box) box.style.display = 'block';
            createBtn.textContent = '✅ 已生成,可再次开号';
          } else {
            showErr('adminAcctError', r.error || '开号失败');
            createBtn.textContent = '生成开通码';
          }
        } catch (e) {
          showErr('adminAcctError', '异常: ' + String(e));
          createBtn.textContent = '生成开通码';
        }
        createBtn.disabled = false;
      }, 30);
    });

    if (copyBtn) copyBtn.addEventListener('click', function () {
      var ta = $('activationCode');
      if (!ta || !ta.value) return;
      copyText(ta.value).then(function () {
        copyBtn.textContent = '✅ 已复制';
        setTimeout(function () { copyBtn.textContent = '📋 复制开通码'; }, 1500);
      }).catch(function () { ta.select(); });
    });
  }

  function bindActivateBox() {
    var toggle = $('activateToggle'), box = $('activateBox'),
        btn = $('activateBtn');
    if (toggle) toggle.addEventListener('click', function () {
      if (!box) return;
      var show = box.style.display === 'none';
      box.style.display = show ? 'block' : 'none';
      if (show) { var t = $('activateCode'); if (t) t.focus(); }
    });

    if (btn) btn.addEventListener('click', function () {
      var code = ($('activateCode') || {}).value || '';
      if (!window.Auth) { showErr('activateError', 'Auth 模块未加载'); return; }
      btn.disabled = true; btn.textContent = '校验中...';
      showErr('activateError', null);
      setTimeout(function () {
        var r = Auth.activateWithCode(code);
        btn.disabled = false; btn.textContent = '激活账号(约数秒)';
        if (r.ok) {
          showErr('activateError', null);
          // 直接登录激活的账号
          var pw = ($('loginPassword') || {}).value || '';
          var login = Auth.login(r.user, pw);
          if (login.ok) {
            showErr('loginError', null);
            if (typeof App !== 'undefined' && App.applyAuthState) App.applyAuthState();
            var lp = $('loginPassword'); if (lp) lp.value = '';
            if (box) box.style.display = 'none';
          } else {
            // 密码未填或不对:提示用表单登录
            showErr('activateError', '✅ 激活成功!请在上方输入该账号密码登录(' + r.display_name + ')');
          }
        } else {
          showErr('activateError', r.error || '激活失败');
        }
      }, 30);
    });
  }

  // script 位于 body 尾部,DOM 已就绪,直接绑定
  bindAdminPanel();
  bindActivateBox();

  /** admin 面板显隐由 app.applyAuthState 调用 */
  window.AIInvest = window.AIInvest || {};
  window.AIInvest.AccountAdmin = {
    /** 登录态变化时调用:仅 admin 显示账号管理 */
    applyVisibility: function (currentUser) {
      var card = $('adminAccountsCard');
      if (card) card.style.display = currentUser === 'admin' ? '' : 'none';
    }
  };
})();
