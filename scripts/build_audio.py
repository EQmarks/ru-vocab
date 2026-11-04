
# -*- coding: utf-8 -*-
"""生成单词朗读音频（按单元一个 mp3 + 时间索引）。

依赖：pip install edge-tts（联网调用微软 Edge 神经语音）
用法：python scripts/build_audio.py [--voice ru-RU-SvetlanaNeural] [--rate -8%]
输出：public/audio/u01.mp3 ... u12.mp3, public/audio/index.json
"""
import argparse
import asyncio
import json
import os
import re
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data', 'words.json')
OUT = os.path.join(ROOT, 'public', 'audio')


def norm(s):
    return re.sub(r'[^0-9a-zа-яё]', '', (s or '').lower())


async def build_unit(unit, voice, rate):
    words = unit['words']
    text = ', '.join(w['ru'] for w in words)
    communicate = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
    bounds = []
    mp3 = os.path.join(OUT, unit['id'] + '.mp3')
    with open(mp3, 'wb') as f:
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                f.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                bounds.append({
                    'text': chunk['text'],
                    'offset': chunk['offset'] / 1e7,
                    'duration': chunk['duration'] / 1e7,
                })

    entries = []
    bi = 0
    for w in words:
        target = norm(w['ru'])
        acc = ''
        start = None
        while bi < len(bounds) and acc != target:
            if start is None:
                start = bounds[bi]['offset']
            acc += norm(bounds[bi]['text'])
            bi += 1
        if acc != target or start is None:
            print('  !! 对齐失败:', w['id'], w['ru'], 'acc=', acc, 'target=', target)
            # 退化：用前一个边界起点 + 固定时长
            start = bounds[bi - 1]['offset'] if bi else 0.0
            dur = 0.8
        else:
            end = bounds[bi - 1]['offset'] + bounds[bi - 1]['duration']
            dur = max(0.25, end - start)
        entries.append({'id': w['id'], 'ru': w['ru'], 'start': round(start, 3), 'dur': round(dur, 3)})

    return {
        'src': './audio/' + unit['id'] + '.mp3',
        'title': unit.get('title', ''),
        'words': entries,
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='ru-RU-SvetlanaNeural')
    ap.add_argument('--rate', default='-8%')
    ap.add_argument('--only', default='')
    args = ap.parse_args()

    with open(DATA, encoding='utf-8') as f:
        data = json.load(f)
    os.makedirs(OUT, exist_ok=True)
    units = data['units']
    if args.only:
        units = [u for u in units if u['id'] in args.only.split(',')]

    index = {'version': 1, 'voice': args.voice, 'generatedAt': '', 'units': {}}
    for unit in units:
        print('生成', unit['id'], unit.get('title', ''), '...', flush=True)
        index['units'][unit['id']] = await build_unit(unit, args.voice, args.rate)
        n = index['units'][unit['id']]['words']
        print('  ok words', len(n), 'size', os.path.getsize(os.path.join(OUT, unit['id'] + '.mp3')), flush=True)

    path = os.path.join(OUT, 'index.json')
    if args.only and os.path.exists(path):
        old = json.load(open(path, encoding='utf-8'))
        old['units'].update(index['units'])
        index = old
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', path)


if __name__ == '__main__':
    asyncio.run(main())
