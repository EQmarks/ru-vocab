
# -*- coding: utf-8 -*-
"""俄语手写体字母「т」替换工具。

用法：
  python scripts/glyph.py export
  python scripts/glyph.py import glyph/t-new.svg [--both] [--advance 650] [--install]
  python scripts/glyph.py preview

约定（给 GPT 的接口）：
  - 输入是一个 SVG 文件，里面至少有一个 <path d="...">，或者直接给一段路径 d。
  - 坐标任意、y 轴向下皆可，脚本会自动缩放、翻转到字体坐标、对齐基线。
  - 输出字形的高度会被缩放到 500 单位（Bad Script 的 x-height），底边贴基线 y=0，
    水平留白 3 单位；默认前进宽度 = 字宽 + 30。
"""
import argparse
import base64
import copy
import io
import json
import math
import os
import re
import subprocess
import sys

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.svgLib.path import parse_path
from fontTools.misc.transform import Transform
from fontTools.ttLib.tables import ttProgram
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLYPH_DIR = os.path.join(ROOT, 'glyph')
BASE_TTF = os.path.join(GLYPH_DIR, 'base-hand.ttf')
NEW_TTF = os.path.join(GLYPH_DIR, 'base-hand-new.ttf')
CHARS = os.path.join(GLYPH_DIR, 'chars.txt')
WOFF = os.path.join(ROOT, 'public', 'fonts', 'rv-hand.woff2')
PREVIEW = os.path.join(GLYPH_DIR, 'preview.png')

TARGET_T = 0x442    # т
TARGET_M = 0x43C    # м
X_HEIGHT = 500.0  # 仅在无法读取基础字形时兜底
LEFT_BEARING = 3.0
DEFAULT_GAP = 30.0


def _first_path_d(text):
    text = text.strip()
    if '<' in text:
        m = re.search(r'<path[^>]*\sd\s*=\s*(["\'])(.*?)\1', text, re.S)
        if not m:
            raise ValueError('SVG 里没找到 <path d="...">')
        return m.group(2)
    return text


def _read_input(path_or_text):
    if os.path.exists(path_or_text):
        with io.open(path_or_text, encoding='utf-8') as f:
            return _first_path_d(f.read())
    return _first_path_d(path_or_text)


def _bounds(d):
    pen = BoundsPen(None)
    parse_path(d, pen)
    if pen.bounds is None:
        raise ValueError('路径没有有效轮廓')
    return pen.bounds


def _base_height():
    f = TTFont(BASE_TTF)
    # Match the unchanged Bad Script п, not a previously replaced т.
    g = f['glyf'][f.getBestCmap()[ord('п')]]
    return float(g.yMax - g.yMin)


def build_glyph_from_d(d, advance=None):
    xmin, ymin, xmax, ymax = _bounds(d)
    width, height = xmax - xmin, ymax - ymin
    if width <= 0 or height <= 0:
        raise ValueError('字形尺寸为 0')
    target_h = _base_height() or X_HEIGHT
    s = target_h / height
    tx = LEFT_BEARING - s * xmin
    ty = s * ymax          # SVG 的底边（y 最大处）落到字体基线 y=0
    transform = Transform(s, 0, 0, -s, tx, ty)
    pen = TTGlyphPen(None)
    parse_path(d, TransformPen(pen, transform))
    glyph = pen.glyph()
    if not glyph.numberOfContours:
        raise ValueError('路径没有闭合轮廓')
    adv = int(round(advance if advance else width * s + DEFAULT_GAP))
    if adv < 200:
        adv = 200
    return glyph, adv


def _draw_text(im, xy, text, font, fill):
    d = ImageDraw.Draw(im)
    d.text(xy, text, font=font, fill=fill)


def render_preview(ttf, out=PREVIEW):
    im = Image.new('RGB', (1200, 620), (255, 253, 248))
    big = ImageFont.truetype(ttf, 300)
    small = ImageFont.truetype(ttf, 46)
    label = ImageFont.truetype(os.path.join('C:/Windows/Fonts', 'msyh.ttc'), 16)
    im_d = ImageDraw.Draw(im)
    im_d.text((20, 14), 'т / м 预览', font=label, fill=(120, 110, 100))
    im_d.text((40, 40), 'т', font=big, fill=(15, 15, 15))
    im_d.text((300, 100), 'мама, тетрадь, привет, дом, музыка, томат', font=small, fill=(20, 20, 20))
    im_d.text((300, 170), 'тетрадь, томат, метро, театр, такси', font=small, fill=(20, 20, 20))
    im_d.text((300, 240), 'Том, там, тут, тот, этот, брат', font=small, fill=(20, 20, 20))
    im.save(out)
    return out


def export_svg(char='т'):
    font = TTFont(BASE_TTF)
    cmap = font.getBestCmap()
    cp = ord(char)
    gname = cmap.get(cp)
    if not gname:
        raise SystemExit('基础字体里没有 %s' % char)
    gs = font.getGlyphSet()
    pen = SVGPathPen(gs)
    gs[gname].draw(TransformPen(pen, Transform(1, 0, 0, -1, 0, 500)))
    d = pen.getCommands()
    out = os.path.join(GLYPH_DIR, 't-current.svg')
    svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 560" width="760" height="560">',
        '  <rect width="760" height="560" fill="#fffdf8"/>',
        '  <line x1="0" y1="500" x2="760" y2="500" stroke="#d8d2c4" stroke-width="1"/>',
        '  <path d="%s" fill="#1d1b17"/>' % d,
        '</svg>',
    ]
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(svg) + '\n')
    print('已导出', out)


def apply_glyph(svg_or_d, both=False, advance=None, install=False):
    d = _read_input(svg_or_d)
    glyph, adv = build_glyph_from_d(d, advance)
    font = TTFont(BASE_TTF)
    glyf = font['glyf']
    targets = [TARGET_T] + ([TARGET_M] if both else [])
    for cp in targets:
        gname = font.getBestCmap()[cp]
        g = copy.deepcopy(glyph)
        g.program = ttProgram.Program()
        g.program.fromBytecode(b'')
        g.recalcBounds(glyf)
        glyf[gname] = g
        font['hmtx'][gname] = (adv, g.xMin)
    # Keep the modified font under its OFL-compliant RV Hand family name.
    names = {1: 'RV Hand', 2: 'Regular', 3: 'RV Hand Regular',
             4: 'RV Hand Regular', 6: 'RVHand-Regular',
             16: 'RV Hand', 17: 'Regular'}
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    font.save(NEW_TTF)
    render_preview(NEW_TTF)
    if install:
        subprocess.run([sys.executable, '-m', 'fontTools.subset', NEW_TTF,
                        '--text-file=' + CHARS, '--flavor=woff2', '--output-file=' + WOFF],
                       check=True)
    print('已生成', NEW_TTF, '宽', adv, '预览', PREVIEW)
    if install:
        print('已更新', WOFF)
    return {'advance': adv, 'ttf': NEW_TTF, 'preview': PREVIEW, 'installed': install}


def preview_png_base64():
    with open(PREVIEW, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('export')
    p_imp = sub.add_parser('import')
    p_imp.add_argument('input')
    p_imp.add_argument('--both', action='store_true')
    p_imp.add_argument('--advance', type=int)
    p_imp.add_argument('--install', action='store_true')
    sub.add_parser('preview')
    args = ap.parse_args()
    if args.cmd == 'export':
        export_svg()
    elif args.cmd == 'import':
        apply_glyph(args.input, both=args.both, advance=args.advance, install=args.install)
    elif args.cmd == 'preview':
        render_preview(NEW_TTF if os.path.exists(NEW_TTF) else BASE_TTF)
        print(PREVIEW)


if __name__ == '__main__':
    main()