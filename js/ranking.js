/**
 * ranking.js — 公司排名表模块 v4.1
 * 可排序、可搜索、可筛选的全球公司列表
 * 新增：子环节、层级(Deep/Shallow/Watch)、信号灯
 */
(function (global) {
  'use strict';

  const Ranking = {
    companies: [],
    filtered: [],
    sortField: 'tier',
    sortOrder: 'asc',
    searchKeyword: '',
    filterIndustry: 'all',
    filterTier: 'all',

    /**
     * 初始化排名表
     */
    init(companies) {
      this.companies = companies;
      this.filtered = [...companies];
      this._bindControls();
      this.render();
    },

    /**
     * 绑定搜索和筛选控件
     */
    _bindControls() {
      const searchInput = document.getElementById('companySearch');
      const industryFilter = document.getElementById('industryFilter');
      const ratingFilter = document.getElementById('ratingFilter');

      if (searchInput) {
        searchInput.addEventListener('input', AIInvest.Utils.debounce(() => {
          this.searchKeyword = searchInput.value.trim().toLowerCase();
          this._applyFilters();
        }, 250));
      }

      if (industryFilter) {
        // 动态填充行业选项（使用 cluster_id 排序）
        const industries = [...new Set(this.companies.map(c => c.industry))];
        industries.sort();
        industries.forEach(ind => {
          const opt = document.createElement('option');
          opt.value = ind;
          opt.textContent = ind;
          industryFilter.appendChild(opt);
        });

        industryFilter.addEventListener('change', () => {
          this.filterIndustry = industryFilter.value;
          this._applyFilters();
        });
      }

      if (ratingFilter) {
        // v4.1: 改为层级筛选
        ratingFilter.addEventListener('change', () => {
          this.filterTier = ratingFilter.value;
          this._applyFilters();
        });
      }

      // 表头点击排序
      const table = document.getElementById('companyTable');
      if (table) {
        table.addEventListener('click', (e) => {
          const th = e.target.closest('th[data-sort]');
          if (!th) return;
          const field = th.dataset.sort;
          if (this.sortField === field) {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
          } else {
            this.sortField = field;
            this.sortOrder = 'asc';
          }
          this._applyFilters();
        });
      }
    },

    /**
     * 应用筛选和排序
     */
    _applyFilters() {
      let result = [...this.companies];

      // 搜索
      if (this.searchKeyword) {
        result = result.filter(c =>
          (c.name || '').toLowerCase().includes(this.searchKeyword) ||
          (c.code || '').toLowerCase().includes(this.searchKeyword) ||
          (c.industry || '').toLowerCase().includes(this.searchKeyword) ||
          (c.name_en || '').toLowerCase().includes(this.searchKeyword) ||
          (c.sub_chain || '').toLowerCase().includes(this.searchKeyword)
        );
      }

      // 行业筛选
      if (this.filterIndustry !== 'all') {
        result = result.filter(c => c.industry === this.filterIndustry);
      }

      // 层级筛选
      if (this.filterTier !== 'all') {
        result = result.filter(c => c.tier === this.filterTier);
      }

      // 排序
      const tierOrder = { 'Deep': 1, 'Shallow': 2, 'Watch': 3 };
      result.sort((a, b) => {
        let va, vb;
        if (this.sortField === 'tier') {
          va = tierOrder[a.tier] || 4;
          vb = tierOrder[b.tier] || 4;
        } else if (this.sortField === 'name') {
          va = (a.name || '').toLowerCase();
          vb = (b.name || '').toLowerCase();
        } else if (this.sortField === 'code') {
          va = (a.code || '').toLowerCase();
          vb = (b.code || '').toLowerCase();
        } else if (this.sortField === 'industry') {
          va = (a.industry || '').toLowerCase();
          vb = (b.industry || '').toLowerCase();
        } else if (this.sortField === 'sub_chain') {
          va = (a.sub_chain || '').toLowerCase();
          vb = (b.sub_chain || '').toLowerCase();
        } else {
          va = a[this.sortField] || '';
          vb = b[this.sortField] || '';
          if (typeof va === 'string') {
            va = va.toLowerCase();
            vb = vb.toLowerCase();
          }
        }
        if (va < vb) return this.sortOrder === 'asc' ? -1 : 1;
        if (va > vb) return this.sortOrder === 'asc' ? 1 : -1;
        return 0;
      });

      this.filtered = result;
      this.render();
    },

    /**
     * 渲染信号灯 HTML
     */
    _renderSignals(signals) {
      if (!signals) return '<span style="color:var(--text-tertiary);font-size:11px;">--</span>';
      // signals 格式: "🟢🟢🟡🟢🟢"
      const lights = signals.split('').filter(c => c !== ' ');
      return `<span style="letter-spacing:2px;font-size:13px;">${lights.join('')}</span>`;
    },

    /**
     * 渲染层级标签
     */
    _renderTierBadge(tier) {
      if (tier === 'Deep') {
        return '<span class="rating-badge rating-buy">Deep 深度</span>';
      } else if (tier === 'Shallow') {
        return '<span class="rating-badge rating-hold">Shallow 浅层</span>';
      } else {
        return '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500;background:rgba(0,0,0,0.05);color:var(--text-secondary);">Watch 观察</span>';
      }
    },

    /**
     * 渲染表格
     */
    render() {
      const tbody = document.getElementById('companyTableBody');
      const countEl = document.getElementById('companyCount');
      if (!tbody) return;

      if (this.filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">🔍 暂无匹配的公司</td></tr>`;
        if (countEl) countEl.textContent = '共 0 家公司';
        return;
      }

      tbody.innerHTML = this.filtered.map(c => `
        <tr>
          <td>
            <span style="font-weight:600;color:var(--text-primary);">${c.name}</span>
            <span style="font-size:11px;color:var(--text-tertiary);margin-left:6px;">${c.name_en || ''}</span>
          </td>
          <td>
            <span class="stock-code">${c.code || '--'}</span>
            <span class="market-tag">${c.market || ''}</span>
          </td>
          <td style="font-size:12px;">${c.industry || ''}</td>
          <td style="font-size:12px;color:var(--text-secondary);">${c.sub_chain || '--'}</td>
          <td>${this._renderTierBadge(c.tier)}</td>
          <td>${this._renderSignals(c.signals)}</td>
          <td style="font-size:12px;color:var(--text-secondary);max-width:280px;white-space:normal;">${c.core_logic || ''}</td>
          <td style="font-family:var(--font-mono);font-size:12px;color:var(--accent-cyan);">${c.market_cap || '--'}</td>
        </tr>
      `).join('');

      if (countEl) {
        const deepCount = this.filtered.filter(c => c.tier === 'Deep').length;
        const shallowCount = this.filtered.filter(c => c.tier === 'Shallow').length;
        const watchCount = this.filtered.filter(c => c.tier === 'Watch').length;
        countEl.textContent = `共 ${this.filtered.length} 家公司 (Deep: ${deepCount} | Shallow: ${shallowCount} | Watch: ${watchCount})`;
      }

      // 更新排序指示器
      document.querySelectorAll('#companyTable th[data-sort]').forEach(th => {
        th.classList.remove('sorted');
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = ' ↕';
      });

      const activeTh = document.querySelector(`#companyTable th[data-sort="${this.sortField}"]`);
      if (activeTh) {
        activeTh.classList.add('sorted');
        const icon = activeTh.querySelector('.sort-icon');
        if (icon) icon.textContent = this.sortOrder === 'asc' ? ' ↑' : ' ↓';
      }
    }
  };

  global.Ranking = Ranking;
})(window.AIInvest = window.AIInvest || {});
