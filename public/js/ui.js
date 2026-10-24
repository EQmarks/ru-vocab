// public/js/ui.js — 通用 UI 小工具：转义 / DOM / toast / 弹窗 / 日期 / 防抖
// 纯浏览器 ESM，零依赖。词库内容一律转义后再拼接，避免注入。

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

// 把带重音符（U+0301）的俄语词渲染成安全 HTML；重音符与元音包在同一个 span 里，不会被换行拆开。
export function stressHTML(text) {
  const source = String(text || '');
  const parts = [];
  for (const ch of source) {
    if (ch === '\u0301' && parts.length > 0) {
      parts[parts.length - 1].stress = true;
    } else {
      parts.push({ base: ch, stress: false });
    }
  }
  let html = '';
  for (const part of parts) {
    if (part.stress) html += '<span class="stress">' + esc(part.base) + '\u0301</span>';
    else html += esc(part.base);
  }
  return html;
}

export function qs(selector, root) {
  return (root || document).querySelector(selector);
}

export function qsa(selector, root) {
  return Array.from((root || document).querySelectorAll(selector));
}

export function debounce(fn, wait) {
  let timer = 0;
  return function debounced() {
    const self = this;
    const args = arguments;
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(self, args), typeof wait === 'number' ? wait : 200);
  };
}

export const ICON = {
  speak: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5.2 6.6 9H3.6v6h3L11 18.8V5.2Z"/><path d="M14.9 8.7a4.7 4.7 0 0 1 0 6.6"/><path d="M17.7 6a8.6 8.6 0 0 1 0 12"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13"/><path d="M5.5 12h13"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 6.5 11 11"/><path d="m17.5 6.5-11 11"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  arrow: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"/><path d="m12.5 5.5 6.5 6.5-6.5 6.5"/></svg>',
};

/* ---------- 日期 ---------- */

export function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function fmtDateCN(ts) {
  const d = new Date(typeof ts === 'number' ? ts : Date.now());
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEKDAYS[d.getDay()];
}

export function fmtDateShort(ts) {
  const d = new Date(typeof ts === 'number' ? ts : Date.now());
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function fmtTimeHM(ts) {
  const d = new Date(typeof ts === 'number' ? ts : Date.now());
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function fmtDateTime(ts) {
  return fmtDateShort(ts) + ' ' + fmtTimeHM(ts);
}

export function parseDayKey(key) {
  const parts = String(key || '').split('-').map(Number);
  return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1);
}

export function fmtDayKeyCN(key) {
  const d = parseDayKey(key);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
}

export function pct(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p / t) * 100)));
}

/* ---------- toast ---------- */

let toastRoot = null;

function ensureToastRoot() {
  if (toastRoot && document.body.contains(toastRoot)) return toastRoot;
  toastRoot = document.getElementById('ui-toast');
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.id = 'ui-toast';
    toastRoot.className = 'toast-root';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

export function toast(message, options) {
  const opts = options || {};
  const type = opts.type || 'info';
  const root = ensureToastRoot();
  const node = document.createElement('div');
  node.className = 'toast toast--' + type;
  node.textContent = String(message === null || message === undefined ? '' : message);
  root.appendChild(node);
  const life = typeof opts.duration === 'number' ? opts.duration : type === 'error' ? 3600 : 2200;
  setTimeout(() => {
    node.classList.add('toast--out');
    setTimeout(() => node.remove(), 220);
  }, life);
  return node;
}

/* ---------- 弹窗 ---------- */

let modalRoot = null;
let modalCount = 0;
let lastFocused = null;

function ensureModalRoot() {
  if (modalRoot && document.body.contains(modalRoot)) return modalRoot;
  modalRoot = document.getElementById('ui-modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'ui-modal-root';
    document.body.appendChild(modalRoot);
  }
  return modalRoot;
}

export function hasOpenModal() {
  const root = document.getElementById('ui-modal-root');
  return !!(root && root.children.length > 0);
}

function collectFocusable(el) {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(el.querySelectorAll(selector)).filter((node) => node.getClientRects().length > 0);
}

// 打开一个弹层。返回 { el, body, close }。
export function openModal(options) {
  const opts = options || {};
  const root = ensureModalRoot();
  if (!root.children.length) lastFocused = document.activeElement;

  const titleId = 'ui-modal-title-' + (++modalCount);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const titleHTML = opts.title
    ? '<h2 class="modal-title" id="' + titleId + '">' + esc(opts.title) + '</h2>'
    : '';
  const closeHTML = opts.closable === false
    ? ''
    : '<button type="button" class="icon-btn modal-close" data-modal-close aria-label="关闭">' + ICON.close + '</button>';

  backdrop.innerHTML =
    '<div class="modal ' + esc(opts.className || '') + '" role="dialog" aria-modal="true"' +
    (opts.title ? ' aria-labelledby="' + titleId + '"' : '') + ' tabindex="-1">' +
      '<div class="modal-head">' + titleHTML + closeHTML + '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
    '</div>';

  root.appendChild(backdrop);
  const modalEl = backdrop.firstElementChild;
  const bodyEl = modalEl.querySelector('.modal-body');
  document.documentElement.classList.add('modal-open');

  let closed = false;
  function cleanup() {
    document.removeEventListener('keydown', onKey, true);
  }
  function close(reason) {
    if (closed) return;
    closed = true;
    cleanup();
    backdrop.remove();
    if (!root.children.length) {
      document.documentElement.classList.remove('modal-open');
      if (lastFocused && typeof lastFocused.focus === 'function' && document.contains(lastFocused)) {
        try { lastFocused.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
      }
      lastFocused = null;
    }
    if (typeof opts.onClose === 'function') opts.onClose(reason);
  }

  function onKey(ev) {
    if (root.lastElementChild !== backdrop) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close('escape');
      return;
    }
    if (ev.key !== 'Tab') return;
    const list = collectFocusable(modalEl);
    if (!list.length) { ev.preventDefault(); modalEl.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  document.addEventListener('keydown', onKey, true);

  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop && opts.backdropClose !== false) { close('backdrop'); return; }
    const closer = ev.target instanceof Element ? ev.target.closest('[data-modal-close]') : null;
    if (closer && modalEl.contains(closer)) close('button');
  });

  try { modalEl.focus({ preventScroll: true }); } catch (e) { modalEl.focus(); }

  return { el: modalEl, body: bodyEl, close: close };
}

export function confirmDialog(options) {
  const opts = options || {};
  return new Promise((resolve) => {
    let decided = false;
    function settle(value) {
      if (decided) return;
      decided = true;
      resolve(value);
    }
    const body =
      '<p class="modal-text">' + esc(opts.message || '') + '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn" data-confirm-cancel>' + esc(opts.cancelText || '取消') + '</button>' +
        '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-confirm-ok>' +
          esc(opts.confirmText || '确定') +
        '</button>' +
      '</div>';
    const modal = openModal({
      title: opts.title || '请确认',
      body: body,
      className: 'modal-confirm',
      onClose: () => settle(false),
    });
    const cancelBtn = modal.el.querySelector('[data-confirm-cancel]');
    const okBtn = modal.el.querySelector('[data-confirm-ok]');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { settle(false); modal.close('cancel'); });
    if (okBtn) okBtn.addEventListener('click', () => { settle(true); modal.close('confirm'); });
    if (okBtn) { try { okBtn.focus({ preventScroll: true }); } catch (e) { okBtn.focus(); } }
  });
}

// 关闭所有弹层（路由切换时清理，避免遮罩残留）
export function closeAllModals() {
  const root = document.getElementById('ui-modal-root');
  if (!root) return;
  const backdrops = Array.from(root.querySelectorAll('.modal-backdrop'));
  for (const backdrop of backdrops) {
    const closer = backdrop.querySelector('[data-modal-close]');
    if (closer && closer instanceof HTMLElement) closer.click();
    else backdrop.remove();
  }
  if (root.children.length) {
    root.innerHTML = '';
    document.documentElement.classList.remove('modal-open');
  }
}
