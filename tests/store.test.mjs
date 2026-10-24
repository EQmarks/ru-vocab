import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, dayKey } from '../public/js/store.js';
import { DAY_MS } from '../public/js/srs.js';

const T0 = new Date('2026-10-24T10:00:00+08:00').getTime();

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => m,
  };
}

function w(id, ru, level) {
  return {
    id,
    ru,
    stress: ru,
    tr: ru,
    zh: '释义 ' + ru,
    pos: '名词',
    gender: 'м',
    level: level || 1,
    example: { ru: ru + ' тут.', zh: '例句' },
  };
}

const WORDS = {
  version: 1,
  units: [
    { id: 'u01', title: '一', titleRu: 'Один', level: 'A1', words: [w('u01-001', 'дом', 1), w('u01-002', 'стол', 2), w('u01-003', 'окно', 3)] },
    { id: 'u02', title: '二', titleRu: 'Два', level: 'A2', words: [w('u02-001', 'книга', 1), w('u02-002', 'ручка', 2)] },
  ],
};

async function makeStore(now) {
  const storage = memStorage();
  const s = createStore({ storage, now: () => now });
  await s.init({ words: WORDS, fetchImpl: null });
  return { s, storage };
}

test('init 载入词库与索引', async () => {
  const { s } = await makeStore(T0);
  assert.equal(s.ready, true);
  assert.equal(s.words.length, 5);
  assert.equal(s.units.length, 2);
  assert.equal(s.word('u02-001').ru, 'книга');
  assert.equal(s.unitOf('u02-001').id, 'u02');
});

test('会话计划：先复习后新词', async () => {
  const { s } = await makeStore(T0);
  const plan = s.buildSession('daily', T0);
  assert.equal(plan.items.length, 5);
  assert.equal(plan.newCount, 5);
  s.grade('u01-001', 2, T0);
  const later = s.buildSession('daily', T0 + DAY_MS);
  assert.equal(later.items[0].kind, 'review');
  assert.equal(later.items[0].id, 'u01-001');
});

test('grade 更新卡片与当日统计', async () => {
  const { s } = await makeStore(T0);
  s.grade('u01-001', 2, T0);
  const card = s.cardOf('u01-001');
  assert.equal(card.reps, 1);
  assert.equal(card.interval, 1);
  assert.equal(s.statusOf('u01-001', T0), 'review');
  assert.deepEqual(s.todayStat(T0), { new: 1, review: 0, correct: 1, wrong: 0 });
  s.grade('u01-001', 2, T0);
  assert.deepEqual(s.todayStat(T0), { new: 1, review: 1, correct: 2, wrong: 0 });
});

test('每日新词上限与复习上限', async () => {
  const { s } = await makeStore(T0);
  s.setSettings({ newPerDay: 2, reviewPerDay: 1 }, T0);
  const plan = s.buildSession('daily', T0);
  assert.equal(plan.newCount, 2);
  s.grade('u01-001', 2, T0);
  s.grade('u01-002', 2, T0);
  assert.equal(s.buildSession('daily', T0).newCount, 0);
  const next = s.buildSession('review', T0 + DAY_MS);
  assert.equal(next.reviewCount, 1);
});

test('持久化：重建 store 能恢复进度', async () => {
  const { s, storage } = await makeStore(T0);
  s.grade('u02-001', 3, T0);
  s.flush();
  const s2 = createStore({ storage, now: () => T0 });
  await s2.init({ words: WORDS, fetchImpl: null });
  assert.equal(s2.cardOf('u02-001').reps, 1);
  assert.equal(s2.todayStat(T0).new, 1);
});

test('自定义词：增删与重复校验', async () => {
  const { s } = await makeStore(T0);
  const word = s.addCustomWord({ ru: 'приве́т', zh: '你好', pos: '感叹词', tr: 'privet' }, T0);
  assert.equal(word.ru, 'привет');
  assert.equal(word.stress, 'приве́т');
  assert.equal(s.words.length, 6);
  assert.equal(s.units.at(-1).id, 'custom');
  assert.throws(() => s.addCustomWord({ ru: 'ДОМ', zh: '房子' }, T0), /已有/);
  s.deleteCustomWord(word.id, T0);
  assert.equal(s.words.length, 5);
  assert.equal(s.customWords.length, 0);
});

test('mergeRemote：远端更新覆盖本地，本地独有标记推送', async () => {
  const { s } = await makeStore(T0);
  s.grade('u01-001', 2, T0);
  s.grade('u01-002', 2, T0);
  const remote = s.exportPayload();
  remote.cards['u01-001'].interval = 30;
  remote.cards['u01-001'].updatedAt = T0 + 5000;
  delete remote.cards['u01-002'];
  remote.updatedAt = T0 + 5000;
  const r = s.mergeRemote(remote);
  assert.equal(r.merged, true);
  assert.equal(r.remoteChanged, true);
  assert.equal(r.localChanged, true);
  assert.equal(s.cardOf('u01-001').interval, 30);
  assert.ok(s.cardOf('u01-002'));
});

test('mergeRemote：本地更新不丢，设置与统计逐项取新', async () => {
  const { s } = await makeStore(T0);
  s.grade('u01-001', 2, T0);
  s.setSettings({ newPerDay: 30 }, T0 + 1000);
  const remote = s.exportPayload();
  remote.settings = { ...remote.settings, newPerDay: 5, updatedAt: T0 };
  remote.cards = {};
  remote.stats = { days: {} };
  const r = s.mergeRemote(remote);
  assert.equal(r.localChanged, true);
  assert.equal(s.settings.newPerDay, 30);
  assert.equal(s.cardOf('u01-001').reps, 1);
});

test('mergeRemote：墓碑删除生效', async () => {
  const { s, storage } = await makeStore(T0);
  const word = s.addCustomWord({ ru: 'кот', zh: '猫' }, T0);
  const remote = s.exportPayload();
  remote.customWords = remote.customWords.map((x) => (x.id === word.id ? { ...x, deleted: true, updatedAt: T0 + 1000 } : x));
  s.mergeRemote(remote);
  assert.equal(s.words.length, 5);
  assert.equal(s.customWords.length, 0);
  s.flush();
  const s2 = createStore({ storage, now: () => T0 + 2000 });
  await s2.init({ words: WORDS, fetchImpl: null });
  assert.equal(s2.customWords.length, 0);
});

test('resetProgress 后词回到新词，远端旧进度不会复活', async () => {
  const { s } = await makeStore(T0);
  s.grade('u01-001', 2, T0);
  const oldRemote = s.exportPayload();
  s.resetProgress(T0 + 1000);
  assert.equal(s.statusOf('u01-001', T0 + 1000), 'new');
  assert.equal(s.newIds(T0 + 1000).length, 5);
  s.mergeRemote(oldRemote);
  assert.equal(s.statusOf('u01-001', T0 + 1000), 'new');
  assert.equal(s.newIds(T0 + 1000).length, 5);
  assert.deepEqual(s.todayStat(T0 + 1000), { new: 0, review: 0, correct: 0, wrong: 0 });
});

test('summary 统计与连续天数', async () => {
  const { s } = await makeStore(T0);
  s.grade('u01-001', 2, T0);
  s.grade('u01-002', 3, T0);
  const sum = s.summary(T0);
  assert.equal(sum.total, 5);
  assert.equal(sum.learned, 2);
  assert.equal(sum.streak, 1);
  assert.equal(sum.accuracy7d, 1);
  assert.equal(sum.last7.length, 7);
  assert.equal(sum.heatmap.length, 30);
  assert.equal(dayKey(T0), '2026-10-24');
});

test('export → import merge 往返一致', async () => {
  const { s } = await makeStore(T0);
  s.grade('u01-001', 2, T0);
  const payload = s.exportPayload();
  const { s: fresh } = await makeStore(T0);
  fresh.importPayload(payload, 'merge', T0);
  assert.equal(fresh.cardOf('u01-001').reps, 1);
  assert.equal(fresh.stats.days[dayKey(T0)].new, 1);
});
