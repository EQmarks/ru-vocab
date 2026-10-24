// 设置页「GitHub 同步」面板 + 顶部同步徽标。
// 只创建/操作自己的 DOM，不依赖 app.js 内部实现；样式用 .rv-sync-* 前缀注入一次。
// 配置说明见 docs/GITHUB-SYNC.md。
import { sync, formatSyncTime } from './sync.js';

const STYLE_ID = 'rv-sync-styles';
const mountedEls = new WeakMap();

const STYLES = `
.rv-sync-panel{box-sizing:border-box;padding:16px;margin:12px 0;border:1px solid var(--rv-sync-border,var(--border,#e5e7eb));border-radius:var(--rv-sync-radius,14px);background:var(--rv-sync-bg,var(--card,#fff));color:var(--rv-sync-fg,var(--text,#1f2937));font-size:14px;line-height:1.55}
.rv-sync-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px}
.rv-sync-title{margin:0;font-size:16px;font-weight:600}
.rv-sync-hint{margin:0 0 12px;color:var(--rv-sync-muted,var(--muted,#6b7280));font-size:13px}
.rv-sync-form{display:grid;gap:12px}
.rv-sync-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:520px){.rv-sync-grid{grid-template-columns:1fr}}
.rv-sync-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.rv-sync-label{font-size:13px;color:var(--rv-sync-muted,var(--muted,#6b7280))}
.rv-sync-input{box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;font-size:16px;color:inherit;background:var(--rv-sync-input-bg,var(--bg,#fff));border:1px solid var(--rv-sync-border,var(--border,#d1d5db));border-radius:10px}
.rv-sync-input:focus-visible{outline:2px solid var(--rv-sync-accent,var(--accent,#2563eb));outline-offset:1px}
.rv-sync-token-row{display:flex;gap:8px;align-items:stretch}
.rv-sync-token-row .rv-sync-input{flex:1;min-width:0}
.rv-sync-btn{box-sizing:border-box;min-height:44px;padding:0 14px;font-size:14px;font-weight:600;border-radius:10px;border:1px solid var(--rv-sync-border,var(--border,#d1d5db));background:var(--rv-sync-btn-bg,var(--bg,#fff));color:inherit;cursor:pointer}
.rv-sync-btn:disabled{opacity:.55;cursor:not-allowed}
.rv-sync-btn:focus-visible{outline:2px solid var(--rv-sync-accent,var(--accent,#2563eb));outline-offset:1px}
.rv-sync-btn--primary{background:var(--rv-sync-accent,var(--accent,#2563eb));border-color:var(--rv-sync-accent,var(--accent,#2563eb));color:#fff}
.rv-sync-btn--danger{color:var(--rv-sync-danger,var(--danger,#b91c1c));border-color:var(--rv-sync-danger,var(--danger,#b91c1c))}
.rv-sync-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.rv-sync-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0}
.rv-sync-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#9ca3af;flex:none}
.rv-sync-dot--ok{background:#16a34a}
.rv-sync-dot--sync{background:#2563eb;animation:rv-sync-pulse 1s ease-in-out infinite}
.rv-sync-dot--warn{background:#d97706}
.rv-sync-dot--err{background:#dc2626}
@keyframes rv-sync-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.rv-sync-meta{margin:2px 0;color:var(--rv-sync-muted,var(--muted,#6b7280));font-size:13px;overflow-wrap:anywhere}
.rv-sync-error{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--rv-sync-error-bg,rgba(220,38,38,.08));color:var(--rv-sync-danger,var(--danger,#b91c1c));font-size:13px;overflow-wrap:anywhere}
.rv-sync-help{margin-top:12px;font-size:13px;color:var(--rv-sync-muted,var(--muted,#6b7280))}
.rv-sync-help summary{cursor:pointer;font-weight:600;color:var(--rv-sync-fg,var(--text,#374151))}
.rv-sync-help ol{margin:8px 0;padding-left:20px}
.rv-sync-help li{margin:2px 0}
.rv-sync-help a{color:var(--rv-sync-accent,var(--accent,#2563eb));word-break:break-all}
.rv-sync-badge{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;font-size:12px;font-weight:600;color:inherit;background:transparent;border:1px solid var(--rv-sync-border,var(--border,#d1d5db));border-radius:999px;cursor:pointer}
.rv-sync-badge:focus-visible{outline:2px solid var(--rv-sync-accent,var(--accent,#2563eb));outline-offset:2px}
.rv-sync-badge--idle{opacity:.75}
.rv-sync-toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9999;max-width:86vw;padding:10px 14px;border-radius:10px;background:rgba(17,24,39,.92);color:#fff;font-size:13px;line-height:1.45;box-shadow:0 8px 24px rgba(0,0,0,.25);overflow-wrap:anywhere}
`;

function ensureStyles() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'hidden') node.hidden = !!value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  const list = children ? [].concat(children) : [];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function showToast(message) {
  if (typeof document === 'undefined' || !document.body) return;
  const toast = el('div', { class: 'rv-sync-toast', role: 'status', text: message });
  document.body.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2600);
}

function stateText(st) {
  if (st.state === 'syncing') return '正在同步…';
  if (st.state === 'offline') return '离线，联网后自动重试';
  if (st.state === 'error') return '同步失败';
  if (st.pending) return '有改动待同步';
  if (st.state === 'ok') return '已同步';
  return '已连接';
}

function dotClass(st) {
  if (st.state === 'syncing') return 'rv-sync-dot--sync';
  if (st.state === 'ok') return st.pending ? 'rv-sync-dot--warn' : 'rv-sync-dot--ok';
  if (st.state === 'error') return 'rv-sync-dot--err';
  if (st.state === 'offline') return 'rv-sync-dot--warn';
  return '';
}

const HELP_STEPS = [
  '在 GitHub 新建一个私有仓库（勾选 Add a README，默认分支 main）。',
  '生成 fine-grained Personal Access Token：只授权这个仓库，权限选 Contents: Read and write。',
  '把 owner / repo / 分支 / 路径 / token 填到下面，点「连接并同步」；其他设备各配一次即可。',
];

export function mountSyncPanel(hostEl) {
  const noop = { refresh() {}, destroy() {} };
  if (!hostEl || typeof document === 'undefined') return noop;
  ensureStyles();
  const previous = mountedEls.get(hostEl);
  if (previous) previous.destroy();

  let unsubscribe = null;
  let submitting = false;
  let view = 'none';
  let wasConnected = false;
  const section = el('section', { class: 'rv-sync-panel', 'aria-label': 'GitHub 同步设置' });
  hostEl.appendChild(section);

  const handle = {
    refresh: () => render(),
    destroy() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (section.parentNode) section.parentNode.removeChild(section);
      mountedEls.delete(hostEl);
    },
  };
  mountedEls.set(hostEl, handle);

  function render() {
    clearNode(section);
    if (sync.isConfigured()) {
      view = 'configured';
      renderConfigured();
    } else {
      view = 'form';
      renderForm();
    }
  }

  function renderForm() {
    const form = el('form', { class: 'rv-sync-form', novalidate: true });
    const ownerInput = el('input', {
      class: 'rv-sync-input', type: 'text', name: 'owner', autocomplete: 'username',
      placeholder: 'GitHub 用户名，例如 octocat', required: true,
    });
    const repoInput = el('input', {
      class: 'rv-sync-input', type: 'text', name: 'repo', placeholder: '仓库名，例如 russian-vocab',
      autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: true,
    });
    const branchInput = el('input', {
      class: 'rv-sync-input', type: 'text', name: 'branch', value: 'main',
      autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: true,
    });
    const pathInput = el('input', {
      class: 'rv-sync-input', type: 'text', name: 'path', value: 'russian-vocab/progress.json',
      autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: true,
    });
    const tokenInput = el('input', {
      class: 'rv-sync-input', type: 'password', name: 'token', autocomplete: 'off',
      autocapitalize: 'none', spellcheck: 'false', placeholder: '粘贴 Personal Access Token',
      required: true,
    });
    const toggle = el('button', { class: 'rv-sync-btn', type: 'button', 'aria-label': '显示或隐藏 Token' }, '显示');
    toggle.addEventListener('click', () => {
      const show = tokenInput.type === 'password';
      tokenInput.type = show ? 'text' : 'password';
      toggle.textContent = show ? '隐藏' : '显示';
    });
    const errorEl = el('div', { class: 'rv-sync-error', role: 'alert', hidden: true });
    const submitBtn = el('button', { class: 'rv-sync-btn rv-sync-btn--primary', type: 'submit' }, '连接并同步');
    const inputs = [ownerInput, repoInput, branchInput, pathInput, tokenInput];

    function updateFeedback() {
      const st = sync.status();
      const busy = submitting || st.state === 'syncing';
      for (const input of inputs) input.disabled = busy;
      toggle.disabled = busy;
      submitBtn.disabled = busy;
      submitBtn.textContent = busy ? '连接中…' : '连接并同步';
      const msg = st.lastError || '';
      errorEl.textContent = msg;
      errorEl.hidden = !msg;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitting) return;
      submitting = true;
      updateFeedback();
      try {
        const st = await sync.configure({
          owner: ownerInput.value,
          repo: repoInput.value,
          branch: branchInput.value,
          path: pathInput.value,
          token: tokenInput.value,
        });
        if (st.lastError) showToast('配置已保存，但首次同步失败：' + st.lastError);
        else showToast('已连接并完成同步');
      } catch (err) {
        const msg = err && err.message ? err.message : '连接失败';
        errorEl.textContent = msg;
        errorEl.hidden = false;
        showToast('连接失败：' + msg);
      } finally {
        submitting = false;
        if (!sync.isConfigured() && view === 'form') updateFeedback();
      }
    });

    form.appendChild(el('div', { class: 'rv-sync-grid' }, [
      el('label', { class: 'rv-sync-field' }, [el('span', { class: 'rv-sync-label' }, '仓库所有者（owner）'), ownerInput]),
      el('label', { class: 'rv-sync-field' }, [el('span', { class: 'rv-sync-label' }, '仓库名（repo）'), repoInput]),
    ]));
    form.appendChild(el('div', { class: 'rv-sync-grid' }, [
      el('label', { class: 'rv-sync-field' }, [el('span', { class: 'rv-sync-label' }, '分支（branch）'), branchInput]),
      el('label', { class: 'rv-sync-field' }, [el('span', { class: 'rv-sync-label' }, '远端文件路径'), pathInput]),
    ]));
    form.appendChild(el('label', { class: 'rv-sync-field' }, [
      el('span', { class: 'rv-sync-label' }, 'Personal Access Token'),
      el('div', { class: 'rv-sync-token-row' }, [tokenInput, toggle]),
    ]));
    form.appendChild(el('p', { class: 'rv-sync-hint' }, 'Token 只保存在这台设备的浏览器里（localStorage），不会写进导出文件，也不会上传到别处。'));
    form.appendChild(el('div', { class: 'rv-sync-actions' }, [submitBtn]));
    form.appendChild(errorEl);

    section.appendChild(el('h3', { class: 'rv-sync-title' }, '同步（GitHub 私有仓库）'));
    section.appendChild(el('p', { class: 'rv-sync-hint' }, '把学习进度备份到自己的 GitHub 私有仓库，多台设备共享。不配置也可以纯本地使用。'));
    section.appendChild(form);

    const details = el('details', { class: 'rv-sync-help' });
    details.appendChild(el('summary', {}, '不知道怎么配置？三步摘要'));
    details.appendChild(el('ol', {}, HELP_STEPS.map((step) => el('li', {}, step))));
    details.appendChild(el('p', {}, [
      el('a', { href: 'docs/GITHUB-SYNC.md', target: '_blank', rel: 'noopener' }, '查看完整配置与常见错误排查文档'),
    ]));
    section.appendChild(details);
    updateFeedback();
  }

  function renderConfigured() {
    const st = sync.status();
    const cfg = sync.config() || {};
    const syncing = st.state === 'syncing';
    const immediateBtn = el('button', { class: 'rv-sync-btn', type: 'button' }, syncing ? '同步中…' : '立即同步');
    const disconnectBtn = el('button', { class: 'rv-sync-btn rv-sync-btn--danger', type: 'button' }, '断开连接');
    immediateBtn.disabled = syncing;
    disconnectBtn.disabled = syncing;

    const errorEl = el('p', { class: 'rv-sync-error', role: 'alert', hidden: !st.lastError }, st.lastError || '');
    const statusRow = el('div', { class: 'rv-sync-status' }, [
      el('span', { class: 'rv-sync-dot ' + dotClass(st), 'aria-hidden': 'true' }),
      el('strong', {}, stateText(st)),
    ]);

    immediateBtn.addEventListener('click', async () => {
      immediateBtn.disabled = true;
      immediateBtn.textContent = '同步中…';
      try {
        await sync.pull();
        if (sync.status().pending) await sync.push();
        showToast('已完成同步');
      } catch (err) {
        showToast('同步失败：' + (err && err.message ? err.message : '未知错误'));
      }
    });
    disconnectBtn.addEventListener('click', () => {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        const ok = window.confirm('断开后本机学习进度仍保留，但不再自动同步。确定断开连接？');
        if (!ok) return;
      }
      sync.disconnect();
      render();
      showToast('已断开同步');
    });

    section.appendChild(el('h3', { class: 'rv-sync-title' }, '同步（GitHub 私有仓库）'));
    section.appendChild(statusRow);
    section.appendChild(el('p', { class: 'rv-sync-meta' }, st.lastSyncAt ? '上次同步：' + formatSyncTime(st.lastSyncAt) : '尚未完成过一次同步'));
    if (st.pending) section.appendChild(el('p', { class: 'rv-sync-meta' }, '有本地改动待推送'));
    if (st.lastError) section.appendChild(errorEl);
    section.appendChild(el('div', { class: 'rv-sync-actions' }, [immediateBtn, disconnectBtn]));
    section.appendChild(el('p', { class: 'rv-sync-meta' }, cfg.owner + '/' + cfg.repo + ' · 分支 ' + cfg.branch));
    section.appendChild(el('p', { class: 'rv-sync-meta' }, '文件：' + cfg.path));
    section.appendChild(el('p', { class: 'rv-sync-meta' }, 'Token：' + (cfg.token || '****') + '（只保存在本机）'));
    section.appendChild(el('p', { class: 'rv-sync-hint' }, '配置会保存在本机浏览器；换设备需要在新设备上再填一次。'));
  }

  unsubscribe = sync.onChange(() => {
    if (hostEl.isConnected) wasConnected = true;
    else if (wasConnected) {
      handle.destroy();
      return;
    }
    const st = sync.status();
    if (!st.configured) {
      if (view === 'form') updateVisibleForm();
      else render();
    } else {
      renderConfiguredViewSafe();
    }
  });

  function updateVisibleForm() {
    const errorEl = section.querySelector('.rv-sync-error');
    if (!errorEl) return;
    const st = sync.status();
    const msg = st.lastError || '';
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  function renderConfiguredViewSafe() {
    clearNode(section);
    view = 'configured';
    renderConfigured();
  }

  render();
  return handle;
}

export function mountSyncBadge(hostEl) {
  const noop = { refresh() {}, destroy() {} };
  if (!hostEl || typeof document === 'undefined') return noop;
  ensureStyles();
  const previous = mountedEls.get(hostEl);
  if (previous) previous.destroy();

  let wasConnected = false;
  const button = el('button', { class: 'rv-sync-badge', type: 'button', 'aria-label': '同步状态', title: '同步状态' });
  const dot = el('span', { class: 'rv-sync-dot', 'aria-hidden': 'true' });
  const label = el('span', {}, '未配置');
  button.appendChild(dot);
  button.appendChild(label);
  hostEl.appendChild(button);

  let unsubscribe = null;
  const handle = {
    refresh: () => render(),
    destroy() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (button.parentNode) button.parentNode.removeChild(button);
      mountedEls.delete(hostEl);
    },
  };
  mountedEls.set(hostEl, handle);

  function render() {
    const st = sync.status();
    const btn = button;
    dot.className = 'rv-sync-dot ' + dotClass(st);
    if (!st.configured) {
      btn.classList.add('rv-sync-badge--idle');
      label.textContent = '本地';
      btn.title = '未配置 GitHub 同步：到设置页填写仓库与 Token';
      return;
    }
    btn.classList.remove('rv-sync-badge--idle');
    if (st.state === 'syncing') label.textContent = '同步中';
    else if (st.state === 'offline') label.textContent = '离线';
    else if (st.state === 'error') label.textContent = '同步失败';
    else if (st.pending) label.textContent = '待同步';
    else label.textContent = '已同步';
    const parts = [];
    if (st.lastSyncAt) parts.push('上次同步 ' + formatSyncTime(st.lastSyncAt));
    if (st.lastError) parts.push(st.lastError);
    parts.push('点按立即拉取');
    btn.title = parts.join(' · ');
  }

  button.addEventListener('click', async () => {
    if (!sync.isConfigured()) {
      showToast('先到设置页配置 GitHub 同步');
      return;
    }
    try {
      await sync.pull();
      if (sync.status().pending) await sync.push();
    } catch (err) {
      // 状态徽标与面板会显示错误
    }
  });

  unsubscribe = sync.onChange(() => {
    if (hostEl.isConnected) wasConnected = true;
    else if (wasConnected) {
      handle.destroy();
      return;
    }
    render();
  });

  render();
  return handle;
}
