// 合并 data-src/units/*.json → public/data/words.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAndValidate, ROOT } from './validate-data.mjs';

const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'words.json');

export function build() {
  const { errors, warnings, units } = loadAndValidate();
  if (warnings.length) console.log('警告 ' + warnings.length + ' 条（不阻塞构建）');
  if (errors.length) {
    console.error('校验失败，共 ' + errors.length + ' 条错误：');
    errors.slice(0, 40).forEach((e) => console.error('  - ' + e));
    process.exitCode = 1;
    return null;
  }
  const seen = new Set();
  const outUnits = [];
  for (const u of units) {
    const words = [];
    for (const w of u.words) {
      if (seen.has(w.ru)) continue;
      seen.add(w.ru);
      const { id, ru, stress, tr, zh, pos, gender, aspect, example, tags, level, note } = w;
      const clean = { id, ru, stress, tr, zh, pos };
      if (gender) clean.gender = gender;
      if (aspect) clean.aspect = aspect;
      if (note) clean.note = note;
      clean.level = level;
      if (Array.isArray(tags) && tags.length) clean.tags = tags;
      clean.example = { ru: example.ru, zh: example.zh };
      words.push(clean);
    }
    outUnits.push({ id: u.id, title: u.title, titleRu: u.titleRu, level: u.level, words });
  }
  const total = outUnits.reduce((n, u) => n + u.words.length, 0);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: total,
    units: outUnits,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('已生成 ' + path.relative(ROOT, OUT_FILE) + '：' + outUnits.length + ' 单元 / ' + total + ' 词');
  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) build();
