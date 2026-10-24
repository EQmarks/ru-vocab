// public/js/app.js — 俄语背单词 SPA：hash 路由 + 六个视图 + 交互
// 纯浏览器 ESM，无打包、无外部依赖。依赖 store / srs / sync / sync-ui 的契约接口。

import { store } from './store.js';
import { sync } from './sync.js';
import { mountSyncPanel } from './sync-ui.js';
import { GRADES, preview, checkAnswer } from './srs.js';
import { speak, isSpeechAvailable, prepareSpeech, stopSpeaking } from './audio.js';
import * as ui from './ui.js';

/* ==================== 常量 ==================== */

const APP_VERSION = '1.1.0';

const STATUS_LABEL = { new: '新词', learning: '学习中', review: '复习中', mastered: '已掌握' };
const GENDER_LABEL = { 'м': '阳性', 'ж': '阴性', 'с': '中性', 'мн': '复数' };
const ASPECT_LABEL = { 'нсв': '未完成体', 'св': '完成体' };
const POS_LIST = ['名词', '动词', '形容词', '副词', '代词', '数词', '前置词', '连词', '语气词', '感叹词', '短语'];
const LEVEL_LABEL = { 1: '1 · 易', 2: '2 · 较易', 3: '3 · 中等', 4: '4 · 较难', 5: '5 · 难' };
const THEME_OPTIONS = [
  { id: 'auto', label: '自动' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];
const BROWSE_CHIPS = [
  { id: 'all', label: '全部' },
  { id: 'new', label: '新词' },
  { id: 'learning', label: '学习中' },
  { id: 'review', label: '复习中' },
  { id: 'mastered', label: '已掌握' },
  { id: 'custom', label: '我的生词' },
];
const TEST_MODES = [
  { id: 'ru2zh', label: '俄→中', desc: '看俄语单词，选出中文释义' },
  { id: 'zh2ru', label: '中→俄', desc: '看中文释义，选出俄语单词' },
  { id: 'listen', label: '听音选义', desc: '听发音，选出中文释义' },
  { id: 'spell', label: '拼写', desc: '看中文释义，拼写俄语单词' },
];
const TEST_LABEL = { ru2zh: '俄→中', zh2ru: '中→俄', listen: '听音选义', spell: '拼写' };

const TRANSLIT_MAP = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

/* ==================== 运行时状态 ==================== */

const ROUTES = [
  { id: 'home', path: '/home', title: '今日', view: viewHome },
  { id: 'study', path: '/study', title: '学习', view: viewStudy },
  { id: 'test', path: '/test', title: '测试', view: viewTest },
  { id: 'browse', path: '/browse', title: '词表', view: viewBrowse },
  { id: 'stats', path: '/stats', title: '统计', view: viewStats },
  { id: 'settings', path: '/settings', title: '设置', view: viewSettings },
];

const shell = { app: null, splash: null, view: null, title: null, syncDots: [], syncText: null };
const current = { id: '', params: {}, cleanup: null, refresh: null };
const browse = { q: '', unitId: '', status: 'all' };

let booted = false;
let booting = false;
let globalsBound = false;
let refreshTimer = 0;
let study = null;
let test = null;

/* ==================== 小工具 ==================== */

function routeOf(id) {
  return ROUTES.find((route) => route.id === id) || ROUTES[0];
}

function speakWord(text) {
  const ok = speak(text);
  if (!ok) ui.toast('当前设备暂不支持俄语朗读，可以继续用文字学习', { type: 'error', duration: 2600 });
  return ok;
}

function speakBtnHTML(text, extraClass) {
  const label = ui.esc(text);
  return '<button type="button" class="speak-btn' + (extraClass ? ' ' + extraClass : '') + '" data-speak="' + label +
    '" aria-label="朗读 ' + label + '" title="朗读">' + ui.ICON.speak + '</button>';
}

function posMeta(word) {
  const parts = [];
  if (word.pos) parts.push(word.pos);
  if (word.gender) parts.push(GENDER_LABEL[word.gender] || '');
  if (word.aspect) parts.push(ASPECT_LABEL[word.aspect] || '');
  return parts.filter(Boolean).join(' · ');
}

function statusTagHTML(status) {
  return '<span class="tag tag--' + status + '">' + (STATUS_LABEL[status] || '新词') + '</span>';
}

function greetingText() {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function formatDue(ts) {
  const now = Date.now();
  if (!ts) return '尚未安排';
  const diff = ts - now;
  if (diff <= 0) return '现在到期';
  const today = new Date(now);
  const dueDay = new Date(ts);
  const sameDay = today.getFullYear() === dueDay.getFullYear() && today.getMonth() === dueDay.getMonth() && today.getDate() === dueDay.getDate();
  if (sameDay) return '今天 ' + ui.fmtTimeHM(ts);
  const tomorrow = new Date(now + 86400000);
  const isTomorrow = tomorrow.getFullYear() === dueDay.getFullYear() && tomorrow.getMonth() === dueDay.getMonth() && tomorrow.getDate() === dueDay.getDate();
  if (isTomorrow) return '明天 ' + ui.fmtTimeHM(ts);
  return ui.fmtDateShort(ts) + ' ' + ui.fmtTimeHM(ts);
}

function translitRu(text) {
  const source = String(text || '').replace(/\u0301/g, '').toLowerCase();
  let out = '';
  for (const ch of source) {
    if (Object.prototype.hasOwnProperty.call(TRANSLIT_MAP, ch)) out += TRANSLIT_MAP[ch];
    else out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function estimateStorage() {
  try {
    const text = JSON.stringify(store.exportPayload());
    return formatBytes(new Blob([text]).size);
  } catch (err) {
    return '—';
  }
}

function pickThemeColor(theme) {
  if (theme === 'dark') return '#101319';
  if (theme === 'light') return '#2f4b9b';
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return '#101319';
  } catch (err) { /* 忽略 */ }
  return '#2f4b9b';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', pickThemeColor(theme));
}

function applyRuFont(value) {
  const root = document.documentElement;
  if (value === 'hand') root.dataset.ruFont = 'hand';
  else delete root.dataset.ruFont;
}

function bindColorSchemeListener() {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (store.settings && store.settings.theme === 'auto') applyTheme('auto');
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  } catch (err) { /* 忽略 */ }
}

/* ==================== 启动 / 路由 ==================== */

function cacheShell() {
  shell.app = document.getElementById('app');
  shell.splash = document.getElementById('app-splash');
  shell.view = document.getElementById('view');
  shell.title = document.getElementById('view-title');
  shell.syncDots = Array.from(document.querySelectorAll('.sync-dot'));
  shell.syncText = document.getElementById('sync-text');
}

async function start() {
  if (booted || booting) return;
  booting = true;
  cacheShell();
  try {
    await store.init();
  } catch (err) {
    booting = false;
    showBootError(err);
    return;
  }
  try {
    await sync.init(store);
  } catch (err) {
    /* 同步不可用不影响本地学习 */
  }
  applyTheme(store.settings.theme);
  applyRuFont(store.settings.ruFont);
  bindGlobalEvents();
  bindColorSchemeListener();
  prepareSpeech();
  if (shell.splash) shell.splash.hidden = true;
  if (shell.app) shell.app.hidden = false;
  store.subscribe(handleStoreChange);
  if (sync && typeof sync.onChange === 'function') sync.onChange(renderSyncBadge);
  if (!location.hash || !/^#\//.test(location.hash)) {
    try { history.replaceState(null, '', '#/home'); } catch (err) { location.hash = '#/home'; }
  }
  booted = true;
  booting = false;
  renderSyncBadge();
  renderRoute();
  registerSW();
}

function showBootError(err) {
  const splash = document.getElementById('app-splash');
  const app = document.getElementById('app');
  if (app) app.hidden = true;
  if (!splash) return;
  const message = err && err.message ? err.message : '未知错误';
  splash.innerHTML =
    '<div class="boot-error">' +
      '<p class="boot-error-eyebrow">俄语背单词</p>' +
      '<h1 class="boot-error-title">词库加载失败</h1>' +
      '<p class="boot-error-text">' + ui.esc(message) + '</p>' +
      '<p class="boot-error-hint">请检查网络连接后重试。第一次打开需要联网加载词库，之后可离线使用。</p>' +
      '<div class="boot-error-actions"><button type="button" class="btn btn-primary" id="boot-retry">重新加载</button></div>' +
    '</div>';
  const retry = document.getElementById('boot-retry');
  if (retry) {
    retry.addEventListener('click', () => {
      retry.disabled = true;
      retry.textContent = '正在重试…';
      start();
    });
  }
}

function bindGlobalEvents() {
  if (globalsBound) return;
  globalsBound = true;
  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('rv:open-study', (event) => {
    const detail = (event && event.detail) || {};
    const mode = ['new', 'review', 'daily'].indexOf(detail.mode) >= 0 ? detail.mode : 'daily';
    location.hash = '#/study?mode=' + mode;
  });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-speak]') : null;
    if (!target) return;
    event.preventDefault();
    const text = target.getAttribute('data-speak') || '';
    if (!isSpeechAvailable()) {
      ui.toast('当前浏览器不支持语音朗读，可继续用文字学习', { type: 'error', duration: 2600 });
      return;
    }
    speak(text);
    target.classList.add('is-speaking');
    setTimeout(() => target.classList.remove('is-speaking'), 900);
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  const secure = location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (!secure) return;
  try {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 注册失败静默 */ });
  } catch (err) {
    /* 忽略 */
  }
}

function parseHash() {
  const raw = String(location.hash || '').replace(/^#/, '');
  const questionIndex = raw.indexOf('?');
  const pathPart = questionIndex >= 0 ? raw.slice(0, questionIndex) : raw;
  const queryPart = questionIndex >= 0 ? raw.slice(questionIndex + 1) : '';
  const path = pathPart && pathPart.charAt(0) === '/' ? pathPart : '/home';
  const params = {};
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = eq >= 0 ? pair.slice(0, eq) : pair;
      const value = eq >= 0 ? pair.slice(eq + 1) : '';
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch (err) {
        params[key] = value;
      }
    }
  }
  return { path, params };
}

function closeModals() {
  if (typeof ui.closeAllModals === 'function') ui.closeAllModals();
}

function renderRoute() {
  if (!booted) return;
  closeModals();
  const parsed = parseHash();
  let route = ROUTES.find((item) => item.path === parsed.path);
  if (!route) {
    route = ROUTES[0];
    try { history.replaceState(null, '', '#/home'); } catch (err) { /* 忽略 */ }
  }
  updateNav(route.id);
  document.title = route.title + ' · 俄语背单词';
  if (shell.title) shell.title.textContent = route.title;
  mountView(route.id, parsed.params);
  window.scrollTo(0, 0);
}

function mountView(id, params) {
  if (!shell.view) return;
  if (typeof current.cleanup === 'function') {
    try { current.cleanup(); } catch (err) { /* 忽略 */ }
  }
  current.cleanup = null;
  current.refresh = null;
  current.id = id;
  current.params = params || {};
  shell.view.innerHTML = '';
  const route = routeOf(id);
  const result = route.view(shell.view, current.params);
  if (result && typeof result === 'object') {
    if (typeof result.cleanup === 'function') current.cleanup = result.cleanup;
    if (typeof result.refresh === 'function') current.refresh = result.refresh;
  }
}

function remountCurrentView() {
  if (current.id) mountView(current.id, current.params);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    if (typeof current.refresh === 'function') current.refresh();
    else remountCurrentView();
  }, 50);
}

function updateNav(activeId) {
  const nodes = document.querySelectorAll('[data-nav]');
  for (const el of nodes) {
    const active = el.getAttribute('data-nav') === activeId;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
}

function renderSyncBadge() {
  let info = null;
  try {
    info = sync && typeof sync.status === 'function' ? sync.status() : null;
  } catch (err) {
    info = null;
  }
  const configured = !!(info && info.configured);
  const state = configured ? (info.state || 'idle') : 'off';
  const className = 'sync-dot sync-dot--' + (state === 'syncing' ? 'busy' : state);
  let label = '仅本机';
  if (state === 'busy') label = '同步中…';
  else if (state === 'ok') label = info && info.lastSyncAt ? '已同步 ' + ui.fmtTimeHM(info.lastSyncAt) : '已同步';
  else if (state === 'error') label = '同步失败';
  else if (state === 'offline') label = '离线';
  else if (state === 'idle') label = '待同步';
  if (configured && info && info.pending && state !== 'busy') label += '（有未推送更改）';
  if (state === 'error' && info && info.error) label += '：' + String(info.error);
  for (const dot of shell.syncDots) {
    dot.className = className;
    dot.title = label;
    dot.setAttribute('aria-label', '同步状态：' + label);
  }
  if (shell.syncText) shell.syncText.textContent = label;
}

function handleStoreChange() {
  if (!booted) return;
  renderSyncBadge();
  if (current.id === 'home' || current.id === 'stats') scheduleRefresh();
  else if (current.id === 'browse' || current.id === 'settings') {
    if (typeof current.refresh === 'function') current.refresh();
  }
}

/* ==================== 视图（由下方实现） ==================== */

function viewHome(root) {
  paintHome(root);
  return { refresh: () => paintHome(root) };
}

function paintHome(root) {
  const now = Date.now();
  const summary = store.summary(now);
  const today = store.todayStat(now);
  const settings = store.settings;
  const dueNow = summary.due;
  const newAvail = store.newIds(now).length;
  const session = store.buildSession('daily', now);
  const allDone = session.items.length === 0;
  const newTarget = Math.max(today.new, Math.min(settings.newPerDay, today.new + newAvail));
  const reviewTarget = Math.max(today.review, Math.min(settings.reviewPerDay, today.review + dueNow));
  const totalDone = today.new + today.review;
  const totalTarget = newTarget + reviewTarget;

  const unitRows = store.units.map((unit) => {
    let learned = 0;
    for (const word of unit.words) {
      if (store.statusOf(word.id) !== 'new') learned += 1;
    }
    return { title: unit.title, learned, total: unit.words.length };
  });

  const unitHTML = unitRows.length
    ? unitRows.map((row) =>
        '<li class="unit-row">' +
          '<div class="unit-head"><span class="unit-name">' + ui.esc(row.title) + '</span>' +
          '<span class="unit-count">' + row.learned + '/' + row.total + '</span></div>' +
          '<div class="bar"><i style="width:' + ui.pct(row.learned, row.total) + '%"></i></div>' +
        '</li>'
      ).join('')
    : '<li class="small muted">词库还没有内容。</li>';

  const actionsHTML = allDone
    ? '<div class="hero-actions">' +
        '<a class="btn btn-primary btn-lg" href="#/test">去测试</a>' +
        '<div class="hero-sub-actions">' +
          '<a class="btn btn-ghost" href="#/browse">翻翻词表</a>' +
          '<a class="btn btn-ghost" href="#/stats">看看统计</a>' +
        '</div>' +
      '</div>'
    : '<div class="hero-actions">' +
        '<a class="btn btn-primary btn-lg" href="#/study?mode=daily">开始学习</a>' +
        '<div class="hero-sub-actions">' +
          '<a class="btn" href="#/study?mode=review">只复习</a>' +
          '<a class="btn" href="#/study?mode=new">只学新词</a>' +
        '</div>' +
      '</div>';

  const doneNotice = allDone
    ? '<div class="notice"><strong>今天的任务都完成啦</strong><p>连续学习 ' + summary.streak + ' 天。去测试巩固一下记忆，或者回词表慢慢翻翻。</p></div>'
    : '';

  root.innerHTML =
    '<section class="stack">' +
      '<div class="hero">' +
        '<p class="hero-date">' + ui.esc(ui.fmtDateCN(now)) + '</p>' +
        '<h2 class="hero-greet">' + greetingText() + '，今天也学几个词</h2>' +
        '<p class="hero-streak">连续学习 <b>' + summary.streak + '</b> 天 · 今日已学 <b>' + totalDone + '</b> / ' + Math.max(totalTarget, 1) + '</p>' +
        '<div class="hero-bars">' +
          '<div class="hero-bar">' +
            '<div class="hero-bar-head"><span>今日新词</span><b>' + today.new + ' / ' + newTarget + '</b></div>' +
            '<div class="bar"><i style="width:' + ui.pct(today.new, newTarget) + '%"></i></div>' +
          '</div>' +
          '<div class="hero-bar">' +
            '<div class="hero-bar-head"><span>今日复习</span><b>' + today.review + ' / ' + reviewTarget + '</b></div>' +
            '<div class="bar"><i style="width:' + ui.pct(today.review, reviewTarget) + '%"></i></div>' +
          '</div>' +
        '</div>' +
        actionsHTML +
      '</div>' +
      doneNotice +
      '<div class="card">' +
        '<h3 class="card-title">今日任务</h3>' +
        '<ul class="task-list">' +
          '<li class="task-item"><span class="dot"></span><span class="task-label">到期需要复习</span><span class="task-value">' + dueNow + ' 个</span></li>' +
          '<li class="task-item"><span class="dot"></span><span class="task-label">可以学的新词</span><span class="task-value">' + newAvail + ' 个</span></li>' +
          '<li class="task-item"><span class="dot"></span><span class="task-label">已掌握</span><span class="task-value">' + summary.mastered + ' 个</span></li>' +
        '</ul>' +
      '</div>' +
      '<div class="card">' +
        '<h3 class="card-title">单元进度</h3>' +
        '<ul class="unit-list">' + unitHTML + '</ul>' +
      '</div>' +
    '</section>';
}

function viewStudy(root, params) {
  const mode = ['new', 'review', 'daily'].indexOf(params.mode) >= 0 ? params.mode : 'daily';
  root.innerHTML = '<div class="study" data-study></div>';
  const host = root.querySelector('[data-study]');
  study = createStudySession(mode, host);

  const onClick = (event) => {
    if (!study) return;
    const again = event.target.closest('[data-study-again]');
    if (again) {
      study = createStudySession(mode, host);
      if (study.items.length === 0) paintStudyEmpty(host, study.mode);
      else paintStudy(host);
      return;
    }
    if (event.target.closest('[data-speak]')) return;
    const gradeBtn = event.target.closest('[data-grade]');
    if (gradeBtn) {
      applyStudyGrade(Number(gradeBtn.getAttribute('data-grade')));
      return;
    }
    const cardEl = event.target.closest('[data-study-card]');
    if (cardEl && !study.revealed && study.index < study.items.length) {
      study.revealed = true;
      paintStudy(host);
    }
  };

  const onKey = (event) => {
    if (ui.hasOpenModal()) return;
    const tag = event.target && event.target.tagName ? event.target.tagName : '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (!study || study.index >= study.items.length) return;
    if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
      if (!study.revealed) {
        event.preventDefault();
        study.revealed = true;
        paintStudy(host);
      }
      return;
    }
    if (study.revealed && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      applyStudyGrade(Number(event.key) - 1);
    }
  };

  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  if (study.items.length === 0) paintStudyEmpty(host, mode);
  else paintStudy(host);

  return {
    cleanup: () => {
      host.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      stopSpeaking();
      study = null;
    },
  };
}

function createStudySession(mode, host) {
  const session = store.buildSession(mode);
  return {
    mode: mode,
    host: host,
    items: session.items.slice(),
    index: 0,
    revealed: false,
    answered: 0,
    correct: 0,
    requeued: 0,
    initialNew: session.newCount,
    initialReview: session.reviewCount,
  };
}

function paintStudy(host) {
  if (!study) return;
  const session = study;
  if (session.index >= session.items.length) {
    paintStudyDone(host);
    return;
  }
  const item = session.items[session.index];
  const word = store.word(item.id);
  if (!word) {
    session.index += 1;
    paintStudy(host);
    return;
  }
  const unit = store.unitOf(item.id);
  const card = store.cardOf(item.id);
  const settings = store.settings;
  const total = session.items.length;
  const position = Math.min(session.index + 1, total);

  const gradeButtons = GRADES.map((grade) =>
    '<button type="button" class="grade grade--' + grade.tone + '" data-grade="' + grade.g + '"' + (session.revealed ? '' : ' hidden') + '>' +
      '<span class="grade-label">' + grade.label + '</span>' +
      '<span class="grade-iv">' + ui.esc(preview(card, grade.g, Date.now())) + '</span>' +
      '<kbd>' + grade.key + '</kbd>' +
    '</button>'
  ).join('');

  const exampleHTML = settings.showExample && word.example && word.example.ru
    ? '<div class="study-example"><span lang="ru">' + ui.esc(word.example.ru) + '</span>' +
      '<span class="study-example-zh">' + ui.esc(word.example.zh) + '</span></div>'
    : '';

  host.innerHTML =
    '<div class="study-head">' +
      '<span class="study-count">' + position + ' / ' + total + '</span>' +
      '<span class="study-unit">' + ui.esc(unit ? unit.title : '') + '</span>' +
      '<span class="tag study-kind ' + (item.kind === 'new' ? 'tag--learning' : 'tag--review') + '">' +
        (item.kind === 'new' ? '新词' : '复习') +
      '</span>' +
    '</div>' +
    '<div class="bar study-bar"><i style="width:' + ui.pct(session.index, total) + '%"></i></div>' +
    '<div class="study-card" role="button" tabindex="0" data-study-card aria-label="' + (session.revealed ? '已显示答案' : '点击显示答案') + '">' +
      '<div class="study-word-wrap">' +
        (settings.showTranslit && word.tr ? '<span class="study-tr">' + ui.esc(word.tr) + '</span>' : '') +
        '<span class="study-word" lang="ru">' + ui.stressHTML(word.stress || word.ru) + '</span>' +
      '</div>' +
      '<div class="study-actions">' + speakBtnHTML(word.ru) + '</div>' +
      '<div class="study-answer"' + (session.revealed ? '' : ' hidden') + '>' +
        '<p class="study-zh">' + ui.esc(word.zh) + '</p>' +
        '<p class="study-meta">' + ui.esc(posMeta(word)) + '</p>' +
        exampleHTML +
        (word.note ? '<p class="study-note">' + ui.esc(word.note) + '</p>' : '') +
      '</div>' +
      '<p class="study-hint">' + (session.revealed ? '按 1–4 评分' : '点击卡片或按空格显示答案') + '</p>' +
    '</div>' +
    '<div class="grades">' + gradeButtons + '</div>' +
    '<p class="study-foot small muted">空格 显示答案 · 1–4 评分 · 忘了会让它排到本轮队尾再练一次</p>';

  if (!session.revealed && settings.autoAudio && isSpeechAvailable()) speak(word.ru);
}

function applyStudyGrade(value) {
  const session = study;
  if (!session || !session.revealed || session.index >= session.items.length) return;
  const item = session.items[session.index];
  session.answered += 1;
  if (value >= 2) session.correct += 1;
  if (value === 0) {
    session.items.push({ id: item.id, kind: 'review' });
    session.requeued += 1;
  }
  try {
    store.grade(item.id, value);
  } catch (err) {
    ui.toast('评分保存失败：' + (err && err.message ? err.message : '未知错误'), { type: 'error' });
  }
  session.index += 1;
  session.revealed = false;
  paintStudy(session.host);
}

function paintStudyDone(host) {
  const session = study;
  if (!session) return;
  const attempts = session.answered;
  const accuracy = attempts > 0 ? Math.round((session.correct / attempts) * 100) : 0;
  host.innerHTML =
    '<div class="card study-done">' +
      '<p class="done-eyebrow">本轮完成</p>' +
      '<h2 class="done-title">' + attempts + ' 次作答 · 正确率 ' + accuracy + '%</h2>' +
      '<div class="done-grid">' +
        '<div class="tile"><span class="tile-value">' + session.initialNew + '</span><span class="tile-label">新词</span></div>' +
        '<div class="tile"><span class="tile-value">' + session.initialReview + '</span><span class="tile-label">复习</span></div>' +
        '<div class="tile"><span class="tile-value">' + session.requeued + '</span><span class="tile-label">加练</span></div>' +
        '<div class="tile"><span class="tile-value">' + accuracy + '%</span><span class="tile-label">正确率</span></div>' +
      '</div>' +
      '<div class="done-actions">' +
        '<button type="button" class="btn btn-primary" data-study-again>再来一轮</button>' +
        '<a class="btn" href="#/home">回首页</a>' +
        '<a class="btn" href="#/test">去测试</a>' +
      '</div>' +
    '</div>';
}

function paintStudyEmpty(host, mode) {
  const now = Date.now();
  const due = store.dueIds(now).length;
  const newAvail = store.newIds(now).length;
  let title = '今天没有要学的词了';
  let text = '到期复习和今天的新词都完成了。去测试巩固记忆，或者休息一下。';
  if (mode === 'new') {
    title = '暂时没有新词可学';
    text = newAvail > 0 ? '今天的新词额度已经用完，可以在设置里调整每日新词上限。' : '词库里的新词都学过了，去复习或测试吧。';
  } else if (mode === 'review') {
    title = '没有到期需要复习的词';
    text = due > 0 ? '今天的复习额度已经用完，可以在设置里调整每日复习上限。' : '所有卡片都还没到复习时间，去学点新词吧。';
  }
  const switchHTML = mode === 'new'
    ? '<a class="btn btn-ghost" href="#/study?mode=review">去复习</a>'
    : mode === 'review'
      ? '<a class="btn btn-ghost" href="#/study?mode=new">去学新词</a>'
      : '<a class="btn btn-ghost" href="#/browse">翻翻词表</a>';
  host.innerHTML =
    '<div class="card empty-state">' +
      '<h2 class="empty-title">' + title + '</h2>' +
      '<p class="empty-text">' + text + '</p>' +
      '<div class="empty-actions">' +
        '<a class="btn btn-primary" href="#/home">回首页</a>' +
        '<a class="btn" href="#/test">去测试</a>' +
        switchHTML +
      '</div>' +
    '</div>';
}

function viewTest(root, params) {
  const initialMode = ['ru2zh', 'zh2ru', 'listen', 'spell'].indexOf(params.mode) >= 0 ? params.mode : '';
  root.innerHTML = '<div class="test" data-test></div>';
  const host = root.querySelector('[data-test]');
  test = {
    mode: initialMode || 'ru2zh',
    host: host,
    questions: [],
    index: 0,
    answers: [],
    phase: 'idle',
    lastAnswer: null,
    spokenAt: -1,
    hintUsed: false,
    spellInput: '',
  };

  const onClick = (event) => {
    if (!test) return;
    if (event.target.closest('[data-speak]')) return;
    const modeBtn = event.target.closest('[data-test-mode]');
    if (modeBtn) { startTest(modeBtn.getAttribute('data-test-mode')); return; }
    if (event.target.closest('[data-test-quit]')) { test.phase = 'idle'; paintTestPicker(host); return; }
    if (event.target.closest('[data-test-modes]')) { test.phase = 'idle'; paintTestPicker(host); return; }
    if (event.target.closest('[data-test-restart]')) { startTest(test.mode); return; }
    if (event.target.closest('[data-test-next]')) { goNextQuestion(); return; }
    if (event.target.closest('[data-test-submit]')) { submitSpell(); return; }
    if (event.target.closest('[data-test-hint]')) { showSpellHint(); return; }
    const wordRow = event.target.closest('[data-word-id]');
    if (wordRow) { openWordDetail(wordRow.getAttribute('data-word-id')); return; }
    const option = event.target.closest('[data-option]');
    if (option && test.phase === 'question') answerChoice(Number(option.getAttribute('data-option')));
  };

  const onKey = (event) => {
    if (!test || ui.hasOpenModal()) return;
    if (test.phase === 'feedback' && event.key === 'Enter') { event.preventDefault(); goNextQuestion(); return; }
    if (test.phase === 'question' && test.mode === 'spell' && event.key === 'Enter') { event.preventDefault(); submitSpell(); return; }
    if (test.phase === 'question' && test.mode !== 'spell' && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      answerChoice(Number(event.key) - 1);
    }
  };

  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  if (initialMode) startTest(initialMode);
  else paintTestPicker(host);

  return {
    cleanup: () => {
      host.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      stopSpeaking();
      test = null;
    },
  };
}

function paintTestPicker(host) {
  if (!test) return;
  test.phase = 'idle';
  const summary = store.summary();
  host.innerHTML =
    '<section class="test-picker">' +
      '<div class="card test-intro">' +
        '<h2 class="card-title">选一种测试方式</h2>' +
        '<p class="small muted">优先抽取到期与学习中的词。已学 ' + summary.learned + ' 词，当前到期 ' + summary.due + ' 词。</p>' +
      '</div>' +
      '<div class="mode-grid">' +
        TEST_MODES.map((mode) =>
          '<button type="button" class="mode-card" data-test-mode="' + mode.id + '">' +
            '<span class="mode-name">' + mode.label + '</span>' +
            '<span class="mode-desc">' + mode.desc + '</span>' +
          '</button>'
        ).join('') +
      '</div>' +
      '<p class="small muted">每轮 10 题，选择题会即时反馈，最后显示得分与错词。</p>' +
    '</section>';
}

function startTest(mode) {
  if (!test) return;
  test.mode = mode;
  test.questions = buildTestQuestions(mode);
  test.index = 0;
  test.answers = [];
  test.lastAnswer = null;
  test.spokenAt = -1;
  test.hintUsed = false;
  test.spellInput = '';
  if (!test.questions.length) { paintTestEmpty(test.host); return; }
  test.phase = 'question';
  paintTestQuestion();
}

function buildTestQuestions(mode) {
  const COUNT = 10;
  const now = Date.now();
  const words = store.words.filter((word) => word && !word.deleted);
  if (words.length < 2) return [];
  const dueSet = new Set(store.dueIds(now));
  const dueAndLearning = [];
  const learned = [];
  const rest = [];
  for (const word of words) {
    const status = store.statusOf(word.id, now);
    if (dueSet.has(word.id) || status === 'learning') dueAndLearning.push(word);
    else if (status === 'review' || status === 'mastered') learned.push(word);
    else rest.push(word);
  }
  const field = mode === 'zh2ru' || mode === 'spell' ? 'ru' : 'zh';
  const pool = shuffle(dueAndLearning).concat(learned, shuffle(rest)).slice(0, COUNT);
  return pool.map((word) => makeQuestion(word, field, words));
}

function normalizeOption(value) {
  return String(value || '').trim().toLowerCase();
}

function makeQuestion(word, field, allWords) {
  const used = new Set([normalizeOption(field === 'ru' ? word.stress || word.ru : word.zh || word.ru)]);
  const samePos = [];
  const sameUnit = [];
  const others = [];
  for (const candidate of allWords) {
    if (candidate.id === word.id) continue;
    const value = field === 'ru' ? candidate.stress || candidate.ru : candidate.zh || candidate.ru;
    const key = normalizeOption(value);
    if (!key || used.has(key)) continue;
    if (candidate.pos === word.pos) samePos.push(candidate);
    else if (candidate.unitId === word.unitId) sameUnit.push(candidate);
    else others.push(candidate);
  }
  const distractors = [];
  const ordered = shuffle(samePos).concat(shuffle(sameUnit), shuffle(others));
  for (const candidate of ordered) {
    if (distractors.length >= 3) break;
    const value = field === 'ru' ? candidate.stress || candidate.ru : candidate.zh || candidate.ru;
    const key = normalizeOption(value);
    if (!key || used.has(key)) continue;
    used.add(key);
    distractors.push(candidate);
  }
  const options = shuffle([word].concat(distractors));
  return {
    word: word,
    field: field,
    options: options,
    correctIndex: options.findIndex((item) => item.id === word.id),
  };
}

function paintTestQuestion() {
  if (!test) return;
  const host = test.host;
  const question = test.questions[test.index];
  if (!question) { paintTestResult(); return; }
  const total = test.questions.length;
  const feedback = test.phase === 'feedback';
  const last = test.lastAnswer || { correct: false, index: -1 };
  const isChoice = test.mode !== 'spell';

  let promptHTML = '';
  if (test.mode === 'zh2ru') {
    promptHTML = '<div class="prompt-zh">' + ui.esc(question.word.zh) + '</div>' +
      '<p class="prompt-ask">选出对应的俄语单词</p>';
  } else if (test.mode === 'spell') {
    promptHTML = '<div class="prompt-zh">' + ui.esc(question.word.zh) + '</div>' +
      '<p class="prompt-ask">拼写俄语单词</p>' +
      '<div class="spell-row">' +
        '<input type="text" class="input input--ru" id="spell-input" lang="ru" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="在这里输入…" value="' + (feedback ? ui.esc(test.spellInput) : '') + '"' + (feedback ? ' disabled' : '') + ' aria-label="输入俄语拼写" />' +
        (feedback ? '' : '<button type="button" class="btn btn-primary" data-test-submit>提交</button>') +
      '</div>' +
      '<div class="spell-hint" id="spell-hint"></div>' +
      (feedback ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-test-hint>提示首字母</button>');
  } else if (test.mode === 'listen') {
    promptHTML = '<button type="button" class="listen-btn" data-speak="' + ui.esc(question.word.ru) + '" aria-label="朗读单词">' +
        ui.ICON.speak + '<span>再听一遍</span></button>' +
      '<p class="prompt-ask">听发音，选出正确的中文释义</p>' +
      (isSpeechAvailable() ? '' : '<p class="small muted">当前设备不支持语音朗读，可退出后换「俄→中」模式。</p>');
  } else {
    promptHTML = '<div class="prompt-word" lang="ru">' + ui.stressHTML(question.word.stress || question.word.ru) + '</div>' +
      '<div class="prompt-actions">' + speakBtnHTML(question.word.ru) + '<span class="small muted">朗读</span></div>' +
      '<p class="prompt-ask">选出正确的中文释义</p>';
  }

  let optionsHTML = '';
  if (isChoice) {
    optionsHTML = '<div class="options">' + question.options.map((optionWord, index) => {
      const isCorrect = index === question.correctIndex;
      const isPicked = feedback && last.index === index;
      let className = 'option';
      if (feedback) {
        className += ' option--locked';
        if (isCorrect) className += ' option--correct';
        else if (isPicked) className += ' option--wrong';
      }
      const label = question.field === 'ru'
        ? '<span class="option-ru" lang="ru">' + ui.stressHTML(optionWord.stress || optionWord.ru) + '</span>'
        : '<span class="option-zh">' + ui.esc(optionWord.zh) + '</span>';
      return '<button type="button" class="' + className + '" data-option="' + index + '"' + (feedback ? ' disabled' : '') + '>' +
        '<span class="option-key">' + (index + 1) + '</span>' +
        '<span class="option-text">' + label + '</span>' +
        (feedback && isCorrect ? '<span class="option-mark">' + ui.ICON.check + '</span>' : '') +
      '</button>';
    }).join('') + '</div>';
  }

  let feedbackHTML = '';
  if (feedback) {
    feedbackHTML = '<div class="feedback ' + (last.correct ? 'feedback--ok' : 'feedback--bad') + '">' +
      '<div class="feedback-line">' +
        '<strong>' + (last.correct ? '回答正确' : '回答错误') + '</strong>' +
        '<span class="feedback-answer" lang="ru">' + ui.stressHTML(question.word.stress || question.word.ru) + '</span>' +
        '<span class="feedback-zh">' + ui.esc(question.word.zh) + '</span>' +
      '</div>' +
      '<div class="feedback-actions">' + speakBtnHTML(question.word.ru) +
        '<button type="button" class="btn btn-primary" data-test-next>' +
          (test.index + 1 >= total ? '查看结果' : '下一题') +
        '</button>' +
      '</div>' +
    '</div>';
  }

  host.innerHTML = '<section class="test-stage">' +
    '<div class="test-head">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-test-quit>退出</button>' +
      '<span class="test-progress">第 ' + (test.index + 1) + ' / ' + total + ' 题</span>' +
      '<span class="tag">' + TEST_LABEL[test.mode] + '</span>' +
    '</div>' +
    '<div class="bar"><i style="width:' + Math.round((test.index / total) * 100) + '%"></i></div>' +
    '<div class="card test-card">' + promptHTML + optionsHTML + feedbackHTML + '</div>' +
  '</section>';

  if (feedback && test.mode === 'spell') {
    const hint = host.querySelector('#spell-hint');
    if (hint) hint.textContent = last.correct ? '拼写正确' : '正确答案：' + (question.word.stress || question.word.ru);
  }
  if (test.mode === 'listen' && !feedback && test.spokenAt !== test.index) {
    test.spokenAt = test.index;
    if (isSpeechAvailable()) speak(question.word.ru);
  }
  if (test.mode === 'spell' && !feedback) {
    const input = host.querySelector('#spell-input');
    if (input) {
      try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
    }
    if (test.hintUsed) showSpellHint();
  }
}

function answerChoice(index) {
  if (!test || test.phase !== 'question') return;
  const question = test.questions[test.index];
  if (!question) return;
  const correct = index === question.correctIndex;
  test.lastAnswer = { correct: correct, index: index };
  test.answers.push({ wordId: question.word.id, correct: correct });
  test.phase = 'feedback';
  if (!correct && isSpeechAvailable()) speak(question.word.ru);
  paintTestQuestion();
}

function showSpellHint() {
  if (!test || test.phase !== 'question' || test.mode !== 'spell') return;
  const question = test.questions[test.index];
  if (!question) return;
  test.hintUsed = true;
  const hint = test.host.querySelector('#spell-hint');
  if (!hint) return;
  const letters = String(question.word.ru || '').replace(/\s/g, '');
  hint.innerHTML = '<span lang="ru">首字母：' + ui.esc(letters.charAt(0)) + '</span> · 共 ' + letters.length + ' 个字母（不含空格）';
}

function submitSpell() {
  if (!test || test.phase !== 'question' || test.mode !== 'spell') return;
  const input = test.host.querySelector('#spell-input');
  const value = input ? input.value : '';
  if (!value.trim()) {
    ui.toast('先输入你记得的拼写，或点「提示首字母」', { type: 'info' });
    if (input) input.focus();
    return;
  }
  const question = test.questions[test.index];
  const correct = checkAnswer(value, question.word);
  test.spellInput = value;
  test.lastAnswer = { correct: correct, index: -1 };
  test.answers.push({ wordId: question.word.id, correct: correct });
  test.phase = 'feedback';
  if (isSpeechAvailable()) speak(question.word.ru);
  paintTestQuestion();
}

function goNextQuestion() {
  if (!test || test.phase !== 'feedback') return;
  test.index += 1;
  test.lastAnswer = null;
  test.hintUsed = false;
  test.spellInput = '';
  if (test.index >= test.questions.length) {
    test.phase = 'done';
    paintTestResult();
    return;
  }
  test.phase = 'question';
  paintTestQuestion();
}

function paintTestResult() {
  if (!test) return;
  const host = test.host;
  const total = test.answers.length;
  const correct = test.answers.filter((item) => item.correct).length;
  const rate = total > 0 ? Math.round((correct / total) * 100) : 0;
  const wrongWords = test.answers
    .filter((item) => !item.correct)
    .map((item) => store.word(item.wordId))
    .filter(Boolean);
  const wrongHTML = wrongWords.length
    ? '<ul class="wrong-list">' + wrongWords.map((word) =>
        '<li class="wrong-item" data-word-id="' + ui.esc(word.id) + '">' +
          '<div class="word-main">' +
            '<span class="word-ru" lang="ru">' + ui.stressHTML(word.stress || word.ru) + '</span>' +
            '<span class="word-zh">' + ui.esc(word.zh) + '</span>' +
          '</div>' + speakBtnHTML(word.ru) +
        '</li>'
      ).join('') + '</ul>'
    : '<p class="small muted">全部答对，太棒了。</p>';
  host.innerHTML = '<section class="test-result">' +
    '<div class="card result-card">' +
      '<p class="result-eyebrow">' + TEST_LABEL[test.mode] + ' · 完成</p>' +
      '<p class="result-score"><strong>' + correct + '</strong><span>/ ' + total + '</span></p>' +
      '<p class="result-rate">正确率 ' + rate + '%</p>' +
      '<div class="result-actions">' +
        '<button type="button" class="btn btn-primary" data-test-restart>再来一轮</button>' +
        '<button type="button" class="btn" data-test-modes>换个模式</button>' +
        '<a class="btn" href="#/home">回首页</a>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">错词 ' + wrongWords.length + ' 个</h3>' + wrongHTML +
    '</div>' +
  '</section>';
}

function paintTestEmpty(host) {
  host.innerHTML = '<div class="card empty-state">' +
    '<h2 class="empty-title">词库太小，暂时无法出题</h2>' +
    '<p class="empty-text">至少需要 2 个单词才能生成测试。先去学几个词，或者添加自己的生词吧。</p>' +
    '<div class="empty-actions">' +
      '<a class="btn btn-primary" href="#/home">回首页</a>' +
      '<a class="btn" href="#/browse">去词表</a>' +
    '</div>' +
  '</div>';
}

function viewBrowse(root) {
  root.innerHTML =
    '<section class="browse">' +
      '<div class="browse-tools">' +
        '<input class="input browse-search" id="browse-search" type="search" placeholder="搜索俄语 / 中文 / 转写" aria-label="搜索单词" autocomplete="off" />' +
        '<select class="select browse-unit" id="browse-unit" aria-label="按单元筛选"></select>' +
        '<button type="button" class="btn btn-primary browse-add" data-add-word aria-label="添加生词">' + ui.ICON.plus + '<span>生词</span></button>' +
      '</div>' +
      '<div class="chips" role="group" aria-label="按学习状态筛选">' +
        BROWSE_CHIPS.map((chip) =>
          '<button type="button" class="chip' + (browse.status === chip.id ? ' is-active' : '') + '" data-status="' + chip.id + '" aria-pressed="' + (browse.status === chip.id) + '">' + chip.label + '</button>'
        ).join('') +
      '</div>' +
      '<ul class="word-list" id="browse-list"></ul>' +
      '<p class="list-count" id="browse-count"></p>' +
    '</section>';

  const listEl = root.querySelector('#browse-list');
  const countEl = root.querySelector('#browse-count');
  const searchEl = root.querySelector('#browse-search');
  const unitEl = root.querySelector('#browse-unit');

  const unitOptionsHTML = () => '<option value="">全部单元</option>' + store.units.map((unit) =>
    '<option value="' + ui.esc(unit.id) + '">' + ui.esc(unit.title) + '</option>'
  ).join('');

  const refreshUnitOptions = () => {
    if (browse.unitId && !store.units.some((unit) => unit.id === browse.unitId)) browse.unitId = '';
    unitEl.innerHTML = unitOptionsHTML();
    unitEl.value = browse.unitId;
  };

  const renderList = () => renderBrowseList(listEl, countEl);

  const onSearchInput = ui.debounce(() => {
    browse.q = searchEl.value.trim();
    renderList();
  }, 200);
  searchEl.addEventListener('input', onSearchInput);
  const onUnitChange = () => {
    browse.unitId = unitEl.value;
    renderList();
  };
  unitEl.addEventListener('change', onUnitChange);

  const onClick = (event) => {
    const chip = event.target.closest('[data-status]');
    if (chip) {
      browse.status = chip.getAttribute('data-status');
      const chips = root.querySelectorAll('[data-status]');
      for (const node of chips) {
        const active = node.getAttribute('data-status') === browse.status;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', String(active));
      }
      renderList();
      return;
    }
    if (event.target.closest('[data-add-word]')) { openWordForm(null); return; }
    if (event.target.closest('[data-speak]')) return;
    const row = event.target.closest('[data-word-id]');
    if (row) openWordDetail(row.getAttribute('data-word-id'));
  };
  root.addEventListener('click', onClick);

  const onListKey = (event) => {
    if (event.key !== 'Enter') return;
    const row = event.target.closest('[data-word-id]');
    if (row) {
      event.preventDefault();
      openWordDetail(row.getAttribute('data-word-id'));
    }
  };
  listEl.addEventListener('keydown', onListKey);

  refreshUnitOptions();
  renderList();

  return {
    cleanup: () => {
      root.removeEventListener('click', onClick);
    },
    refresh: () => {
      refreshUnitOptions();
      renderList();
    },
  };
}

function renderBrowseList(listEl, countEl) {
  const all = store.words;
  let list = all;
  const query = browse.q;
  if (query) {
    const needle = query.toLowerCase();
    list = list.filter((word) => {
      const ru = String(word.ru || '').toLowerCase();
      const stress = String(word.stress || '').toLowerCase();
      const tr = String(word.tr || '').toLowerCase();
      const zh = String(word.zh || '');
      return ru.indexOf(needle) >= 0 || stress.indexOf(needle) >= 0 || tr.indexOf(needle) >= 0 ||
        zh.indexOf(query) >= 0 || zh.toLowerCase().indexOf(needle) >= 0;
    });
  }
  if (browse.unitId) list = list.filter((word) => word.unitId === browse.unitId);
  if (browse.status === 'custom') list = list.filter((word) => word.custom);
  else if (browse.status !== 'all') list = list.filter((word) => store.statusOf(word.id) === browse.status);

  if (!list.length) {
    listEl.innerHTML = '<li class="list-empty">没有找到匹配的单词</li>';
    countEl.textContent = '共 0 个词';
    return;
  }

  const showTranslit = store.settings.showTranslit;
  listEl.innerHTML = list.map((word) => {
    const status = store.statusOf(word.id);
    return '<li class="word-item" data-word-id="' + ui.esc(word.id) + '" tabindex="0" role="button" aria-label="查看 ' + ui.esc(word.ru) + ' 的详情">' +
      '<div class="word-main">' +
        '<div class="word-ru-line">' +
          '<span class="word-ru" lang="ru">' + ui.stressHTML(word.stress || word.ru) + '</span>' +
          (showTranslit && word.tr ? '<span class="word-tr">' + ui.esc(word.tr) + '</span>' : '') +
        '</div>' +
        '<div class="word-zh">' + ui.esc(word.zh) + '</div>' +
      '</div>' +
      '<div class="word-side">' + statusTagHTML(status) + speakBtnHTML(word.ru) + '</div>' +
    '</li>';
  }).join('');

  countEl.textContent = '共 ' + list.length + ' 个词' + (list.length !== all.length ? '（全部 ' + all.length + ' 个）' : '');
}

function openWordDetail(id) {
  const word = store.word(id);
  if (!word) return;
  const card = store.cardOf(id);
  const status = store.statusOf(id);
  const unit = store.unitOf(id);
  const dueText = card && card.reps > 0 ? formatDue(card.due) : '尚未学习';
  const body =
    '<div class="detail-word"><span lang="ru">' + ui.stressHTML(word.stress || word.ru) + '</span>' +
      speakBtnHTML(word.ru, 'speak-btn--lg') + '</div>' +
    (word.tr ? '<p class="detail-tr">' + ui.esc(word.tr) + '</p>' : '') +
    '<p class="detail-zh">' + ui.esc(word.zh) + '</p>' +
    '<div class="detail-tags">' +
      '<span class="tag">' + ui.esc(posMeta(word)) + '</span>' +
      statusTagHTML(status) +
      (unit ? '<span class="tag">' + ui.esc(unit.title) + '</span>' : '') +
      (word.custom ? '<span class="tag tag--custom">我的生词</span>' : '') +
    '</div>' +
    (word.example && word.example.ru
      ? '<div class="detail-block"><span class="detail-label">例句</span>' +
        '<p class="detail-example" lang="ru">' + ui.esc(word.example.ru) + '</p>' +
        '<p class="detail-example-zh">' + ui.esc(word.example.zh) + '</p></div>'
      : '') +
    (word.note ? '<div class="detail-block"><span class="detail-label">笔记</span><p>' + ui.esc(word.note) + '</p></div>' : '') +
    '<div class="detail-block"><span class="detail-label">学习状态</span><p>' +
      (STATUS_LABEL[status] || '新词') + ' · 下次复习：' + ui.esc(dueText) +
    '</p></div>' +
    (word.custom
      ? '<div class="modal-actions">' +
          '<button type="button" class="btn" data-edit-word="' + ui.esc(word.id) + '">编辑</button>' +
          '<button type="button" class="btn btn-danger" data-delete-word="' + ui.esc(word.id) + '">删除</button>' +
        '</div>'
      : '');

  const modal = ui.openModal({ title: '单词详情', body: body, className: 'modal-detail' });

  modal.el.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit-word]');
    if (editBtn) {
      const target = store.word(editBtn.getAttribute('data-edit-word'));
      modal.close();
      openWordForm(target);
      return;
    }
    const deleteBtn = event.target.closest('[data-delete-word]');
    if (!deleteBtn) return;
    const target = store.word(deleteBtn.getAttribute('data-delete-word'));
    const confirmed = await ui.confirmDialog({
      title: '删除生词',
      message: '确定删除「' + (target ? target.ru : '') + '」吗？它的学习记录也会一并删除，此操作不可恢复。',
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      store.deleteCustomWord(deleteBtn.getAttribute('data-delete-word'));
      ui.toast('已删除', { type: 'ok' });
      modal.close();
    } catch (err) {
      ui.toast('删除失败：' + (err && err.message ? err.message : '未知错误'), { type: 'error' });
    }
  });
}

function openWordForm(word) {
  const editing = !!word;
  const source = word || {
    ru: '', stress: '', zh: '', pos: '名词', level: 3, tr: '', note: '',
    example: { ru: '', zh: '' },
  };
  const genderValue = source.gender || '';
  const aspectValue = source.aspect || '';
  const body =
    '<form class="word-form" id="word-form" novalidate>' +
      '<div class="field">' +
        '<label for="wf-ru">俄语单词' + (editing ? '' : '（可带重音）') + '</label>' +
        '<input class="input input--ru" id="wf-ru" lang="ru" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="例如 приве́т" value="' + ui.esc(source.stress || source.ru) + '" />' +
        '<span class="field-hint">重音符号会自动拆分保存；单音节词不用标。</span>' +
      '</div>' +
      '<div class="field">' +
        '<label for="wf-zh">中文释义</label>' +
        '<input class="input" id="wf-zh" placeholder="例如 你好；嗨（非正式）" value="' + ui.esc(source.zh) + '" />' +
        '<span class="field-hint">多义用「；」分隔。</span>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="wf-pos">词性</label><select class="select" id="wf-pos">' +
          POS_LIST.map((pos) => '<option value="' + pos + '"' + (source.pos === pos ? ' selected' : '') + '>' + pos + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label for="wf-level">难度</label><select class="select" id="wf-level">' +
          [1, 2, 3, 4, 5].map((level) => '<option value="' + level + '"' + (Number(source.level) === level ? ' selected' : '') + '>' + LEVEL_LABEL[level] + '</option>').join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="wf-tr">转写</label>' +
        '<input class="input" id="wf-tr" autocomplete="off" placeholder="留空则自动生成" value="' + ui.esc(source.tr || '') + '" />' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field" id="wf-gender-field"><label for="wf-gender">性（名词）</label><select class="select" id="wf-gender">' +
          '<option value="">不指定</option>' +
          ['м', 'ж', 'с', 'мн'].map((gender) => '<option value="' + gender + '"' + (genderValue === gender ? ' selected' : '') + '>' + GENDER_LABEL[gender] + '</option>').join('') +
        '</select></div>' +
        '<div class="field" id="wf-aspect-field"><label for="wf-aspect">体（动词）</label><select class="select" id="wf-aspect">' +
          '<option value="">不指定</option>' +
          ['нсв', 'св'].map((aspect) => '<option value="' + aspect + '"' + (aspectValue === aspect ? ' selected' : '') + '>' + ASPECT_LABEL[aspect] + '</option>').join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="wf-ex-ru">例句（可选）</label>' +
        '<input class="input input--ru" id="wf-ex-ru" lang="ru" placeholder="例如 Привет, как дела?" value="' + ui.esc(source.example && source.example.ru ? source.example.ru : '') + '" />' +
      '</div>' +
      '<div class="field">' +
        '<label for="wf-ex-zh">例句翻译（可选）</label>' +
        '<input class="input" id="wf-ex-zh" value="' + ui.esc(source.example && source.example.zh ? source.example.zh : '') + '" />' +
      '</div>' +
      '<div class="field">' +
        '<label for="wf-note">笔记（可选）</label>' +
        '<input class="input" id="wf-note" value="' + ui.esc(source.note || '') + '" />' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn" data-modal-close>取消</button>' +
        '<button type="submit" class="btn btn-primary">' + (editing ? '保存' : '添加') + '</button>' +
      '</div>' +
    '</form>';

  const modal = ui.openModal({ title: editing ? '编辑生词' : '添加生词', body: body, className: 'modal-form' });
  const form = modal.el.querySelector('#word-form');
  const posEl = form.querySelector('#wf-pos');
  const genderField = form.querySelector('#wf-gender-field');
  const aspectField = form.querySelector('#wf-aspect-field');
  const syncFields = () => {
    genderField.hidden = posEl.value !== '名词';
    aspectField.hidden = posEl.value !== '动词';
  };
  syncFields();
  posEl.addEventListener('change', syncFields);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ruField = form.querySelector('#wf-ru');
    const zhField = form.querySelector('#wf-zh');
    const rawRu = ruField.value.trim();
    const zh = zhField.value.trim();
    if (!rawRu) { ruField.focus(); ui.toast('请填写俄语单词', { type: 'error' }); return; }
    if (!zh) { zhField.focus(); ui.toast('请填写中文释义', { type: 'error' }); return; }
    let stress = '';
    let ru = rawRu;
    if (rawRu.indexOf('\u0301') >= 0) {
      stress = rawRu;
      ru = rawRu.replace(/\u0301/g, '');
    }
    const trValue = form.querySelector('#wf-tr').value.trim();
    const payload = {
      ru: ru,
      stress: stress,
      zh: zh,
      tr: trValue || translitRu(ru),
      pos: posEl.value,
      level: Number(form.querySelector('#wf-level').value) || 3,
      gender: genderField.hidden ? undefined : (form.querySelector('#wf-gender').value || undefined),
      aspect: aspectField.hidden ? undefined : (form.querySelector('#wf-aspect').value || undefined),
      note: form.querySelector('#wf-note').value.trim(),
      example: {
        ru: form.querySelector('#wf-ex-ru').value.trim(),
        zh: form.querySelector('#wf-ex-zh').value.trim(),
      },
    };
    try {
      if (editing) store.updateCustomWord(word.id, payload);
      else store.addCustomWord(payload);
      ui.toast(editing ? '已保存' : '已添加到我的生词', { type: 'ok' });
      modal.close();
    } catch (err) {
      ui.toast(err && err.message ? err.message : '保存失败', { type: 'error' });
    }
  });
}

function viewStats(root) {
  paintStats(root);
  return { refresh: () => paintStats(root) };
}

function paintStats(root) {
  const summary = store.summary();
  const heatmap = summary.heatmap || [];
  const levelOf = (count) => {
    if (!count) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 10) return 3;
    return 4;
  };
  const accuracyText = summary.accuracy7d > 0 ? Math.round(summary.accuracy7d * 100) + '%' : '—';
  const tiles = [
    { label: '总词数', value: summary.total },
    { label: '已学', value: summary.learned },
    { label: '已掌握', value: summary.mastered },
    { label: '到期', value: summary.due },
    { label: '连续天数', value: summary.streak },
    { label: '近 7 天正确率', value: accuracyText },
  ];

  const unitRows = store.units.map((unit) => {
    let learned = 0;
    for (const word of unit.words) {
      if (store.statusOf(word.id) !== 'new') learned += 1;
    }
    return { title: unit.title, learned: learned, total: unit.words.length };
  });

  const last7 = summary.last7 || [];
  const last7HTML = last7.length
    ? last7.map((day) => {
        const date = ui.parseDayKey(day.date);
        const attempts = day.correct + day.wrong;
        const rate = attempts > 0 ? Math.round((day.correct / attempts) * 100) + '%' : '—';
        return '<li class="last7-row">' +
          '<span class="last7-date">' + ui.fmtDateShort(date.getTime()) + ' ' + ui.WEEKDAYS[date.getDay()] + '</span>' +
          '<span class="last7-stats">' +
            '<span>新 <b>' + day.new + '</b></span>' +
            '<span>复习 <b>' + day.review + '</b></span>' +
            '<span>正确率 <b>' + rate + '</b></span>' +
          '</span>' +
        '</li>';
      }).join('')
    : '<li class="small muted">还没有学习记录。</li>';

  root.innerHTML = '<section class="stats">' +
    '<div class="tiles">' +
      tiles.map((tile) => '<div class="tile"><span class="tile-value">' + tile.value + '</span><span class="tile-label">' + tile.label + '</span></div>').join('') +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">近 30 天学习</h3>' +
      '<div class="heatmap-wrap">' +
        '<div class="heatmap" role="group" aria-label="近 30 天学习热力图">' +
          heatmap.map((day) => '<button type="button" class="heat" data-level="' + levelOf(day.count) + '" data-heat="' + day.date + '" data-count="' + day.count + '" title="' + ui.esc(ui.fmtDayKeyCN(day.date)) + ' · ' + day.count + ' 个词" aria-label="' + ui.esc(ui.fmtDayKeyCN(day.date)) + '，' + day.count + ' 个词"></button>').join('') +
        '</div>' +
        '<p class="heat-caption" id="heat-caption">点击格子查看当天学习量</p>' +
        '<div class="heat-legend"><span>少</span><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>多</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">单元进度</h3>' +
      '<ul class="unit-list">' +
        (unitRows.length
          ? unitRows.map((row) =>
              '<li class="unit-row">' +
                '<div class="unit-head"><span class="unit-name">' + ui.esc(row.title) + '</span>' +
                '<span class="unit-count">' + row.learned + '/' + row.total + '</span></div>' +
                '<div class="bar"><i style="width:' + ui.pct(row.learned, row.total) + '%"></i></div>' +
              '</li>'
            ).join('')
          : '<li class="small muted">词库还没有内容。</li>') +
      '</ul>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">近 7 天明细</h3>' +
      '<ul class="last7">' + last7HTML + '</ul>' +
    '</div>' +
  '</section>';

  const caption = root.querySelector('#heat-caption');
  const cells = root.querySelectorAll('.heat');
  for (const cell of cells) {
    cell.addEventListener('click', () => {
      if (!caption) return;
      caption.textContent = ui.fmtDayKeyCN(cell.getAttribute('data-heat')) + ' · 学习 ' + cell.getAttribute('data-count') + ' 个词';
    });
  }
}

function viewSettings(root) {
  const settings = store.settings;
  root.innerHTML =
    '<section class="settings stack">' +
      '<div class="card">' +
        '<h3 class="card-title">学习</h3>' +
        '<div class="setting-row">' +
          '<label for="set-new">每日新词上限</label>' +
          '<input class="input input--num" id="set-new" type="number" inputmode="numeric" min="0" max="200" step="1" value="' + settings.newPerDay + '" />' +
        '</div>' +
        '<div class="setting-row">' +
          '<label for="set-review">每日复习上限</label>' +
          '<input class="input input--num" id="set-review" type="number" inputmode="numeric" min="0" max="1000" step="1" value="' + settings.reviewPerDay + '" />' +
        '</div>' +
        '<div class="setting-row">' +
          '<span>显示转写</span>' +
          '<label class="switch"><input type="checkbox" id="set-translit"' + (settings.showTranslit ? ' checked' : '') + ' aria-label="显示转写" /><span class="switch-track"></span></label>' +
        '</div>' +
        '<div class="setting-row">' +
          '<span>显示例句</span>' +
          '<label class="switch"><input type="checkbox" id="set-example"' + (settings.showExample ? ' checked' : '') + ' aria-label="显示例句" /><span class="switch-track"></span></label>' +
        '</div>' +
        '<div class="setting-row">' +
          '<span>自动发音</span>' +
          '<label class="switch"><input type="checkbox" id="set-audio"' + (settings.autoAudio ? ' checked' : '') + ' aria-label="自动发音" /><span class="switch-track"></span></label>' +
        '</div>' +
        '<div class="setting-row setting-row--stack">' +
          '<span>主题</span>' +
          '<div class="segmented" role="group" aria-label="主题">' +
            THEME_OPTIONS.map((option) =>
              '<button type="button" class="segment' + (settings.theme === option.id ? ' is-active' : '') + '" data-theme-opt="' + option.id + '" aria-pressed="' + (settings.theme === option.id) + '">' + option.label + '</button>'
            ).join('') +
          '</div>' +
        '</div>' +
        '<div class="setting-row setting-row--stack">' +
          '<span>俄语字体</span>' +
          '<div class="segmented" role="group" aria-label="俄语字体">' +
            '<button type="button" class="segment' + (settings.ruFont === 'hand' ? '' : ' is-active') + '" data-rufont-opt="print" aria-pressed="' + (settings.ruFont !== 'hand') + '">印刷体</button>' +
            '<button type="button" class="segment' + (settings.ruFont === 'hand' ? ' is-active' : '') + '" data-rufont-opt="hand" aria-pressed="' + (settings.ruFont === 'hand') + '">手写体</button>' +
          '</div>' +
        '</div>' +
        '<p class="card-note">每日上限按「今天已经学过多少」计算，修改后立即生效；手写体用于练习阅读俄语连笔字。</p>' +
      '</div>' +

      '<div class="card">' +
        '<h3 class="card-title">同步</h3>' +
        '<div id="sync-panel"></div>' +
      '</div>' +

      '<div class="card">' +
        '<h3 class="card-title">数据</h3>' +
        '<div class="setting-actions">' +
          '<button type="button" class="btn" data-export>导出备份</button>' +
          '<button type="button" class="btn" data-import>导入备份</button>' +
          '<button type="button" class="btn" data-reset>重置进度</button>' +
          '<button type="button" class="btn btn-danger" data-clear>清除本机数据</button>' +
        '</div>' +
        '<input type="file" id="import-file" accept="application/json,.json" hidden />' +
        '<p class="card-note">导出文件包含学习进度、设置和自定义生词，可用于换设备或还原备份；导入按时间合并，不会覆盖较新的本地记录。</p>' +
      '</div>' +

      '<div class="card">' +
        '<h3 class="card-title">关于</h3>' +
        '<ul class="kv-list">' +
          '<li><span>版本</span><b>' + APP_VERSION + '</b></li>' +
          '<li><span>本地词库</span><b data-about-words>' + store.words.length + ' 词</b></li>' +
          '<li><span>我的生词</span><b data-about-custom>' + store.customWords.length + ' 个</b></li>' +
          '<li><span>存储占用</span><b data-about-size>' + ui.esc(estimateStorage()) + '</b></li>' +
          '<li><span>设备</span><b data-about-device>' + ui.esc(store.meta && store.meta.deviceName ? store.meta.deviceName : '—') + '</b></li>' +
        '</ul>' +
        '<p class="card-note">纯静态 PWA，零依赖。词库与进度默认只保存在本机，配置同步后才会写入 GitHub 私有仓库。</p>' +
      '</div>' +
    '</section>';

  bindNumberInput(root.querySelector('#set-new'), 'newPerDay', 0, 200);
  bindNumberInput(root.querySelector('#set-review'), 'reviewPerDay', 0, 1000);
  bindToggle(root.querySelector('#set-translit'), 'showTranslit');
  bindToggle(root.querySelector('#set-example'), 'showExample');
  bindToggle(root.querySelector('#set-audio'), 'autoAudio');

  const themeButtons = root.querySelectorAll('[data-theme-opt]');
  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      const theme = button.getAttribute('data-theme-opt');
      applyTheme(theme);
      store.setSettings({ theme: theme });
      for (const node of themeButtons) {
        const active = node === button;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', String(active));
      }
    });
  }

  const ruFontButtons = root.querySelectorAll('[data-rufont-opt]');
  for (const button of ruFontButtons) {
    button.addEventListener('click', () => {
      const value = button.getAttribute('data-rufont-opt') === 'hand' ? 'hand' : 'print';
      applyRuFont(value);
      store.setSettings({ ruFont: value });
      for (const node of ruFontButtons) {
        const active = node === button;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', String(active));
      }
    });
  }

  const exportBtn = root.querySelector('[data-export]');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadJSON(store.exportPayload(), 'russian-vocab-backup-' + stamp + '.json');
      ui.toast('备份已导出', { type: 'ok' });
    });
  }

  const importBtn = root.querySelector('[data-import]');
  const importFile = root.querySelector('#import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      importFile.value = '';
      if (!file) return;
      let payload = null;
      try {
        payload = JSON.parse(await file.text());
      } catch (err) {
        ui.toast('文件不是有效的 JSON', { type: 'error' });
        return;
      }
      if (!payload || typeof payload !== 'object' || !payload.cards) {
        ui.toast('备份文件格式不正确', { type: 'error' });
        return;
      }
      const confirmed = await ui.confirmDialog({
        title: '导入备份',
        message: '将把备份中的进度、设置与生词按时间合并到本机，本地更新的记录不会被覆盖。继续吗？',
        confirmText: '合并导入',
      });
      if (!confirmed) return;
      try {
        store.importPayload(payload, 'merge');
        ui.toast('导入完成', { type: 'ok' });
        remountCurrentView();
      } catch (err) {
        ui.toast('导入失败：' + (err && err.message ? err.message : '未知错误'), { type: 'error' });
      }
    });
  }

  const resetBtn = root.querySelector('[data-reset]');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const first = await ui.confirmDialog({
        title: '重置学习进度',
        message: '会清空所有单词的复习进度与统计，自定义生词和设置会保留。此操作不可恢复。',
        confirmText: '继续',
        danger: true,
      });
      if (!first) return;
      const second = await ui.confirmDialog({
        title: '再确认一次',
        message: '真的要重置全部学习进度吗？重置后无法恢复。',
        confirmText: '确认重置',
        danger: true,
      });
      if (!second) return;
      store.resetProgress();
      ui.toast('学习进度已重置', { type: 'ok' });
      remountCurrentView();
    });
  }

  const clearBtn = root.querySelector('[data-clear]');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      const confirmed = await ui.confirmDialog({
        title: '清除本机数据',
        message: '会删除本机保存的学习进度、自定义生词与设置（不会动云端备份）。此操作不可恢复，建议先导出备份。',
        confirmText: '清除',
        danger: true,
      });
      if (!confirmed) return;
      try {
        if (sync && typeof sync.disconnect === 'function') sync.disconnect();
      } catch (err) { /* 忽略 */ }
      try {
        store.importPayload({
          schema: 1,
          updatedAt: Date.now(),
          cards: {},
          customWords: [],
          settings: {},
          stats: { days: {} },
          meta: { resetAt: Date.now(), deviceName: '' },
        }, 'replace');
        if (typeof store.setDeviceName === 'function') {
          store.setDeviceName('设备-' + Math.random().toString(36).slice(2, 6).toUpperCase());
        }
        applyTheme(store.settings.theme);
        applyRuFont(store.settings.ruFont);
        ui.toast('本机数据已清除', { type: 'ok' });
        remountCurrentView();
      } catch (err) {
        ui.toast('清除失败：' + (err && err.message ? err.message : '未知错误'), { type: 'error' });
      }
    });
  }

  updateAbout(root);
  const syncHandle = mountSyncPanelInto(root);

  return {
    refresh: () => {
      updateAbout(root);
    },
    cleanup: () => {
      if (syncHandle && typeof syncHandle.destroy === 'function') syncHandle.destroy();
    },
  };
}

function bindNumberInput(input, key, min, max) {
  if (!input) return;
  const commit = () => {
    const raw = String(input.value).trim();
    if (!raw) {
      input.value = String(store.settings[key]);
      return;
    }
    let value = Math.round(Number(raw));
    if (!Number.isFinite(value)) value = store.settings[key];
    value = Math.min(max, Math.max(min, value));
    input.value = String(value);
    if (value !== store.settings[key]) store.setSettings({ [key]: value });
  };
  input.addEventListener('blur', commit);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  });
}

function bindToggle(input, key) {
  if (!input) return;
  input.addEventListener('change', () => store.setSettings({ [key]: !!input.checked }));
}

function updateAbout(root) {
  const wordsEl = root.querySelector('[data-about-words]');
  if (wordsEl) wordsEl.textContent = store.words.length + ' 词';
  const customEl = root.querySelector('[data-about-custom]');
  if (customEl) customEl.textContent = store.customWords.length + ' 个';
  const sizeEl = root.querySelector('[data-about-size]');
  if (sizeEl) sizeEl.textContent = estimateStorage();
  const deviceEl = root.querySelector('[data-about-device]');
  if (deviceEl) deviceEl.textContent = store.meta && store.meta.deviceName ? store.meta.deviceName : '—';
}

function mountSyncPanelInto(root) {
  const panel = root.querySelector('#sync-panel');
  if (!panel) return null;
  let handle = null;
  try {
    handle = mountSyncPanel(panel);
  } catch (err) {
    panel.innerHTML = '<p class="small muted">同步面板暂时不可用。</p>';
    return null;
  }
  if (!panel.textContent || !panel.textContent.trim()) {
    panel.innerHTML = '<p class="small muted">同步功能尚未就绪，当前进度只保存在本机，可先导出备份。</p>';
  }
  return handle && typeof handle.destroy === 'function' ? handle : null;
}

/* ==================== 入口 ==================== */

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
