# 手写体字形工坊（改 т / м）

给 GPT 改字形用的接口：把「手写体里的 т」从一段 SVG 路径变成字体文件。

## 快速开始

启动本地网页（npm run glyph）：

    npm run glyph
    # 打开 http://127.0.0.1:5198

1. 打开网页，把 GPT 返回的 <path d="…">（或整段 SVG）贴进左边文本框
2. 点「预览」看效果；满意后点「写入字体」
3. 写入的是本地 public/fonts/rv-hand.woff2，线上部署要升 SW 版本再推送（告诉我即可）

## 命令行

    python scripts/glyph.py export                 # 把当前 т 导出成 glyph/t-current.svg
    python scripts/glyph.py import glyph/t-new.svg # 只生成新字体+预览，不动线上文件
    python scripts/glyph.py import glyph/t-new.svg --install   # 同时写入 public/fonts/rv-hand.woff2
    python scripts/glyph.py import glyph/t-new.svg --both      # 同时替换 м 和 т
    python scripts/glyph.py import glyph/t-new.svg --advance 700
    python scripts/glyph.py preview

| 文件 | 说明 |
| --- | --- |
| glyph/t-current.svg | 当前 т 的轮廓（给 GPT 当参考） |
| glyph/prompt-for-gpt.md | 现成的提示词 + 当前路径，直接复制给 GPT |
| glyph/base-hand.ttf | 基础手写体（Bad Script + 当前 м/т） |
| glyph/base-hand-new.ttf | 替换后的字体（生成物） |
| glyph/preview.png | 大字 + 整词预览（生成物） |

## 给 GPT 的提示词

直接复制 glyph/prompt-for-gpt.md 的内容，或贴这段：

> 这是俄语手写体小写字母 **т**（手写形状像英文 m）。请基于它改一版：
> - 只输出一个 SVG 路径元素（path），不要解释；
> - 画布用 1000×1000，y 轴向下，字形底部放在 y=1000 附近；
> - 笔画粗细约 55（1000 单位里），两端圆润；
> - 两个拱顶左右等高、等宽，拱顶圆滑、不要尖角；
> - 底部平齐、落在同一水平线上；
> - 整体宽度约 650，高度约 420（x-height）；
> - 可以微调重心和弧度，但要一眼能认出是俄语连笔 т。

拿到路径后贴进网页（或存成 glyph/t-new.svg 跑 import）。脚本会自动缩放/翻正/对齐基线，所以 GPT 不需要精确算坐标。

## 坐标规则（脚本自动做）

- 输入坐标任意，y 向上或向下都行
- 字形高度缩放到当前 т 的高度（419 单位）
- 底边贴基线 y=0，左边留白 3
- 前进宽度默认 = 字宽 + 30，可用 --advance 覆盖
- 输出字体中替换 U+0442（т），加 --both 时同时替换 U+043C（м）

## HTTP 接口

    POST /api/preview
    Content-Type: application/json
    {"d": "<path …> 或 M…Z", "both": false, "advance": null}

    → {"ok": true, "advance": 708, "installed": false, "image": "data:image/png;base64,…"}

POST /api/apply 参数相同，会额外写入 public/fonts/rv-hand.woff2。
GET /api/current 返回当前字体的预览图（data URL）。

## 注意

- 写字体后必须升版本（public/sw.js 的 VERSION、public/js/app.js 的 APP_VERSION）再推送，否则用户端可能继续用旧缓存。
- 部署命令：node temp/vocab-site/push-tool/full-push.mjs（需要 GH_TOKEN），或让 Lead 处理。
