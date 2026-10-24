import test from 'node:test';
import assert from 'node:assert/strict';
import { newCard, grade, isDue, isMastered, statusOf, formatInterval, preview, checkAnswer, normalizeAnswer, DAY_MS, LEARN_MS, MIN_EASE, MAX_INTERVAL } from '../public/js/srs.js';

const T0 = 1700000000000;

test('newCard 初始状态', () => {
  const c = newCard(T0);
  assert.equal(c.reps, 0);
  assert.equal(c.interval, 0);
  assert.equal(statusOf(c), 'new');
  assert.equal(c.ease, 2.5);
});

test('首次 grade 记得 → 1 天', () => {
  const c = grade(newCard(T0), 2, T0);
  assert.equal(c.reps, 1);
  assert.equal(c.interval, 1);
  assert.equal(c.due, T0 + DAY_MS);
  assert.equal(c.correct, 1);
  assert.equal(statusOf(c), 'review');
});

test('grade 不修改入参', () => {
  const c = newCard(T0);
  const snapshot = JSON.stringify(c);
  grade(c, 2, T0);
  assert.equal(JSON.stringify(c), snapshot);
});

test('记得 → 间隔按 ease 增长', () => {
  let c = grade(newCard(T0), 2, T0);
  c = grade(c, 2, T0 + DAY_MS);
  assert.equal(c.interval, 2.5);
  c = grade(c, 2, T0 + 3 * DAY_MS);
  assert.equal(c.interval, 6.25);
});

test('忘记 → 10 分钟并增加 lapses', () => {
  let c = grade(newCard(T0), 2, T0);
  c = grade(c, 0, T0 + DAY_MS);
  assert.equal(c.lapses, 1);
  assert.ok(Math.abs(c.interval - LEARN_MS / DAY_MS) < 1e-9);
  assert.equal(c.due, T0 + DAY_MS + LEARN_MS);
  assert.equal(statusOf(c), 'learning');
});

test('简单 首次 → 3 天，ease 提升', () => {
  const c = grade(newCard(T0), 3, T0);
  assert.equal(c.interval, 3);
  assert.ok(c.ease > 2.5);
});

test('ease 下限 1.3', () => {
  let c = newCard(T0);
  for (let i = 0; i < 20; i++) c = grade(c, 0, T0 + i * DAY_MS);
  assert.ok(Math.abs(c.ease - MIN_EASE) < 1e-9);
});

test('间隔上限 365 天', () => {
  let c = newCard(T0);
  for (let i = 0; i < 40; i++) c = grade(c, 3, T0 + i * DAY_MS);
  assert.ok(c.interval <= MAX_INTERVAL);
});

test('isDue 到期判断', () => {
  const c = grade(newCard(T0), 2, T0);
  assert.equal(isDue(c, T0 + 1), false);
  assert.equal(isDue(c, T0 + DAY_MS), true);
});

test('isMastered 需要 21 天以上', () => {
  const c = { ...newCard(T0), reps: 6, interval: 21, ease: 2.5, lapses: 0 };
  assert.equal(isMastered(c), true);
  assert.equal(isMastered({ ...c, lapses: 5 }), false);
  assert.equal(statusOf(c), 'mastered');
});

test('formatInterval 文案', () => {
  assert.equal(formatInterval(10 / 1440), '10 分钟');
  assert.equal(formatInterval(1), '1 天');
  assert.equal(formatInterval(6.25), '6 天');
  assert.equal(formatInterval(45), '2 个月');
  assert.equal(formatInterval(400), '1 年');
});

test('preview 给按钮文案', () => {
  const c = newCard(T0);
  assert.equal(preview(c, 0, T0), '10 分钟');
  assert.equal(preview(c, 2, T0), '1 天');
  assert.equal(preview(c, 3, T0), '3 天');
});

test('拼写判分：ё/重音/大小写/标点都不影响', () => {
  const w = { ru: 'семья', stress: 'семья́' };
  assert.equal(checkAnswer('семья', w), true);
  assert.equal(checkAnswer('СЕМЬЯ', w), true);
  assert.equal(checkAnswer('семья.', w), true);
  assert.equal(checkAnswer('семя', w), false);
  assert.equal(checkAnswer('', w), false);
  assert.equal(normalizeAnswer('Приве́т!'), 'привет');
});
