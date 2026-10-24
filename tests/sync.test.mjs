// GitHub 同步单测：用注入的 fetchImpl 模拟 GitHub Contents API。
// 运行：node tests/sync.test.mjs（不要用 node --test，本机沙箱会 EPERM）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncClient, maskToken } from '../public/js/sync.js';
import { createStore } from '../public/js/store.js';

const T0 = new Date('2026-10-24T10:00:00+08:00').getTime();
const TOKEN = 'ghp_testtoken_0123456789abcdef';
const CFG = {
  owner: 'me',
  repo: 'vocab',
  branch: 'main',
  path: 'russian-vocab/progress.json',
  token: TOKEN,
};

const WORDS = {
  version: 1,
  units: [
    {
      id: 'u01',
      title: '第1单元',
      titleRu: 'Первый',
      level: 'A1',
      words: [
        { id: 'u01-001', ru: 'дом', stress: 'дом', tr: 'dom', zh: '房子', pos: '名词', gender: 'м', level: 1, example: { ru: 'Это дом.', zh: '这是房子。' } },
        { id: 'u01-002', ru: 'стол', stress: 'сто́л', tr: 'stol', zh: '桌子', pos: '名词', gender: 'м', level: 2, example: { ru: 'Тут стол.', zh: '这里有一张桌子。' } },
      ],
    },
  ],
};

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => map,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const limit = timeoutMs || 1500;
  const start = Date.now();
  for (;;) {
    if (predicate()) return true;
    if (Date.now() - start > limit) throw new Error('waitFor 超时');
    await sleep(10);
  }
}

function b64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

class FakeGitHub {
  constructor() {
    this.owner = CFG.owner;
    this.repo = CFG.repo;
    this.branch = CFG.branch;
    this.path = CFG.path;
    this.file = null;
    this.repoStatus = 200;
    this.branchStatus = 200;
    this.putFailures = [];
    this.networkFailures = 0;
    this.delayMs = 0;
    this.calls = [];
    this.active = 0;
    this.maxActive = 0;
    this.shaSeq = 0;
    this.fetch = async (url, init) => {
      const options = init || {};
      const method = String(options.method || 'GET').toUpperCase();
      let body = null;
      if (options.body) {
        try {
          body = JSON.parse(options.body);
        } catch (err) {
          body = null;
        }
      }
      this.calls.push({ method, url, init: options, body });
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        if (this.delayMs > 0) await sleep(this.delayMs);
        if (this.networkFailures > 0) {
          this.networkFailures -= 1;
          throw new TypeError('Failed to fetch');
        }
        return this.route(method, new URL(url), options);
      } finally {
        this.active -= 1;
      }
    };
  }

  route(method, url, options) {
    const repoPath = '/repos/' + this.owner + '/' + this.repo;
    if (url.pathname === repoPath) {
      if (this.repoStatus !== 200) {
        const message = this.repoStatus === 401 ? 'Bad credentials' : this.repoStatus === 403 ? 'Forbidden' : 'Not Found';
        return response(this.repoStatus, { message });
      }
      return response(200, { full_name: this.owner + '/' + this.repo, permissions: { push: true } });
    }
    if (url.pathname === repoPath + '/branches/' + this.branch) {
      return response(this.branchStatus === 404 ? 404 : 200, this.branchStatus === 200 ? { name: this.branch } : { message: 'Branch not found' });
    }
    if (url.pathname === repoPath + '/contents/' + this.path) {
      if (method === 'GET') {
        if (!this.file) return response(404, { message: 'Not Found' });
        return response(200, {
          name: 'progress.json',
          path: this.path,
          sha: this.file.sha,
          size: Buffer.byteLength(this.file.text, 'utf8'),
          content: b64(this.file.text),
          encoding: 'base64',
        });
      }
      if (method === 'PUT') return this.put(options);
    }
    return response(404, { message: 'Not Found' });
  }

  put(options) {
    const body = JSON.parse(options.body || '{}');
    const failure = this.putFailures.shift();
    if (failure) {
      if (failure.remote) this.file = failure.remote;
      return response(failure.status, { message: failure.message || 'conflict' });
    }
    if (this.file && !body.sha) return response(409, { message: 'sha is required' });
    if (this.file && body.sha !== this.file.sha) return response(409, { message: 'sha does not match' });
    this.shaSeq += 1;
    this.file = { text: Buffer.from(String(body.content || ''), 'base64').toString('utf8'), sha: 'sha' + this.shaSeq };
    return response(200, { content: { sha: this.file.sha, path: this.path } });
  }
}

async function makeStore(now) {
  const t = now || T0;
  const storage = memStorage();
  const store = createStore({ storage, now: () => t });
  await store.init({ words: WORDS, fetchImpl: null });
  store.setDeviceName('测试设备A');
  return { store, storage };
}

function seedConfig(storage) {
  storage.setItem('rv.sync.cfg', JSON.stringify(CFG));
}

function makeClient(storage, gh, extra) {
  return new SyncClient({
    storage,
    fetchImpl: gh.fetch,
    now: () => T0,
    debounceMs: 100000,
    retryMs: 100000,
    ...(extra || {}),
  });
}

function baseRemote(overrides) {
  const base = {
    schema: 1,
    updatedAt: 0,
    cards: {},
    customWords: [],
    settings: {
      newPerDay: 15,
      reviewPerDay: 80,
      autoAudio: true,
      showTranslit: true,
      showExample: true,
      theme: 'auto',
      updatedAt: 0,
    },
    stats: { days: {} },
    meta: { resetAt: 0 },
  };
  return Object.assign(base, overrides || {});
}

function jsonFile(payload, sha) {
  return { text: JSON.stringify(payload, null, 2), sha };
}

function cleanUp(t, client) {
  t.after(() => {
    try {
      client.disconnect();
    } catch (err) {
      // 忽略清理异常
    }
  });
}

// ---------------------------------------------------------------------------

test('初次 pull 404：远端没有文件不报错，本地为空不推送', async (t) => {
  const { store, storage } = await makeStore();
  const gh = new FakeGitHub();
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);

  const st = await client.init(store);
  assert.equal(st.configured, true);
  assert.equal(st.state, 'ok');
  assert.equal(st.lastError, null);
  assert.equal(st.pending, false);
  assert.equal(gh.calls.filter((c) => c.method === 'PUT').length, 0);
  assert.equal(gh.calls.filter((c) => c.method === 'GET' && c.url.includes('/contents/')).length, 1);
});

test('pull 404 且本地有进度：标记 pending，随后 push 创建远端文件', async (t) => {
  const { store, storage } = await makeStore();
  const gh = new FakeGitHub();
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);

  await client.init(store);
  store.grade('u01-001', 2, T0);
  const stPulled = await client.pull();
  assert.equal(stPulled.pending, true);
  assert.equal(stPulled.state, 'ok');

  const stPushed = await client.push();
  assert.equal(stPushed.state, 'ok');
  assert.equal(stPushed.pending, false);
  assert.ok(gh.file, 'push 后远端应存在文件');
  const saved = JSON.parse(gh.file.text);
  assert.equal(saved.cards['u01-001'].reps, 1);
  assert.equal(store.meta.lastSyncAt, T0);
  assert.equal(stPushed.lastSyncAt, T0);
});

test('pull 合并远端较新卡片（真实 store.mergeRemote）', async (t) => {
  const { store, storage } = await makeStore();
  store.grade('u01-001', 2, T0);
  store.grade('u01-002', 2, T0);
  const remote = store.exportPayload();
  remote.cards['u01-001'] = { ...remote.cards['u01-001'], interval: 42, reps: 7, updatedAt: T0 + 5000 };
  remote.updatedAt = T0 + 5000;

  const gh = new FakeGitHub();
  gh.file = jsonFile(remote, 'sha-remote');
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);

  const st = await client.init(store);
  assert.equal(st.state, 'ok');
  assert.equal(st.lastError, null);
  assert.equal(store.cardOf('u01-001').interval, 42);
  assert.equal(store.cardOf('u01-001').reps, 7);
  assert.equal(store.cardOf('u01-002').reps, 1);
  assert.equal(gh.calls.filter((c) => c.method === 'PUT').length, 0, '本地没有领先数据时不应推送');
});

test('push 带 sha、UTF-8 中文/俄语往返、提交信息与请求头', async (t) => {
  const { store, storage } = await makeStore();
  const word = store.addCustomWord(
    { ru: 'приве́т', zh: '你好；嗨', tr: 'privet', pos: '感叹词', example: { ru: 'Привет, мир!', zh: '你好，世界！' } },
    T0,
  );
  store.grade('u01-001', 2, T0);

  const gh = new FakeGitHub();
  gh.file = jsonFile(baseRemote(), 'sha-base');
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);
  await client.init(store);

  const st = await client.push();
  assert.equal(st.state, 'ok');
  assert.equal(st.pending, false);

  const put = gh.calls.find((c) => c.method === 'PUT');
  assert.ok(put, '应发出 PUT 请求');
  assert.equal(put.body.sha, 'sha-base');
  assert.deepEqual(Object.keys(put.init.headers).sort(), ['Accept', 'Authorization', 'Content-Type']);
  assert.equal(put.init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(put.init.headers.Accept, 'application/vnd.github+json');
  assert.match(put.body.message, /^sync: 测试设备A \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  const decoded = JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8'));
  assert.deepEqual(decoded, store.exportPayload());
  const custom = decoded.customWords.find((w) => w.id === word.id);
  assert.equal(custom.ru, 'привет');
  assert.equal(custom.stress, 'приве́т');
  assert.equal(custom.zh, '你好；嗨');
  assert.ok(gh.file.text.includes('приве́т'), '远端文件应保留俄语原文（UTF-8）');
  assert.ok(!gh.file.text.includes(TOKEN), '导出负载不能包含 token');
  assert.equal(store.meta.lastSyncAt, T0);
});

test('push 409 冲突：GET 最新 + mergeRemote + 新 sha 重试成功', async (t) => {
  const { store, storage } = await makeStore();
  store.grade('u01-001', 2, T0);

  const remote1 = baseRemote({
    updatedAt: T0 + 1000,
    cards: {
      'u01-002': { ease: 2.5, interval: 10, due: T0 + 1000, reps: 3, lapses: 0, correct: 3, wrong: 0, last: T0, updatedAt: T0 + 1000 },
    },
  });
  const remote2 = baseRemote({
    updatedAt: T0 + 2000,
    cards: {
      'u01-002': { ease: 2.5, interval: 20, due: T0 + 2000, reps: 4, lapses: 0, correct: 4, wrong: 0, last: T0, updatedAt: T0 + 2000 },
    },
    settings: {
      newPerDay: 25,
      reviewPerDay: 80,
      autoAudio: true,
      showTranslit: true,
      showExample: true,
      theme: 'auto',
      updatedAt: T0 + 2000,
    },
  });

  const gh = new FakeGitHub();
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);
  await client.init(store); // 远端还没文件 → 404

  gh.file = jsonFile(remote1, 'sha-old');
  gh.putFailures = [{ status: 409, message: 'sha does not match', remote: jsonFile(remote2, 'sha-new') }];

  const st = await client.push();
  assert.equal(st.state, 'ok');
  assert.equal(st.pending, false);

  const puts = gh.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2, '冲突后应重试一次 PUT');
  assert.equal(puts[0].body.sha, 'sha-old');
  assert.equal(puts[1].body.sha, 'sha-new');

  assert.equal(store.cardOf('u01-001').reps, 1, '本地卡片不能丢');
  assert.equal(store.cardOf('u01-002').interval, 20, '远端较新卡片要合并进来');
  assert.equal(store.settings.newPerDay, 25);
  const saved = JSON.parse(gh.file.text);
  assert.ok(saved.cards['u01-001'], '最终远端包含本地卡片');
  assert.equal(saved.cards['u01-002'].interval, 20);
});

test('base64 UTF-8 往返：pull 中文/俄语不出现乱码', async (t) => {
  const { store, storage } = await makeStore();
  const remote = baseRemote({
    customWords: [
      {
        id: 'c-test1',
        ru: 'книга',
        stress: 'кни́га',
        tr: 'kniga',
        zh: '书；书籍',
        pos: '名词',
        gender: 'ж',
        level: 2,
        example: { ru: 'Это книга.', zh: '这是一本书。' },
        custom: true,
        createdAt: T0,
        updatedAt: T0,
        tags: ['自定义'],
      },
    ],
  });
  const gh = new FakeGitHub();
  gh.file = jsonFile(remote, 'sha-utf8');
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);

  await client.init(store);
  assert.equal(store.customWords.length, 1);
  assert.equal(store.customWords[0].ru, 'книга');
  assert.equal(store.customWords[0].stress, 'кни́га');
  assert.equal(store.customWords[0].zh, '书；书籍');
  assert.equal(store.word('c-test1').example.zh, '这是一本书。');

  store.setSettings({ theme: 'dark' }, T0 + 50);
  await client.push();
  const decoded = JSON.parse(gh.file.text);
  assert.equal(decoded.customWords[0].ru, 'книга');
  assert.equal(decoded.customWords[0].zh, '书；书籍');
  assert.equal(decoded.settings.theme, 'dark');
});

test('配置校验：空字段 / 401 / 403 / 404 均为中文错误且不泄漏 token', async (t) => {
  const storage = memStorage();
  const gh = new FakeGitHub();
  const client = new SyncClient({ storage, fetchImpl: gh.fetch, now: () => T0, debounceMs: 100000, retryMs: 100000 });
  cleanUp(t, client);

  await assert.rejects(() => client.configure({ ...CFG, owner: '' }), /owner|用户名/);
  await assert.rejects(() => client.configure({ ...CFG, repo: '' }), /仓库名/);
  await assert.rejects(() => client.configure({ ...CFG, branch: '' }), /分支/);
  await assert.rejects(() => client.configure({ ...CFG, path: '' }), /路径/);
  await assert.rejects(() => client.configure({ ...CFG, token: '' }), /Token/);
  assert.equal(client.isConfigured(), false);
  assert.equal(client.status().configured, false);
  assert.ok(!JSON.stringify(client.status()).includes(TOKEN));

  gh.repoStatus = 401;
  let err = await client.configure(CFG).then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /Token 无效|401/);
  assert.ok(!err.message.includes(TOKEN), '401 错误信息不能包含完整 token');
  assert.equal(client.status().state, 'error');

  gh.repoStatus = 403;
  err = await client.configure(CFG).then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /403/);
  assert.ok(!err.message.includes(TOKEN));

  gh.repoStatus = 404;
  err = await client.configure(CFG).then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /404|不存在|无权/);
  assert.ok(!err.message.includes(TOKEN));

  // 网络层异常信息里带 token（模拟底层库拼接），也必须打码
  const leaky = new SyncClient({
    storage: memStorage(),
    now: () => T0,
    fetchImpl: async () => {
      throw new Error('boom ' + TOKEN);
    },
  });
  err = await leaky.configure(CFG).then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /网络错误/);
  assert.ok(!err.message.includes(TOKEN), '网络错误信息不能包含完整 token');
  assert.ok(err.message.includes('****'), 'token 应被打码');
  leaky.disconnect();
});

test('仓库为空 / 分支不存在：configure 给出中文提示', async (t) => {
  const storage = memStorage();
  const gh = new FakeGitHub();
  gh.branchStatus = 404;
  const client = new SyncClient({ storage, fetchImpl: gh.fetch, now: () => T0, debounceMs: 100000, retryMs: 100000 });
  cleanUp(t, client);
  const err = await client.configure(CFG).then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /仓库为空或分支不存在/);
  assert.match(err.message, /README/);
  assert.equal(client.isConfigured(), false);
});

test('并发保护：同时 push 两次串行执行', async (t) => {
  const { store, storage } = await makeStore();
  store.grade('u01-001', 2, T0);
  const gh = new FakeGitHub();
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);
  await client.init(store); // 404

  gh.file = jsonFile(baseRemote(), 'sha-0');
  gh.delayMs = 15;
  await Promise.all([client.push(), client.push()]);
  assert.equal(gh.calls.filter((c) => c.method === 'PUT').length, 2);
  assert.equal(gh.maxActive, 1, '同一时刻只允许一个请求在跑（pull/push 排队）');
  assert.equal(client.status().state, 'ok');
});

test('本地变更触发防抖自动推送', async (t) => {
  const { store, storage } = await makeStore();
  const gh = new FakeGitHub();
  seedConfig(storage);
  const client = makeClient(storage, gh, { debounceMs: 25 });
  cleanUp(t, client);
  await client.init(store);
  assert.equal(gh.file, null);

  store.grade('u01-002', 2, T0);
  await waitFor(() => !!gh.file, 2000);
  assert.equal(client.status().state, 'ok');
  assert.equal(client.status().pending, false);
  assert.equal(gh.calls.filter((c) => c.method === 'PUT').length, 1);
  const saved = JSON.parse(gh.file.text);
  assert.equal(saved.cards['u01-002'].reps, 1);
});

test('推送失败：offline 状态 + pending 保留，恢复后可重试成功', async (t) => {
  const { store, storage } = await makeStore();
  store.grade('u01-001', 2, T0);
  const gh = new FakeGitHub();
  seedConfig(storage);
  const client = makeClient(storage, gh);
  cleanUp(t, client);
  await client.init(store);

  gh.networkFailures = 1;
  const err = await client.push().then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /网络/);
  let st = client.status();
  assert.equal(st.state, 'offline');
  assert.equal(st.pending, true);
  assert.equal(typeof st.lastError, 'string');

  st = await client.push();
  assert.equal(st.state, 'ok');
  assert.equal(st.pending, false);
  assert.ok(gh.file);
});

test('失败后自动重试（注入短 retryMs）', async (t) => {
  const { store, storage } = await makeStore();
  store.grade('u01-001', 2, T0);
  const gh = new FakeGitHub();
  seedConfig(storage);
  const client = makeClient(storage, gh, { retryMs: 30 });
  cleanUp(t, client);
  await client.init(store);

  gh.networkFailures = 1;
  await assert.rejects(() => client.push(), /网络/);
  await waitFor(() => client.status().state === 'ok' && !!gh.file, 2000);
  assert.equal(client.status().pending, false);
  assert.ok(gh.calls.filter((c) => c.method === 'PUT').length >= 1);
});

test('未配置：init 不拉取，status 为 idle；disconnect 清空配置', async (t) => {
  const { store, storage } = await makeStore();
  const gh = new FakeGitHub();
  const client = makeClient(storage, gh);
  cleanUp(t, client);
  const st = await client.init(store);
  assert.equal(st.configured, false);
  assert.equal(st.state, 'idle');
  assert.equal(gh.calls.length, 0);
  await assert.rejects(() => client.pull(), /尚未配置/);
  await assert.rejects(() => client.push(), /尚未配置/);

  // 配置后 disconnect 应删掉 localStorage 里的配置
  gh.file = null;
  await client.configure(CFG);
  assert.equal(client.isConfigured(), true);
  assert.equal(client.config().token, maskToken(TOKEN));
  assert.ok(!client.config().token.includes(TOKEN));
  client.disconnect();
  assert.equal(client.isConfigured(), false);
  assert.equal(storage.getItem('rv.sync.cfg'), null);
  assert.equal(client.status().state, 'idle');
});