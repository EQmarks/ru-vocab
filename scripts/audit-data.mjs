// 词库人工复核辅助：node scripts/audit-data.mjs [--json]
// 只做启发式检查，不阻塞构建；结果供 Lead / 复核人逐条看。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRawUnits, stripStress, autoTranslit, vowelCount, ROOT } from './validate-data.mjs';

const CJK = /[\u4e00-\u9fff]/;
const CYR = /[\u0400-\u04ff]/;
const LAT = /[a-zA-Z]/;

function stem(ru) {
  const s = stripStress(ru).toLowerCase();
  if (s.length <= 4) return s;
  return s.slice(0, s.length - 2);
}

export function audit() {
  const raw = loadRawUnits();
  const units = raw.filter((r) => r.data && Array.isArray(r.data.words)).map((r) => ({ file: r.file, ...r.data }));
  const report = { units: [], trMismatch: [], exampleMiss: [], dupZh: [], dupTr: [], zhLatin: [], zhNoCjk: [], levelJumps: [], posStats: {}, total: 0 };
  const zhMap = new Map();
  const trMap = new Map();
  for (const u of units) {
    const posCount = {};
    let prevLevel = 0;
    const unitReport = { id: u.id, file: u.file, count: u.words.length, levels: [0, 0, 0, 0, 0], pos: posCount };
    for (const w of u.words) {
      report.total += 1;
      posCount[w.pos] = (posCount[w.pos] || 0) + 1;
      if (Number.isInteger(w.level)) unitReport.levels[w.level - 1] += 1;
      if (prevLevel && Number.isInteger(w.level) && w.level < prevLevel - 1) report.levelJumps.push(u.id + ' ' + w.id + ' (' + (prevLevel) + '→' + w.level + ')');
      prevLevel = w.level;
      const auto = autoTranslit(w.ru).replace(/'/g, '');
      const tr = String(w.tr || '').replace(/'/g, '');
      if (auto !== tr) report.trMismatch.push(u.id + ' ' + w.ru + ' → ' + tr + '（自动: ' + auto + '）');
      const st = stem(w.ru);
      if (st.length >= 3 && w.example && typeof w.example.ru === 'string' && !w.example.ru.toLowerCase().includes(st)) {
        report.exampleMiss.push(u.id + ' ' + w.ru + ' — ' + w.example.ru);
      }
      const zh = String(w.zh || '').trim();
      if (CJK.test(zh)) {
        const key = zh.replace(/\s+/g, '');
        if (zhMap.has(key)) report.dupZh.push(u.id + ' ' + w.ru + ' 与 ' + zhMap.get(key) + ' 释义相同：' + zh);
        else zhMap.set(key, u.id + ' ' + w.ru);
      } else report.zhNoCjk.push(u.id + ' ' + w.ru + ' → ' + zh);
      if (LAT.test(zh) || CYR.test(zh)) report.zhLatin.push(u.id + ' ' + w.ru + ' → ' + zh);
      if (tr) {
        if (trMap.has(tr) && trMap.get(tr) !== u.id + ' ' + w.ru) report.dupTr.push(u.id + ' ' + w.ru + ' 与 ' + trMap.get(tr) + ' 转写相同：' + tr);
        else trMap.set(tr, u.id + ' ' + w.ru);
      }
    }
    report.units.push(unitReport);
  }
  report.posStats = report.units.reduce((a, u) => a, {});
  return report;
}

function section(title, items, limit) {
  if (!items.length) return '';
  const shown = items.slice(0, limit || 40);
  return '\n' + title + '（' + items.length + '）\n  ' + shown.join('\n  ') + (items.length > shown.length ? '\n  …还有 ' + (items.length - shown.length) + ' 条' : '');
}

function main() {
  const report = audit();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log('词条总数: ' + report.total);
  for (const u of report.units) {
    console.log('\n' + u.id + '  词数 ' + u.count + '  难度分布 ' + u.levels.join('/') + '  词性: ' + Object.entries(u.pos).map(([k, v]) => k + v).join(' '));
  }
  console.log(section('转写不一致', report.trMismatch));
  console.log(section('例句可能没用该词', report.exampleMiss));
  console.log(section('释义重复', report.dupZh));
  console.log(section('转写重复', report.dupTr));
  console.log(section('释义含拉丁/西里尔字母', report.zhLatin));
  console.log(section('释义无中文', report.zhNoCjk));
  console.log(section('难度倒退', report.levelJumps));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
