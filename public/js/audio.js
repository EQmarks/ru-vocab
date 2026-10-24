// public/js/audio.js — 俄语朗读：使用浏览器内置 speechSynthesis，不加载任何外部音频。
// 导出 speak(text) 与 isSpeechAvailable()；不支持的设备上静默降级。

let voicesBound = false;
let cachedVoice = null;

export function isSpeechAvailable() {
  if (typeof window === 'undefined') return false;
  if (!('speechSynthesis' in window)) return false;
  return typeof window.SpeechSynthesisUtterance === 'function';
}

function pickRussianVoice() {
  if (!isSpeechAvailable()) return null;
  let voices = [];
  try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
  if (!voices.length) return null;
  const russian = voices.filter((voice) => String(voice.lang || '').toLowerCase().indexOf('ru') === 0);
  if (!russian.length) return null;
  const preferred = russian.find((voice) => /google|yandex|milena|alena|pavel|katya|irina/i.test(voice.name || ''));
  return preferred || russian[0];
}

function ensureVoicesBound() {
  if (voicesBound || !isSpeechAvailable()) return;
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

// 提前触发一次音色列表加载（部分浏览器首次 getVoices 为空）。
export function prepareSpeech() {
  if (!isSpeechAvailable()) return;
  ensureVoicesBound();
  try { window.speechSynthesis.getVoices(); } catch (e) { /* 忽略 */ }
}

export function speak(text, options) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (!isSpeechAvailable()) return false;
  ensureVoicesBound();
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utter = new window.SpeechSynthesisUtterance(value);
    utter.lang = 'ru-RU';
    const voice = cachedVoice || pickRussianVoice();
    if (voice) utter.voice = voice;
    const opts = options || {};
    utter.rate = typeof opts.rate === 'number' ? opts.rate : 0.92;
    utter.pitch = typeof opts.pitch === 'number' ? opts.pitch : 1;
    synth.speak(utter);
    return true;
  } catch (e) {
    return false;
  }
}

export function stopSpeaking() {
  if (!isSpeechAvailable()) return;
  try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
}
