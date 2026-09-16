/**
 * portfolio.js — 投资组合模块
 * Apple 极简风格：横向卡片 + 水平占比条
 * v3: 登录门控——持仓数据由账号保险箱(Auth)解密提供,未登录不渲染任何持仓
 */
(function (global) {
  'use strict';

  const STORAGE_BASE = 'aiinvest_portfolio_positions';
  const USD_TO_HKD = 7.80;

  // 兜底空仓位(仅在保险箱解密异常时使用,正常流程不可达;不含任何真实数据)
  const FALLBACK_POSITIONS = [];

  const Portfolio = {
    positions: [],
    valuations: [],
    livePrices: {},      // {ticker: {price, chg_pct, name}}
    editingId: null,
    refreshTimer: null,
    isVisible: true,
    state: { lastLiveUpdate: null, liveStatus: null },

    // ticker → 腾讯行情代码映射（覆盖全部持仓 + 常见备用）
    _tickerMap: {
      '0700.HK': 'hk00700', '1810.HK': 'hk01810', '9988.HK': 'hk09988',
      '9866.HK': 'hk09866', '0100.HK': 'hk00100',
      'PDD': 'usPDD', 'BABA': 'usBABA', 'BIDU': 'usBIDU', 'JD': 'usJD',
      'AAOI': 'usAAOI', 'COHR': 'usCOHR',
      'SPCX': 'usSPCX', 'SPCE': 'usSPCE', 'NIO': 'usNIO', 'XPEV': 'usXPEV',
      'LI': 'usLI', 'BILI': 'usBILI', 'NTES': 'usNTES', 'TME': 'usTME',
      'EDU': 'usEDU', 'BEST': 'usBEST', 'DIDIY': 'usDIDIY', 'YI': 'usYI',
    },

    init(valuations) {
      this.valuations = valuations;
      this.positions = [];
      this._userKey = null;
      this._bindForm();
      this._bindVisibility();
      this._bindExport();
      this._bindSaveCloud();
      this._bindLogout();
      // 未登录:不加载、不渲染、不拉行情(由 App 在登录成功后调用 unlockWith)
    },

    /**
     * 登录成功后解锁持仓(Auth.current.data 为解密后的保险箱数据)
     */
    unlockWith(data) {
      this._userKey = STORAGE_BASE + '_' + (Auth.current ? Auth.current.user : 'anon');
      this._vaultPositions = (data && Array.isArray(data.positions)) ? data.positions : [];
      this._vaultUpdatedAt = (data && data.updated_at) || '';
      this._loadPositions();
      this._renderAll();
      this._fetchAndRefresh();
      // 同步 app 数据条上的持仓数
      if (global.App && global.App._renderHoldingsCount) {
        global.App._renderHoldingsCount();
      }
    },

    /** 退出登录:清空内存与定时器,渲染交回登录门 */
    lock() {
      if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
      this.positions = [];
      this.livePrices = {};
      this._userKey = null;
      this._vaultPositions = null;
    },

    _loadPositions() {
      try {
        // 加载顺序(登录版):
        // 1) 浏览器 localStorage(per-user)—— 当前设备上的未同步修改(最高优先级)
        // 2) 账号保险箱解密数据 —— 中央持久化持仓(基线)
        const raw = this._userKey ? localStorage.getItem(this._userKey) : null;
        const loaded = raw ? JSON.parse(raw) : null;
        if (Array.isArray(loaded) && loaded.length > 0) {
          this.positions = loaded;
          this._savePositions();
          return;
        }
        this.positions = (this._vaultPositions || FALLBACK_POSITIONS).map(p => ({ ...p }));
        this._savePositions();
      } catch (e) {
        this.positions = (this._vaultPositions || FALLBACK_POSITIONS).map(p => ({ ...p }));
      }
    },

    refresh() {
      if (!Auth.current) return; // 未登录不刷新
      this._fetchAndRefresh();
    },

    _bindLogout() {
      const btn = document.getElementById('logoutBtn');
      if (btn) btn.addEventListener('click', () => {
        if (global.App && global.App.doLogout) global.App.doLogout();
      });
    },

    async _fetchAndRefresh() {
      await this._fetchLivePrices();
      this._renderAll();
      this._startAutoRefresh();
    },

    _bindVisibility() {
      document.addEventListener('visibilitychange', () => {
        this.isVisible = !document.hidden;
        if (this.isVisible) this._fetchAndRefresh();
      });
    },

    _startAutoRefresh() {
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = setInterval(() => {
        if (this.isVisible) {
          this._fetchLivePrices().then(() => this._renderPricesOnly());
        }
      }, 30000); // 每30秒增量刷新价格
    },

    /**
     * 从腾讯行情拉取所有持仓实时价格
     */
    async _fetchLivePrices() {
      const codes = [];
      const tickers = [];
      this.positions.forEach(p => {
        const tc = this._tickerMap[p.ticker];
        if (tc) { codes.push(tc); tickers.push(p.ticker); }
      });
      if (codes.length === 0) return;

      try {
        // 兜底超时：8 秒内无响应则回退静态价，避免长时间空白
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch(`https://qt.gtimg.cn/q=${codes.join(',')}`, { cache: 'no-cache', signal: ctrl.signal });
        clearTimeout(timer);
        // 腾讯接口返回 GBK 编码，需显式按 GBK 解码，避免中文乱码导致解析错乱
        const buf = await resp.arrayBuffer();
        let text = '';
        try { text = new TextDecoder('gbk').decode(buf); }
        catch (e) { text = new TextDecoder('utf-8').decode(buf); }
        const lines = text.split('\n').filter(l => l.includes('=') && l.includes('"'));
        let updated = 0;
        for (const line of lines) {
          const m = line.match(/v_(\w+)="([^"]*)"/);
          if (!m) continue;
          const tc = m[1];
          const raw = m[2];
          const parts = raw.split('~');
          if (parts.length < 33) continue;
          const ticker = Object.entries(this._tickerMap).find(([,v]) => v === tc);
          if (!ticker) continue;
          const price = parseFloat(parts[3]);
          if (price) {
            this.livePrices[ticker[0]] = {
              price,
              chg_pct: parseFloat(parts[32]) || 0,
              name: parts[1] || '',
            };
            updated++;
          }
        }
        this.state.liveStatus = updated > 0 ? 'live' : 'offline';
        if (updated > 0) this.state.lastLiveUpdate = Date.now();
        this._renderLiveStatus();
      } catch (e) {
        // 网络失败/超时：标记为离线，使用缓存的 livePrices 或 valuations 静态价
        this.state.liveStatus = 'offline';
        this._renderLiveStatus();
      }
    },

    /**
     * 在 KPI 区域展示实时行情连接状态
     */
    _renderLiveStatus() {
      const el = document.getElementById('kpiLastUpdate');
      if (!el) return;
      if (this.state.liveStatus === 'live' && this.state.lastLiveUpdate) {
        const ts = this.state.lastLiveUpdate;
        const ageSec = Math.floor((Date.now() - ts) / 1000);
        let label;
        if (ageSec < 5) label = '实时 · 刚刚';
        else if (ageSec < 60) label = '实时 · ' + ageSec + ' 秒前';
        else if (ageSec < 3600) label = '实时 · ' + Math.floor(ageSec/60) + ' 分钟前';
        else label = '实时 · ' + Math.floor(ageSec/3600) + ' 小时前';
        el.textContent = label;
        el.className = 'kpi-update kpi-live';
      } else {
        el.textContent = '实时行情未连接，显示静态快照';
        el.className = 'kpi-update kpi-offline';
      }
    },

    /**
     * 获取某持仓的实时现价
     */
    _getLivePrice(ticker) {
      const live = this.livePrices[ticker];
      if (live && live.price) return live.price;
      const v = this.valuations.find(x => x.ticker === ticker);
      return v ? v.current_price : null;
    },

    /**
     * 仅更新卡片中的价格和涨跌幅（增量刷新，不重建DOM）
     */
    _renderPricesOnly() {
      this.positions.forEach(p => {
        const v = this.valuations.find(x => x.name === p.name);
        if (!v) return;
        const cur = v.currency;
        const lp = this._getLivePrice(p.ticker);
        if (!lp) return;
        const fmtP = (val, c) => (c === 'USD' ? '$' : 'HK$') + val.toFixed(2);

        const priceEl = document.getElementById(`pos-price-${p.id}`);
        const chgEl = document.getElementById(`pos-chg-${p.id}`);
        const pnlEl = document.getElementById(`pos-pnl-${p.id}`);
        const pnlPctEl = document.getElementById(`pos-pnlpct-${p.id}`);
        const costDistEl = document.getElementById(`pos-costdist-${p.id}`);

        if (priceEl) priceEl.textContent = fmtP(lp, cur);

        const { pnl, pnlPercent } = this._calcPnlWithPrice(p, lp, v);
        const isUp = pnl !== null && pnl >= 0;
        if (pnlEl) { pnlEl.textContent = pnl !== null ? (pnl>=0?'+':'') + pnl.toFixed(2) + ' 万' : '--'; pnlEl.className = isUp ? 'pnl-up' : 'pnl-down'; }
        if (pnlPctEl) { pnlPctEl.textContent = pnlPercent !== null ? (pnlPercent>=0?'+':'') + pnlPercent.toFixed(1) + '%' : ''; pnlPctEl.className = isUp ? 'pnl-up' : 'pnl-down'; }
        if (costDistEl && p.cost) {
          const cd = ((lp - p.cost) / p.cost * 100);
          costDistEl.textContent = (cd>=0?'+':'') + cd.toFixed(1) + '%';
          costDistEl.className = cd >= 0 ? 'pnl-up' : 'pnl-down';
        }

        if (chgEl) {
          const live = this.livePrices[p.ticker];
          const chg = live ? live.chg_pct : 0;
          chgEl.textContent = (chg>=0?'+':'') + chg.toFixed(2) + '%';
          chgEl.className = (chg >= 0 ? 'pnl-up' : 'pnl-down') + ' sc-live-badge';
        }
      });
      this._renderSummaryOnly();
    },

    /**
     * 中央持仓数据来自账号保险箱(Auth 解密),不再从明文 portfolio.json 拉取。
     * 本地与保险箱不一致时提示:本地修改尚未同步给管理员。
     */
    _showSyncNotice() {
      const box = document.getElementById('syncNotice');
      if (box) {
        box.style.display = 'flex';
        box.classList.add('show');
      }
    },

    _savePositions() {
      try { if (this._userKey) localStorage.setItem(this._userKey, JSON.stringify(this.positions)); } catch (e) {}
    },

    _bindForm() {
      const stockSelect = document.getElementById('positionStock');
      const addBtn = document.getElementById('positionAddBtn');
      if (stockSelect && this.valuations.length > 0) {
        this.valuations.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.name;
          opt.textContent = `${v.name} (${v.ticker} · ${v.currency === 'USD' ? '美元' : '港币'})`;
          stockSelect.appendChild(opt);
        });
      }
      if (addBtn) addBtn.addEventListener('click', () => this._handleAddOrUpdate());
    },

    /**
     * 绑定「导出当前持仓」按钮（页面 footer 区域）
     * 点击后将当前持仓序列化为 JSON 格式文本并复制到剪贴板，弹窗展示
     */
    _bindExport() {
      // footer 主按钮 + 不一致提示条按钮
      ['exportPortfolioBtn', 'exportPortfolioBtn2'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => this._exportPositions());
      });
    },

    _exportPositions() {
      const payload = {
        updated_at: new Date().toISOString().slice(0, 10),
        note: '用户当前持仓快照（粘贴到对话，我覆盖更新 data/portfolio.json）',
        holdings: this.positions.map(p => ({
          id: p.id, name: p.name, ticker: p.ticker,
          shares: p.shares ?? null, cost: p.cost ?? null, note: p.note || ''
        }))
      };
      const text = JSON.stringify(payload, null, 2);
      // 复制到剪贴板（fallback 提示）
      const copyOk = (() => { try { return navigator.clipboard.writeText(text); } catch (e) { return Promise.reject(e); } })();
      Promise.resolve(copyOk).then(() => {
        alert('已复制到剪贴板：\n\n' + text);
      }).catch(() => {
        prompt('复制失败，请手动复制以下 JSON：', text);
      });
    },

    /**
     * 绑定「保存到云端」按钮：一键把持仓写入服务器（沙箱保存服务）
     * 成功 → 数据落到 data/portfolio.json；失败 → 兜底导出复制
     */
    _bindSaveCloud() {
      const btn = document.getElementById('saveCloudBtn');
      if (btn) btn.addEventListener('click', () => this._saveToCloud());
    },

    async _saveToCloud() {
      const statusEl = document.getElementById('saveCloudStatus');
      const setStatus = (text, ok, cls) => {
        if (statusEl) { statusEl.textContent = text; statusEl.className = 'save-status ' + (ok ? 'ok' : 'fail'); }
        if (cls) { document.body.classList.remove('save-clouding', 'save-cloud-ok', 'save-cloud-fail'); document.body.classList.add(cls); }
      };
      const btn = document.getElementById('saveCloudBtn');
      if (btn) { btn.disabled = true; }

      // 先写本地 localStorage，保证即时生效（永不丢失）
      this._savePositions();

      const payload = JSON.stringify({
        updated_at: new Date().toISOString(),
        holdings: this.positions.map(p => ({
          id: p.id, name: p.name, ticker: p.ticker,
          shares: p.shares ?? null, cost: p.cost ?? null, note: p.note || '',
          createdAt: p.createdAt || null, updatedAt: p.updatedAt || new Date().toISOString()
        }))
      });

      // 候选保存端点：同源（http 部署时）+ 沙箱本地服务
      const endpoints = [];
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        endpoints.push(window.location.origin + '/api/save-portfolio');
      }
      endpoints.push('http://localhost:8080/api/save-portfolio');
      endpoints.push('http://127.0.0.1:8080/api/save-portfolio');

      setStatus('正在保存到服务器…', true, 'save-clouding');
      for (const ep of endpoints) {
        try {
          const r = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
          });
          if (!r.ok) continue;
          const d = await r.json();
          if (d.ok) {
            setStatus(`✅ 已保存到服务器 · ${d.count} 家持仓 · ${String(d.updated_at).slice(5, 16)}`, true, 'save-cloud-ok');
            if (btn) btn.disabled = false;
            return;
          }
        } catch (e) { /* 尝试下一个端点 */ }
      }

      // 全部失败 → 兜底：导出复制
      setStatus('⚠️ 未连接保存服务，已复制 JSON（贴回对话可入库）', false, 'save-cloud-fail');
      if (btn) btn.disabled = false;
      this._exportPositions();
    },

    _handleAddOrUpdate() {
      const name = document.getElementById('positionStock').value;
      const cost = parseFloat(document.getElementById('positionCost').value) || null;
      const shares = parseFloat(document.getElementById('positionShares').value);
      const note = document.getElementById('positionNote').value.trim();
      if (!name || isNaN(shares) || shares <= 0) { alert('请选择公司并输入有效的持仓数量'); return; }
      const valuation = this.valuations.find(v => v.name === name);
      if (this.editingId) {
        const idx = this.positions.findIndex(p => p.id === this.editingId);
        if (idx !== -1) this.positions[idx] = { ...this.positions[idx], name, ticker: valuation ? valuation.ticker : '', shares, cost, note, updatedAt: new Date().toISOString() };
        this.editingId = null;
        document.getElementById('positionAddBtn').textContent = '添加持仓';
      } else {
        this.positions.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, ticker: valuation ? valuation.ticker : '', shares, cost, note, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      this._savePositions(); this._clearForm(); this._renderAll();
    },

    _clearForm() {
      document.getElementById('positionStock').value = '';
      document.getElementById('positionShares').value = '';
      document.getElementById('positionCost').value = '';
      document.getElementById('positionNote').value = '';
    },

    _editPosition(id) {
      const pos = this.positions.find(p => p.id === id);
      if (!pos) return;
      this.editingId = id;
      document.getElementById('positionStock').value = pos.name;
      document.getElementById('positionCost').value = pos.cost || '';
      document.getElementById('positionShares').value = pos.shares || '';
      document.getElementById('positionNote').value = pos.note || '';
      document.getElementById('positionAddBtn').textContent = '更新持仓';
      document.getElementById('positionForm').scrollIntoView({ behavior: 'smooth' });
    },

    _deletePosition(id) {
      if (!confirm('确认删除？')) return;
      this.positions = this.positions.filter(p => p.id !== id);
      if (this.editingId === id) { this.editingId = null; this._clearForm(); document.getElementById('positionAddBtn').textContent = '添加持仓'; }
      this._savePositions(); this._renderAll();
    },

    _calcPnl(position) {
      const v = this.valuations.find(x => x.name === position.name);
      if (!v || !position.cost) return { pnl: null, pnlPercent: null };
      const cp = this._getLivePrice(position.ticker) || v.current_price;
      if (!cp) return { pnl: null, pnlPercent: null };
      const pct = (cp - position.cost) / position.cost * 100;
      // 盈亏额（万元）= (现价-成本) × 股数 / 10000
      const pnl = ((cp - position.cost) * position.shares) / 10000;
      return { pnl, pnlPercent: pct };
    },

    _calcPnlWithPrice(position, price, v) {
      if (!v || !position.cost || !price) return { pnl: null, pnlPercent: null };
      const pct = (price - position.cost) / position.cost * 100;
      const pnl = ((price - position.cost) * position.shares) / 10000;
      return { pnl, pnlPercent: pct };
    },

    // 市值（万元，原币种）= 股数 × 现价 / 10000
    _marketValue(position, price) {
      return (position.shares * price) / 10000;
    },

    // 成本市值（万元，原币种）= 股数 × 成本价 / 10000
    _costValue(position) {
      return position.cost ? (position.shares * position.cost) / 10000 : 0;
    },

    _extractStopLoss(action, currency) {
      const patterns = [/止损\s*\$(\d+\.?\d*)/, /止损[^\d]*(\d+\.?\d*)\s*(港元|港币|美元)/, /止损[^\d]*(\d+\.?\d*)/];
      for (const pat of patterns) {
        const m = action.match(pat);
        if (m) {
          let unit = m[2] || '';
          if (!unit && pat === patterns[0]) unit = '美元';
          if (!unit) unit = currency === 'USD' ? '美元' : '港币';
          return { price: parseFloat(m[1]), unit };
        }
      }
      return null;
    },

    // ============================================================
    // 总览行
    // ============================================================
    _renderSummary() {
      this._renderSummaryOnly();
    },

    _renderSummaryOnly() {
      let totalHkd = 0; const cb = {};
      let totalPnl = 0; let hasPnl = false;
      let totalCost = 0; let hasCost = false;
      let upCount = 0, downCount = 0;

      this.positions.forEach(p => {
        const v = this.valuations.find(x => x.name === p.name);
        const cur = v ? v.currency : 'HKD';
        const cp = this._getLivePrice(p.ticker) || (v ? v.current_price : 0);
        const mv = this._marketValue(p, cp); // 市值（万元，原币种）
        const amt = cur === 'USD' ? mv * USD_TO_HKD : mv;
        totalHkd += amt;
        cb[cur] = (cb[cur] || 0) + mv;
        const { pnl } = this._calcPnl(p);
        if (pnl !== null) {
          // USD 盈亏折算港币后汇总，保持口径一致
          totalPnl += cur === 'USD' ? pnl * USD_TO_HKD : pnl;
          hasPnl = true;
          if (pnl > 0) upCount++; else if (pnl < 0) downCount++;
        }
        if (p.cost && cur === 'USD') { totalCost += this._costValue(p) * USD_TO_HKD; hasCost = true; }
        else if (p.cost) { totalCost += this._costValue(p); hasCost = true; }
      });
      // === 兼容旧 summary 元素 ===
      const parts = [];
      if (cb['HKD']) parts.push(cb['HKD'].toFixed(2) + ' 万港币');
      if (cb['USD']) parts.push(cb['USD'].toFixed(2) + ' 万美元');
      const totalEl = document.getElementById('totalMarketValue');
      const pnlEl = document.getElementById('totalPnl');
      if (totalEl) totalEl.textContent = parts.join(' + ') + '  ≈ HK$ ' + totalHkd.toFixed(2) + ' 万';
      if (pnlEl) {
        const sign = totalPnl >= 0 ? '+' : '';
        pnlEl.textContent = hasPnl ? sign + totalPnl.toFixed(2) + ' 万' : '--';
        pnlEl.className = totalPnl >= 0 ? 'pnl-up' : 'pnl-down';
      }

      // === 新的 KPI 仪表盘 ===
      // 1. 总市值卡片
      const kpiMv = document.getElementById('kpiMarketValue');
      const kpiMvd = document.getElementById('kpiMarketBreakdown');
      if (kpiMv) {
        kpiMv.textContent = 'HK$ ' + totalHkd.toFixed(2) + ' 万';
        kpiMv.className = 'kpi-value';
      }
      if (kpiMvd) {
        const sub = [];
        if (cb['HKD']) sub.push('港币 ' + cb['HKD'].toFixed(2) + '万');
        if (cb['USD']) sub.push('美元 ' + cb['USD'].toFixed(2) + '万');
        kpiMvd.textContent = sub.join('  ·  ');
      }

      // 2. 实时盈亏卡片（核心）
      const kpiPv = document.getElementById('kpiPnlValue');
      const kpiPpct = document.getElementById('kpiPnlPct');
      const kpiCost = document.getElementById('kpiCostLabel');
      const kpiPnlCard = kpiPv ? kpiPv.parentElement.parentElement : null;
      if (kpiPv) {
        if (hasPnl) {
          const sign = totalPnl >= 0 ? '+' : '';
          kpiPv.textContent = sign + totalPnl.toFixed(2) + ' 万';
          const pnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;
          if (kpiPpct) kpiPpct.textContent = '盈亏率 ' + (pnlPct>=0?'+':'') + pnlPct.toFixed(2) + '%';
          if (kpiCost) kpiCost.textContent = '成本 HK$ ' + totalCost.toFixed(2) + '万';
          // 颜色 + 闪烁动画
          const cls = totalPnl >= 0 ? 'kpi-value pulse-up' : 'kpi-value pulse-down';
          kpiPv.className = cls;
          if (kpiPnlCard) {
            kpiPnlCard.classList.remove('kpi-pnl-up','kpi-pnl-down');
            kpiPnlCard.classList.add(totalPnl >= 0 ? 'kpi-pnl-up' : 'kpi-pnl-down');
          }
          // 移除动画 class 以便下次再触发
          setTimeout(() => { kpiPv.classList.remove('pulse-up','pulse-down'); }, 800);
        } else {
          kpiPv.textContent = '--';
          if (kpiPpct) kpiPpct.textContent = '设置成本后显示盈亏率';
          if (kpiCost) kpiCost.textContent = '成本 --';
        }
      }

      // 3. 实时行情连接状态（由 _renderLiveStatus 统一维护）
      this._renderLiveStatus();
    },

    // ============================================================
    // 持仓卡片（7列）
    // ============================================================
    _renderPositionCards() {
      const container = document.getElementById('positionCards');
      if (!container) return;
      if (this.positions.length === 0) { container.innerHTML = '<div class="empty-state">暂无持仓记录</div>'; return; }

      let totalHkd = 0;
      this.positions.forEach(p => {
        const v = this.valuations.find(x => x.name === p.name);
        const cp = this._getLivePrice(p.ticker) || (v ? v.current_price : 0);
        const mv = this._marketValue(p, cp);
        totalHkd += (v && v.currency === 'USD') ? mv * USD_TO_HKD : mv;
      });

      const sorted = [...this.positions].sort((a, b) => {
        const va = this.valuations.find(x => x.name === a.name);
        const vb = this.valuations.find(x => x.name === b.name);
        const ca = this._getLivePrice(a.ticker) || (va ? va.current_price : 0);
        const cb = this._getLivePrice(b.ticker) || (vb ? vb.current_price : 0);
        return (vb && vb.currency === 'USD' ? this._marketValue(b, cb) * USD_TO_HKD : this._marketValue(b, cb)) - (va && va.currency === 'USD' ? this._marketValue(a, ca) * USD_TO_HKD : this._marketValue(a, ca));
      });

      const fmtP = (v, cur) => (cur === 'USD' ? '$' : 'HK$') + v.toFixed(2);
      const fmtPct = (v) => { const s = v >= 0 ? '+' : ''; return s + v.toFixed(1) + '%'; };

      container.innerHTML = sorted.map(p => {
        const v = this.valuations.find(x => x.name === p.name);
        if (!v) return '';
        const cur = v.currency;
        const cp = this._getLivePrice(p.ticker) || v.current_price;
        const live = this.livePrices[p.ticker];
        const liveChg = live ? live.chg_pct : 0;
        const isLive = !!(live && live.price);
        const { pnl, pnlPercent } = this._calcPnl(p);
        const isUp = pnl !== null && pnl >= 0;
        const pnlSign = pnl !== null ? (pnl >= 0 ? '+' : '') : '';
        const sl = this._extractStopLoss(v.action, cur);
        const mv = this._marketValue(p, cp);
        const amtHkd = cur === 'USD' ? mv * USD_TO_HKD : mv;
        const weight = (amtHkd / totalHkd * 100);
        const fmtShares = (n) => n >= 10000 ? (n / 10000).toFixed(2) + ' 万股' : Math.round(n).toLocaleString() + ' 股';

        const upLow = ((v.target_low - cp) / cp * 100);
        const upBase = ((v.target_base - cp) / cp * 100);
        const upHigh = ((v.target_high - cp) / cp * 100);
        const costDist = p.cost ? ((cp - p.cost) / p.cost * 100) : null;

        const priceMin = Math.min(p.cost || cp, cp, v.target_low);
        const priceMax = Math.max(p.cost || cp, cp, v.target_high);
        const cpPos = ((cp - priceMin) / (priceMax - priceMin || 1) * 100);

        return `<div class="stock-card">
          <div class="sc-head">
            <span class="sc-name">${p.name}</span>
            <span class="sc-code">${p.ticker}</span>
            ${isLive ? `<span class="sc-live-dot" title="实时价格"></span>` : ''}
          </div>
          <div class="sc-weight">${weight.toFixed(1)}%</div>
          <div class="sc-pnl ${isUp ? 'pnl-up' : 'pnl-down'}" id="pos-pnl-${p.id}">
            ${pnl !== null ? pnlSign + pnl.toFixed(2) + ' 万' : '--'}
          </div>
          <div class="sc-change ${isUp ? 'pnl-up' : 'pnl-down'}" id="pos-pnlpct-${p.id}">
            ${pnl !== null ? fmtPct(pnlPercent) : ''}
          </div>
          ${isLive ? `<div class="sc-live-chg ${liveChg >= 0 ? 'pnl-up' : 'pnl-down'}" id="pos-chg-${p.id}">${(liveChg>=0?'+':'') + liveChg.toFixed(2)}%</div>` : ''}
          <div class="sc-rows">
            <div class="sc-row">
              <span>数量</span><span>${fmtShares(p.shares)}</span>
            </div>
            <div class="sc-row">
              <span>成本</span><span>${p.cost ? fmtP(p.cost, cur) : '--'}</span>
              ${costDist !== null ? `<i class="${isUp ? 'pnl-up' : 'pnl-down'}" id="pos-costdist-${p.id}">${fmtPct(costDist)}</i>` : ''}
            </div>
            <div class="sc-row sc-row-now">
              <span>现价</span><span id="pos-price-${p.id}">${fmtP(cp, cur)}</span><i class="sc-cur-label">${cur === 'USD' ? 'USD' : 'HKD'}</i>
            </div>
            <div class="sc-row sc-row-target">
              <span>悲观</span><span>${fmtP(v.target_low, cur)}</span><i class="${upLow >= 0 ? 'pnl-up' : 'pnl-down'}">${fmtPct(upLow)}</i>
            </div>
            <div class="sc-row sc-row-target">
              <span>基准</span><span>${fmtP(v.target_base, cur)}</span><i class="${upBase >= 0 ? 'pnl-up' : 'pnl-down'}">${fmtPct(upBase)}</i>
            </div>
            <div class="sc-row sc-row-target">
              <span>乐观</span><span>${fmtP(v.target_high, cur)}</span><i class="${upHigh >= 0 ? 'pnl-up' : 'pnl-down'}">${fmtPct(upHigh)}</i>
            </div>
          </div>
          <div class="sc-bar"><div class="sc-bar-fill" style="width:${cpPos}%"></div><div class="sc-bar-dot" style="left:${cpPos}%"></div></div>
          ${sl ? `<div class="sc-sl"><span>止损</span><strong>${sl.price} ${sl.unit}</strong></div>` : ''}
          <div class="sc-acts">
            <button class="btn-edit" data-edit="${p.id}">编辑</button>
            <button class="btn-danger" data-delete="${p.id}">删除</button>
          </div>
        </div>`;
      }).join('');

      container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => this._editPosition(b.dataset.edit)));
      container.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => this._deletePosition(b.dataset.delete)));
    },

    // ============================================================
    // 占比条 + 操作计划（合并为单一表格）
    // ============================================================
    _renderWeightAndPlan() {
      const tbody = document.getElementById('weightPlanBody');
      if (!tbody || this.positions.length === 0) return;

      let totalHkd = 0;
      const items = this.positions.map(p => {
        const v = this.valuations.find(x => x.name === p.name);
        const cur = v ? v.currency : 'HKD';
        const cp = this._getLivePrice(p.ticker) || (v ? v.current_price : 0);
        const mv = this._marketValue(p, cp);
        const amt = cur === 'USD' ? mv * USD_TO_HKD : mv;
        totalHkd += amt;
        return { name: p.name, ticker: v ? v.ticker : '', shares: p.shares, marketValue: mv, amountHkd: amt, currency: cur, cp, cost: p.cost, valuation: v };
      });
      items.forEach(it => { it.weight = it.amountHkd / totalHkd * 100; });
      items.sort((a, b) => b.weight - a.weight);

      tbody.innerHTML = items.map(it => {
        const v = it.valuation;
        if (!v) return '';
        const w = Math.round(it.weight);
        const isUp = it.cp >= it.cost;
        let cls = 'tag-hold';
        if (v.action.includes('买入') || v.action.includes('增持')) cls = 'tag-buy';
        else if (v.action.includes('观望')) cls = 'tag-watch';

        // 提取操作建议第一行（短标签）
        const actionShort = v.action.split('，')[0];

        // 高亮关键数字和动作
        const highlight = (text) => {
          if (!text) return '--';
          return text
            .replace(/([><≥≤]?=?\s*\$?\d+\.?\d*[ -]?\$?\d*\.?\d*\s*[万亿美港]?元?)/g, '<em class="hl-num">$1</em>')
            .replace(/(\s*→\s*)/g, '<span class="hl-arrow">→</span>')
            .replace(/(加仓至|减仓至|升级至|立即清仓|清仓|不参与|止损|建仓)/g, '<strong class="hl-act">$1</strong>');
        };

        return `<tr>
          <td>
            <div class="wp-name">${v.name}</div>
            <div class="wp-code">${it.ticker}</div>
          </td>
          <td class="wp-weight-cell">
            <div class="wp-pct">${w}%</div>
            <div class="wb-bar-wrap"><div class="wb-bar ${isUp ? 'wb-up' : 'wb-down'}" style="width:${w}%"></div></div>
          </td>
          <td class="wp-action-cell"><span class="act-tag ${cls}">${actionShort}</span></td>
          <td class="wp-decision-cell">
            <div class="wp-decision-header">${highlight(v.key_node)}</div>
            <div class="wp-decision-body">${highlight(v.trigger)}</div>
          </td>
        </tr>`;
      }).join('');
    },

    _renderAll() {
      this._renderSummary();
      this._renderPositionCards();
      this._renderWeightAndPlan();
    }
  };

  global.Portfolio = Portfolio;
})(window.AIInvest = window.AIInvest || {});
