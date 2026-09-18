#!/usr/bin/env python3
"""
sync_data.py — 数据同步脚本
当行业筛选方法论更新时，运行此脚本从方法论文档中提取最新数据并更新 data/*.json

用法: python3 sync_data.py [--dry-run]

数据源:
- clusters.json: 从方法论 v4.1 的"全球12产业集群深度筛选"提取
- companies.json: 从全球12产业集群深度筛选_终版_v4.1 提取
- news.json: 手动维护（此脚本仅更新时间戳）
"""

import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist', 'data')
DRY_RUN = '--dry-run' in sys.argv

def log(msg):
    print(f"[sync] {msg}")

def load_json(filename):
    path = os.path.join(DATA_DIR, filename)
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(filename, data):
    if DRY_RUN:
        log(f"DRY RUN: would update {filename}")
        return
    path = os.path.join(DATA_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log(f"Updated {filename}")

def update_meta():
    """更新元数据文件的时间戳"""
    meta = load_json('meta.json')
    meta['data_last_updated'] = datetime.now(CST).isoformat()
    save_json('meta.json', meta)
    return meta

def sync_from_methodology():
    """
    从方法论文档提取最新数据。
    
    当前为模板模式：解析本地 clusters.json 并做基础校验。
    未来可扩展为从 tdrive 拉取 .md 文件并解析表格。
    """
    log("开始同步...")
    
    # 1. 校验 clusters.json
    clusters = load_json('clusters.json')
    log(f"clusters.json: {len(clusters)} 个集群")
    
    # 校验评分范围
    for c in clusters:
        if not (1.0 <= c['score'] <= 5.0):
            log(f"WARNING: {c['name']} 评分 {c['score']} 超出范围")
        if c['grade'] not in ('A', 'B', 'C'):
            log(f"WARNING: {c['name']} 等级 {c['grade']} 无效")
    
    # 2. 校验 companies.json
    companies = load_json('companies.json')
    log(f"companies.json: {len(companies)} 家公司")
    
    valid_tiers = {'Deep', 'Shallow', 'Watch'}
    for c in companies:
        if c.get('tier') not in valid_tiers:
            log(f"WARNING: {c['name']} 层级 {c.get('tier')} 无效")
    
    # 3. 校验 news.json
    news = load_json('news.json')
    log(f"news.json: {len(news)} 条新闻")
    
    # 4. 更新 meta
    meta = update_meta()
    log(f"同步完成! 数据版本: {meta['version']}, 更新时间: {meta['data_last_updated']}")
    
    # 打印摘要
    print(f"\n{'='*60}")
    print(f"  数据同步摘要")
    print(f"{'='*60}")
    print(f"  方法论版本: {meta['methodology_version']} ({meta['methodology_date']})")
    print(f"  集群数量:   {meta['clusters_count']}")
    print(f"  公司数量:   {meta['companies_count']}")
    print(f"  更新时间:   {meta['data_last_updated']}")
    print(f"{'='*60}")


if __name__ == '__main__':
    sync_from_methodology()
