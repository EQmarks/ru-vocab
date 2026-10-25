
# -*- coding: utf-8 -*-
"""本地小服务：粘贴 GPT 给的 SVG/path，实时预览并写入手写体 т。

启动：python scripts/glyph_server.py   （或 npm run glyph）
网址：http://127.0.0.1:5198
"""
import base64
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import glyph as G

PORT = 5198
LOCK = threading.Lock()
CURRENT = os.path.join(G.GLYPH_DIR, 'current-base.png')


def _b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def _current():
    with LOCK:
        G.render_preview(G.BASE_TTF, out=CURRENT)
        return 'data:image/png;base64,' + _b64(CURRENT)


def _apply(payload, install):
    d = (payload.get('d') or '').strip()
    if not d:
        raise ValueError('缺少 SVG / path 内容')
    both = bool(payload.get('both'))
    adv = payload.get('advance') or None
    if adv:
        adv = int(adv)
    with LOCK:
        info = G.apply_glyph(d, both=both, advance=adv, install=install)
        img = _b64(info['preview'])
    return {'ok': True, 'advance': info['advance'], 'installed': install,
            'image': 'data:image/png;base64,' + img}


PAGE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>字形工坊 · т</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#f6f3ec;color:#26231d;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:24px}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#8a8272;font-size:13px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:860px){.grid{grid-template-columns:1fr}}
.card{background:#fffdf8;border:1px solid #e6e0d2;border-radius:14px;padding:14px}
.card h2{font-size:13px;color:#8a8272;margin:0 0 8px;font-weight:600}
textarea{width:100%;min-height:190px;border:1px solid #ddd6c6;border-radius:10px;padding:10px;font:12px/1.5 ui-monospace,Consolas,monospace;background:#fff;resize:vertical}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px}
label{font-size:13px;color:#5c564a}
input[type=number]{width:110px;padding:6px 8px;border:1px solid #ddd6c6;border-radius:8px}
button{border:0;border-radius:9px;padding:9px 16px;font-size:14px;cursor:pointer}
.primary{background:#2f4a8f;color:#fff}
.ghost{background:#ece7db;color:#3b362c}
button:disabled{opacity:.5;cursor:wait}
img{width:100%;border-radius:10px;border:1px solid #eee8da;background:#fffdf8;display:block}
.hint{color:#8a8272;font-size:12px;margin-top:8px}
#status{font-size:13px;color:#2f4a8f;min-height:20px;margin-top:8px}
.ok{color:#2e7d4f}
.err{color:#c0392b}
kbd{background:#eee8da;border-radius:4px;padding:1px 5px;font-size:12px}
</style></head><body><div class="wrap">
<h1>字形工坊 · 手写体 т / м</h1>
<div class="sub">把 GPT 返回的 <code>&lt;path d="…"&gt;</code> 或整段 SVG 贴进来，预览后写入字体。坐标随意，脚本会自动缩放、翻正、对齐基线。</div>
<div class="grid">
  <div class="card">
    <h2>① 贴入新字形</h2>
    <textarea id="d" placeholder='例如：<path d="M 80 100 ... Z" /> 或直接 M 80 100 ... Z'></textarea>
    <div class="row">
      <label><input type="checkbox" id="both"/> 同时用于「м」</label>
      <label>前进宽度 <input type="number" id="adv" placeholder="自动"/></label>
    </div>
    <div class="row">
      <button class="primary" id="preview">预览</button>
      <button class="ghost" id="apply">写入字体</button>
    </div>
    <div id="status"></div>
    <div class="hint">「写入字体」会直接更新本地 <kbd>public/fonts/rv-hand.woff2</kbd>，线上部署还需要升 SW 版本再推送（告诉我即可）。</div>
  </div>
  <div class="card">
    <h2>② 当前字体里的 т</h2>
    <img id="current" alt="当前字形"/>
    <div class="hint">字高会自动对齐到当前 т 的高度（419 单位），底边贴基线，左边留 3。</div>
  </div>
</div>
<div class="card" style="margin-top:18px">
  <h2>③ 新字形预览</h2>
  <img id="result" alt="新字形预览" style="display:none"/>
  <div id="empty" class="hint">还没生成预览。贴入路径后点「预览」。</div>
</div>
<script>
const $=id=>document.getElementById(id);
async function post(url,payload){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return r.json();
}
function payload(){return {d:$('d').value,both:$('both').checked,advance:$('adv').value?Number($('adv').value):null};}
async function showCurrent(){
  try{const r=await fetch('/api/current');const j=await r.json();if(j.ok)$('current').src=j.image;}catch(e){}
}
async function preview(){
  $('status').textContent='生成中…';$('status').className='';
  try{
    const j=await post('/api/preview',payload());
    if(!j.ok)throw new Error(j.error||'失败');
    $('result').src=j.image;$('result').style.display='block';$('empty').style.display='none';
    $('status').textContent='预览完成 · 前进宽度 '+j.advance;
    $('status').className='ok';
  }catch(e){$('status').textContent='出错：'+e.message;$('status').className='err';}
}
async function apply(){
  $('status').textContent='写入中…';$('status').className='';
  try{
    const j=await post('/api/apply',payload());
    if(!j.ok)throw new Error(j.error||'失败');
    $('result').src=j.image;$('result').style.display='block';$('empty').style.display='none';
    $('status').textContent='已写入本地字体 · 前进宽度 '+j.advance+'（部署时记得升版本）';
    $('status').className='ok';
  }catch(e){$('status').textContent='出错：'+e.message;$('status').className='err';}
}
$('preview').onclick=preview;$('apply').onclick=apply;
showCurrent();
</script>
</div></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        if isinstance(body, bytes):
            data = body
        else:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        try:
            if self.path in ('/', '/index.html'):
                self._send(200, PAGE.encode('utf-8'), 'text/html; charset=utf-8')
            elif self.path.startswith('/api/current'):
                self._send(200, {'ok': True, 'image': _current()})
            else:
                self._send(404, {'ok': False, 'error': 'not found'})
        except Exception as e:
            self._send(500, {'ok': False, 'error': str(e)})

    def do_POST(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(n) or b'{}')
            if self.path == '/api/preview':
                self._send(200, _apply(payload, False))
            elif self.path == '/api/apply':
                self._send(200, _apply(payload, True))
            else:
                self._send(404, {'ok': False, 'error': 'not found'})
        except Exception as e:
            self._send(400, {'ok': False, 'error': str(e)})

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('字形工坊: http://127.0.0.1:%d' % PORT, flush=True)
    srv.serve_forever()
