/**
 * heatmap.js — 行业热度图模块
 * 使用 ECharts 渲染全球 25 大产业集群的评分排行
 * 支持柱状图和气泡图两种视图
 */
(function (global) {
  'use strict';

  const HeatMap = {
    chart: null,
    currentView: 'bar',

    /**
     * 初始化图表
     */
    init(containerId, clusters) {
      const container = document.getElementById(containerId);
      if (!container) return;

      this.chart = echarts.init(container);
      this.clusters = clusters;
      this.render();
      this._bindToggle();

      window.addEventListener('resize', () => {
        if (this.chart) this.chart.resize();
      });
    },

    /**
     * 绑定视图切换按钮
     */
    _bindToggle() {
      const buttons = document.querySelectorAll('.chart-toggle-btn');
      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentView = btn.dataset.view;
          this.render();
        });
      });
    },

    /**
     * 渲染图表
     */
    render() {
      if (!this.chart || !this.clusters) return;

      if (this.currentView === 'bar') {
        this._renderBar();
      } else {
        this._renderBubble();
      }
    },

    /**
     * 柱状图：行业评分排行
     */
    _renderBar() {
      const sorted = [...this.clusters].sort((a, b) => b.score - a.score);
      const names = sorted.map(c => c.name);
      const scores = sorted.map(c => c.score);
      const colors = sorted.map(c => {
        if (c.grade === 'A') return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#3b82f6' }, { offset: 1, color: '#1d4ed8' }
        ]);
        if (c.grade === 'B') return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#8b5cf6' }, { offset: 1, color: '#6d28d9' }
        ]);
        return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#4b5563' }, { offset: 1, color: '#374151' }
        ]);
      });

      const option = {
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          borderColor: 'rgba(0, 0, 0, 0.08)',
          textStyle: { color: '#1a1a2e', fontSize: 13 },
          formatter: (params) => {
            const d = params[0];
            const cluster = sorted[d.dataIndex];
            const champs = (cluster.core_champions || []).join(', ');
            return `<div style="font-weight:600;margin-bottom:4px;">${cluster.name} (${cluster.name_en || ''})</div>
              <div>评分: <b style="color:${AIInvest.Utils.getScoreColor(cluster.score)}">${cluster.score}</b> | 等级: <b>${cluster.grade}</b></div>
              <div style="margin-top:4px;font-size:12px;color:#6b7280;">核心冠军: ${champs}</div>
              <div style="font-size:12px;color:#6b7280;">标的数: ${cluster.company_count || 0} (Deep: ${cluster.deep_count || 0})</div>`;
          }
        },
        grid: {
          left: '3%',
          right: '8%',
          bottom: '3%',
          top: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'value',
          name: '评分',
          min: 2.5,
          max: 5.0,
          axisLabel: { color: '#6b7280', fontSize: 11 },
          axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
          splitLine: { lineStyle: { color: 'rgba(0,0,0,0.04)' } }
        },
        yAxis: {
          type: 'category',
          data: names.reverse(),
          axisLabel: {
            color: '#6b7280',
            fontSize: 11,
            width: 100,
            overflow: 'truncate'
          },
          axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
          inverse: true
        },
        series: [{
          type: 'bar',
          data: scores.reverse().map((s, i) => ({
            value: s,
            itemStyle: { color: colors.reverse()[i], borderRadius: [0, 4, 4, 0] }
          })),
          barWidth: 16,
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(37,99,235,0.3)' }
          },
          label: {
            show: true,
            position: 'right',
            color: '#1a1a2e',
            fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{c}'
          }
        }]
      };

      this.chart.setOption(option, true);
    },

    /**
     * 气泡图：行业分布（X=评分，Y=TAM规模，气泡大小=公司数量）
     */
    _renderBubble() {
      const data = this.clusters.map(c => {
        const tamVal = c.company_count || 1;
        return {
          name: c.name,
          value: [c.score, Math.log10(tamVal + 1) * 2.5, c.deep_count || 0],
          grade: c.grade,
          color: AIInvest.Utils.getIndustryColor(c.id),
          champions: c.core_champions || [],
          companyCount: c.company_count || 0,
          drivers: c.key_drivers || ''
        };
      });

      const option = {
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          borderColor: 'rgba(0, 0, 0, 0.08)',
          textStyle: { color: '#1a1a2e', fontSize: 13 },
          formatter: (params) => {
            const d = params.data;
            return `<div style="font-weight:600;margin-bottom:4px;">${d.name} [${d.grade}级]</div>
              <div>评分: <b>${d.value[0]}</b> | Deep: <b>${d.value[2]}</b> | 总标的: <b>${d.companyCount}</b></div>
              <div style="margin-top:4px;font-size:12px;color:#6b7280;">冠军: ${(d.champions||[]).join(', ')}</div>
              <div style="font-size:12px;color:#6b7280;">${d.drivers}</div>`;
          }
        },
        grid: { left: '8%', right: '5%', top: '5%', bottom: '8%' },
        xAxis: {
          name: '综合评分',
          min: 2.5,
          max: 5.2,
          axisLabel: { color: '#6b7280', fontSize: 11 },
          axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
          splitLine: { lineStyle: { color: 'rgba(0,0,0,0.04)' } }
        },
        yAxis: {
          name: '市场规模 (log)',
          axisLabel: { color: '#6b7280', fontSize: 11 },
          axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
          splitLine: { lineStyle: { color: 'rgba(0,0,0,0.04)' } }
        },
        series: [{
          type: 'scatter',
          data: data,
          symbolSize: (val) => Math.max(val[2] * 12, 20),
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(37,99,235,0.15)',
            opacity: 0.8
          },
          label: {
            show: true,
            formatter: '{b}',
            position: 'right',
            color: '#6b7280',
            fontSize: 10
          },
          emphasis: {
            label: { fontSize: 12, fontWeight: 'bold', color: '#1a1a2e' },
            itemStyle: { shadowBlur: 20, opacity: 1 }
          }
        }]
      };

      this.chart.setOption(option, true);
    },

    destroy() {
      if (this.chart) {
        this.chart.dispose();
        this.chart = null;
      }
    }
  };

  global.HeatMap = HeatMap;
})(window.AIInvest = window.AIInvest || {});
