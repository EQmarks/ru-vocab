// 间隔重复算法（SM-2 改良版），纯函数、无副作用。
// 评级：0 忘了 / 1 模糊 / 2 记得 / 3 简单。

export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const LEARN_MS = 10 * MINUTE_MS;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const MAX_INTERVAL = 365;
export const MASTER_INTERVAL = 21;

export const GRADES = [
  { g: 0, label: '忘了', tone: 'again', key: '1', hint: '10 分钟后重来' },
  { g: 1, label: '模糊', tone: 'hard', key: '2', hint: '勉强想起' },
  { g: 2, label: '记得', tone: 'good', key: '3', hint: '正常答对' },
  { g: 3, label: '简单', tone: 'easy', key: '4', hint: '秒答' },
];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function newCard(now) {
  const t = num(now, Date.now());
  return {
    ease: 2.5,
    interval: 0,
    due: t,
    reps: 0,
    lapses: 0,
    correct: 0,
    wrong: 0,
    last: t,
    updatedAt: t,
  };
}

// 返回全新卡片对象，绝不修改入参。
export function grade(card, g, now) {
  const t = num(now, Date.now());
  const base = card && !card.deleted ? { ...newCard(t), ...card } : newCard(t);
  const prevReps = num(base.reps, 0);
  const ease = clamp(num(base.ease, 2.5), MIN_EASE, MAX_EASE);
  const interval = Math.max(0, num(base.interval, 0));
  const next = {
    ...base,
    reps: prevReps + 1,
    last: t,
    updatedAt: t,
  };
  if (g <= 0) {
    next.lapses = num(base.lapses, 0) + 1;
    next.wrong = num(base.wrong, 0) + 1;
    next.ease = clamp(ease - 0.2, MIN_EASE, MAX_EASE);
    next.interval = LEARN_MS / DAY_MS;
    next.due = t + LEARN_MS;
  } else if (g === 1) {
    next.correct = num(base.correct, 0) + 1;
    next.ease = clamp(ease - 0.15, MIN_EASE, MAX_EASE);
    let iv = prevReps === 0 ? 0.5 : Math.max(1, interval * 1.2);
    iv = Math.min(iv, MAX_INTERVAL);
    next.interval = iv;
    next.due = t + iv * DAY_MS;
  } else if (g === 2) {
    next.correct = num(base.correct, 0) + 1;
    let iv = prevReps === 0 ? 1 : interval < 0.5 ? 1 : interval * ease;
    iv = Math.min(iv, MAX_INTERVAL);
    next.interval = iv;
    next.due = t + iv * DAY_MS;
  } else {
    next.correct = num(base.correct, 0) + 1;
    next.ease = clamp(ease + 0.15, MIN_EASE, MAX_EASE);
    let iv = prevReps === 0 ? 3 : interval < 0.5 ? 3 : interval * ease * 1.3;
    iv = Math.min(iv, MAX_INTERVAL);
    next.interval = iv;
    next.due = t + iv * DAY_MS;
  }
  return next;
}

export function isDue(card, now) {
  const t = num(now, Date.now());
  return !!card && !card.deleted && num(card.reps, 0) > 0 && num(card.due, 0) <= t;
}

export function isMastered(card) {
  return !!card && !card.deleted && num(card.interval, 0) >= MASTER_INTERVAL && num(card.lapses, 0) <= 3;
}

export function statusOf(card) {
  if (!card || card.deleted || num(card.reps, 0) === 0) return 'new';
  if (isMastered(card)) return 'mastered';
  if (num(card.interval, 0) < 1) return 'learning';
  return 'review';
}

export function formatInterval(days) {
  const d = Math.max(0, num(days, 0));
  const ms = d * DAY_MS;
  if (ms < 60 * MINUTE_MS) return Math.max(1, Math.round(ms / MINUTE_MS)) + ' 分钟';
  if (ms < DAY_MS) return Math.max(1, Math.round(ms / (60 * MINUTE_MS))) + ' 小时';
  if (d < 30) return Math.max(1, Math.round(d)) + ' 天';
  if (d < 365) return Math.max(1, Math.round(d / 30)) + ' 个月';
  return Math.max(1, Math.round(d / 365)) + ' 年';
}

// 四颗按钮上的间隔文案预览
export function preview(card, g, now) {
  const t = num(now, Date.now());
  const next = grade(card, g, t);
  return g <= 0 ? '10 分钟' : formatInterval(next.interval);
}

// 拼写判分：去重音、小写、ё→е、去除首尾标点与空格，允许连字符/空格差异
export function normalizeAnswer(s) {
  return String(s || '')
    .replace(/\u0301/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:'\"«»()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function checkAnswer(input, word) {
  if (!word) return false;
  const a = normalizeAnswer(input);
  if (!a) return false;
  return [word.ru, word.stress || word.ru].some((s) => normalizeAnswer(s) === a);
}
