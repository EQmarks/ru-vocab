// public/js/audio.js — 单词朗读：优先播放内置 mp3（按单元分文件 + 时间索引），
// 不可用时退回浏览器 speechSynthesis。索引在启动时预取，音频元素预加载 metadata。

let voicesBound = false;
let cachedVoice = null;
let indexPromise = null;
let textMap = null;
let currentEl = null;
let stopTimer = null;
let stopRAF = null;
let currentUtterance = null;

function audioSupported() {
  return typeof window !== 'undefined' && typeof window.Audio === 'function' && !!document.body;
}

function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function';
}

export function isSpeechAvailable() {
  return audioSupported() || ttsSupported();
}

function pickRussianVoice() {
  if (!ttsSupported()) return null;
  let voices = [];
  try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
  if (!voices.length) return null;
  const russian = voices.filter((voice) => String(voice.lang || '').toLowerCase().indexOf('ru') === 0);
  if (!russian.length) return null;
  const preferred = russian.find((voice) => /google|yandex|milena|alena|pavel|katya|irina/i.test(voice.name || ''));
  return preferred || russian[0];
}

function ensureVoicesBound() {
  if (voicesBound || !ttsSupported()) return;
  voicesBound = true;
  cachedVoice = pickRussianVoice();
  try {
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        cachedVoice = pickRussianVoice();
      });
    }
  } catch (e) { /* 忽略 */ }
}

function loadIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = fetch('./audio/index.json', { cache: 'no-cache' })
    .then((response) => (response && response.ok ? response.json() : null))
    .then((json) => {
      if (!json || !json.units) return null;
      textMap = new Map();
      Object.values(json.units).forEach((unit) => {
        const src = unit.src || ('./audio/' + unit.id + '.mp3');
        (unit.words || []).forEach((word) => {
          if (!textMap.has(word.ru)) textMap.set(word.ru, { src, start: word.start || 0, dur: word.dur || 1 });
        });
      });
      return json;
    })
    .catch(() => null);
  return indexPromise;
}

function stopBundled() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (stopRAF) { cancelAnimationFrame(stopRAF); stopRAF = null; }
  if (currentEl) {
    const el = currentEl;
    currentEl = null;
    try { el.pause(); } catch (e) { /* 忽略 */ }
    try { el.removeAttribute('src'); el.load(); } catch (e) { /* 忽略 */ }
    try { el.remove(); } catch (e) { /* 忽略 */ }
  }
}

function playBundled(hit, text) {
  stopBundled();
  // 用媒体片段 #t= 直接从头播放到单词位置：不用等 metadata、也保住用户手势。
  const el = document.createElement('audio');
  el.preload = 'auto';
  el.src = hit.src + '#t=' + (hit.start || 0).toFixed(2);
  el.style.display = 'none';
  document.body.appendChild(el);
  currentEl = el;
  // 有些浏览器（尤其旧 iOS）不认 #t 片段：metadata 到了再补一次 seek。
  el.addEventListener('loadedmetadata', () => {
    const start = hit.start || 0;
    if (Math.abs(el.currentTime - start) > 0.5) {
      try { el.currentTime = start; } catch (e) { /* 忽略 */ }
    }
  }, { once: true });
  let promise = null;
  try { promise = el.play(); } catch (e) { promise = null; }
  if (promise && typeof promise.catch === 'function') {
    promise.catch(() => {
      // 自动播放被浏览器拦截时，退回 TTS（同样需要手势，失败则静默）。
      if (text) speakTTS(text);
    });
  }
  // 精确停在单词结束处：之前用固定 +0.4s 会把下一个词的起头也放出来。
  const startAt = hit.start || 0;
  const endAt = startAt + (hit.dur || 1);
  const hardEnd = Math.max(startAt + 0.15, endAt - 0.02);
  // 以“媒体时间”为准停：墙钟定时器会被缓冲/卡顿带偏，实际播到哪算哪。
  const poll = () => {
    if (currentEl !== el) return;
    if (el.ended || el.currentTime >= hardEnd) stopBundled();
  };
  stopRAF = requestAnimationFrame(function tick() {
    if (currentEl !== el) return;
    poll();
    if (currentEl === el) stopRAF = requestAnimationFrame(tick);
  });
  const iv = setInterval(() => {
    if (currentEl !== el) { clearInterval(iv); return; }
    poll();
  }, 20);
  el.addEventListener('timeupdate', poll);
  // 兜底：标签页在后台时 rAF/interval 都会被节流，别让它一直播下去。
  stopTimer = setTimeout(() => {
    if (currentEl === el) stopBundled();
  }, 15000);
  return true;
}

function speakTTS(value, options) {
  if (!ttsSupported()) return false;
  ensureVoicesBound();
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) {
      try { synth.cancel(); } catch (e) { /* 忽略 */ }
    }
    const utter = new window.SpeechSynthesisUtterance(value);
    utter.lang = 'ru-RU';
    const voice = cachedVoice || pickRussianVoice();
    if (voice) utter.voice = voice;
    const opts = options || {};
    utter.rate = typeof opts.rate === 'number' ? opts.rate : 0.92;
    utter.pitch = typeof opts.pitch === 'number' ? opts.pitch : 1;
    // 保留引用，避免 iOS Safari 把 utterance 回收导致无声。
    currentUtterance = utter;
    utter.onend = () => { if (currentUtterance === utter) currentUtterance = null; };
    utter.onerror = () => { if (currentUtterance === utter) currentUtterance = null; };
    synth.speak(utter);
    return true;
  } catch (e) {
    return false;
  }
}

export function prepareSpeech() {
  if (!audioSupported() && !ttsSupported()) return;
  loadIndex();
  ensureVoicesBound();
  if (ttsSupported()) {
    try { window.speechSynthesis.getVoices(); } catch (e) { /* 忽略 */ }
  }
}

export function speak(text, options) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (audioSupported()) {
    if (!textMap) loadIndex();
    if (textMap) {
      const hit = textMap.get(value);
      if (hit) return playBundled(hit, value);
    }
  }
  return speakTTS(value, options);
}

export function stopSpeaking() {
  stopBundled();
  if (!ttsSupported()) return;
  try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
}