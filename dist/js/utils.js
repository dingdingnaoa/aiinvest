/**
 * utils.js — 通用工具函数
 * 数字格式化、颜色计算、DOM 操作
 */
(function (global) {
  'use strict';

  const Utils = {
    /**
     * 格式化数字，保留指定小数位
     */
    formatNumber(n, decimals = 2) {
      if (n === undefined || n === null || isNaN(n) || n === '') return '-';
      return parseFloat(n).toFixed(decimals);
    },

    /**
     * 格式化市值（自动转换单位）
     */
    formatMarketCap(n) {
      if (!n || n === '-') return '-';
      const num = parseFloat(n);
      if (num >= 10000) return (num / 10000).toFixed(1) + '万亿';
      if (num >= 1) return num.toFixed(1) + '亿';
      return num.toFixed(2) + '万';
    },

    /**
     * 根据评分返回颜色
     */
    getScoreColor(score) {
      if (score >= 4.5) return '#3b82f6';
      if (score >= 4.0) return '#8b5cf6';
      if (score >= 3.5) return '#06b6d4';
      return '#9aa0a6';
    },

    /**
     * 根据等级返回 CSS 类名
     */
    getGradeClass(grade) {
      const map = { 'A': 'grade-a', 'B': 'grade-b', 'C': 'grade-c' };
      return map[grade] || 'grade-c';
    },

    /**
     * 根据评分返回等级
     */
    getGrade(score) {
      if (score >= 4.5) return 'A';
      if (score >= 4.0) return 'B';
      return 'C';
    },

    /**
     * 防抖
     */
    debounce(fn, delay = 300) {
      let timer;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },

    /**
     * 快捷 DOM 选择器
     */
    $(selector) {
      return document.querySelector(selector);
    },

    $$(selector) {
      return document.querySelectorAll(selector);
    },

    /**
     * 创建 DOM 元素
     */
    createElement(tag, attrs = {}, ...children) {
      const el = document.createElement(tag);
      for (const [key, val] of Object.entries(attrs)) {
        if (key === 'className') el.className = val;
        else if (key === 'innerHTML') el.innerHTML = val;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), val);
        else el.setAttribute(key, val);
      }
      children.forEach(child => {
        if (typeof child === 'string') el.appendChild(document.createTextNode(child));
        else if (child instanceof Node) el.appendChild(child);
      });
      return el;
    },

    /**
     * 相对时间格式化
     */
    timeAgo(dateStr) {
      const now = new Date();
      const date = new Date(dateStr);
      const diff = now - date;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 60) return minutes + '分钟前';
      if (hours < 24) return hours + '小时前';
      if (days < 7) return days + '天前';
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    },

    /**
     * 格式化日期
     */
    formatDate(dateStr) {
      const date = new Date(dateStr);
      return date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    },

    /**
     * 获取行业颜色（基于 cluster_id 的简单哈希）
     */
    getIndustryColor(clusterId) {
      const colors = [
        '#3b82f6', '#06b6d4', '#8b5cf6', '#10b981',
        '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
        '#14b8a6', '#f97316', '#84cc16', '#64748b'
      ];
      // clusterId 可能是整数或字符串
      const idx = (typeof clusterId === 'number') ? (clusterId - 1) : Math.abs(clusterId.charCodeAt(0));
      return colors[idx % colors.length];
    },

    /**
     * 生成评级徽章 HTML
     */
    renderRatingBadge(rating) {
      let cls = 'rating-hold';
      if (rating === '买入') cls = 'rating-buy';
      else if (rating === '增持') cls = 'rating-overweight';
      else if (rating === '持有') cls = 'rating-neutral';
      else if (rating === '回避') cls = 'rating-avoid';
      return `<span class="rating-badge ${cls}">${rating}</span>`;
    }
  };

  global.Utils = Utils;
})(window.AIInvest = window.AIInvest || {});
