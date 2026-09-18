import json, re, datetime, os, base64

# 仓库根 = 本脚本的上层目录(仓库化:不再依赖固定路径)
base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
site = f'{base}/dist'   # 站点发布目录：html / css / js / data 都在这里
now = datetime.datetime.now().strftime('%Y%m%d_%H%M')
main_name = f'aiinvest_{now}.html'
admin_name = f'aiinvest_admin_{now}.html'

# 账号保险箱(密文):从 accounts.json 提取公开可嵌入字段
def load_vault_js():
    path = f'{site}/data/accounts.json'
    acc = json.load(open(path, encoding='utf-8'))
    pub = []
    for a in acc.get('accounts', []):
        pub.append({k: a[k] for k in ('user', 'display_name', 'iter', 'salt', 'iv', 'blob', 'mac') if k in a})
    return 'window.__VAULT__ = ' + json.dumps({'accounts': pub}, ensure_ascii=False, separators=(',', ':')) + ';\n'

def build(html_path, js_files, data_include, out_name, md_in_reports=True, link_replace=None, include_vault=False):
    html = open(f'{site}/{html_path}', encoding='utf-8').read()
    css = open(f'{site}/css/style.css', encoding='utf-8').read()
    js_content = '\n'.join(open(f'{site}/js/{f}', encoding='utf-8').read() for f in js_files)
    if include_vault:
        js_content = load_vault_js() + js_content

    # 1) 内联 CSS
    html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')
    # 2) 移除 js 外链标签
    html = re.sub(r'\s*<script src="js/[^"]+\.js"></script>', '', html)

    # 3) 内联数据：按白名单选择 json(安全:portfolio.json 明文绝不入前台)
    data_map = {}
    for f in sorted(os.listdir(f'{site}/data')):
        if f.endswith('.json') and (f in data_include):
            data_map[f'data/{f}'] = json.load(open(f'{site}/data/{f}', encoding='utf-8'))
    # 内联研报 md（仅主站需要）
    if md_in_reports:
        reports_root = f'{site}/data/reports'
        if os.path.isdir(reports_root):
            for root, dirs, files in os.walk(reports_root):
                for fn in sorted(files):
                    if fn.endswith('.md'):
                        full = os.path.join(root, fn)
                        rel = 'data/reports/' + os.path.relpath(full, reports_root).replace(os.sep, '/')
                        data_map[rel] = open(full, encoding='utf-8').read()
    data_js = json.dumps(data_map, ensure_ascii=False, separators=(',', ':'))

    interceptor = f'''<script>
(function(){{
  var __DATA__ = {data_js};
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {{
    if (typeof url === 'string' && __DATA__[url]) {{
      var data = __DATA__[url];
      var isJson = typeof data !== 'string' || (url.indexOf('.json') > -1);
      var body = isJson ? JSON.stringify(data) : data;
      return Promise.resolve(new Response(body, {{
        status: 200,
        headers: {{'Content-Type': isJson ? 'application/json' : 'text/markdown; charset=utf-8'}}
      }}));
    }}
    return origFetch.apply(this, arguments);
  }};
}})();
</script>
'''
    modules = '<script>\n' + js_content + '\n</script>\n'

    # 页面间链接替换（单文件版互相链接）
    if link_replace:
        for old, new in link_replace.items():
            html = html.replace(old, new)

    # 主站：直接插在 </body> 之前
    # 管理后台：在 <!--ADMIN_INIT--> 之前插入（让 modules + __DATA__ 先于 Admin.init 执行）
    if '<!--ADMIN_INIT-->' in html:
        html = html.replace('<!--ADMIN_INIT-->', modules + interceptor)
    else:
        html = html.replace('</body>', modules + interceptor + '</body>')

    out = f'{base}/{out_name}'
    open(out, 'w', encoding='utf-8').write(html)
    md_count = sum(1 for k in data_map if k.endswith('.md'))
    print(f'[{out_name}] ({os.path.getsize(out):,} bytes, md={md_count})')
    return out

# ===== 构建管理后台（返回链接指向主站单文件版） =====
build(
    html_path='admin.html',
    js_files=['utils.js','clock.js','heatmap.js','ranking.js'],
    data_include={'clusters.json','companies.json','meta.json','valuations.json','research_reports.json'},
    out_name=admin_name,
    md_in_reports=False,
    link_replace={'href="index.html"': f'href="{main_name}"'},
)

# ===== 构建主站（入口链接指向管理后台单文件版） =====
# 安全:v3 起 portfolio.json(明文持仓)不再内联;持仓仅以密文 vault 提供
build(
    html_path='index.html',
    js_files=['utils.js','clock.js','heatmap.js','ranking.js','auth.js','admin-accounts.js','portfolio.js','research.js','market-pulse.js','app.js'],
    data_include={'clusters.json','companies.json','market_pulse.json','meta.json','research_reports.json','valuations.json','news.json'},
    out_name=main_name,
    md_in_reports=True,
    link_replace={'href="admin.html"': f'href="{admin_name}"'},
    include_vault=True,
)

# 安全校验:产物中不得出现明文持仓字段组合
for name in (main_name,):
    content = open(f'{base}/{name}', encoding='utf-8').read()
    leaks = []
    if '"holdings"' in content or "'holdings'" in content: leaks.append('holdings')
    if 'aaoi1' in content: leaks.append('aaoi持仓id')
    if 'DEFAULT_POSITIONS' in content: leaks.append('DEFAULT_POSITIONS')
    if 'qt.gtimg.cn' not in content: leaks.append('行情接口缺失?')
    if leaks:
        print('⚠️ 安全检查告警:', leaks)
    else:
        print('✅ 安全校验:前台产物无明文持仓数据(holdings/持仓id/默认持仓)')
