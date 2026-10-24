// GitHub 同步客户端：用私有仓库当后端（GitHub Contents API）。
// 契约见 docs/CONTRACT.md 第 6 节；用户配置与排错见 docs/GITHUB-SYNC.md。
// 纯 ESM，无 npm 依赖；单测通过构造参数注入 storage / fetchImpl / now。
//
// 合并语义完全交给 store.mergeRemote：逐卡、逐自定义词、逐日统计、设置都按 updatedAt
// 取新（LWW），删除用 deleted:true 墓碑；本模块只负责搬运、并发控制、重试与状态。

const CFG_KEY = 'rv.sync.cfg';
const API_BASE = 'https://api.github.com';
const DEFAULT_DEBOUNCE_MS = 4000;
const DEFAULT_RETRY_MS = 60000;
const MAX_PUSH_ATTEMPTS = 3;
const MAX_AUTO_RETRIES = 3;

export const DEFAULT_BRANCH = 'main';
export const DEFAULT_PATH = 'russian-vocab/progress.json';

export class SyncError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'SyncError';
    const o = options || {};
    this.code = o.code || '';
    this.offline = !!o.offline;
  }
}

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

function trim(v) {
  return str(v).trim();
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** 时间戳 → 'YYYY-MM-DD HH:mm'（本地时间），用于状态行与提交信息。 */
export function formatSyncTime(t) {
  const d = new Date(num(t, 0));
  if (!Number.isFinite(d.getTime()) || d.getTime() <= 0) return '';
  return (
    d.getFullYear() +
    '-' + pad2(d.getMonth() + 1) +
    '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) +
    ':' + pad2(d.getMinutes())
  );
}

/** Token 打码：只保留末 4 位，绝不返回完整 token。 */
export function maskToken(token) {
  const s = str(token);
  if (!s) return '';
  if (s.length <= 8) return '****';
  return '****' + s.slice(-4);
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function decodeBase64Utf8(text) {
  const clean = String(text || '').replace(/\s+/g, '');
  let bytes;
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    bytes = Uint8Array.from(Buffer.from(clean, 'base64'));
  } else {
    const bin = atob(clean);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch (err) {
    return null;
  }
}

function encodePath(path) {
  return String(path)
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const owner = trim(raw.owner);
  const repo = trim(raw.repo);
  const token = trim(raw.token);
  if (!owner || !repo || !token) return null;
  let path = trim(raw.path) || DEFAULT_PATH;
  path = path.replace(/^\/+/, '');
  return {
    owner,
    repo,
    branch: trim(raw.branch) || DEFAULT_BRANCH,
    path,
    token,
  };
}

function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new SyncError('同步配置不完整');
  const owner = trim(raw.owner);
  const repo = trim(raw.repo);
  const branch = trim(raw.branch);
  let path = trim(raw.path);
  const token = trim(raw.token);
  if (!owner) throw new SyncError('请填写 GitHub 用户名或组织名（owner）');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-_.]*[A-Za-z0-9])?$/.test(owner)) {
    throw new SyncError('GitHub 用户名 / 组织名格式不正确（只能包含字母、数字、- _ .）');
  }
  if (!repo) throw new SyncError('请填写仓库名（repo）');
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) {
    throw new SyncError('仓库名格式不正确（只能包含字母、数字、- _ .）');
  }
  if (!branch) throw new SyncError('请填写分支名（branch），通常是 main');
  if (/[\s~^:?*\[\\]/.test(branch) || branch.includes('..')) {
    throw new SyncError('分支名包含非法字符');
  }
  if (!path) throw new SyncError('请填写远端文件路径，例如 russian-vocab/progress.json');
  path = path.replace(/^\/+/, '');
  if (!path) throw new SyncError('请填写远端文件路径，例如 russian-vocab/progress.json');
  if (path.includes('..')) throw new SyncError('文件路径不能包含 ..');
  if (/[\u0000-\u001f]/.test(path)) throw new SyncError('文件路径包含非法字符');
  if (!token) throw new SyncError('请填写 Personal Access Token');
  return { owner, repo, branch, path, token };
}

export class SyncClient {
  constructor(options) {
    const o = options || {};
    this._storage = o.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this._fetch =
      typeof o.fetchImpl === 'function'
        ? o.fetchImpl
        : typeof fetch === 'function'
          ? fetch.bind(globalThis)
          : null;
    this._now = typeof o.now === 'function' ? o.now : () => Date.now();
    this._debounceMs = Number.isFinite(o.debounceMs) ? o.debounceMs : DEFAULT_DEBOUNCE_MS;
    this._retryMs = Number.isFinite(o.retryMs) ? o.retryMs : DEFAULT_RETRY_MS;

    this._store = null;
    this._cfg = null;
    this._token = '';
    this._state = 'idle';
    this._lastSyncAt = 0;
    this._lastError = null;
    this._pending = false;
    this._syncing = false;
    this._queue = Promise.resolve();
    this._listeners = new Set();
    this._timer = null;
    this._retryTimer = null;
    this._retryCount = 0;
    this._unsubscribeStore = null;
    this._lifecycle = null;
  }

  // ---------- 对外 API ----------

  /** 绑定 store：读配置、订阅本地变更、注册在线/可见性事件。已配置则先拉取合并。 */
  async init(store) {
    if (!store || typeof store.mergeRemote !== 'function' || typeof store.exportPayload !== 'function') {
      throw new SyncError('sync.init 需要传入 store');
    }
    this._store = store;
    this._lastSyncAt = num(store.meta && store.meta.lastSyncAt, this._lastSyncAt);
    this._readConfig();
    this._token = this._cfg ? this._cfg.token : '';

    if (this._unsubscribeStore) {
      this._unsubscribeStore();
      this._unsubscribeStore = null;
    }
    if (typeof store.onSyncNeeded === 'function') {
      this._unsubscribeStore = store.onSyncNeeded(() => this.schedulePush());
    }
    this._bindLifecycle();

    if (!this._cfg) {
      this._state = 'idle';
      this._notify();
      return this.status();
    }
    try {
      await this.pull();
    } catch (err) {
      // 应用启动不因同步失败而中断；状态已记录，可稍后重试。
    }
    return this.status();
  }

  /** 校验并保存配置，随后立即拉取一次。失败抛中文可读错误（不发网络请求前已完成本地校验）。 */
  async configure(input) {
    if (!this._fetch) throw new SyncError('当前环境不支持网络请求（fetch 不可用），无法配置同步');
    let cfg;
    try {
      cfg = validateConfig(input);
    } catch (err) {
      const e = err instanceof SyncError ? err : new SyncError(str(err && err.message) || '同步配置不完整');
      this._lastError = e.message;
      this._state = 'error';
      this._notify();
      throw e;
    }

    this._token = cfg.token;
    this._state = 'syncing';
    this._lastError = null;
    this._notify();
    try {
      await this._verifyRepo(cfg);
      await this._verifyBranch(cfg);
    } catch (err) {
      const e = this._asSyncError(err);
      this._recordFailure(e, { retry: false });
      throw e;
    }

    try {
      this._saveConfig(cfg);
    } catch (err) {
      this._cfg = null;
      const e = new SyncError('无法保存同步配置：浏览器本地存储不可用或已满');
      this._recordFailure(e, { retry: false });
      throw e;
    }
    this._cfg = cfg;
    this._retryCount = 0;
    this._clearRetryTimer();
    this._pending = false;
    this._lastError = null;
    this._state = 'idle';
    this._notify();

    try {
      await this.pull();
    } catch (err) {
      // 配置已保存；拉取失败的状态已记录，面板里可点「立即同步」重试。
    }
    return this.status();
  }

  /** 断开：删配置、清定时器、回到 idle。本机学习进度保留。 */
  disconnect() {
    this._cfg = null;
    this._token = '';
    if (this._storage) {
      try {
        this._storage.removeItem(CFG_KEY);
      } catch (err) {
        // 存储不可用时忽略
      }
    }
    this._clearPushTimer();
    this._clearRetryTimer();
    this._retryCount = 0;
    this._pending = false;
    this._lastError = null;
    this._state = 'idle';
    this._notify();
    return this.status();
  }

  /** 拉远端 → store.mergeRemote → 本地领先则推送。 */
  async pull() {
    this._requireConfigured();
    await this._runExclusive(() => this._pullInner());
    return this.status();
  }

  /** 立即推送（内部处理 409 → 重拉合并 → 重试）。 */
  async push() {
    this._requireConfigured();
    await this._runExclusive(() => this._pushInner());
    return this.status();
  }

  /** 防抖推送：本地每次变更都会调用；页面隐藏时立即推送。 */
  schedulePush() {
    if (!this._cfg || !this._store) return;
    this._pending = true;
    this._notify();
    if (this._isHidden()) {
      this._flushPushNow();
      return;
    }
    this._clearPushTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flushPushNow();
    }, this._debounceMs);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }

  status() {
    return {
      configured: !!this._cfg,
      state: this._state,
      lastSyncAt: this._lastSyncAt,
      lastError: this._lastError,
      error: this._lastError, // 兼容 CONTRACT 第 6 节的 error 字段名
      pending: this._pending,
    };
  }

  /** 配置摘要（token 已打码，可安全展示）。 */
  config() {
    if (!this._cfg) return null;
    return {
      owner: this._cfg.owner,
      repo: this._cfg.repo,
      branch: this._cfg.branch,
      path: this._cfg.path,
      token: maskToken(this._cfg.token),
    };
  }

  isConfigured() {
    return !!this._cfg;
  }

  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  // ---------- 内部：配置 / 生命周期 ----------

  _readConfig() {
    this._cfg = null;
    if (!this._storage) return;
    let raw = null;
    try {
      raw = this._storage.getItem(CFG_KEY);
    } catch (err) {
      return;
    }
    if (!raw) return;
    try {
      this._cfg = normalizeConfig(JSON.parse(raw));
    } catch (err) {
      this._cfg = null;
    }
  }

  _saveConfig(cfg) {
    if (!this._storage) throw new Error('没有可用的本地存储');
    this._storage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  _bindLifecycle() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    if (this._lifecycle) return;
    const onOnline = () => this._resume('online');
    const onVisibility = () => {
      if (this._isHidden()) {
        if (this._pending) this._flushPushNow();
      } else {
        this._resume('visible');
      }
    };
    window.addEventListener('online', onOnline);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    this._lifecycle = { onOnline, onVisibility };
  }

  _unbindLifecycle() {
    if (!this._lifecycle || typeof window === 'undefined') return;
    window.removeEventListener('online', this._lifecycle.onOnline);
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._lifecycle.onVisibility);
    }
    this._lifecycle = null;
  }

  _isHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  async _resume(reason) {
    if (!this._cfg || !this._store) return;
    try {
      await this.pull();
      if (this._pending) await this.push();
    } catch (err) {
      // 状态已记录；在线事件可能重复触发，不额外提示。
    }
  }

  // ---------- 内部：状态 ----------

  _setState(state) {
    this._state = state;
    this._notify();
  }

  _notify() {
    if (this._listeners.size === 0) return;
    const st = this.status();
    for (const fn of Array.from(this._listeners)) {
      try {
        fn(st);
      } catch (err) {
        // 订阅者自身异常不应影响同步
      }
    }
  }

  _clean(text) {
    let out = String(text == null ? '' : text);
    const token = this._token;
    if (token && token.length >= 4 && out.includes(token)) {
      out = out.split(token).join(maskToken(token));
    }
    return out;
  }

  _asSyncError(err) {
    if (err instanceof SyncError) {
      return new SyncError(this._clean(err.message), { code: err.code, offline: err.offline });
    }
    const msg = err && err.message ? err.message : '未知错误';
    return new SyncError(this._clean('同步失败：' + msg));
  }

  _recordFailure(err, options) {
    const e = err instanceof SyncError ? err : this._asSyncError(err);
    this._lastError = this._clean(e.message);
    this._state = e.offline ? 'offline' : 'error';
    const retry = !options || options.retry !== false;
    const blocked =
      e.code === 'empty-repo' || e.code === 'unauthorized' || e.code === 'forbidden' || e.code === 'not-found';
    if (retry && (e.offline || !blocked)) this._scheduleRetry();
    this._notify();
  }

  _clearPushTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _clearRetryTimer() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  _scheduleRetry() {
    if (!this._cfg) return;
    if (this._retryCount >= MAX_AUTO_RETRIES) return;
    if (this._retryTimer) return;
    this._retryCount += 1;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._pending = true;
      this.push().catch(() => {
        // 状态已由 push 内部记录；重试次数用尽后不再调度。
      });
    }, this._retryMs);
    if (this._retryTimer && typeof this._retryTimer.unref === 'function') this._retryTimer.unref();
  }

  _flushPushNow() {
    this._clearPushTimer();
    this.push().catch(() => {
      // 失败状态已记录，保留 pending，稍后自动重试
    });
  }

  // ---------- 内部：并发 ----------

  _runExclusive(task) {
    const run = async () => {
      this._syncing = true;
      this._setState('syncing');
      try {
        return await task();
      } finally {
        this._syncing = false;
      }
    };
    const result = this._queue.then(run, run);
    this._queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  _requireConfigured() {
    if (!this._cfg) throw new SyncError('尚未配置 GitHub 同步：请先填写仓库与 Token');
  }

  _authHeaders(cfg, withBody) {
    const headers = {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
    };
    if (withBody) headers['Content-Type'] = 'application/json';
    return headers;
  }

  _contentsUrl(cfg, withRef) {
    const base =
      API_BASE +
      '/repos/' + encodeURIComponent(cfg.owner) +
      '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + encodePath(cfg.path);
    return withRef ? base + '?ref=' + encodeURIComponent(cfg.branch) : base;
  }

  async _request(url, init) {
    try {
      return await this._fetch(url, init);
    } catch (err) {
      const detail = err && err.message ? '（' + err.message + '）' : '';
      throw new SyncError(
        this._clean('网络错误：无法连接 GitHub' + detail + '，请检查网络后重试'),
        { code: 'offline', offline: true },
      );
    }
  }

  _responseError(res, body, action) {
    const status = res.status;
    const apiMsg = body && typeof body.message === 'string' ? body.message : '';
    const suffix = apiMsg ? '（' + apiMsg + '）' : '';
    if (status === 401) {
      return new SyncError('Token 无效或已过期（401）：请到 GitHub 重新生成 Token 后重新连接', { code: 'unauthorized' });
    }
    if (status === 403) {
      let remaining = null;
      try {
        if (res.headers && typeof res.headers.get === 'function') remaining = res.headers.get('x-ratelimit-remaining');
      } catch (err) {
        remaining = null;
      }
      if (remaining === '0') {
        return new SyncError('GitHub 接口限流（403）：请求太频繁，请等待约一小时后再试', { code: 'forbidden' });
      }
      return new SyncError(
        'GitHub 拒绝访问（403）：请确认 Token 勾选了该仓库的 Contents: Read and write 权限',
        { code: 'forbidden' },
      );
    }
    if (status === 404) {
      return new SyncError('仓库或文件不存在（404）：请检查 owner/repo、分支名和 Token 权限', { code: 'not-found' });
    }
    if (status === 409) {
      return new SyncError('同步冲突（409）：远端刚被其他设备修改，正在自动重试', { code: 'conflict' });
    }
    if (status === 422) {
      if (/branch/i.test(apiMsg) && /not found|does not exist/i.test(apiMsg)) {
        return new SyncError('仓库为空或分支不存在：请先在 GitHub 上创建 README 并提交一次', { code: 'empty-repo' });
      }
      return new SyncError(
        action + '失败：GitHub 拒绝了数据（422）' + suffix + '，请检查文件路径与分支是否匹配',
        { code: 'invalid' },
      );
    }
    if (status === 429) {
      return new SyncError('GitHub 接口限流（429）：请稍后再试', { code: 'forbidden' });
    }
    return new SyncError(action + '失败：GitHub 返回 HTTP ' + status + suffix);
  }

  // ---------- 内部：仓库 / 分支校验 ----------

  async _verifyRepo(cfg) {
    const url = API_BASE + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);
    const res = await this._request(url, {
      method: 'GET',
      headers: this._authHeaders(cfg, false),
      cache: 'no-store',
    });
    const body = await readJsonSafe(res);
    if (!res.ok) throw this._responseError(res, body, '验证仓库');
    if (body && body.permissions && body.permissions.push === false) {
      throw new SyncError('Token 只有只读权限：请把该仓库的 Contents 权限改为 Read and write', { code: 'forbidden' });
    }
    return body || {};
  }

  async _verifyBranch(cfg) {
    const url =
      API_BASE +
      '/repos/' + encodeURIComponent(cfg.owner) +
      '/' + encodeURIComponent(cfg.repo) +
      '/branches/' + encodeURIComponent(cfg.branch);
    let res;
    try {
      res = await this._request(url, {
        method: 'GET',
        headers: this._authHeaders(cfg, false),
        cache: 'no-store',
      });
    } catch (err) {
      // 仓库已通过验证；分支检查失败（如网络抖动）不阻塞配置，留给 pull/push 报错。
      return;
    }
    if (res.status === 404) {
      throw new SyncError(
        '仓库为空或分支不存在：请先在 GitHub 上创建 README 并提交一次，并确认分支名为「' + cfg.branch + '」',
        { code: 'empty-repo' },
      );
    }
  }

  // ---------- 内部：远端读写 ----------

  async _getContents(allow404) {
    const cfg = this._cfg;
    const res = await this._request(this._contentsUrl(cfg, true), {
      method: 'GET',
      headers: this._authHeaders(cfg, false),
      cache: 'no-store',
    });
    const body = await readJsonSafe(res);
    if (!res.ok && !(allow404 && res.status === 404)) {
      throw this._responseError(res, body, '读取远端');
    }
    return { status: res.status, ok: res.ok, body };
  }

  _hasLocalData() {
    if (!this._store) return false;
    const payload = this._store.exportPayload();
    if (num(payload.updatedAt, 0) > 0) return true;
    if (payload.cards && Object.keys(payload.cards).length > 0) return true;
    if (Array.isArray(payload.customWords) && payload.customWords.length > 0) return true;
    if (payload.stats && payload.stats.days && Object.keys(payload.stats.days).length > 0) return true;
    return false;
  }

  _parseRemotePayload(body) {
    if (!body || typeof body.content !== 'string') return null;
    const text = decodeBase64Utf8(body.content);
    if (!text.trim()) return null;
    let remote;
    try {
      remote = JSON.parse(text);
    } catch (err) {
      throw new SyncError(
        '远端同步文件不是合法 JSON：请检查 GitHub 上 ' + this._cfg.path + ' 的内容，或先用本机数据重新推送',
        { code: 'invalid-json' },
      );
    }
    return remote;
  }

  _mergeRemote(remote) {
    try {
      return this._store.mergeRemote(remote);
    } catch (err) {
      throw new SyncError('合并远端数据失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  async _pullInner() {
    try {
      const got = await this._getContents(true);
      if (got.status === 404) {
        // 远端还没有这个文件：不算错误；本地有进度就稍后推上去。
        this._lastError = null;
        this._pending = this._hasLocalData();
        this._setState('ok');
        if (this._pending) this.schedulePush();
        return { pulled: true, empty: true, localChanged: false };
      }
      const remote = this._parseRemotePayload(got.body);
      if (!remote) {
        this._lastError = null;
        this._pending = this._hasLocalData();
        this._setState('ok');
        if (this._pending) this.schedulePush();
        return { pulled: true, empty: true, localChanged: false };
      }
      const merged = this._mergeRemote(remote);
      this._lastError = null;
      this._lastSyncAt = this._now();
      this._pending = !!merged.localChanged;
      this._setState('ok');
      if (merged.localChanged) {
        await this._pushInner();
      }
      return { pulled: true, ...merged };
    } catch (err) {
      const e = this._asSyncError(err);
      this._recordFailure(e, { retry: false });
      throw e;
    }
  }

  _commitMessage() {
    const device = trim(this._store && this._store.meta && this._store.meta.deviceName) || '设备';
    return 'sync: ' + device + ' ' + formatSyncTime(this._now());
  }

  async _writeRemote(payloadText, sha) {
    const cfg = this._cfg;
    const body = {
      message: this._commitMessage(),
      content: encodeBase64Utf8(payloadText),
      branch: cfg.branch,
    };
    if (sha) body.sha = sha;
    return this._request(this._contentsUrl(cfg, false), {
      method: 'PUT',
      headers: this._authHeaders(cfg, true),
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  }

  async _pushInner() {
    this._pending = true;
    try {
      const head = await this._getContents(true);
      let sha = head.status === 404 ? null : (head.body && head.body.sha) || null;
      for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt += 1) {
        const payloadText = JSON.stringify(this._store.exportPayload(), null, 2);
        const res = await this._writeRemote(payloadText, sha);
        if (res.ok) {
          const now = this._now();
          if (typeof this._store.markSynced === 'function') this._store.markSynced(now);
          this._lastSyncAt = now;
          this._lastError = null;
          this._pending = false;
          this._retryCount = 0;
          this._clearRetryTimer();
          this._setState('ok');
          const resBody = await readJsonSafe(res);
          return { pushed: true, attempts: attempt, sha: resBody && resBody.content ? resBody.content.sha : '' };
        }
        if (res.status === 409 && attempt < MAX_PUSH_ATTEMPTS) {
          // 冲突：拉最新版本合并后再用新 sha 重试
          const latest = await this._getContents(true);
          if (latest.status === 404) {
            sha = null;
            continue;
          }
          if (latest.body && latest.body.sha) sha = latest.body.sha;
          const remote = this._parseRemotePayload(latest.body);
          if (remote) this._mergeRemote(remote);
          continue;
        }
        if (res.status === 409) {
          throw new SyncError(
            '同步冲突：多台设备同时修改，自动重试 ' + MAX_PUSH_ATTEMPTS + ' 次仍失败，请稍后再点「立即同步」',
            { code: 'conflict' },
          );
        }
        throw this._responseError(res, await readJsonSafe(res), '推送');
      }
      throw new SyncError('同步冲突：重试 ' + MAX_PUSH_ATTEMPTS + ' 次仍失败，请稍后再试', { code: 'conflict' });
    } catch (err) {
      const e = this._asSyncError(err);
      this._pending = true;
      this._recordFailure(e, { retry: true });
      throw e;
    }
  }
}

export const sync = new SyncClient();
