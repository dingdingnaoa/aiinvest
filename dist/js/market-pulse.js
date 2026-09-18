/**
 * market-pulse.js — GLOBAL MARKET PULSE｜全球市场脉搏
 * 实时跨市场金融终端：A股/港股/美股/利率/汇率/大宗商品
 * 数据源：data/market_pulse.json (snapshot) + 实时 Tencent/CNBC 接口
 */
(function (global) {
  'use strict';

  const MarketPulse = {
    // 状态
    state: {
      data: null,
      lastRefresh: null,
      autoTimer: null,
      realtimeTimer: null,
      isVisible: true
    },

    // 配置
    config: {
      snapshotPath: 'data/market_pulse.json',
      fullRefreshMs: 10 * 60 * 1000,    // 10分钟全量刷新
      incrementalMs: 60 * 1000,          // 1分钟增量刷新
    },

    // ============ 初始化入口 ============
    async init() {
      this._bindVisibility();
      await this._loadSnapshot();
      this._renderAll();
      this._startAutoRefresh();
    },

    // ============ 数据加载 ============
    async _loadSnapshot() {
      const root = document.getElementById('pulseRoot');
      if (!root) return;
      root.innerHTML = '<div class="pulse-loading"><div class="pulse-spinner"></div><span>正在连接全球数据源...</span></div>';

      try {
        const resp = await fetch(this.config.snapshotPath, { cache: 'no-cache' });
        if (!resp.ok) throw new Error('快照加载失败: ' + resp.status);
        this.state.data = await resp.json();
        this.state.lastRefresh = new Date();
      } catch (err) {
        console.error('[MarketPulse] 快照加载失败:', err);
        if (!this.state.data) {
          const root = document.getElementById('pulseRoot');
          if (root) {
            root.innerHTML = '<div class="pulse-error"><div class="pulse-error-icon">⚠️</div><div>数据加载失败</div><div class="pulse-error-detail">请检查网络连接后刷新页面</div></div>';
          }
        }
      }
    },

    async _refreshRealtime() {
      // 增量刷新：只更新价格、涨跌幅、VIX 等高频字段
      // 使用 Tencent 行情接口 (CORS *) 和 CNBC REST API
      try {
        const updates = await this._fetchRealtimeQuotes();
        if (updates && this.state.data) {
          this._mergeRealtime(updates);
          this._updateLiveElements();
        }
      } catch (e) {
        // 静默失败，保留 snapshot 数据
      }
    },

    async _fetchRealtimeQuotes() {
      const updates = { indices: {}, vix: null, us10y: null, gold: null, oil: null };

      try {
        // Tencent 行情 — 批量获取所有指数 + 大宗商品
        const codes = [
          'sh000001','sz399001','sz399006','sh000300','sh000688',  // A股
          'hkHSI','hkHSTECH','hkHSCEI',                            // 港股
          'usDJI','usIXIC','usINX',                                // 美股
          'hf_GC','hf_CL','hf_SI'                                  // 商品期货
        ].join(',');
        const url = `https://qt.gtimg.cn/q=${codes}`;
        const resp = await fetch(url, { cache: 'no-cache' });
        const text = await resp.text();

        // 解析每条 v_xxx="..." 行
        const lines = text.split('\n').filter(l => l.includes('=') && l.includes('"'));
        for (const line of lines) {
          const match = line.match(/v_(\w+)="([^"]*)"/);
          if (!match) continue;
          const code = match[1];
          const raw = match[2];
          const parts = raw.split('~');

          if (code.startsWith('hf_')) {
            // 商品期货：逗号分隔
            const fp = raw.split(',');
            const name = fp[0] || '';
            const price = parseFloat(fp[1]) || 0;
            const chgPct = parseFloat(fp[2]) || 0;
            if (code === 'hf_GC') updates.gold = { price, chg_pct: chgPct, name };
            if (code === 'hf_CL') updates.oil = { price, chg_pct: chgPct, name };
            if (code === 'hf_SI') updates.silver = { price, chg_pct: chgPct, name };
          } else {
            // 指数：波浪号分隔
            if (parts.length < 32) continue;
            const name = parts[1] || '';
            const price = parseFloat(parts[3]) || 0;
            const chgPct = parseFloat(parts[32]) || 0;
            const chg = parseFloat(parts[31]) || 0;
            updates.indices[code] = { name, price, chg_pct: chgPct, chg };
          }
        }
      } catch (e) { /* ignore */ }

      try {
        // CNBC — VIX + US10Y
        const cnbcResp = await fetch('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=.VIX|US10Y&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1', { cache: 'no-cache' });
        const cnbcData = await cnbcResp.json();
        if (cnbcData && cnbcData['FormattedQuoteResult'] && cnbcData['FormattedQuoteResult']['FormattedQuote']) {
          const quotes = cnbcData['FormattedQuoteResult']['FormattedQuote'];
          for (const q of quotes) {
            if (q.symbol === '.VIX') {
              updates.vix = { value: parseFloat(q.last) || 0, chg_pct: parseFloat(q.change_pct) || 0 };
            }
            if (q.symbol === 'US10Y') {
              const last = typeof q.last === 'string' ? q.last.replace('%', '') : q.last;
              updates.us10y = { value: parseFloat(last) || 0, chg_pct: parseFloat(q.change_pct) || 0 };
            }
          }
        }
      } catch (e) { /* ignore */ }
      return updates;
    },

    _mergeRealtime(updates) {
      const d = this.state.data;
      if (!d) return;

      // 合并指数实时报价
      for (const [code, u] of Object.entries(updates.indices)) {
        if (d.indices[code]) {
          d.indices[code].price = u.price;
          d.indices[code].chg_pct = u.chg_pct;
          d.indices[code].chg = u.chg;
        }
      }

      // VIX
      if (updates.vix) {
        d.vix.value = updates.vix.value;
        d.vix.chg_pct = updates.vix.chg_pct;
      }

      // US10Y
      if (updates.us10y) {
        d.rates.us10y.value = updates.us10y.value;
      }

      // 商品
      if (updates.gold) {
        d.commodities.GC.price = updates.gold.price;
        d.commodities.GC.chg_pct = updates.gold.chg_pct;
      }
      if (updates.oil) {
        d.commodities.CL.price = updates.oil.price;
        d.commodities.CL.chg_pct = updates.oil.chg_pct;
      }
      if (updates.silver) {
        d.commodities.SI.price = updates.silver.price;
        d.commodities.SI.chg_pct = updates.silver.chg_pct;
      }
    },

    _updateLiveElements() {
      // 增量更新DOM中已渲染的价格/涨跌幅（避免全量重渲染）
      const d = this.state.data;
      if (!d) return;

      // 指数卡片价格
      for (const [code, idx] of Object.entries(d.indices)) {
        const priceEl = document.getElementById(`pulse-price-${code}`);
        const chgEl = document.getElementById(`pulse-chg-${code}`);
        if (priceEl) priceEl.textContent = this._fmtPrice(idx.price, idx.market);
        if (chgEl) {
          chgEl.textContent = this._fmtPct(idx.chg_pct);
          chgEl.className = this._chgClass(idx.chg_pct) + ' pulse-chg';
        }
      }

      // 商品价格
      for (const [code, comm] of Object.entries(d.commodities)) {
        const priceEl = document.getElementById(`pulse-comm-price-${code}`);
        const chgEl = document.getElementById(`pulse-comm-chg-${code}`);
        if (priceEl) priceEl.textContent = this._fmtPrice(comm.price, 'commodity');
        if (chgEl) {
          chgEl.textContent = this._fmtPct(comm.chg_pct);
          chgEl.className = this._chgClass(comm.chg_pct) + ' pulse-chg';
        }
      }

      // VIX
      const vixEl = document.getElementById('pulse-vix-value');
      const vixChgEl = document.getElementById('pulse-vix-chg');
      if (vixEl) vixEl.textContent = d.vix.value.toFixed(2);
      if (vixChgEl) {
        vixChgEl.textContent = this._fmtPct(d.vix.chg_pct);
        vixChgEl.className = this._chgClass(-d.vix.chg_pct) + ' pulse-chg'; // VIX跌是利好
      }
    },

    // ============ 自动刷新 ============
    _startAutoRefresh() {
      this._stopAutoRefresh();
      this.state.autoTimer = setInterval(() => {
        if (this.state.isVisible) this._loadSnapshot().then(() => this._renderAll());
      }, this.config.fullRefreshMs);
      this.state.realtimeTimer = setInterval(() => {
        if (this.state.isVisible) this._refreshRealtime();
      }, this.config.incrementalMs);
    },

    _stopAutoRefresh() {
      if (this.state.autoTimer) { clearInterval(this.state.autoTimer); this.state.autoTimer = null; }
      if (this.state.realtimeTimer) { clearInterval(this.state.realtimeTimer); this.state.realtimeTimer = null; }
    },

    _bindVisibility() {
      document.addEventListener('visibilitychange', () => {
        this.state.isVisible = !document.hidden;
        if (this.state.isVisible) {
          this._refreshRealtime();
        }
      });
    },

    // ============ 全量渲染 ============
    _renderAll() {
      const d = this.state.data;
      if (!d) return;

      const root = document.getElementById('pulseRoot');
      if (!root) return;

      root.innerHTML = `
        <!-- 顶部刷新栏 -->
        ${this._renderTopBar()}

        <!-- 知行温度计 (市场温度 + 行业温度 合为一体) -->
        ${this._renderTemperatureSystem()}

        <!-- 全球指数矩阵 -->
        <div class="pulse-section">
          <div class="pulse-section-header">
            <h3 class="pulse-section-title">🌏 全球指数</h3>
            <div class="pulse-section-tabs" id="indexRegionTabs">
              <button class="pulse-region-btn active" data-region="all">全部</button>
              <button class="pulse-region-btn" data-region="cn">🇨🇳 A股</button>
              <button class="pulse-region-btn" data-region="hk">🇭🇰 港股</button>
              <button class="pulse-region-btn" data-region="us">🇺🇸 美股</button>
            </div>
          </div>
          <div class="pulse-index-grid" id="pulseIndexGrid">
            ${this._renderIndexCards(d.indices)}
          </div>
        </div>

        <!-- 利率/汇率/VIX/大宗商品 面板 -->
        <div class="pulse-mid-row">
          ${this._renderRatesPanel(d.rates, d.vix)}
          ${this._renderCommoditiesPanel(d.commodities)}
          ${this._renderForexPanel(d.forex, d.rates)}
        </div>

        <!-- 股债风险溢价 (ERP) -->
        <div class="pulse-section">
          <div class="pulse-section-header">
            <h3 class="pulse-section-title">📐 股债风险溢价 (ERP)</h3>
            <span class="pulse-section-hint">ERP = 盈利收益率 − 10年期国债收益率</span>
          </div>
          ${this._renderERPPanel(d.erp, d.valuation)}
        </div>

        <!-- 背离信号 -->
        <div class="pulse-section">
          <div class="pulse-section-header">
            <h3 class="pulse-section-title">🔍 跨市场背离信号</h3>
          </div>
          ${this._renderDivergencePanel(d.divergences)}
        </div>

        <!-- 底部元信息 -->
        <div class="pulse-footer">
          <span>数据更新: ${d.updated_at ? new Date(d.updated_at).toLocaleString('zh-CN') : '--'}</span>
          <span class="pulse-footer-sep">|</span>
          <span>数据源: Tencent行情 · CNBC · East Money · multpl.com</span>
          <span class="pulse-footer-sep">|</span>
          <span>自动刷新: ${this.config.incrementalMs / 1000}s 增量 / ${this.config.fullRefreshMs / 60000}min 全量</span>
          <span class="pulse-footer-sep">|</span>
          <span class="pulse-footer-disclaimer">仅供研究参考，不构成投资建议</span>
        </div>
      `;

      // 绑定地区筛选事件
      this._bindRegionTabs();
    },

    // ============ 顶部栏 ============
    _renderTopBar() {
      const d = this.state.data;
      const risk = d.risk || {};
      const levelClass = this._riskLevelClass(risk.temp);
      return `
        <div class="pulse-topbar">
          <div class="pulse-topbar-left">
            <span class="pulse-topbar-label">GLOBAL MARKET PULSE</span>
            <span class="pulse-topbar-sub">全球市场脉搏</span>
          </div>
          <div class="pulse-topbar-center">
            <span class="pulse-refresh-indicator" id="pulseRefreshDot"></span>
            <span class="pulse-refresh-text" id="pulseRefreshTime">实时</span>
          </div>
          <div class="pulse-topbar-right">
            <span class="pulse-risk-badge ${levelClass}">${risk.level || '--'} · ${risk.temp != null ? risk.temp.toFixed(0) : '--'}/100</span>
            <button class="pulse-refresh-btn" id="pulseManualRefresh" title="手动刷新">↻</button>
          </div>
        </div>`;
    },

    // ============ 风险温度计 ============
    _renderRiskGauge() {
      const d = this.state.data;
      const risk = d.risk || {};
      const temp = risk.temp || 0;
      const comp = risk.components || {};

      // 温度计颜色映射
      let tempColor, tempLabel;
      if (temp < 25) { tempColor = '#16a34a'; tempLabel = '低温 · 风险偏好'; }
      else if (temp < 45) { tempColor = '#65a30d'; tempLabel = '温和 · 适度乐观'; }
      else if (temp < 60) { tempColor = '#d97706'; tempLabel = '中性 · 保持警惕'; }
      else if (temp < 75) { tempColor = '#ea580c'; tempLabel = '偏高 · 注意风控'; }
      else { tempColor = '#dc2626'; tempLabel = '高温 · 高度警戒'; }

      // SVG 温度计
      const svgHeight = 200;
      const fillHeight = (temp / 100) * 160;
      const mercuryY = 180 - fillHeight;

      return `
        <div class="pulse-card pulse-risk-card">
          <div class="pulse-card-title">🌡️ 全球风险温度</div>
          <div class="pulse-gauge-wrap">
            <svg viewBox="0 0 100 ${svgHeight}" class="pulse-gauge-svg">
              <!-- 温度计主体 -->
              <defs>
                <linearGradient id="tempGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stop-color="#16a34a"/>
                  <stop offset="30%" stop-color="#65a30d"/>
                  <stop offset="55%" stop-color="#d97706"/>
                  <stop offset="75%" stop-color="#ea580c"/>
                  <stop offset="100%" stop-color="#dc2626"/>
                </linearGradient>
              </defs>
              <!-- 管身背景 -->
              <rect x="40" y="20" width="20" height="160" rx="10" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="1"/>
              <!-- 水银柱 -->
              <rect x="40" y="${mercuryY}" width="20" height="${fillHeight}" rx="10" fill="url(#tempGrad)"/>
              <!-- 球泡 -->
              <circle cx="50" cy="190" r="14" fill="${tempColor}" stroke="#e5e7eb" stroke-width="1"/>
              <!-- 刻度线 -->
              ${[0, 25, 50, 75, 100].map(v => {
                const y = 180 - (v / 100) * 160;
                return `<line x1="62" y1="${y}" x2="68" y2="${y}" stroke="#9ca3af" stroke-width="1"/><text x="71" y="${y + 4}" fill="#9ca3af" font-size="9" font-family="var(--font-mono)">${v}</text>`;
              }).join('')}
            </svg>
            <div class="pulse-gauge-value" style="color:${tempColor}">${temp.toFixed(1)}</div>
            <div class="pulse-gauge-label" style="color:${tempColor}">${tempLabel}</div>
          </div>
          <div class="pulse-risk-desc">${risk.desc || ''}</div>
          <div class="pulse-risk-breakdown">
            <div class="pulse-risk-comp">
              <span>波动率</span><span class="pulse-risk-comp-val">${comp.volatility != null ? comp.volatility.toFixed(0) : '--'}</span>
            </div>
            <div class="pulse-risk-comp">
              <span>动量</span><span class="pulse-risk-comp-val">${comp.momentum != null ? comp.momentum.toFixed(0) : '--'}</span>
            </div>
          </div>
        </div>`;
    },

    // ============ 关键指标 ============
    _renderKeyMetrics() {
      const d = this.state.data;
      const vix = d.vix || {};
      const rates = d.rates || {};
      const us10y = rates.us10y || {};
      const cn10y = rates.cn10y || {};

      return `
        <div class="pulse-card pulse-metrics-card">
          <div class="pulse-card-title">📊 核心指标速览</div>
          <div class="pulse-metrics-grid">
            <div class="pulse-metric-item">
              <div class="pulse-metric-label">VIX 恐慌指数</div>
              <div class="pulse-metric-value" id="pulse-vix-value">${vix.value != null ? vix.value.toFixed(2) : '--'}</div>
              <div class="pulse-metric-sub ${this._chgClass(-(vix.chg_pct||0))}" id="pulse-vix-chg">${this._fmtPct(vix.chg_pct)}</div>
            </div>
            <div class="pulse-metric-item">
              <div class="pulse-metric-label">美国 10Y 国债</div>
              <div class="pulse-metric-value">${us10y.value != null ? us10y.value.toFixed(3) + '%' : '--'}</div>
              <div class="pulse-metric-sub pulse-metric-neutral">${rates.us10y_5d_bp != null ? (rates.us10y_5d_bp > 0 ? '+' : '') + rates.us10y_5d_bp.toFixed(1) + 'bp' : ''}</div>
            </div>
            <div class="pulse-metric-item">
              <div class="pulse-metric-label">中国 10Y 国债</div>
              <div class="pulse-metric-value">${cn10y.value != null ? cn10y.value.toFixed(4) + '%' : '--'}</div>
              <div class="pulse-metric-sub pulse-metric-neutral">${cn10y.date || ''}</div>
            </div>
            <div class="pulse-metric-item">
              <div class="pulse-metric-label">中美利差</div>
              <div class="pulse-metric-value ${(rates.spread_bp||0) < 0 ? 'pulse-negative' : ''}">${rates.spread_bp != null ? rates.spread_bp.toFixed(0) + 'bp' : '--'}</div>
              <div class="pulse-metric-sub pulse-metric-neutral">美−中</div>
            </div>
            <div class="pulse-metric-item">
              <div class="pulse-metric-label">沪深300 PE</div>
              <div class="pulse-metric-value">${d.valuation && d.valuation.csi300_pe ? d.valuation.csi300_pe.toFixed(2) : '--'}</div>
              <div class="pulse-metric-sub pulse-metric-neutral">TTM</div>
            </div>
            <div class="pulse-metric-item">
              <div class="pulse-metric-label">标普500 EY</div>
              <div class="pulse-metric-value ${(d.valuation && d.valuation.spx_ey) ? (d.valuation.spx_ey < d.valuation.spx_ey_median ? 'pulse-negative' : 'pulse-positive') : ''}">${d.valuation && d.valuation.spx_ey ? d.valuation.spx_ey.toFixed(2) + '%' : '--'}</div>
              <div class="pulse-metric-sub pulse-metric-neutral">中位: ${d.valuation && d.valuation.spx_ey_median ? d.valuation.spx_ey_median.toFixed(2) + '%' : '--'}</div>
            </div>
          </div>
        </div>`;
    },

    // ============ 指数卡片 ============
    _renderIndexCards(indices) {
      if (!indices) return '';
      const order = ['sh000001','sz399001','sz399006','sh000300','sh000688','hkHSI','hkHSTECH','hkHSCEI','usDJI','usIXIC','usINX'];

      return order.map(code => {
        const idx = indices[code];
        if (!idx) return '';
        const chgCls = this._chgClass(idx.chg_pct);
        const marketLabel = { cn: 'A股', hk: '港股', us: '美股' }[idx.market] || '';
        const marketFlag = { cn: '🇨🇳', hk: '🇭🇰', us: '🇺🇸' }[idx.market] || '';
        const regionClass = `pulse-idx-${idx.market}`;

        return `
          <div class="pulse-idx-card ${regionClass}" data-market="${idx.market}">
            <div class="pulse-idx-head">
              <span class="pulse-idx-flag">${marketFlag}</span>
              <span class="pulse-idx-name">${idx.name}</span>
              <span class="pulse-idx-market">${marketLabel}</span>
            </div>
            <div class="pulse-idx-price" id="pulse-price-${code}">${this._fmtPrice(idx.price, idx.market)}</div>
            <div class="pulse-idx-change">
              <span class="${chgCls} pulse-chg" id="pulse-chg-${code}">${this._fmtPct(idx.chg_pct)}</span>
            </div>
            <div class="pulse-idx-extra">
              <div class="pulse-idx-row">
                <span>5日</span>
                <span class="${this._chgClass(idx.chg5d)}">${this._fmtPct(idx.chg5d)}</span>
              </div>
              <div class="pulse-idx-row">
                <span>20日波</span>
                <span>${idx.vol20 != null ? idx.vol20.toFixed(1) + '%' : '--'}</span>
              </div>
              <div class="pulse-idx-row">
                <span>52周高</span>
                <span>${idx.high52 ? this._fmtPrice(idx.high52, idx.market) : '--'}</span>
              </div>
              <div class="pulse-idx-row">
                <span>52周低</span>
                <span>${idx.low52 ? this._fmtPrice(idx.low52, idx.market) : '--'}</span>
              </div>
            </div>
          </div>`;
      }).join('');
    },

    // ============ 利率面板 ============
    _renderRatesPanel(rates, vix) {
      const us10y = rates.us10y || {};
      const cn10y = rates.cn10y || {};
      const cn30y = rates.cn30y || {};
      const cn1y = rates.cn1y || {};

      return `
        <div class="pulse-card pulse-panel-card">
          <div class="pulse-card-title">📈 利率与债券</div>
          <div class="pulse-rates-grid">
            <div class="pulse-rate-row">
              <div class="pulse-rate-label">🇺🇸 美国10Y</div>
              <div class="pulse-rate-value">${us10y.value != null ? us10y.value.toFixed(3) + '%' : '--'}</div>
              <div class="pulse-rate-bar">
                <div class="pulse-rate-fill" style="width:${Math.min((us10y.value||0)/7*100,100)}%;background:${(us10y.value||0)>4.5?'#dc2626':(us10y.value||0)>3.5?'#d97706':'#16a34a'}"></div>
              </div>
            </div>
            <div class="pulse-rate-row">
              <div class="pulse-rate-label">🇨🇳 中国10Y</div>
              <div class="pulse-rate-value">${cn10y.value != null ? cn10y.value.toFixed(4) + '%' : '--'}</div>
              <div class="pulse-rate-bar">
                <div class="pulse-rate-fill" style="width:${Math.min((cn10y.value||0)/5*100,100)}%;background:#16a34a"></div>
              </div>
            </div>
            <div class="pulse-rate-row">
              <div class="pulse-rate-label">中国30Y</div>
              <div class="pulse-rate-value">${cn30y.value != null ? cn30y.value.toFixed(4) + '%' : '--'}</div>
              <div class="pulse-rate-bar">
                <div class="pulse-rate-fill" style="width:${Math.min((cn30y.value||0)/5*100,100)}%;background:#8b5cf6"></div>
              </div>
            </div>
            <div class="pulse-rate-row">
              <div class="pulse-rate-label">中国1Y</div>
              <div class="pulse-rate-value">${cn1y.value != null ? cn1y.value.toFixed(4) + '%' : '--'}</div>
              <div class="pulse-rate-bar">
                <div class="pulse-rate-fill" style="width:${Math.min((cn1y.value||0)/5*100,100)}%;background:#06b6d4"></div>
              </div>
            </div>
            <div class="pulse-rate-row pulse-rate-spread">
              <div class="pulse-rate-label">中美利差</div>
              <div class="pulse-rate-value ${(rates.spread_bp||0)<0?'pulse-negative':''}">${rates.spread_bp != null ? rates.spread_bp.toFixed(0) + 'bp' : '--'}</div>
              <div class="pulse-rate-desc">${(rates.spread_bp||0)<0?'倒挂中':'正常'}</div>
            </div>
          </div>
          <div class="pulse-vix-mini">
            <span>VIX</span>
            <span class="pulse-vix-badge ${vix.value>30?'pulse-vix-high':vix.value>20?'pulse-vix-mid':'pulse-vix-low'}">${vix.value != null ? vix.value.toFixed(1) : '--'}</span>
            <span class="pulse-vix-desc">${vix.value>30?'高波动':vix.value>20?'中等波动':'低波动'}</span>
          </div>
        </div>`;
    },

    // ============ 大宗商品面板 ============
    _renderCommoditiesPanel(commodities) {
      if (!commodities) return '';
      const items = [
        { key: 'GC', icon: '🥇', name: '黄金' },
        { key: 'SI', icon: '🥈', name: '白银' },
        { key: 'CL', icon: '🛢️', name: 'WTI原油' },
        { key: 'HG', icon: '🔶', name: '铜' }
      ];

      return `
        <div class="pulse-card pulse-panel-card">
          <div class="pulse-card-title">🏭 大宗商品</div>
          <div class="pulse-comm-grid">
            ${items.map(item => {
              const c = commodities[item.key];
              if (!c) return '';
              return `
                <div class="pulse-comm-item">
                  <div class="pulse-comm-icon">${item.icon}</div>
                  <div class="pulse-comm-info">
                    <div class="pulse-comm-name">${item.name}</div>
                    <div class="pulse-comm-price" id="pulse-comm-price-${item.key}">${this._fmtPrice(c.price, 'commodity')}</div>
                    <div class="${this._chgClass(c.chg_pct)} pulse-comm-chg" id="pulse-comm-chg-${item.key}">${this._fmtPct(c.chg_pct)}</div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    },

    // ============ 汇率面板 ============
    _renderForexPanel(forex, rates) {
      const dxy = forex.DXY || {};
      const usdcny = forex.USDCNY || {};

      return `
        <div class="pulse-card pulse-panel-card">
          <div class="pulse-card-title">💱 汇率</div>
          <div class="pulse-forex-grid">
            <div class="pulse-forex-item">
              <div class="pulse-forex-label">美元指数</div>
              <div class="pulse-forex-value">${dxy.price != null ? dxy.price.toFixed(2) : '--'}</div>
              <div class="${this._chgClass(dxy.chg_pct)} pulse-forex-chg">${this._fmtPct(dxy.chg_pct)}</div>
            </div>
            <div class="pulse-forex-item">
              <div class="pulse-forex-label">USD/CNY</div>
              <div class="pulse-forex-value">${usdcny.price != null ? usdcny.price.toFixed(4) : '--'}</div>
              <div class="${this._chgClass(-(usdcny.chg_pct||0))} pulse-forex-chg">${this._fmtPct(usdcny.chg_pct)}</div>
              <div class="pulse-forex-desc">人民币${(usdcny.chg_pct||0)<0?'升值':'贬值'}</div>
            </div>
            <div class="pulse-forex-item">
              <div class="pulse-forex-label">中美利差</div>
              <div class="pulse-forex-value ${(rates.spread_bp||0)<0?'pulse-negative':''}">${rates.spread_bp != null ? rates.spread_bp.toFixed(0) + 'bp' : '--'}</div>
              <div class="pulse-forex-desc">${(rates.spread_bp||0)<0?'资本外流压力':'正常'}</div>
            </div>
          </div>
        </div>`;
    },

    // ============ ERP 面板 ============
    _renderERPPanel(erp, valuation) {
      const cn = erp.cn || {};
      const us = erp.us || {};
      const hk = erp.hk;

      return `
        <div class="pulse-erp-grid">
          <div class="pulse-erp-card ${(cn.erp||0)>0?'pulse-erp-positive':'pulse-erp-negative'}">
            <div class="pulse-erp-market">🇨🇳 ${cn.index || '沪深300'}</div>
            <div class="pulse-erp-formula">
              <div class="pulse-erp-line">
                <span>盈利收益率 (1/PE)</span>
                <span class="pulse-erp-num">${cn.earnings_yield != null ? cn.earnings_yield.toFixed(2) + '%' : '--'}</span>
              </div>
              <div class="pulse-erp-line">
                <span>− 10Y国债</span>
                <span class="pulse-erp-num">${cn.bond_yield != null ? cn.bond_yield.toFixed(2) + '%' : '--'}</span>
              </div>
              <div class="pulse-erp-line pulse-erp-result">
                <span>= ERP</span>
                <span class="pulse-erp-num pulse-erp-big">${cn.erp != null ? cn.erp.toFixed(2) + '%' : '--'}</span>
              </div>
            </div>
            <div class="pulse-erp-verdict">${(cn.erp||0)>3?'✅ 股票相对债券极具吸引力':(cn.erp||0)>0?'⚖️ 股票略有优势':'⚠️ 债券相对更优'}</div>
          </div>

          <div class="pulse-erp-card ${(us.erp||0)>0?'pulse-erp-positive':'pulse-erp-negative'}">
            <div class="pulse-erp-market">🇺🇸 ${us.index || '标普500'}</div>
            <div class="pulse-erp-formula">
              <div class="pulse-erp-line">
                <span>盈利收益率 (EY)</span>
                <span class="pulse-erp-num">${us.earnings_yield != null ? us.earnings_yield.toFixed(2) + '%' : '--'}</span>
              </div>
              <div class="pulse-erp-line">
                <span>− 10Y国债</span>
                <span class="pulse-erp-num">${us.bond_yield != null ? us.bond_yield.toFixed(3) + '%' : '--'}</span>
              </div>
              <div class="pulse-erp-line pulse-erp-result">
                <span>= ERP</span>
                <span class="pulse-erp-num pulse-erp-big">${us.erp != null ? us.erp.toFixed(2) + '%' : '--'}</span>
              </div>
            </div>
            <div class="pulse-erp-verdict">${(us.erp||0)>0?'⚖️ 股票略有优势':'🔴 标普相对国债溢价为负，美股估值偏高'}</div>
            ${valuation && valuation.spx_ey_mean ? `<div class="pulse-erp-note">历史EY均值: ${valuation.spx_ey_mean.toFixed(2)}% | 中位: ${valuation.spx_ey_median.toFixed(2)}%</div>` : ''}
          </div>

          <div class="pulse-erp-card pulse-erp-na">
            <div class="pulse-erp-market">🇭🇰 恒生指数</div>
            <div class="pulse-erp-na-text">暂无实时PE数据</div>
            <div class="pulse-erp-na-detail">所有免费数据源均不提供恒生指数实时PE-TTM</div>
          </div>
        </div>`;
    },

    // ============ 背离信号面板 ============
    _renderDivergencePanel(divergences) {
      if (!divergences || divergences.length === 0) {
        return `<div class="pulse-div-empty">暂无背离信号</div>`;
      }
      return `
        <div class="pulse-div-grid">
          ${divergences.map(d => {
            let levelCls, levelLabel;
            if (d.level === 2) { levelCls = 'pulse-div-critical'; levelLabel = '🔴 强信号'; }
            else if (d.level === 1) { levelCls = 'pulse-div-warn'; levelLabel = '🟡 弱信号'; }
            else { levelCls = 'pulse-div-ok'; levelLabel = '🟢 正常'; }
            return `
              <div class="pulse-div-card ${levelCls}">
                <div class="pulse-div-head">
                  <span class="pulse-div-name">${d.name}</span>
                  <span class="pulse-div-level">${levelLabel}</span>
                </div>
                <div class="pulse-div-detail">${d.detail || ''}</div>
              </div>`;
          }).join('')}
        </div>`;
    },

    // ============ 地区筛选 ============
    _bindRegionTabs() {
      const tabs = document.querySelectorAll('#indexRegionTabs .pulse-region-btn');
      const cards = document.querySelectorAll('.pulse-idx-card');

      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const region = tab.dataset.region;

          cards.forEach(card => {
            if (region === 'all' || card.dataset.market === region) {
              card.style.display = '';
            } else {
              card.style.display = 'none';
            }
          });
        });
      });

      // 手动刷新按钮
      const refreshBtn = document.getElementById('pulseManualRefresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          this._loadSnapshot().then(() => this._renderAll());
        });
      }
    },

    // ============ 工具函数 ============
    _fmtPrice(price, market) {
      if (price == null || isNaN(price)) return '--';
      if (market === 'commodity' && price > 100) return price.toFixed(1);
      if (market === 'commodity') return price.toFixed(2);
      if (market === 'us') return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    _fmtPct(pct) {
      if (pct == null || isNaN(pct)) return '--';
      const sign = pct > 0 ? '+' : '';
      return sign + pct.toFixed(2) + '%';
    },

    _chgClass(pct) {
      if (pct == null || isNaN(pct)) return '';
      if (pct > 0) return 'pulse-up';
      if (pct < 0) return 'pulse-down';
      return 'pulse-flat';
    },

    _riskLevelClass(temp) {
      if (temp == null) return '';
      if (temp < 25) return 'pulse-risk-cool';
      if (temp < 45) return 'pulse-risk-mild';
      if (temp < 60) return 'pulse-risk-neutral';
      if (temp < 75) return 'pulse-risk-warn';
      return 'pulse-risk-hot';
    },

    // ============ 市场温度计算 ============

    /**
     * Compute market-level temperature (0-100) for a given market.
     * Uses available snapshot data — no additional API calls.
     */
    _computeMarketTemperature(market, d) {
      const indices = d.indices || {};
      const valuation = d.valuation || {};
      const erp = d.erp || {};
      const vix = d.vix || {};

      // -- A股 (50% PE + 25% 动量 + 15% 波动率 + 10% ERP) --
      if (market === 'cn') {
        const pe = valuation.csi300_pe;
        let peScore = 50;
        if (pe != null) {
          peScore = Math.max(0, Math.min(100, (pe - 10) / (30 - 10) * 100));
        }

        const cnIdx = ['sh000001', 'sz399001', 'sh000300'];
        const momVals = cnIdx.map(c => (indices[c] || {}).chg_pct).filter(v => v != null);
        const momAvg = momVals.length ? momVals.reduce((a, b) => a + b, 0) / momVals.length : 0;
        const momScore = Math.max(0, Math.min(100, 50 - momAvg * 33.3));

        const volVals = cnIdx.map(c => (indices[c] || {}).vol20).filter(v => v != null);
        const volAvg = volVals.length ? volVals.reduce((a, b) => a + b, 0) / volVals.length : 20;
        const volScore = Math.max(0, Math.min(100, volAvg * 2));

        const cnErp = (erp.cn || {}).erp;
        let erpScore = 50;
        if (cnErp != null) {
          erpScore = Math.max(0, Math.min(100, 50 - cnErp * 10));
        }

        const temp = peScore * 0.50 + momScore * 0.25 + volScore * 0.15 + erpScore * 0.10;
        return {
          temp: Math.round(temp * 10) / 10,
          level: this._tempLevel(temp),
          components: { pe: Math.round(peScore), momentum: Math.round(momScore), volatility: Math.round(volScore), erp: Math.round(erpScore) }
        };
      }

      // -- 港股 (50% PE proxy via 52w + 25% 动量 + 15% 波动率 + 10% ERP) --
      if (market === 'hk') {
        const hsi = indices['hkHSI'] || {};
        let peScore = 50;
        if (hsi.price && hsi.high52 && hsi.low52 && hsi.high52 !== hsi.low52) {
          peScore = Math.round(((hsi.price - hsi.low52) / (hsi.high52 - hsi.low52)) * 100);
        }

        const hkIdx = ['hkHSI', 'hkHSTECH', 'hkHSCEI'];
        const momVals = hkIdx.map(c => (indices[c] || {}).chg_pct).filter(v => v != null);
        const momAvg = momVals.length ? momVals.reduce((a, b) => a + b, 0) / momVals.length : 0;
        const momScore = Math.max(0, Math.min(100, 50 - momAvg * 33.3));

        const volVals = hkIdx.map(c => (indices[c] || {}).vol20).filter(v => v != null);
        const volAvg = volVals.length ? volVals.reduce((a, b) => a + b, 0) / volVals.length : 20;
        const volScore = Math.max(0, Math.min(100, volAvg * 2));

        const erpScore = 50; // HK ERP unavailable

        const temp = peScore * 0.50 + momScore * 0.25 + volScore * 0.15 + erpScore * 0.10;
        return {
          temp: Math.round(temp * 10) / 10,
          level: this._tempLevel(temp),
          components: { pe: peScore, momentum: Math.round(momScore), volatility: Math.round(volScore), erp: erpScore }
        };
      }

      // -- 美股 (50% EY vs history + 25% VIX + 15% 动量 + 10% ERP) --
      if (market === 'us') {
        const ey = valuation.spx_ey;
        const eyMean = valuation.spx_ey_mean || 7.2;
        let eyScore = 50;
        if (ey != null && eyMean != null && eyMean > 0) {
          eyScore = Math.max(0, Math.min(100, 100 - (ey / eyMean) * 50));
        }

        const vixVal = vix.value;
        let vixScore = 50;
        if (vixVal != null) {
          vixScore = Math.max(0, Math.min(100, (vixVal - 12) / (35 - 12) * 100));
        }

        const usIdx = ['usDJI', 'usIXIC', 'usINX'];
        const momVals = usIdx.map(c => (indices[c] || {}).chg_pct).filter(v => v != null);
        const momAvg = momVals.length ? momVals.reduce((a, b) => a + b, 0) / momVals.length : 0;
        const momScore = Math.max(0, Math.min(100, 50 - momAvg * 33.3));

        const usErp = (erp.us || {}).erp;
        let erpScore = 50;
        if (usErp != null) {
          erpScore = Math.max(0, Math.min(100, 50 - usErp * 10));
        }

        const temp = eyScore * 0.50 + vixScore * 0.25 + momScore * 0.15 + erpScore * 0.10;
        return {
          temp: Math.round(temp * 10) / 10,
          level: this._tempLevel(temp),
          components: { valuation: Math.round(eyScore), vix: Math.round(vixScore), momentum: Math.round(momScore), erp: Math.round(erpScore) }
        };
      }

      return null;
    },

    _tempLevel(temp) {
      if (temp < 25) return { text: '低温', cls: 'pulse-temp-cool' };
      if (temp < 45) return { text: '温和', cls: 'pulse-temp-mild' };
      if (temp < 65) return { text: '偏热', cls: 'pulse-temp-warm' };
      if (temp < 85) return { text: '高热', cls: 'pulse-temp-hot' };
      return { text: '极端', cls: 'pulse-temp-extreme' };
    },

    _tempColor(temp) {
      if (temp < 25) return '#16a34a';
      if (temp < 45) return '#65a30d';
      if (temp < 60) return '#d97706';
      if (temp < 75) return '#ea580c';
      return '#dc2626';
    },

    // ================================================================
    // 知行温度计 — 有知有行方法论
    // ================================================================
    //
    // 核心设计哲学 (孟岩):
    //   "好资产 + 好价格 + 真的看懂" — 温度计帮你判断"好价格"
    //   "投资是认知的变现" — 温度计帮你认知市场周期位置
    //   "长期主义" — 用多维度指标而非单一PE判断冷热
    //   "等权思想" — 每个维度平等看待，不偏废
    //
    // 行业温度公式 (有知有行 + 集思录方法论改进):
    //   PE估值温度 (40%): PE在行业合理区间的相对位置
    //   动量温度   (25%): 近期涨跌幅 → 过热/恐慌信号
    //   波动率温度 (20%): 20日实现波动率 → 不确定性
    //   52周位置   (15%): 股价在52周区间位置 → 短期热度
    //
    //   综合温度 = PE×0.40 + 动量×0.25 + 波动×0.20 + 52周×0.15
    //
    //   解读: 0-25 低温低估(好价格) / 25-45 温和 / 45-65 中性偏热 /
    //         65-85 高温 / 85-100 过热(谨慎)
    // ================================================================

    /**
     * 行业PE合理区间 (基于行业特性、盈利模式、成长性)
     * lo=合理低估线, hi=合理高估线
     */
    _sectorPeRanges: {
      'sz399986': { lo: 4,  hi: 12 },   // 银行 — 低PE行业，稳定但不增长
      'sz399975': { lo: 10, hi: 30 },   // 证券 — 周期性强，牛熊PE波动大
      'sz399808': { lo: 15, hi: 55 },   // 新能源 — 成长行业，PE容忍度高
      'sz399811': { lo: 25, hi: 85 },   // 电子 — 科技成长，PE中枢高
      'sz399989': { lo: 20, hi: 70 },   // 医疗 — 成长防御，PE中枢偏高
      'sz399997': { lo: 15, hi: 50 },   // 白酒 — 品牌消费，PE稳定
      'sz399967': { lo: 30, hi: 100 },  // 军工 — 高PE行业，政策驱动
      'sz399998': { lo: 6,  hi: 30 },   // 煤炭 — 周期行业，PE波动大
      'sz399971': { lo: 15, hi: 60 },   // 传媒 — 成长+周期
      'sz399976': { lo: 15, hi: 60 },   // 新能源车 — 高成长
      'sz399933': { lo: 20, hi: 55 },   // 医药 — 成长防御，PE中枢偏高
      'sz399970': { lo: 20, hi: 80 },   // 移动互联 — 科技成长，PE弹性大
    },

    /**
     * 有知有行风格行业温度计算
     * 多维度综合: PE估值 + 动量 + 波动率 + 52周位置
     */
    _computeSectorTemperature(code, sector, d) {
      const indices = d.indices || {};
      const range = this._sectorPeRanges[code];
      if (!range || !sector) return null;

      const { lo, hi } = range;
      const pe = sector.pe;
      const chgPct = sector.chg_pct || 0;
      const price = sector.price;

      // --- 1. PE估值温度 (40%) ---
      // 有知有行核心理念: PE分位数 = 当前PE在历史区间内的位置
      // 我们用合理lo-hi区间模拟PE分位数
      let peScore = 50;
      if (pe != null && pe > 0 && hi > lo) {
        peScore = Math.max(0, Math.min(100, ((pe - lo) / (hi - lo)) * 100));
      }

      // --- 2. 动量温度 (25%) ---
      // 大涨=过热信号，大跌=恐慌(但可能是好价格)
      // +3% → 100 (过热), 0% → 50 (中性), -3% → 0 (恐慌/低估)
      const momScore = Math.max(0, Math.min(100, 50 + chgPct * 16.7));

      // --- 3. 波动率温度 (20%) ---
      // 用指数波动率作为代理 (行业指数的vol20在JSON里没有，用对应宽基近似)
      // 高波动 = 高不确定性 = 偏热
      let volScore = 50;
      const proxyIdx = sector.market === 'hk' ? indices['hkHSI'] : indices['sh000001'];
      if (proxyIdx && proxyIdx.vol20 != null) {
        volScore = Math.max(0, Math.min(100, proxyIdx.vol20 * 2));
      }

      // --- 4. 52周位置温度 (15%) ---
      // 有知有行思想: 当前价格在52周区间的位置反映短期热度
      // 没有行业指数的52周数据，用价格和PE共同判断
      // PE越高 + 近期涨幅越大 = 越可能处于52周高位
      let pos52Score = 50;
      if (pe != null && pe > 0 && hi > lo) {
        // PE已经反映了大部分52周位置信息，再加上动量修正
        const pePos = ((pe - lo) / (hi - lo));
        const momAdj = chgPct * 0.05; // ±3% → ±0.15修正
        pos52Score = Math.max(0, Math.min(100, (pePos + momAdj) * 100));
      }

      // --- 综合加权 ---
      const temp = peScore * 0.40 + momScore * 0.25 + volScore * 0.20 + pos52Score * 0.15;
      const rounded = Math.round(temp);

      return {
        temp: rounded,
        level: this._tempLevel(rounded),
        pe: pe,
        components: {
          pe: Math.round(peScore),
          momentum: Math.round(momScore),
          volatility: Math.round(volScore),
          pos52: Math.round(pos52Score),
        }
      };
    },

    // ============ 知行温度计统一渲染 ============

    _renderTemperatureSystem() {
      const d = this.state.data;
      return `
        <div class="pulse-section">
          <div class="pulse-section-header">
            <h3 class="pulse-section-title">🌡️ 知行温度计</h3>
            <span class="pulse-section-hint">有知有行方法论 · 好资产+好价格 · 多维度估值</span>
          </div>

          <!-- 市场温度 -->
          <div class="pulse-market-gauges">${this._renderMarketGaugeCards()}</div>

          <!-- 行业温度 -->
          ${this._renderSectorGaugeGrids()}
        </div>`;
    },

    /**
     * 市场温度卡片 (仅返回卡片HTML，不含外层wrapper)
     */
    _renderMarketGaugeCards() {
      const d = this.state.data;
      const globalRisk = d.risk || {};
      const markets = [
        { key: 'global', label: '全球', icon: '🌐',
          data: { temp: globalRisk.temp || 0, level: { text: globalRisk.level || '--', cls: this._riskLevelClass(globalRisk.temp) } } },
        { key: 'cn', label: 'A股', icon: '🇨🇳',
          data: this._computeMarketTemperature('cn', d) },
        { key: 'hk', label: '港股', icon: '🇭🇰',
          data: this._computeMarketTemperature('hk', d) },
        { key: 'us', label: '美股', icon: '🇺🇸',
          data: this._computeMarketTemperature('us', d) },
      ];

      return markets.map(m => {
        const t = m.data || {};
        const temp = t.temp || 0;
        const level = t.level || { text: '--', cls: '' };
        const color = this._tempColor(temp);

        return `
          <div class="pulse-market-gauge-card">
            <div class="pulse-mg-header">
              <span class="pulse-mg-icon">${m.icon}</span>
              <span class="pulse-mg-label">${m.label}</span>
            </div>
            <div class="pulse-mg-bar-wrap">
              <div class="pulse-mg-bar-bg">
                <div class="pulse-mg-bar-fill" style="width:${temp}%;background:${color};"></div>
              </div>
              <div class="pulse-mg-marker" style="left:${temp}%;"></div>
            </div>
            <div class="pulse-mg-bottom">
              <span class="pulse-mg-temp" style="color:${color}">${temp.toFixed(0)}°</span>
              <span class="pulse-mg-level ${level.cls}">${level.text}</span>
            </div>
            ${this._renderMgComponents(t.components, m.key)}
          </div>`;
      }).join('');
    },

    _renderMgComponents(comp, market) {
      if (!comp) return '';
      const labels = {
        global: { volatility: '波动', momentum: '动量', safehaven: '避险', fx: '汇率' },
        cn: { pe: 'PE估值', momentum: '动量', volatility: '波动', erp: 'ERP' },
        hk: { pe: '52周位', momentum: '动量', volatility: '波动', erp: 'ERP' },
        us: { valuation: '估值', vix: 'VIX', momentum: '动量', erp: 'ERP' },
      };
      const map = labels[market] || {};
      const items = Object.entries(comp).map(([k, v]) =>
        `<div class="pulse-mg-comp-item"><span class="pulse-mg-comp-label">${map[k] || k}</span><span class="pulse-mg-comp-val">${v}</span></div>`
      ).join('');
      return `<div class="pulse-mg-components">${items}</div>`;
    },

    /**
     * 行业温度网格 (仅返回网格HTML，不含外层wrapper)
     */
    _renderSectorGaugeGrids() {
      const d = this.state.data;
      const sectors = d.sectors || {};
      if (Object.keys(sectors).length === 0) return '';

      const cnSectors = [];
      const hkSectors = [];
      for (const [code, sec] of Object.entries(sectors)) {
        const temp = this._computeSectorTemperature(code, sec, d);
        if (!temp) continue;
        if (sec.market === 'cn') cnSectors.push({ code, ...sec, ...temp });
        else hkSectors.push({ code, ...sec, ...temp });
      }

      const renderGrid = (title, list) => {
        if (list.length === 0) return '';
        const items = list.map(s => {
          const color = this._tempColor(s.temp);
          const comp = s.components || {};
          return `
            <div class="pulse-sector-gauge">
              <div class="pulse-sg-head">
                <span class="pulse-sg-name">${s.name}</span>
                <span class="pulse-sg-temp" style="color:${color}">${s.temp}° ${s.level.text}</span>
              </div>
              <div class="pulse-sg-bar-wrap">
                <div class="pulse-sg-bar-bg"></div>
                <div class="pulse-sg-bar-fill" style="width:${s.temp}%;background:${color};"></div>
                <div class="pulse-sg-dot" style="left:${s.temp}%;background:${color};"></div>
              </div>
              <div class="pulse-sg-dims">
                <div class="pulse-sg-dim">
                  <span class="pulse-sg-dim-label">PE</span>
                  <span class="pulse-sg-dim-val">${s.pe != null ? s.pe.toFixed(1) : '--'}</span>
                  <span class="pulse-sg-dim-score">${comp.pe != null ? comp.pe : '--'}°</span>
                </div>
                <div class="pulse-sg-dim">
                  <span class="pulse-sg-dim-label">动量</span>
                  <span class="pulse-sg-dim-val">${s.chg_pct != null ? (s.chg_pct>0?'+':'') + s.chg_pct.toFixed(1) + '%' : '--'}</span>
                  <span class="pulse-sg-dim-score">${comp.momentum != null ? comp.momentum : '--'}°</span>
                </div>
                <div class="pulse-sg-dim">
                  <span class="pulse-sg-dim-label">波动</span>
                  <span class="pulse-sg-dim-val">--</span>
                  <span class="pulse-sg-dim-score">${comp.volatility != null ? comp.volatility : '--'}°</span>
                </div>
                <div class="pulse-sg-dim">
                  <span class="pulse-sg-dim-label">52周</span>
                  <span class="pulse-sg-dim-val">--</span>
                  <span class="pulse-sg-dim-score">${comp.pos52 != null ? comp.pos52 : '--'}°</span>
                </div>
              </div>
            </div>`;
        }).join('');
        return `
          <div class="pulse-sector-group">
            <div class="pulse-sector-group-title">${title}</div>
            <div class="pulse-sector-grid">${items}</div>
          </div>`;
      };

      return `
        <div class="pulse-sector-divider"></div>
        ${renderGrid('🇨🇳 A股行业', cnSectors)}
        ${renderGrid('🇭🇰 港股行业', hkSectors)}`;
    },

    // 清理
    destroy() {
      this._stopAutoRefresh();
    }
  };

  global.MarketPulse = MarketPulse;
})(window.AIInvest = window.AIInvest || {});
