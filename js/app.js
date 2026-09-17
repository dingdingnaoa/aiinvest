/**
 * app.js — 应用主控制器
 * v4: 云端账号系统——登录/注册走 /api 接口,持仓数据云端存储;
 *     Cookie 会话 7 天有效,刷新页面自动恢复登录态。
 *     全球脉搏对所有人公开;研究报告与投资组合需登录。
 */
(function (global) {
  'use strict';

  const App = {
    state: {
      clusters: [],
      companies: [],
      valuations: [],
      research: [],
      news: null,
      meta: null,
      loading: true
    },

    async init() {
      this._showLoading();
      AIInvest.Clock.init();
      AIInvest.Clock.setDataStatus('正在加载数据...');
      this._initTabNavigation();
      this._bindLoginUI();

      try {
        await this.loadData();
        this.renderPublic();
        // 会话恢复:Cookie 有效则自动登录(云端持仓随之就位)
        if (window.Auth) await window.Auth.restoreSession();
        this.applyAuthState();
        AIInvest.Clock.setDataStatus('数据就绪');
        AIInvest.Clock.setLastUpdate(new Date().toISOString());
      } catch (err) {
        console.error('数据加载失败:', err);
        AIInvest.Clock.setDataStatus('⚠️ 数据加载失败');
      }
    },

    async loadData() {
      const [clustersRes, companiesRes, valuationsRes, researchRes, metaRes, newsRes] = await Promise.all([
        fetch('data/clusters.json'),
        fetch('data/companies.json'),
        fetch('data/valuations.json'),
        fetch('data/research_reports.json').catch(() => null),
        fetch('data/meta.json').catch(() => null),
        fetch('data/news.json').catch(() => null)
      ]);

      if (!clustersRes.ok || !companiesRes.ok || !valuationsRes.ok) {
        throw new Error('数据文件加载失败');
      }

      this.state.clusters = await clustersRes.json();
      this.state.companies = await companiesRes.json();
      this.state.valuations = await valuationsRes.json();
      if (researchRes && researchRes.ok) this.state.research = await researchRes.json();
      if (metaRes && metaRes.ok) this.state.meta = await metaRes.json();
      if (newsRes && newsRes.ok) {
        try { this.state.news = await newsRes.json(); } catch (e) { this.state.news = null; }
      }
      this.state.loading = false;
    },

    /** 公开区渲染(全球脉搏)——所有人可见 */
    renderPublic() {
      this._renderVersion();
      AIInvest.MarketPulse.init();
    },

    /** 按登录状态渲染受保护区 */
    applyAuthState() {
      const loggedIn = window.Auth && window.Auth.current;
      const gate = document.getElementById('portfolioGate');
      const content = document.getElementById('portfolioContent');
      const researchGate = document.getElementById('researchGate');
      const researchSection = document.getElementById('researchSection');

      if (loggedIn) {
        // ---- 登录态 ----
        if (gate) gate.style.display = 'none';
        if (content) content.style.display = '';
        if (researchGate) researchGate.style.display = 'none';
        if (researchSection) researchSection.style.display = '';

        const badge = document.getElementById('userBadge');
        if (badge) badge.textContent = '👤 ' + (Auth.current.display_name || Auth.current.user);

        // 持仓(云端数据驱动)
        if (this.state.valuations && this.state.valuations.length > 0) {
          AIInvest.Portfolio.init(this.state.valuations);
          AIInvest.Portfolio.unlockWith(Auth.current.data);
        }
        this._renderHoldingsCount();

        // 研究报告(按持仓过滤)+ 新闻
        if (this.state.research && this.state.research.length > 0) {
          AIInvest.Research.init(this.state.research, Auth.current.data.positions, this.state.news);
          AIInvest.Research.initEvents();
        }
        const sub = document.getElementById('portfolioSubCount');
        if (sub) {
          const n = (Auth.current.data.positions || []).filter(p => p.shares > 0).length;
          sub.textContent = n + ' 家深度研究标的 · 数据快照 ' + (Auth.current.data.updated_at || '--');
        }
        // 用户管理面板:仅管理员可见
        if (AIInvest.AccountAdmin) AIInvest.AccountAdmin.applyVisibility(Auth.current.user);
      } else {
        // ---- 未登录 ----
        if (gate) gate.style.display = '';
        if (content) content.style.display = 'none';
        if (researchGate) researchGate.style.display = '';
        if (researchSection) researchSection.style.display = 'none';
        // 隐藏管理面板
        if (AIInvest.AccountAdmin) AIInvest.AccountAdmin.applyVisibility(null);
      }
    },

    /** 登录/注册表单与门控按钮 */
    _bindLoginUI() {
      const form = document.getElementById('loginForm');
      const errBox = document.getElementById('loginError');
      const goLogin = document.getElementById('gateGoLoginBtn');

      if (goLogin) goLogin.addEventListener('click', () => {
        const btn = document.querySelector('#mainTabNav .tab-btn[data-tab="tab-portfolio"]');
        if (btn) btn.click();
        setTimeout(() => { const u = document.getElementById('loginUser'); if (u) u.focus(); }, 100);
      });

      /* ---------- 登录 ---------- */
      if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = (document.getElementById('loginUser') || {}).value || '';
        const pass = (document.getElementById('loginPassword') || {}).value || '';
        const btn = document.getElementById('loginBtn');
        if (!user || !pass) {
          if (errBox) { errBox.textContent = '请输入账号和密码'; errBox.style.display = 'block'; }
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = '登录中...'; }
        try {
          await window.Auth.login(user.trim(), pass);
          if (errBox) errBox.style.display = 'none';
          const pw = document.getElementById('loginPassword'); if (pw) pw.value = '';
          this.applyAuthState();
        } catch (err) {
          if (errBox) { errBox.textContent = err.message || '登录失败,请稍后再试'; errBox.style.display = 'block'; }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = '登 录'; }
        }
      });

      /* ---------- 注册(开放注册,注册成功即登录) ---------- */
      const regForm = document.getElementById('registerForm');
      const regErrBox = document.getElementById('registerError');
      const regToggle = document.getElementById('registerToggle');

      if (regToggle) regToggle.addEventListener('click', () => {
        const showingRegister = regForm && regForm.style.display !== 'none';
        if (regForm) regForm.style.display = showingRegister ? 'none' : '';
        if (form) form.style.display = showingRegister ? '' : 'none';
        if (regErrBox) regErrBox.style.display = 'none';
        if (errBox) errBox.style.display = 'none';
        regToggle.textContent = showingRegister ? '✨ 没有账号?点此注册' : '← 已有账号?返回登录';
        if (!showingRegister) { const u = document.getElementById('registerUser'); if (u) u.focus(); }
        else { const u = document.getElementById('loginUser'); if (u) u.focus(); }
      });

      if (regForm) regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = (document.getElementById('registerUser') || {}).value || '';
        const pass = (document.getElementById('registerPassword') || {}).value || '';
        const display = (document.getElementById('registerDisplay') || {}).value || '';
        const btn = document.getElementById('registerBtn');
        if (!username.trim() || !pass) {
          if (regErrBox) { regErrBox.textContent = '请输入账号和密码'; regErrBox.style.display = 'block'; }
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = '注册中...'; }
        try {
          await window.Auth.register(username.trim(), pass, display.trim());
          if (regErrBox) regErrBox.style.display = 'none';
          this.applyAuthState();
        } catch (err) {
          if (regErrBox) { regErrBox.textContent = err.message || '注册失败,请稍后再试'; regErrBox.style.display = 'block'; }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = '注册并登录'; }
        }
      });
    },

    async doLogout() {
      if (window.Auth) await window.Auth.logout();
      if (AIInvest.Portfolio) AIInvest.Portfolio.lock();
      this.applyAuthState();
      // 回到全球脉搏页
      const btn = document.querySelector('#mainTabNav .tab-btn[data-tab="tab-pulse"]');
      if (btn) btn.click();
    },

    _renderHoldingsCount() {
      const el = document.getElementById('holdingsCount');
      if (el && AIInvest.Portfolio && AIInvest.Portfolio.positions) {
        const real = AIInvest.Portfolio.positions.filter(p => p.shares && p.shares > 0).length;
        el.textContent = real;
      }
    },

    _initTabNavigation() {
      const tabs = document.querySelectorAll('#mainTabNav .tab-btn');
      const contents = document.querySelectorAll('.tab-content');

      function switchTab(tab, allTabs) {
        const targetId = tab.dataset.tab;
        allTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        contents.forEach(c => c.classList.remove('active'));
        const target = document.getElementById(targetId);
        if (target) {
          target.classList.add('active');
          if (targetId === 'tab-portfolio' && AIInvest.Portfolio) {
            AIInvest.Portfolio.refresh();
          }
        }
      }

      const initialTab = Array.from(tabs).find(t => t.classList.contains('active')) || tabs[0];
      if (initialTab) {
        const initialTarget = document.getElementById(initialTab.dataset.tab);
        contents.forEach(c => c.classList.toggle('active', c === initialTarget));
      }

      tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab, tabs));
      });
    },

    _renderVersion() {
      const bar = document.getElementById('dataVersionBar');
      if (!bar) return;

      const meta = this.state.meta;
      if (meta) {
        bar.style.display = 'flex';
        const mv = document.getElementById('methodologyVersion');
        const cc = document.getElementById('clustersCount');
        const coc = document.getElementById('companiesCount');
        const st = document.getElementById('dataSyncTime');
        if (mv) mv.textContent = meta.methodology_version || '--';
        if (cc) cc.textContent = meta.clusters_count || '--';
        if (coc) coc.textContent = meta.companies_count || '--';
        if (st && meta.data_last_updated) {
          st.textContent = new Date(meta.data_last_updated).toLocaleString('zh-CN');
        }
      } else {
        bar.style.display = 'flex';
        const cc = document.getElementById('clustersCount');
        const coc = document.getElementById('companiesCount');
        const st = document.getElementById('dataSyncTime');
        if (cc) cc.textContent = this.state.clusters.length;
        if (coc) coc.textContent = this.state.companies.length;
        if (st) st.textContent = new Date().toLocaleString('zh-CN');
      }
    },

    _showLoading() {
      const chartContainer = document.getElementById('heatmapChart');
      if (chartContainer) {
        chartContainer.innerHTML = '<div class="loading">正在加载行业数据...</div>';
      }
    },

    _hideLoading() {}
  };

  window.addEventListener('DOMContentLoaded', () => {
    App.init();
  });

  global.App = App;
})(window.AIInvest = window.AIInvest || {});
