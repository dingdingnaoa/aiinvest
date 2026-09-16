/**
 * clock.js — 实时时钟与数据状态模块
 */
(function (global) {
  'use strict';

  const Clock = {
    timer: null,

    init() {
      this.update();
      this.timer = setInterval(() => this.update(), 1000);
    },

    update() {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const el = document.getElementById('liveClock');
      if (el) el.textContent = timeStr;
    },

    setDataStatus(text) {
      const el = document.getElementById('dataStatusText');
      if (el) el.textContent = text;
    },

    setLastUpdate(dateStr) {
      const el = document.getElementById('lastUpdate');
      if (el) el.textContent = '数据更新: ' + new Date(dateStr).toLocaleString('zh-CN');
    },

    destroy() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  };

  global.Clock = Clock;
})(window.AIInvest = window.AIInvest || {});
