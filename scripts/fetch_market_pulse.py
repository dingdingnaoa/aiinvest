#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_market_pulse.py — GLOBAL MARKET PULSE 数据快照生成器
=========================================================
从真实公开数据源拉取跨市场行情，计算量化指标，输出 dist/data/market_pulse.json。
由 GitHub Action 定时运行（见 .github/workflows/market-pulse.yml），也可本地手动运行。

数据源（全部真实、公开、可审计）：
  - qt.gtimg.cn            腾讯行情：A股/港股/美股指数、USDCNY、COMEX金/油/银（GBK文本）
  - web.ifzq.gtimg.cn      腾讯K线：指数/外汇日K（JSON，用于5日涨跌与20日实现波动率）
  - quote.cnbc.com         CNBC：美债10Y、VIX现货、美元指数期货、COMEX铜（JSON）
  - datacenter-web.eastmoney.com  东方财富数据中心：中债1Y/10Y/30Y收益率（JSON）
  - multpl.com             标普500盈利收益率（HTML，每日收盘后更新）

禁止编造：任何数据源失败时，对应字段置 null 并沿用上一份快照中的有效值（附原日期）。
"""

import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'}
CST = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist', 'data', 'market_pulse.json')

# ──────────────────────────────────────────────
# 标的定义
# ──────────────────────────────────────────────
INDICES = [
    # (腾讯代码, 名称, 市场, 52周高字段, 52周低字段)
    ("sh000001", "上证指数",   "cn", 67, 68),
    ("sz399001", "深证成指",   "cn", 67, 68),
    ("sz399006", "创业板指",   "cn", 67, 68),
    ("sh000300", "沪深300",    "cn", 67, 68),
    ("sh000688", "科创50",     "cn", 67, 68),
    ("hkHSI",    "恒生指数",   "hk", 48, 49),
    ("hkHSTECH", "恒生科技",   "hk", 48, 49),
    ("hkHSCEI",  "恒生国企",   "hk", 48, 49),
    ("usDJI",    "道琼斯",     "us", 48, 49),
    ("usIXIC",   "纳斯达克",   "us", 48, 49),
    ("usINX",    "标普500",    "us", 48, 49),
]
KLINE_INDEX = ["sh000001", "sz399001", "sz399006", "sh000300", "sh000688",
               "hkHSI", "hkHSTECH", "hkHSCEI", "usDJI", "usIXIC", "usINX"]
FUTURES = [("hf_GC", "COMEX黄金"), ("hf_CL", "WTI原油"), ("hf_SI", "COMEX白银")]
SECTOR_INDICES = [
    # A-share 中证行业指数 (腾讯代码, 名称) — PE-TTM 通过 fields[39] 获取
    ("sz399986", "中证银行"),
    ("sz399975", "证券公司"),
    ("sz399808", "中证新能"),
    ("sz399811", "CSSW电子"),
    ("sz399989", "中证医疗"),
    ("sz399997", "中证白酒"),
    ("sz399967", "中证军工"),
    ("sz399998", "中证煤炭"),
    ("sz399971", "中证传媒"),
    ("sz399976", "CS新能车"),
    ("sz399933", "中证医药"),
    ("sz399970", "移动互联"),
    # HK 主要指数作为行业代理（港股行业子指数腾讯不支持，用宽基指数近似）
    ("hkHSI",    "恒生指数"),
    ("hkHSTECH", "恒生科技"),
    ("hkHSCEI",  "恒生国企"),
    ("hkHSCCI",  "红筹指数"),
]
HISTORY_MAX = 120  # 历史序列最大保留天数


# ──────────────────────────────────────────────
# 网络层
# ──────────────────────────────────────────────
def http_get(url, enc='utf-8', retries=2, timeout=15, headers=None):
    last = None
    for i in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers or UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode(enc, errors='replace')
        except Exception as e:
            last = e
            time.sleep(0.8 * (i + 1))
    raise last


# ──────────────────────────────────────────────
# 解析器
# ──────────────────────────────────────────────
def parse_tencent_quotes(body):
    """解析 qt.gtimg.cn 响应 → {code: {...}}。指数/股票为 ~ 分隔，期货为 , 分隔。"""
    out = {}
    for line in body.strip().split(';'):
        line = line.strip()
        if not line or '=' not in line:
            continue
        var, val = line.split('=', 1)
        code = var.strip().lstrip('v_')
        val = val.strip().strip('"')
        if not val:
            continue
        if '~' in val:
            f = val.split('~')
            if len(f) < 33:
                continue
            rec = {
                'name': f[1], 'price': _f(f[3]), 'prev_close': _f(f[4]),
                'chg': _f(f[31]), 'chg_pct': _f(f[32]),
                'high': _f(f[33]), 'low': _f(f[34]), 'time_raw': f[30] if len(f) > 30 else '',
                'fields': f,
            }
        else:  # 期货逗号格式: [0]价 [1]涨跌% [4]高 [5]低 [7]昨收 [12]日期 [13]名
            f = val.split(',')
            if len(f) < 14:
                continue
            price, prev = _f(f[0]), _f(f[7])
            rec = {
                'name': f[13], 'price': price, 'prev_close': prev,
                'chg': round(price - prev, 4) if price and prev else None,
                'chg_pct': _f(f[1]), 'high': _f(f[4]), 'low': _f(f[5]),
                'time_raw': f"{f[12]} {f[6]}" if len(f) > 12 else '',
                'fields': f,
            }
        out[code] = rec
    return out


def _f(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def fetch_kline(code, n=25):
    """腾讯日K → [(date, open, close, high, low), ...]，最新在最后。"""
    body = http_get(f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,,,{n},qfq")
    d = json.loads(body)
    node = d.get('data', {}).get(code)
    if isinstance(node, dict):
        rows = node.get('day') or node.get('qfqday') or []
    elif isinstance(node, list):  # 部分品种直接是 list
        rows = node
    else:
        rows = []
    out = []
    for r in rows:
        try:
            out.append((r[0], float(r[1]), float(r[2]), float(r[3]), float(r[4])))
        except (IndexError, ValueError, TypeError):
            continue
    return out


def pct_change(kline, days):
    """K线 N 日涨跌幅%（最新收盘 vs N日前收盘）"""
    if not kline or len(kline) < days + 1:
        return None
    base, last = kline[-(days + 1)][2], kline[-1][2]
    if not base:
        return None
    return round((last - base) / base * 100, 2)


def realized_vol(kline, days=20):
    """N日实现波动率（年化%）= std(日对数收益) × √252 × 100"""
    if not kline or len(kline) < days + 1:
        return None
    closes = [r[2] for r in kline[-(days + 1):]]
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]
    if len(rets) < 5:
        return None
    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / (len(rets) - 1)
    return round(math.sqrt(var) * math.sqrt(252) * 100, 1)


# ──────────────────────────────────────────────
# 各数据源
# ──────────────────────────────────────────────
def fetch_tencent():
    codes = [c for c, *_ in INDICES] + ['whUSDCNY'] + [c for c, _ in FUTURES] + [c for c, _ in SECTOR_INDICES]
    body = http_get("https://qt.gtimg.cn/q=" + ','.join(codes), enc='gbk')
    return parse_tencent_quotes(body)


def fetch_cnbc():
    """→ {us10y, vix, dxy, copper}"""
    url = ("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol"
           "?symbols=US10Y|.VIX|@DX.1|@HG.1&output=json")
    d = json.loads(http_get(url))
    res = {}
    for q in d.get('FormattedQuoteResult', {}).get('FormattedQuote', []):
        sym = q.get('symbol')
        last = q.get('last')
        pct = q.get('change_pct')
        last = float(str(last).replace('%', '').replace(',', '')) if last not in (None, '') else None
        pct = float(str(pct).replace('%', '').replace(',', '')) if pct not in (None, '') else None
        res[sym] = {'value': last, 'chg_pct': pct, 'time': q.get('last_time')}
    return res


def fetch_cn_bonds():
    """东财中债收益率 → {date, y1, y10, y30, us10y_em}"""
    url = ("https://datacenter-web.eastmoney.com/api/data/v1/get"
           "?reportName=RPTA_WEB_TREASURYYIELD&columns=ALL"
           "&sortColumns=SOLAR_DATE&sortTypes=-1&pageSize=2&pageNumber=1")
    d = json.loads(http_get(url, headers={**UA, 'Referer': 'https://data.eastmoney.com/'}))
    rows = (d.get('result') or {}).get('data') or []
    if not rows:
        return {}
    r = rows[0]
    return {
        'date': (r.get('SOLAR_DATE') or '')[:10],
        'y1': r.get('EMM00588704'), 'y5': r.get('EMM00166462'),
        'y10': r.get('EMM00166466'), 'y30': r.get('EMM00166469'),
    }


def fetch_spx_ey():
    """multpl 标普500盈利收益率% + 历史均值/中位数"""
    body = http_get("https://www.multpl.com/s-p-500-earnings-yield", timeout=20)
    cur = re.search(r'Current S&P 500 Earnings Yield\s*:?\s*(?:is)?\s*([\d.]+)%', body)
    mean = re.search(r'Mean:\s*</t[dh]>\s*<t[dh][^>]*>\s*([\d.]+)%', body) or re.search(r'Mean:\s*([\d.]+)%', body)
    med = re.search(r'Median:\s*</t[dh]>\s*<t[dh][^>]*>\s*([\d.]+)%', body) or re.search(r'Median:\s*([\d.]+)%', body)
    datem = re.search(r'([A-Z][a-z]{2} \d{1,2}(?:,\s*\d{4})?)', body)
    return {
        'ey': float(cur.group(1)) if cur else None,
        'mean': float(mean.group(1)) if mean else None,
        'median': float(med.group(1)) if med else None,
        'asof': datem.group(1) if datem else None,
    }


# ──────────────────────────────────────────────
# 量化计算（公式与前端 js/market-pulse.js 保持一致）
# ──────────────────────────────────────────────
def clamp(x, lo=0.0, hi=100.0):
    return max(lo, min(hi, x))


def risk_temperature(vix, mom_avg, gold5d, us10y_5d_bp, usdcny_chg):
    """全球风险温度 0-100，四分量加权：
    - 波动率 40%: VIX ≤12→0, ≥35→100 线性
    - 动量   25%: 主要指数当日均值 +1.5%→0, -1.5%→100
    - 避险   20%: 黄金5日涨 & 美债5日下行 → 分高
    - 汇率   15%: USDCNY 当日涨幅 ±0.6% 映射 0-100
    """
    parts, weights = {}, {}
    if vix is not None:
        parts['volatility'] = clamp((vix - 12) / (35 - 12) * 100)
        weights['volatility'] = 0.40
    if mom_avg is not None:
        parts['momentum'] = clamp(50 - mom_avg * 33.3)
        weights['momentum'] = 0.25
    if gold5d is not None or us10y_5d_bp is not None:
        g = gold5d or 0.0
        b = us10y_5d_bp or 0.0
        parts['safehaven'] = clamp(50 + g * 8 - b * 1.0)
        weights['safehaven'] = 0.20
    if usdcny_chg is not None:
        parts['fx'] = clamp(50 + usdcny_chg * 80)
        weights['fx'] = 0.15
    if not parts:
        return None, {}, None
    wsum = sum(weights.values())
    temp = sum(parts[k] * weights[k] for k in parts) / wsum
    temp = round(temp, 1)
    if temp < 25:   level, desc = "低温平静", "市场处于低波动区间，风险偏好较高"
    elif temp < 45: level, desc = "温和",     "风险指标整体平稳"
    elif temp < 65: level, desc = "偏热",     "部分风险指标升温，保持关注"
    elif temp < 85: level, desc = "高热",     "多指标共振走强避险，降低风险敞口"
    else:           level, desc = "极端",     "市场处于极端避险状态"
    return temp, {k: round(v, 1) for k, v in parts.items()}, {'level': level, 'desc': desc}


def compute_erp(csi300_pe, spx_ey, us10y, cn10y):
    """股债风险溢价 = 盈利收益率(1/PE) − 10Y国债收益率，单位 %"""
    out = {}
    if csi300_pe and cn10y is not None:
        ey = 100.0 / csi300_pe
        out['cn'] = {'index': '沪深300', 'pe': round(csi300_pe, 2), 'earnings_yield': round(ey, 2),
                     'bond_yield': cn10y, 'erp': round(ey - cn10y, 2)}
    if spx_ey is not None and us10y is not None:
        out['us'] = {'index': '标普500', 'earnings_yield': spx_ey,
                     'bond_yield': us10y, 'erp': round(spx_ey - us10y, 2)}
    # 港股：恒指官方 PE 无免费实时 API（已验证腾讯/东财/Yahoo/AAStocks/etnet/HSI官网/TV均不可得），
    # 诚实标注缺失，不编造。
    out['hk'] = None
    return out


def divergence_signals(q, k5, gold5d, cl5d, spx5d, hsi5d, usdcny5d, us10y_5d_bp, vix, sh_chg, usinx_chg, spx_dist_52w):
    """跨市场背离信号规则引擎。每条: {name, level(0正常/1关注/2警告), detail}"""
    sigs = []

    def add(name, level, detail):
        sigs.append({'name': name, 'level': level, 'detail': detail})

    # 1. 隔夜美股 → A股跟随度
    if usinx_chg is not None and sh_chg is not None:
        if usinx_chg > 1.0 and sh_chg < 0:
            add('美股→A股背离', 1, f"隔夜标普{usinx_chg:+.2f}%，当日上证{sh_chg:+.2f}%，A股未跟随美股走强，内资情绪偏弱")
        elif usinx_chg < -1.0 and sh_chg > 0:
            add('美股→A股背离', 1, f"隔夜标普{usinx_chg:+.2f}%，当日上证{sh_chg:+.2f}%，A股走出独立行情")
        else:
            add('美股→A股联动', 0, f"隔夜标普{usinx_chg:+.2f}%，当日上证{sh_chg:+.2f}%，联动正常")

    # 2. 股金同涨（流动性驱动警惕）
    if spx5d is not None and gold5d is not None:
        if spx5d > 1.5 and gold5d > 1.5:
            add('股金同涨', 1, f"标普5日{spx5d:+.1f}% 且黄金5日{gold5d:+.1f}%，风险与避险资产同涨，警惕流动性驱动的估值泡沫")
        elif spx5d < -1.5 and gold5d < -1.5:
            add('股金同跌', 1, f"标普5日{spx5d:+.1f}% 且黄金5日{gold5d:+.1f}%，风险与避险资产同跌，可能为美元流动性收缩")

    # 3. 油价冲击
    if cl5d is not None and spx5d is not None:
        if cl5d > 4 and spx5d < -1:
            add('油涨股跌', 2, f"WTI原油5日{cl5d:+.1f}% 且标普5日{spx5d:+.1f}%，滞胀压力信号")
        elif cl5d < -4 and spx5d > 1:
            add('油跌股涨', 0, f"WTI原油5日{cl5d:+.1f}%，通胀压力缓解，利好风险资产")

    # 4. 汇率与港股共振
    if usdcny5d is not None and hsi5d is not None:
        if usdcny5d > 0.4 and hsi5d < -1.5:
            add('汇率港股共振走弱', 2, f"USDCNY 5日{usdcny5d:+.2f}%（人民币贬值）且恒指5日{hsi5d:+.1f}%，外资流出压力")
        elif usdcny5d < -0.4 and hsi5d > 1.5:
            add('汇率港股共振走强', 0, f"USDCNY 5日{usdcny5d:+.2f}%（人民币升值）且恒指5日{hsi5d:+.1f}%，外资回流")

    # 5. 股债关系
    if spx5d is not None and us10y_5d_bp is not None:
        if spx5d < -1.5 and us10y_5d_bp < -8:
            add('债牛股熊', 1, f"标普5日{spx5d:+.1f}%，美债10Y 5日{us10y_5d_bp:+.0f}bp，经典 risk-off 避险模式")
        elif spx5d < -0.5 and us10y_5d_bp > 10:
            add('股债双杀', 2, f"标普5日{spx5d:+.1f}% 且美债10Y 5日{us10y_5d_bp:+.0f}bp，股债双杀，通胀/流动性冲击")
        elif spx5d > 1.5 and us10y_5d_bp > 8:
            add('股债跷跷板', 0, f"标普5日{spx5d:+.1f}%，美债10Y 5日{us10y_5d_bp:+.0f}bp，增长预期驱动的正常轮动")

    # 6. 波动率状态
    if vix is not None and spx_dist_52w is not None:
        if vix < 13 and spx_dist_52w > -2:
            add('低波动+新高', 1, f"VIX={vix:.1f} 处于低位且标普距52周高点仅{spx_dist_52w:+.1f}%，警惕市场自满情绪")
        elif vix > 28:
            add('恐慌区间', 2, f"VIX={vix:.1f} 进入恐慌区间，注意流动性风险")
        else:
            add('波动率正常', 0, f"VIX={vix:.1f}，处于正常波动区间")

    if not sigs:
        add('数据不足', 0, '部分输入数据缺失，暂无可评估的背离信号')
    return sigs


# ──────────────────────────────────────────────
# 历史序列
# ──────────────────────────────────────────────
def update_history(old, today, point):
    """history: {series_key: [{d, v}, ...]}，按日期去重更新，截断到 HISTORY_MAX"""
    hist = (old or {}).get('history') or {}
    for key, val in point.items():
        if val is None:
            continue
        arr = hist.get(key, [])
        arr = [x for x in arr if x.get('d') != today]
        arr.append({'d': today, 'v': round(val, 4) if isinstance(val, float) else val})
        hist[key] = arr[-HISTORY_MAX:]
    return hist


def hist_change_bp(hist, key, days):
    """从history取N日前值，返回差值（bp用于利率，%用于汇率/商品）"""
    arr = hist.get(key) or []
    if len(arr) < days + 1:
        return None
    return arr[-1]['v'] - arr[-(days + 1)]['v']


# ──────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────
def main():
    now = datetime.now(CST)
    today = now.strftime('%Y-%m-%d')
    old = None
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding='utf-8') as f:
                old = json.load(f)
        except Exception:
            old = None
    old_val = (old or {}).get('valuation') or {}
    errors = []

    # ── 1. 腾讯行情 ──
    try:
        tq = fetch_tencent()
    except Exception as e:
        tq = {}
        errors.append(f"tencent: {e}")

    indices = {}
    for code, name, market, hi52_i, lo52_i in INDICES:
        r = tq.get(code)
        if not r or r['price'] is None:
            continue
        f = r['fields']
        indices[code] = {
            'name': name, 'market': market, 'price': r['price'],
            'chg_pct': r['chg_pct'], 'chg': r['chg'],
            'high52': _f(f[hi52_i]) if len(f) > hi52_i else None,
            'low52': _f(f[lo52_i]) if len(f) > lo52_i else None,
            'time': r['time_raw'],
        }

    usdcny = None
    r = tq.get('whUSDCNY')
    if r and r['price']:
        f = r['fields']
        usdcny = {'price': r['price'], 'chg_pct': _f(f[13]) if len(f) > 13 else None,
                  'time': f[5] if len(f) > 5 else ''}

    # ── 1b. 行业指数（PE温度计数据源）──
    sectors = {}
    for code, name in SECTOR_INDICES:
        r = tq.get(code)
        if not r or r['price'] is None:
            continue
        f = r['fields']
        market = 'hk' if code.startswith('hk') else 'cn'
        pe = _f(f[39]) if len(f) > 39 else None  # 腾讯字段[39]=指数PE-TTM
        sectors[code] = {
            'name': name, 'market': market,
            'price': r['price'], 'chg_pct': r['chg_pct'],
            'pe': pe, 'time': r['time_raw'],
        }

    commodities = {}
    for code, name in FUTURES:
        r = tq.get(code)
        if r and r['price']:
            commodities[code.replace('hf_', '')] = {
                'name': name, 'price': r['price'], 'chg_pct': r['chg_pct'],
                'high': r['high'], 'low': r['low'], 'time': r['time_raw']}

    # ── 2. K线（5日涨跌 + 20日波动率）──
    klines = {}
    for code in KLINE_INDEX + ['whUSDCNY']:
        try:
            klines[code] = fetch_kline(code, 25)
        except Exception as e:
            klines[code] = []
            errors.append(f"kline {code}: {e}")
        time.sleep(0.15)

    for code in list(indices.keys()):
        kl = klines.get(code) or []
        indices[code]['chg5d'] = pct_change(kl, 5)
        indices[code]['vol20'] = realized_vol(kl, 20)

    usdcny5d = pct_change(klines.get('whUSDCNY'), 5)

    # ── 3. CNBC（美债10Y / VIX / 美元指数 / 铜）──
    try:
        cnbc = fetch_cnbc()
    except Exception as e:
        cnbc = {}
        errors.append(f"cnbc: {e}")
    us10y = (cnbc.get('US10Y') or {}).get('value')
    vix = (cnbc.get('.VIX') or {}).get('value')
    dxy = (cnbc.get('@DX.1') or {})
    if dxy.get('value'):
        pass  # 下方统一装配
    if (cnbc.get('@HG.1') or {}).get('value'):
        commodities['HG'] = {'name': 'COMEX铜', 'price': cnbc['@HG.1']['value'],
                             'chg_pct': cnbc['@HG.1'].get('chg_pct'),
                             'high': None, 'low': None, 'time': cnbc['@HG.1'].get('time')}

    # ── 4. 中债 ──
    try:
        bonds = fetch_cn_bonds()
    except Exception as e:
        bonds = {}
        errors.append(f"cn_bonds: {e}")
    cn10y = bonds.get('y10')

    # ── 5. 标普盈利收益率（multpl，失败沿用旧值）──
    try:
        spx = fetch_spx_ey()
        if spx.get('ey') is None:
            raise ValueError('regex miss')
    except Exception as e:
        errors.append(f"multpl: {e}")
        spx = {'ey': old_val.get('spx_ey'), 'mean': old_val.get('spx_ey_mean'),
               'median': old_val.get('spx_ey_median'), 'asof': old_val.get('spx_ey_asof')}

    csi300_pe = None
    r300 = tq.get('sh000300')
    if r300:
        f = r300['fields']
        csi300_pe = _f(f[39]) if len(f) > 39 else None  # 腾讯字段[39]=指数PE-TTM（已实测验证）

    # ── 6. 利率差 ──
    spread_bp = round((us10y - cn10y) * 100, 1) if (us10y is not None and cn10y is not None) else None

    # ── 7. 历史序列（先append今日点，再算5日变动）──
    gold_p = commodities.get('GC', {}).get('price')
    cl_p = commodities.get('CL', {}).get('price')
    point = {
        'us10y': us10y, 'cn10y': cn10y, 'vix': vix,
        'gold': gold_p, 'wti': cl_p,
        'usdcny': usdcny['price'] if usdcny else None,
    }
    hist = update_history(old, today, point)

    us10y_5d_bp = hist_change_bp(hist, 'us10y', 5)
    us10y_5d_bp = round(us10y_5d_bp * 100, 1) if us10y_5d_bp is not None else None
    gold5d = hist_change_bp(hist, 'gold', 5)
    gold5d = round(gold5d / hist['gold'][-6]['v'] * 100, 2) if (gold5d is not None and len(hist.get('gold', [])) >= 6) else None
    cl5d = hist_change_bp(hist, 'wti', 5)
    cl5d = round(cl5d / hist['wti'][-6]['v'] * 100, 2) if (cl5d is not None and len(hist.get('wti', [])) >= 6) else None

    spx5d = indices.get('usINX', {}).get('chg5d')
    hsi5d = indices.get('hkHSI', {}).get('chg5d')

    # ── 8. 风险温度 ──
    mom_pool = [indices[c]['chg_pct'] for c in
                ['sh000001', 'sz399001', 'sh000300', 'hkHSI', 'hkHSTECH', 'usINX', 'usIXIC', 'usDJI']
                if c in indices and indices[c]['chg_pct'] is not None]
    mom_avg = sum(mom_pool) / len(mom_pool) if mom_pool else None
    temp, temp_parts, temp_meta = risk_temperature(vix, mom_avg, gold5d, us10y_5d_bp,
                                                   usdcny['chg_pct'] if usdcny else None)
    if temp is not None:
        hist = update_history(old, today, {**point, 'risk_temp': temp})

    # ── 9. ERP ──
    erp = compute_erp(csi300_pe, spx.get('ey'), us10y, cn10y)

    # ── 10. 背离信号 ──
    spx_q = indices.get('usINX', {})
    spx_dist_52w = None
    if spx_q.get('price') and spx_q.get('high52'):
        spx_dist_52w = round((spx_q['price'] - spx_q['high52']) / spx_q['high52'] * 100, 1)
    sigs = divergence_signals(
        tq, None, gold5d, cl5d, spx5d, hsi5d, usdcny5d, us10y_5d_bp, vix,
        indices.get('sh000001', {}).get('chg_pct'),
        indices.get('usINX', {}).get('chg_pct'),
        spx_dist_52w)

    # ── 11. 装配输出 ──
    out = {
        'updated_at': now.isoformat(timespec='seconds'),
        'indices': indices,
        'sectors': sectors,
        'commodities': commodities,
        'forex': {
            'USDCNY': usdcny,
            'DXY': {'name': '美元指数(期货)', 'price': dxy.get('value'),
                    'chg_pct': dxy.get('chg_pct'), 'time': dxy.get('time')} if dxy.get('value') else None,
        },
        'rates': {
            'us10y': {'value': us10y, 'time': (cnbc.get('US10Y') or {}).get('time')},
            'cn10y': {'value': cn10y, 'date': bonds.get('date')},
            'cn30y': {'value': bonds.get('y30'), 'date': bonds.get('date')},
            'cn1y': {'value': bonds.get('y1'), 'date': bonds.get('date')},
            'spread_bp': spread_bp,
            'us10y_5d_bp': us10y_5d_bp,
        },
        'vix': {'value': vix, 'chg_pct': (cnbc.get('.VIX') or {}).get('chg_pct'),
                'time': (cnbc.get('.VIX') or {}).get('time')},
        'valuation': {
            'csi300_pe': csi300_pe,
            'spx_ey': spx.get('ey'), 'spx_ey_mean': spx.get('mean'),
            'spx_ey_median': spx.get('median'), 'spx_ey_asof': spx.get('asof'),
        },
        'risk': {'temp': temp, 'components': temp_parts, **(temp_meta or {})},
        'erp': erp,
        'divergences': sigs,
        'history': hist,
        'errors': errors,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)

    print(f"[OK] {OUT}")
    print(f"  indices={len(indices)} commodities={len(commodities)} "
          f"us10y={us10y} cn10y={cn10y} vix={vix} csi300_pe={csi300_pe} spx_ey={spx.get('ey')}")
    print(f"  risk_temp={temp} ({(temp_meta or {}).get('level')})")
    if errors:
        print("  errors:", errors)
    return 0


if __name__ == '__main__':
    sys.exit(main())
