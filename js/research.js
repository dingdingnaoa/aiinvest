/**
 * research.js — 研究报告模块
 * v3: 登录门控 + 持仓过滤——只展示当前账号持仓公司的研究卡,并渲染持仓新闻专栏
 */
(function (global) {
  'use strict';

  const Research = {
    data: [],
    news: null,
    containerId: 'researchClusters',
    modalId: 'reportModal',
    modalBodyId: 'reportModalBody',
    modalTitleId: 'reportModalTitle',

    /**
     * @param {Array} data 全量研究卡数据
     * @param {Array|null} filterPositions 登录账号的持仓数组(按 name/ticker 过滤);null=不过滤
     * @param {Object|null} news 新闻数据 {updated_at, items}
     */
    init(data, filterPositions, news) {
      this.data = data;
      this.news = news || null;
      if (filterPositions) {
        const wanted = new Set();
        filterPositions.forEach(p => { wanted.add(p.name); if (p.ticker) wanted.add(p.ticker); });
        // 高意/Coherent 名称归一(COHR 同时映射中文与英文)
        const cohr = filterPositions.find(p => p.ticker === 'COHR');
        if (cohr) { wanted.add('高意'); wanted.add('Coherent'); wanted.add('高意(Coherent)'); }
        this.filtered = data.filter(c => wanted.has(c.name) || wanted.has(c.ticker));
      } else {
        this.filtered = data;
      }
      this._ensureModal();
      this.render();
      this.renderNews();
    },

    /**
     * 确保模态弹窗DOM存在
     */
    _ensureModal() {
      if (document.getElementById(this.modalId)) return;
      const html = `
        <div class="report-modal-overlay" id="${this.modalId}" style="display:none;">
          <div class="report-modal">
            <div class="report-modal-header">
              <span class="report-modal-title" id="${this.modalTitleId}">策略裁决报告</span>
              <button class="report-modal-close" id="reportModalClose">&times;</button>
            </div>
            <div class="report-modal-stages" id="reportModalStages" style="display:none;"></div>
            <div class="report-modal-body" id="${this.modalBodyId}">
              <div class="report-modal-loading">加载中...</div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', html);

      document.getElementById('reportModalClose').addEventListener('click', () => this._closeModal());
      document.getElementById(this.modalId).addEventListener('click', function(e) {
        if (e.target === this) Research._closeModal();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this._closeModal();
      });
    },

    _openModal(title, stages) {
      document.getElementById(this.modalTitleId).textContent = title;
      document.getElementById(this.modalBodyId).innerHTML = '<div class="report-modal-loading">加载中...</div>';
      document.getElementById(this.modalId).style.display = 'flex';
      document.body.style.overflow = 'hidden';
      // 重置并准备阶段导航
      const stagesEl = document.getElementById('reportModalStages');
      if (stagesEl) {
        stagesEl.innerHTML = '';
        stagesEl.style.display = (stages && stages.length > 1) ? 'flex' : 'none';
      }
    },

    _closeModal() {
      document.getElementById(Research.modalId).style.display = 'none';
      document.body.style.overflow = '';
    },

    _groupByCluster(list) {
      const map = {};
      (list || this.data).forEach(item => {
        const key = item.cluster_id + '|' + item.cluster_name;
        if (!map[key]) map[key] = [];
        map[key].push(item);
      });
      return map;
    },

    render() {
      const container = document.getElementById(this.containerId);
      if (!container) return;

      const list = this.filtered || this.data;
      if (!list || list.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:60px 0;">当前账号持仓暂无匹配的研究报告</div>';
        return;
      }

      const groups = this._groupByCluster(list);
      let html = '';

      Object.entries(groups).forEach(([key, companies]) => {
        const [clusterId, clusterName] = key.split('|');
        html += this._renderCluster(clusterId, clusterName, companies);
      });

      container.innerHTML = html;
    },

    /**
     * 渲染持仓新闻专栏(仅登录后调用)
     */
    renderNews() {
      const box = document.getElementById('newsSection');
      const listEl = document.getElementById('newsList');
      if (!box || !listEl) return;
      const items = (this.news && Array.isArray(this.news.items)) ? this.news.items : [];
      const updatedEl = document.getElementById('newsUpdatedAt');
      if (updatedEl && this.news && this.news.updated_at) {
        updatedEl.textContent = '更新于 ' + this.news.updated_at;
      }
      if (items.length === 0) {
        listEl.innerHTML = '<div class="empty-state">暂无新闻数据</div>';
        return;
      }
      // 按公司分组渲染
      const byCompany = {};
      items.forEach(n => {
        const k = n.company + '|' + (n.ticker || '');
        (byCompany[k] = byCompany[k] || []).push(n);
      });
      let html = '';
      Object.entries(byCompany).forEach(([key, arr]) => {
        const [company, ticker] = key.split('|');
        html += `<div class="news-company-block">
          <div class="news-company-head"><span class="news-company-name">${this._esc(company)}</span><span class="news-company-ticker">${this._esc(ticker)}</span></div>
          ${arr.map(n => this._renderNewsItem(n)).join('')}
        </div>`;
      });
      listEl.innerHTML = html;
    },

    _renderNewsItem(n) {
      const imp = n.importance === '高' ? '<span class="news-imp news-imp-high">重大</span>'
                : n.importance === '中' ? '<span class="news-imp news-imp-mid">重要</span>' : '';
      const link = n.url ? `<a class="news-link" href="${this._esc(n.url)}" target="_blank" rel="noopener">原文 →</a>` : '';
      return `<div class="news-item">
        <div class="news-item-head">
          <span class="news-date">${this._esc(n.date || '')}</span>
          <span class="news-source">${this._esc(n.source || '')}</span>
          ${imp}
        </div>
        <div class="news-title">${this._esc(n.title || '')}</div>
        <div class="news-summary">${this._esc(n.summary || '')}</div>
        ${link}
      </div>`;
    },

    _renderCluster(clusterId, clusterName, companies) {
      let cards = companies.map(c => this._renderCompanyCard(c)).join('');
      return `
        <div class="research-cluster" data-cluster="${clusterId}">
          <div class="research-cluster-header">
            <span class="rc-id">${clusterId}</span>
            <h3 class="rc-name">${clusterName}</h3>
            <span class="rc-count">${companies.length} 家公司</span>
          </div>
          <div class="research-card-grid">
            ${cards}
          </div>
        </div>
      `;
    },

    _renderCompanyCard(company) {
      const ratingClass = this._ratingClass(company.rating);
      const isV5 = typeof company.methodology === 'string' && company.methodology.indexOf('v5') === 0;
      return `
        <div class="research-card ${isV5 ? 'rc-v5' : ''}">
          <div class="rc-top">
            <div class="rc-company">
              <h4 class="rc-company-name">${this._esc(company.name)}</h4>
              <span class="rc-ticker">${this._esc(company.ticker)}</span>
              ${isV5 ? `<span class="rc-v5-badge" title="${this._esc(company.methodology)} 报告">${this._esc(company.methodology)}</span>` : ''}
            </div>
            <span class="rc-rating ${ratingClass}">${this._esc(company.rating)}</span>
          </div>
          <div class="rc-body">
            <div class="rc-section">
              <span class="rc-label">价值</span>
              <p class="rc-value">${this._esc(company.investment_thesis)}</p>
            </div>
            <div class="rc-section">
              <span class="rc-label">空间</span>
              <p class="rc-upside">${this._esc(company.upside_potential)}</p>
            </div>
          </div>
          <div class="rc-bottom">
            <span class="rc-target">目标: ${this._esc(company.target_price)}</span>
            ${company.report_md ? `<button class="rc-report-link" data-md="${this._esc(company.report_md)}" data-name="${this._esc(company.name)}">完整报告 →</button>` : ''}
          </div>
        </div>
      `;
    },

    /**
     * 加载并渲染MD报告（支持v5.0多阶段切换）
     */
    async _loadReport(mdPath, companyName, stages) {
      this._openModal(`${companyName} — 投资研究报告`, stages);
      await this._renderStage(mdPath, stages);
    },

    async _renderStage(mdPath, stages) {
      try {
        const resp = await fetch(mdPath);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const mdText = await resp.text();
        const html = this._mdToHtml(mdText);
        document.getElementById(this.modalBodyId).innerHTML = html;
        this._bindStageTabs(mdPath, stages);
      } catch (err) {
        document.getElementById(this.modalBodyId).innerHTML =
          `<div class="report-modal-error">加载报告失败: ${this._esc(err.message)}</div>`;
      }
    },

    /**
     * 渲染v5.0阶段导航tabs
     */
    _bindStageTabs(activeMd, stages) {
      const container = document.getElementById('reportModalStages');
      if (!container) return;
      if (!stages || stages.length <= 1) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
      }
      container.style.display = 'flex';
      container.innerHTML = stages.map(s => {
        const active = s.file === activeMd ? 'active' : '';
        return `<button class="report-stage-btn ${active}" data-stage-md="${this._esc(s.file)}" data-stage-label="${this._esc(s.label)}">${s.stage} ${this._esc(s.label)}</button>`;
      }).join('');
      container.querySelectorAll('.report-stage-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const md = btn.dataset.stageMd;
          if (!md || md === activeMd) return;
          document.getElementById(this.modalBodyId).innerHTML = '<div class="report-modal-loading">加载中...</div>';
          container.querySelectorAll('.report-stage-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._renderStage(md, stages);
        });
      });
    },

    /**
     * 简易Markdown转HTML（无需外部依赖）
     */
    _mdToHtml(md) {
      let html = md;

      // 代码块 (``` ... ```)
      html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

      // 标题
      html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // 水平线
      html = html.replace(/^---$/gm, '<hr>');

      // 粗体 + 斜体
      html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

      // 行内代码
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

      // 链接
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

      // 无序列表
      html = html.replace(/^[\t ]*[-*] (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

      // 有序列表
      html = html.replace(/^[\t ]*\d+\. (.+)$/gm, '<li>$1</li>');

      // 引用块
      html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');
      // 合并连续引用块
      html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

      // 表格 — 简易处理：保留原始格式包装
      html = html.replace(/^\|(.+)\|$/gm, function(match) {
        const cells = match.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const isSep = cells.every(c => /^[-:]+$/.test(c));
        if (isSep) return '';
        const tag = match.startsWith('|') && !match.startsWith('||') ? 'td' : 'td';
        return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
      });
      html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>');

      // 段落：连续非空行
      html = html.replace(/\n\n+/g, '</p><p>');
      html = '<p>' + html + '</p>';

      // 清理段落中的块级元素
      html = html.replace(/<p><(h[1-4]|ul|ol|table|pre|blockquote|hr)/g, '<$1');
      html = html.replace(/<\/(h[1-4]|ul|ol|table|pre|blockquote)><\/p>/g, '</$1>');
      html = html.replace(/<p><\/p>/g, '');

      return html;
    },

    /**
     * 初始化事件委托 — 在app.js renderAll后调用
     */
    initEvents() {
      const container = document.getElementById(this.containerId);
      if (!container) return;

      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.rc-report-link');
        if (!btn) return;
        e.preventDefault();
        const mdPath = btn.dataset.md;
        const name = btn.dataset.name;
        if (mdPath) {
          const company = this.data.find(c => c.name === name);
          const stages = company ? company.report_stages : null;
          this._loadReport(mdPath, name, stages);
        }
      });
    },

    _ratingClass(rating) {
      if (!rating) return '';
      if (rating.includes('买入')) return 'rc-rating-buy';
      if (rating.includes('增持')) return 'rc-rating-overweight';
      if (rating.includes('回避')) return 'rc-rating-avoid';
      if (rating.includes('中性偏多')) return 'rc-rating-neutral';
      if (rating.includes('谨慎')) return 'rc-rating-cautious';
      if (rating.includes('观望')) return 'rc-rating-hold';
      if (rating.includes('标配')) return 'rc-rating-mw';
      if (rating.includes('持有')) return 'rc-rating-hold';
      return '';
    },

    _esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  };

  global.Research = Research;
})(window.AIInvest = window.AIInvest || {});
