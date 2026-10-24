// 词库校验：node scripts/validate-data.mjs [--unit 03]
// 校验 data-src/units/NN-slug.json 的结构、重音、转写、去重。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const UNITS_DIR = path.join(ROOT, 'data-src', 'units');
export const POS = ['名词', '动词', '形容词', '副词', '代词', '数词', '前置词', '连词', '语气词', '感叹词', '短语'];
const GENDERS = ['м', 'ж', 'с', 'мн'];
const ASPECTS = ['нсв', 'св'];
const VOWELS = 'аеёиоуыэюя';
const ACUTE = '\u0301';
const RU_RE = /^[а-яё\- ]+$/;
const TR_RE = /^[a-z' \-]+$/;

export function stripStress(s) { return String(s || '').replace(/\u0301/g, ''); }
export function vowelCount(s) { let n = 0; for (const ch of stripStress(s).toLowerCase()) if (VOWELS.includes(ch)) n++; return n; }

const TRANSLIT = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};
export function autoTranslit(ru) {
  return Array.from(stripStress(ru).toLowerCase()).map((c) => (c in TRANSLIT ? TRANSLIT[c] : c)).join('');
}

export function loadRawUnits(filter) {
  if (!fs.existsSync(UNITS_DIR)) return [];
  const files = fs.readdirSync(UNITS_DIR).filter((f) => f.endsWith('.json')).sort();
  const out = [];
  for (const f of files) {
    if (filter && !f.startsWith(filter)) continue;
    const full = path.join(UNITS_DIR, f);
    let data = null, error = null;
    try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { error = 'JSON 解析失败: ' + e.message; }
    out.push({ file: f, data, error });
  }
  return out;
}

export function validateUnits(rawUnits) {
  const errors = [], warnings = [];
  const seenWords = new Map();
  const seenIds = new Map();
  const unitNums = new Set();
  const units = [];
  for (const raw of rawUnits) {
    const where = raw.file;
    if (raw.error) { errors.push(where + ': ' + raw.error); continue; }
    const u = raw.data;
    if (!u || typeof u !== 'object') { errors.push(where + ': 顶层必须是对象'); continue; }
    const m = /^(\d{2})-([a-z0-9-]+)\.json$/.exec(where);
    if (!m) { errors.push(where + ': 文件名必须形如 01-greetings.json'); continue; }
    const num = Number(m[1]);
    const uid = 'u' + m[1];
    if (unitNums.has(num)) errors.push(where + ': 单元号重复 ' + num);
    unitNums.add(num);
    if (u.id !== uid) errors.push(where + ': id 应为 ' + uid + '，实际 ' + u.id);
    if (!u.title || typeof u.title !== 'string') errors.push(where + ': 缺少 title');
    if (!u.titleRu || typeof u.titleRu !== 'string') errors.push(where + ': 缺少 titleRu');
    if (!u.level || !/^[ABC][12]$/.test(u.level)) errors.push(where + ': level 应为 A1/A2/B1/B2');
    if (!Array.isArray(u.words)) { errors.push(where + ': words 必须是数组'); continue; }
    if (u.words.length !== 60) errors.push(where + ': 每单元必须正好 60 词，实际 ' + u.words.length);
    u.words.forEach((w, i) => {
      const at = where + ' #' + (i + 1) + (w && w.ru ? ' (' + w.ru + ')' : '');
      const expectId = uid + '-' + String(i + 1).padStart(3, '0');
      if (!w || typeof w !== 'object') { errors.push(at + ': 词条必须是对象'); return; }
      if (w.id !== expectId) errors.push(at + ': id 应为 ' + expectId + '，实际 ' + w.id);
      if (seenIds.has(w.id)) errors.push(at + ': id 重复，已被 ' + seenIds.get(w.id) + ' 使用');
      seenIds.set(w.id, where);
      if (typeof w.ru !== 'string' || !RU_RE.test(w.ru)) errors.push(at + ': ru 必须是小写西里尔字母/连字符/空格');
      else if (vowelCount(w.ru) === 0) errors.push(at + ': ru 没有元音');
      if (typeof w.stress !== 'string') { errors.push(at + ': 缺少 stress'); }
      else {
        if (stripStress(w.stress) !== w.ru) errors.push(at + ': stress 去掉重音符后必须等于 ru');
        const acuteN = (w.stress.match(/\u0301/g) || []).length;
        const hasYo = w.ru.includes('ё');
        const vc = vowelCount(w.ru);
        if (hasYo && acuteN > 0) errors.push(at + ': 含 ё 的词不要加重音符');
        if (!hasYo && vc >= 2 && acuteN !== 1) errors.push(at + ': 多音节词必须正好一个重音符，实际 ' + acuteN);
        if (!hasYo && vc === 1 && acuteN > 0) errors.push(at + ': 单音节词不加/只加一个重音符即可，建议不加');
        for (let k = 0; k < w.stress.length; k++) {
          if (w.stress[k] === ACUTE) {
            const prev = w.stress[k - 1] || '';
            if (!VOWELS.includes(prev.toLowerCase())) errors.push(at + ': 重音符必须紧跟元音');
          }
        }
      }
      if (typeof w.tr !== 'string' || !TR_RE.test(w.tr)) errors.push(at + ': tr 只能是小写拉丁字母/空格/连字符/撇号');
      else if (w.ru && w.stress && autoTranslit(w.ru).replace(/'/g, '') !== w.tr.replace(/'/g, '')) {
        warnings.push(at + ': tr 与自动转写不一致（自动: ' + autoTranslit(w.ru) + '，实际: ' + w.tr + '）');
      }
      if (typeof w.zh !== 'string' || !w.zh.trim()) errors.push(at + ': 缺少中文释义 zh');
      else if (w.zh.length > 40) errors.push(at + ': zh 过长（>40 字）');
      else if (!/[\u4e00-\u9fff]/.test(w.zh)) warnings.push(at + ': zh 不含中文');
      if (!POS.includes(w.pos)) errors.push(at + ': pos 必须是 ' + POS.join('/'));
      if (w.pos === '名词') {
        if (!GENDERS.includes(w.gender)) errors.push(at + ': 名词必须给 gender（м/ж/с/мн）');
      } else if (w.gender !== undefined && w.gender !== null && w.gender !== '') {
        warnings.push(at + ': 非名词不应有 gender');
      }
      if (w.aspect !== undefined && !ASPECTS.includes(w.aspect)) errors.push(at + ': aspect 只能是 нсв/св');
      if (!w.example || typeof w.example !== 'object') errors.push(at + ': 缺少 example {ru, zh}');
      else {
        if (typeof w.example.ru !== 'string' || !w.example.ru.trim()) errors.push(at + ': example.ru 为空');
        else if (w.example.ru.length > 120) errors.push(at + ': example.ru 过长（>120 字符）');
        else if (w.example.ru.includes(ACUTE)) errors.push(at + ': example.ru 不要带重音符');
        if (typeof w.example.zh !== 'string' || !w.example.zh.trim()) errors.push(at + ': example.zh 为空');
      }
      if (!Number.isInteger(w.level) || w.level < 1 || w.level > 5) errors.push(at + ': level 必须是 1-5 的整数');
      if (w.tags !== undefined && (!Array.isArray(w.tags) || w.tags.some((t) => typeof t !== 'string'))) warnings.push(at + ': tags 应为字符串数组');
      if (w.note !== undefined && (typeof w.note !== 'string' || w.note.length > 60)) warnings.push(at + ': note 应为 ≤60 字字符串');
      if (w.ru && seenWords.has(w.ru)) warnings.push(at + ': 与 ' + seenWords.get(w.ru) + ' 重复（构建时会去重）');
      else if (w.ru) seenWords.set(w.ru, where + '#' + (i + 1));
    });
    units.push(u);
  }
  units.sort((a, b) => a.id.localeCompare(b.id));
  return { errors, warnings, units };
}

export function loadAndValidate(filter) {
  return validateUnits(loadRawUnits(filter));
}

function fmtList(title, items, limit) {
  if (!items.length) return '';
  const shown = items.slice(0, limit || 60);
  return '\n' + title + ' (' + items.length + '):\n  ' + shown.join('\n  ') + (items.length > shown.length ? '\n  ... 还有 ' + (items.length - shown.length) + ' 条' : '');
}

function main() {
  const args = process.argv.slice(2);
  const ui = args.indexOf('--unit');
  const filter = ui >= 0 ? args[ui + 1] : null;
  const { errors, warnings, units } = loadAndValidate(filter);
  const words = units.reduce((n, u) => n + (u.words ? u.words.length : 0), 0);
  console.log('单元: ' + units.length + ' 个，词条: ' + words + ' 个');
  if (warnings.length) console.log(fmtList('警告', warnings));
  if (errors.length) { console.log(fmtList('错误', errors)); process.exit(1); }
  console.log('校验通过 ✓');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
