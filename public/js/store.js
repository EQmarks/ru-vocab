// 应用状态：词库索引 / 学习卡片 / 设置 / 统计 / 持久化 / 云合并。
// 纯浏览器 ESM，不依赖任何库。契约见 docs/CONTRACT.md 第 5 节。
import {
  newCard,
  grade as applyGrade,
  statusOf as srsStatus,
  isDue as srsIsDue,
  isMastered as srsIsMastered,
  DAY_MS,
} from './srs.js';

const STATE_KEY = 'rv.state.v1';
export const STATE_SCHEMA = 1;

export const DEFAULT_SETTINGS = {
  newPerDay: 15,
  reviewPerDay: 80,
  autoAudio: true,
  showTranslit: true,
  showExample: true,
  theme: 'auto',
  ruFont: 'print',
  updatedAt: 0,
};

const THEMES = ['auto', 'light', 'dark'];

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

export function dayKey(now) {
  const d = new Date(num(now, Date.now()));
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function emptyState() {
  return {
    schema: STATE_SCHEMA,
    updatedAt: 0,
    cards: {},
    customWords: [],
    settings: { ...DEFAULT_SETTINGS },
    stats: { days: {} },
    meta: { resetAt: 0, lastSyncAt: 0, deviceName: '' },
  };
}

function sanitizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {
    ease: num(raw.ease, 2.5),
    interval: Math.max(0, num(raw.interval, 0)),
    due: num(raw.due, 0),
    reps: Math.max(0, num(raw.reps, 0)),
    lapses: Math.max(0, num(raw.lapses, 0)),
    correct: Math.max(0, num(raw.correct, 0)),
    wrong: Math.max(0, num(raw.wrong, 0)),
    last: num(raw.last, 0),
    updatedAt: num(raw.updatedAt, 0),
  };
  if (raw.deleted) out.deleted = true;
  return out;
}

function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    newPerDay: Math.min(200, Math.max(0, Math.round(num(src.newPerDay, DEFAULT_SETTINGS.newPerDay)))),
    reviewPerDay: Math.min(1000, Math.max(0, Math.round(num(src.reviewPerDay, DEFAULT_SETTINGS.reviewPerDay)))),
    autoAudio: src.autoAudio !== false,
    showTranslit: src.showTranslit !== false,
    showExample: src.showExample !== false,
    theme: THEMES.includes(src.theme) ? src.theme : 'auto',
    ruFont: ['print', 'hand', 'both'].includes(src.ruFont) ? src.ruFont : 'print',
    updatedAt: num(src.updatedAt, 0),
  };
}

function sanitizeDay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    new: Math.max(0, Math.round(num(raw.new, 0))),
    review: Math.max(0, Math.round(num(raw.review, 0))),
    correct: Math.max(0, Math.round(num(raw.correct, 0))),
    wrong: Math.max(0, Math.round(num(raw.wrong, 0))),
    updatedAt: num(raw.updatedAt, 0),
  };
}

function sanitizeWord(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.ru !== 'string' || !raw.ru.trim()) return null;
  const w = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : '',
    ru: raw.ru.trim(),
    stress: typeof raw.stress === 'string' && raw.stress ? raw.stress : raw.ru.trim(),
    tr: typeof raw.tr === 'string' ? raw.tr : '',
    zh: typeof raw.zh === 'string' ? raw.zh : '',
    pos: typeof raw.pos === 'string' ? raw.pos : '短语',
    level: Math.min(5, Math.max(1, Math.round(num(raw.level, 3)))),
    example: {
      ru: raw.example && typeof raw.example.ru === 'string' ? raw.example.ru : '',
      zh: raw.example && typeof raw.example.zh === 'string' ? raw.example.zh : '',
    },
    custom: true,
    createdAt: num(raw.createdAt, 0),
    updatedAt: num(raw.updatedAt, 0),
  };
  if (raw.gender === 'м' || raw.gender === 'ж' || raw.gender === 'с' || raw.gender === 'мн') w.gender = raw.gender;
  if (raw.aspect === 'нсв' || raw.aspect === 'св') w.aspect = raw.aspect;
  if (typeof raw.note === 'string' && raw.note) w.note = raw.note;
  if (Array.isArray(raw.tags)) w.tags = raw.tags.filter((t) => typeof t === 'string');
  if (raw.deleted) w.deleted = true;
  return w;
}

function sanitizeCustomWords(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const w = sanitizeWord(item);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
  }
  return out;
}

function sanitizeState(raw) {
  const st = emptyState();
  if (!raw || typeof raw !== 'object') return st;
  st.updatedAt = num(raw.updatedAt, 0);
  if (raw.cards && typeof raw.cards === 'object') {
    for (const [id, c] of Object.entries(raw.cards)) {
      const card = sanitizeCard(c);
      if (card) st.cards[id] = card;
    }
  }
  st.customWords = sanitizeCustomWords(raw.customWords);
  st.settings = sanitizeSettings(raw.settings);
  if (raw.stats && raw.stats.days && typeof raw.stats.days === 'object') {
    for (const [k, v] of Object.entries(raw.stats.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      const day = sanitizeDay(v);
      if (day) st.stats.days[k] = day;
    }
  }
  if (raw.meta && typeof raw.meta === 'object') {
    st.meta.resetAt = num(raw.meta.resetAt, 0);
    st.meta.lastSyncAt = num(raw.meta.lastSyncAt, 0);
    st.meta.deviceName = typeof raw.meta.deviceName === 'string' ? raw.meta.deviceName : '';
  }
  return st;
}

function normalizeBuiltinWord(raw, unitId) {
  return {
    id: raw.id,
    ru: raw.ru,
    stress: raw.stress || raw.ru,
    tr: raw.tr || '',
    zh: raw.zh || '',
    pos: raw.pos || '短语',
    gender: raw.gender,
    aspect: raw.aspect,
    note: raw.note,
    level: raw.level || 3,
    tags: raw.tags || [],
    example: raw.example || { ru: '', zh: '' },
    unitId,
    custom: false,
  };
}

function normalizeInput(input) {
  const src = input || {};
  let ru = String(src.ru || '').trim();
  let stress = typeof src.stress === 'string' ? src.stress.trim() : '';
  if (ru.includes('\u0301') && !stress) { stress = ru; ru = ru.replace(/\u0301/g, ''); }
  if (!ru) throw new Error('俄语单词不能为空');
  stress = stress || ru;
  const zh = String(src.zh || '').trim();
  if (!zh) throw new Error('中文释义不能为空');
  const level = Math.min(5, Math.max(1, Math.round(num(src.level, 3))));
  const example = {
    ru: src.example && typeof src.example.ru === 'string' ? src.example.ru.trim() : '',
    zh: src.example && typeof src.example.zh === 'string' ? src.example.zh.trim() : '',
  };
  return {
    ru,
    stress,
    tr: typeof src.tr === 'string' ? src.tr.trim() : '',
    zh,
    pos: typeof src.pos === 'string' && src.pos ? src.pos : '短语',
    gender: src.gender,
    aspect: src.aspect,
    note: typeof src.note === 'string' ? src.note.trim() : '',
    level,
    example,
  };
}

export function createStore(options) {
  const opts = options || {};
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const t0 = () => nowFn();

  let state = emptyState();
  let data = null;
  let wordMap = new Map();
  let orderMap = new Map();
  let customUnit = null;
  let wordsVersion = 0;
  let ready = false;
  let lastError = null;
  let saveTimer = null;
  const listeners = new Set();
  const syncListeners = new Set();

  function nowNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : t0();
  }

  function emit() {
    for (const fn of Array.from(listeners)) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  function notifySync() {
    for (const fn of Array.from(syncListeners)) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  function rebuildIndex() {
    wordMap = new Map();
    orderMap = new Map();
    wordsVersion++;
    let order = 0;
    if (data && Array.isArray(data.units)) {
      for (const unit of data.units) {
        for (const w of unit.words || []) {
          const word = normalizeBuiltinWord(w, unit.id);
          wordMap.set(word.id, word);
          orderMap.set(word.id, order++);
        }
      }
    }
    const customs = state.customWords.filter((w) => !w.deleted);
    for (const w of customs) {
      const word = { ...w, unitId: 'custom', custom: true };
      wordMap.set(word.id, word);
      orderMap.set(word.id, order++);
    }
    customUnit = customs.length
      ? { id: 'custom', title: '我的生词', titleRu: 'Мои слова', level: '—', words: customs.map((w) => ({ ...w, custom: true })) }
      : null;
  }

  function setWords(payload) {
    if (!payload || !Array.isArray(payload.units)) throw new Error('词库格式不正确');
    data = payload;
    rebuildIndex();
  }

  function loadPersisted() {
    if (!storage) return;
    let text = null;
    try { text = storage.getItem(STATE_KEY); } catch (e) { lastError = e; return; }
    if (!text) return;
    try {
      state = sanitizeState(JSON.parse(text));
    } catch (e) {
      lastError = e;
      state = emptyState();
    }
  }

  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!storage) return;
    try { storage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { lastError = e; emit(); }
  }

  function saveSoon() {
    if (!storage) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 250);
  }

  function touch(t) {
    state.updatedAt = t;
    saveSoon();
    emit();
    notifySync();
  }

  function findWord(id) {
    return wordMap.get(id) || null;
  }

  function allWords() {
    return Array.from(wordMap.values());
  }

  function units() {
    const list = data && Array.isArray(data.units) ? data.units.map((u) => ({ ...u })) : [];
    if (customUnit) list.push(customUnit);
    return list;
  }

  function unitOf(id) {
    const word = findWord(id);
    if (!word) return null;
    return units().find((u) => u.id === word.unitId) || null;
  }

  function cardOf(id) {
    return state.cards[id] || null;
  }

  function isActiveCard(card) {
    return !!card && !card.deleted && num(card.reps, 0) > 0;
  }

  function statusOf(id, now) {
    const card = state.cards[id];
    if (!isActiveCard(card)) return 'new';
    return srsStatus(card);
  }

  function dueIds(now) {
    const t = nowNum(now);
    const out = [];
    for (const [id, card] of Object.entries(state.cards)) {
      if (!isActiveCard(card)) continue;
      if (!wordMap.has(id)) continue;
      if (num(card.due, 0) <= t) out.push({ id, due: num(card.due, 0) });
    }
    out.sort((a, b) => a.due - b.due || (orderMap.get(a.id) || 0) - (orderMap.get(b.id) || 0));
    return out.map((x) => x.id);
  }

  function newIds(now) {
    const out = [];
    for (const [id, word] of wordMap) {
      const card = state.cards[id];
      if (!isActiveCard(card)) out.push({ id, order: orderMap.get(id) || 0, level: word.level || 3 });
    }
    out.sort((a, b) => a.order - b.order);
    return out.map((x) => x.id);
  }

  function dayStat(now) {
    const day = state.stats.days[dayKey(nowNum(now))];
    return day ? { new: day.new, review: day.review, correct: day.correct, wrong: day.wrong } : { new: 0, review: 0, correct: 0, wrong: 0 };
  }

  function buildSession(mode, now) {
    const t = nowNum(now);
    const today = dayStat(t);
    const reviewCap = Math.max(0, state.settings.reviewPerDay - today.review);
    const newCap = Math.max(0, state.settings.newPerDay - today.new);
    const reviews = dueIds(t).slice(0, reviewCap);
    const news = newIds(t).slice(0, newCap);
    let items = [];
    if (mode === 'new') items = news.map((id) => ({ id, kind: 'new' }));
    else if (mode === 'review') items = reviews.map((id) => ({ id, kind: 'review' }));
    else items = reviews.map((id) => ({ id, kind: 'review' })).concat(news.map((id) => ({ id, kind: 'new' })));
    return {
      items,
      newCount: items.filter((x) => x.kind === 'new').length,
      reviewCount: items.filter((x) => x.kind === 'review').length,
    };
  }

  function grade(id, g, now) {
    const t = nowNum(now);
    const word = findWord(id);
    if (!word) throw new Error('未知单词: ' + id);
    const old = state.cards[id];
    const wasNew = !isActiveCard(old);
    const next = applyGrade(old, g, t);
    state.cards[id] = next;
    const key = dayKey(t);
    const day = state.stats.days[key] ? { ...state.stats.days[key] } : { new: 0, review: 0, correct: 0, wrong: 0, updatedAt: 0 };
    if (wasNew) day.new += 1; else day.review += 1;
    if (g >= 2) day.correct += 1; else day.wrong += 1;
    day.updatedAt = t;
    state.stats.days[key] = day;
    touch(t);
    return next;
  }

  function setSettings(patch, now) {
    const t = nowNum(now);
    state.settings = sanitizeSettings({ ...state.settings, ...(patch || {}), updatedAt: t });
    touch(t);
    return state.settings;
  }

  function addCustomWord(input, now) {
    const t = nowNum(now);
    const w = normalizeInput(input);
    const dup = allWords().find((x) => x.ru.toLowerCase() === w.ru.toLowerCase());
    if (dup) throw new Error('词库里已有「' + w.ru + '」');
    const id = 'c-' + t.toString(36) + Math.random().toString(36).slice(2, 6);
    const word = {
      id,
      ru: w.ru,
      stress: w.stress,
      tr: w.tr,
      zh: w.zh,
      pos: w.pos,
      level: w.level,
      example: w.example,
      tags: ['自定义'],
      custom: true,
      createdAt: t,
      updatedAt: t,
    };
    if (w.gender) word.gender = w.gender;
    if (w.aspect) word.aspect = w.aspect;
    if (w.note) word.note = w.note;
    state.customWords.push(word);
    rebuildIndex();
    touch(t);
    return word;
  }

  function updateCustomWord(id, patch, now) {
    const t = nowNum(now);
    const i = state.customWords.findIndex((w) => w.id === id && !w.deleted);
    if (i < 0) throw new Error('自定义词不存在');
    const cur = state.customWords[i];
    const merged = normalizeInput({ ...cur, ...(patch || {}) });
    const next = {
      ...cur,
      ...merged,
      id: cur.id,
      custom: true,
      tags: cur.tags && cur.tags.length ? cur.tags : ['自定义'],
      createdAt: cur.createdAt,
      updatedAt: t,
    };
    if (!merged.gender) delete next.gender;
    if (!merged.aspect) delete next.aspect;
    if (!merged.note) delete next.note;
    state.customWords[i] = next;
    rebuildIndex();
    touch(t);
    return next;
  }

  function deleteCustomWord(id, now) {
    const t = nowNum(now);
    const i = state.customWords.findIndex((w) => w.id === id && !w.deleted);
    if (i < 0) throw new Error('自定义词不存在');
    state.customWords[i] = { ...state.customWords[i], deleted: true, updatedAt: t };
    if (state.cards[id]) state.cards[id] = { ...state.cards[id], deleted: true, updatedAt: t };
    rebuildIndex();
    touch(t);
  }

  function resetProgress(now) {
    const t = nowNum(now);
    for (const [id, card] of Object.entries(state.cards)) {
      if (card.deleted) continue;
      state.cards[id] = {
        ease: 2.5,
        interval: 0,
        due: 0,
        reps: 0,
        lapses: 0,
        correct: 0,
        wrong: 0,
        last: 0,
        deleted: true,
        updatedAt: t,
      };
    }
    state.stats.days = {};
    state.meta.resetAt = t;
    touch(t);
  }

  function summary(now) {
    const t = nowNum(now);
    const words = allWords();
    let learned = 0;
    let mastered = 0;
    let learning = 0;
    for (const w of words) {
      const card = state.cards[w.id];
      if (!isActiveCard(card)) continue;
      learned += 1;
      const st = srsStatus(card);
      if (st === 'mastered') mastered += 1;
      if (st === 'learning') learning += 1;
    }
    const due = dueIds(t).length;
    const today = dayKey(t);
    let streak = 0;
    const cursor = new Date(t);
    const hasToday = (state.stats.days[today] && state.stats.days[today].new + state.stats.days[today].review > 0) || false;
    if (!hasToday) cursor.setDate(cursor.getDate() - 1);
    for (let i = 0; i < 3660; i++) {
      const key = dayKey(cursor.getTime());
      const d = state.stats.days[key];
      if (d && d.new + d.review > 0) { streak += 1; cursor.setDate(cursor.getDate() - 1); } else break;
    }
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(t);
      d.setDate(d.getDate() - i);
      const key = dayKey(d.getTime());
      const day = state.stats.days[key] || { new: 0, review: 0, correct: 0, wrong: 0 };
      last7.push({ date: key, new: day.new, review: day.review, correct: day.correct, wrong: day.wrong });
    }
    const acc = last7.reduce((a, d) => { a.correct += d.correct; a.wrong += d.wrong; return a; }, { correct: 0, wrong: 0 });
    const accuracy7d = acc.correct + acc.wrong > 0 ? acc.correct / (acc.correct + acc.wrong) : 0;
    const heatmap = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(t);
      d.setDate(d.getDate() - i);
      const key = dayKey(d.getTime());
      const day = state.stats.days[key] || { new: 0, review: 0, correct: 0, wrong: 0 };
      heatmap.push({ date: key, count: day.new + day.review, correct: day.correct });
    }
    return {
      total: words.length,
      learned,
      mastered,
      learning,
      due,
      streak,
      accuracy7d,
      last7,
      heatmap,
      newLearnedToday: dayStat(t).new,
      reviewsToday: dayStat(t).review,
    };
  }

  function exportPayload() {
    const payload = {
      schema: STATE_SCHEMA,
      updatedAt: state.updatedAt,
      cards: state.cards,
      customWords: state.customWords,
      settings: state.settings,
      stats: state.stats,
      meta: { resetAt: state.meta.resetAt, deviceName: state.meta.deviceName },
    };
    return JSON.parse(JSON.stringify(payload));
  }

  function mergeRemote(remote) {
    const result = { merged: false, localChanged: false, remoteChanged: false };
    if (!remote || typeof remote !== 'object') return result;
    if (Number(remote.schema || 0) > STATE_SCHEMA) throw new Error('云端数据版本过新，请更新应用');
    const remoteState = sanitizeState(remote);
    result.merged = true;

    const remoteCards = remoteState.cards;
    for (const [id, r] of Object.entries(remoteCards)) {
      const l = state.cards[id];
      if (!l) { state.cards[id] = r; result.remoteChanged = true; continue; }
      const lu = num(l.updatedAt, 0);
      const ru = num(r.updatedAt, 0);
      if (ru > lu) { state.cards[id] = r; result.remoteChanged = true; }
      else if (lu > ru) result.localChanged = true;
      else if (JSON.stringify(l) !== JSON.stringify(r)) result.localChanged = true;
    }
    for (const id of Object.keys(state.cards)) if (!(id in remoteCards)) result.localChanged = true;

    const localCustom = new Map(state.customWords.map((w) => [w.id, w]));
    const remoteCustom = new Map(remoteState.customWords.map((w) => [w.id, w]));
    const customIds = new Set([...localCustom.keys(), ...remoteCustom.keys()]);
    const mergedCustom = [];
    for (const id of customIds) {
      const l = localCustom.get(id);
      const r = remoteCustom.get(id);
      if (!l && r) { mergedCustom.push(r); result.remoteChanged = true; continue; }
      if (l && !r) { mergedCustom.push(l); result.localChanged = true; continue; }
      if (!l && !r) continue;
      const lu = num(l.updatedAt, 0);
      const ru = num(r.updatedAt, 0);
      if (ru > lu) { mergedCustom.push(r); result.remoteChanged = true; }
      else { mergedCustom.push(l); if (lu > ru || JSON.stringify(l) !== JSON.stringify(r)) result.localChanged = true; }
    }
    mergedCustom.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    state.customWords = mergedCustom;

    const remoteSettings = remoteState.settings;
    const localSettings = state.settings;
    if (remoteSettings.updatedAt > localSettings.updatedAt) {
      state.settings = remoteSettings;
      result.remoteChanged = true;
    } else if (localSettings.updatedAt > remoteSettings.updatedAt) {
      result.localChanged = true;
    } else if (JSON.stringify(remoteSettings) !== JSON.stringify(localSettings)) {
      result.localChanged = true;
    }

    const resetAt = Math.max(num(state.meta.resetAt, 0), num(remoteState.meta.resetAt, 0));
    const resetKey = resetAt ? dayKey(resetAt) : '';
    state.meta.resetAt = resetAt;
    const remoteDays = remoteState.stats.days;
    for (const [key, r] of Object.entries(remoteDays)) {
      if (resetKey && key <= resetKey && r.updatedAt <= resetAt) continue;
      const l = state.stats.days[key];
      if (!l) { state.stats.days[key] = r; result.remoteChanged = true; continue; }
      if (r.updatedAt > l.updatedAt) { state.stats.days[key] = r; result.remoteChanged = true; }
      else if (l.updatedAt > r.updatedAt) result.localChanged = true;
      else if (JSON.stringify(l) !== JSON.stringify(r)) result.localChanged = true;
    }
    for (const key of Object.keys(state.stats.days)) if (!(key in remoteDays)) result.localChanged = true;
    if (resetKey) {
      for (const key of Object.keys(state.stats.days)) {
        const day = state.stats.days[key];
        if (key < resetKey || (key === resetKey && day.updatedAt <= resetAt)) {
          delete state.stats.days[key];
          result.localChanged = true;
        }
      }
    }

    state.updatedAt = Math.max(state.updatedAt, remoteState.updatedAt);
    rebuildIndex();
    if (result.remoteChanged) { saveSoon(); emit(); }
    return result;
  }

  function importPayload(payload, mode, now) {
    const t = nowNum(now);
    if (mode === 'replace') {
      const next = sanitizeState(payload);
      state = next;
      state.updatedAt = t;
      rebuildIndex();
      touch(t);
      return { ...resultPlaceholder(), replaced: true };
    }
    const result = mergeRemote(payload);
    if (result.localChanged) notifySync();
    return result;
  }

  function resultPlaceholder() {
    return { merged: false, localChanged: true, remoteChanged: false };
  }

  function markSynced(now) {
    const t = nowNum(now);
    state.meta.lastSyncAt = t;
    saveSoon();
    emit();
  }

  function setDeviceName(name) {
    state.meta.deviceName = String(name || '').slice(0, 40);
    saveSoon();
    emit();
  }

  async function init(initOptions) {
    const o = initOptions || {};
    loadPersisted();
    if (o.words) setWords(o.words);
    else if (o.fetchImpl !== null) {
      const f = o.fetchImpl || (typeof fetch === 'function' ? fetch : null);
      if (!f) throw new Error('环境不支持 fetch，请显式传入词库数据');
      const res = await f('data/words.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('词库加载失败 HTTP ' + res.status);
      setWords(await res.json());
    }
    if (!state.meta.deviceName) {
      state.meta.deviceName = '设备-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    }
    ready = true;
    emit();
    return true;
  }

  const api = {
    init,
    get ready() { return ready; },
    get data() { return data; },
    get units() { return units(); },
    get words() { return allWords(); },
    get cards() { return state.cards; },
    get customWords() { return state.customWords.filter((w) => !w.deleted); },
    get settings() { return state.settings; },
    get stats() { return state.stats; },
    get meta() { return state.meta; },
    get lastError() { return lastError; },
    get version() { return wordsVersion; },
    get state() { return state; },
    word(id) { return findWord(id); },
    unitOf,
    cardOf,
    statusOf,
    dueIds,
    newIds,
    buildSession,
    todayStat: dayStat,
    summary,
    grade,
    setSettings,
    addCustomWord,
    updateCustomWord,
    deleteCustomWord,
    resetProgress,
    exportPayload,
    importPayload,
    mergeRemote,
    markSynced,
    setDeviceName,
    saveNow,
    flush: saveNow,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSyncNeeded(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); },
  };
  return api;
}

export const store = createStore();
