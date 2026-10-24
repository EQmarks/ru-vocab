# CONTRACT — 俄语背单词 PWA 工程契约

> 所有参与开发的人都先读本文件。接口与文件归属以本文件为准，改契约先改本文件并通知全组。
> 项目根：俄语-ai/vocab-site/（下称「项目根」）。纯静态站点 + 零依赖 Node 脚本，无 npm 依赖、无构建框架。

## 1. 目标

- 俄语背单词应用，手机 / 电脑浏览器都能用，可添加到主屏幕（PWA）。
- 数据同步：GitHub 私有仓库当后端（Contents API），也可纯本地使用并导出/导入 JSON。
- 学习模型：SM-2 改良版间隔重复；新词按难度递增（12 个主题单元，每单元 60 词，共 720 词）。
- 中文界面，俄语学习内容；桌面端侧栏 + 移动端底部标签栏。

## 2. 目录与文件归属（写前先看，别碰别人的文件）

| 路径 | 归属 | 说明 |
| --- | --- | --- |
| public/index.html | frontend | 唯一 HTML 入口 |
| public/css/app.css（可拆 components.css） | frontend | 全部样式 |
| public/js/app.js | frontend | 路由 + 各视图 + 交互 |
| public/js/audio.js | frontend | 俄语朗读（speechSynthesis） |
| public/js/ui.js | frontend | 通用水合/DOM 小工具 |
| public/sw.js、public/manifest.webmanifest、public/icons/* | frontend | PWA 壳 |
| public/js/sync.js | sync | GitHub 同步客户端 + 合并 |
| public/js/sync-ui.js | sync | 设置页同步面板组件 |
| docs/GITHUB-SYNC.md、docs/DEPLOY.md | sync | 配置与部署说明 |
| public/js/srs.js | lead | 间隔重复算法（纯函数） |
| public/js/store.js | lead | 状态 / 持久化 / 合并 / 会话计划 |
| scripts/*.mjs | lead | 校验、构建、本地服务 |
| data-src/units/NN-slug.json | data | 词库源文件（每人分单元） |
| public/data/words.json | 生成物 | 由 npm run build 生成，不要手改 |
| tests/*.test.mjs | lead + sync | node:test 单测 |

## 3. 词库 schema

每单元一个文件：data-src/units/NN-slug.json（NN 从 01 起，slug 小写英文连字符）。
每单元正好 60 词，word.id 必须为 uNN-001 … uNN-060 连续编号；难度在单元内由易到难排列。

单元对象：

    {
      "id": "u01",
      "title": "第1单元 · 问候与相识",
      "titleRu": "Знакомство",
      "level": "A1",
      "words": [ ... 60 个词条 ... ]
    }

词条对象：

    {
      "id": "u01-001",
      "ru": "привет",
      "stress": "приве́т",
      "tr": "privet",
      "zh": "你好；嗨（非正式）",
      "pos": "感叹词",
      "gender": "м",            // 仅名词必填：м/ж/с/мн；其他词性不填
      "aspect": "нсв",          // 仅动词可选：нсв/св
      "note": "非正式问候",       // 可选，≤60 字
      "level": 1,               // 1 易 … 5 难
      "tags": ["greeting"],     // 可选
      "example": { "ru": "Привет, как дела?", "zh": "你好，最近怎么样？" }
    }

硬规则（校验会打回）：

- ru：小写西里尔字母（可含连字符、空格短语），不得含重音符；
- stress：把重音符 U+0301 直接加在重读元音后面；去掉重音符后必须等于 ru；多音节词正好一个重音符，单音节词不加；含 ё 的词不加（ё 自带重音）；
- tr：小写拉丁转写，可含空格/连字符/撇号；
- zh：中文释义，多义用「；」分隔，≤40 字；
- pos：名词/动词/形容词/副词/代词/数词/前置词/连词/语气词/感叹词/短语 之一；
- level：1-5 整数；
- example.ru：不带重音符，≤120 字符；example.zh：中文翻译；
- 全库不得重复 ru（跨单元去重）。

词条质量要求：只用自己有把握的重音；例句要短、自然、含该词；释义准确，避免生僻义。

## 4. SRS 契约（public/js/srs.js，纯函数）

卡片 Card：{ ease, interval, due, reps, lapses, correct, wrong, last, updatedAt, deleted? }
- interval 单位「天」（浮点，0.007 ≈ 10 分钟）；due 为毫秒时间戳；deleted 为删除墓碑。

导出：

    export const DAY_MS, LEARN_MS
    export const GRADES = [{ g:0, label:'忘了', hint:'' }, ...]  // 0-3
    export function newCard(now)
    export function grade(card, g, now)     // 返回新卡，不改原对象
    export function isDue(card, now)
    export function isMastered(card)
    export function statusOf(card)          // 'new'|'learning'|'review'|'mastered'
    export function formatInterval(days)    // '10 分钟' / '1 天' / '3 周' / '2 月'
    export function preview(card, g)        // 按钮上显示的间隔文案

评级：0 忘了 / 1 模糊 / 2 记得 / 3 简单。算法细节以 srs.js 为准，改算法必须同步 tests/srs.test.mjs。

## 5. Store 契约（public/js/store.js）

    import { store } from './store.js';
    await store.init();               // 拉 data/words.json + localStorage 恢复，失败抛错

只读：

    store.ready                       // boolean
    store.units                       // [{id,title,titleRu,level,words}]
    store.words                       // 全部词（内置 + 自定义）
    store.word(id) / store.unitOf(id)
    store.cards                       // { [wordId]: Card }
    store.settings                    // { newPerDay, reviewPerDay, autoAudio, showTranslit, showExample, theme, updatedAt }
    store.customWords                 // 自定义词数组
    store.statusOf(id, now?)          // new/learning/review/mastered
    store.cardOf(id)
    store.dueIds(now?) / store.newIds(now?)
    store.buildSession(mode, now?)    // mode: 'daily'|'new'|'review' → { items:[{id,kind}], newCount, reviewCount }
    store.todayStat(now?)             // { new, review, correct, wrong }
    store.summary(now?)               // { total, learned, mastered, learning, due, streak, accuracy7d, heatmap:[{date,count}] }

写：

    store.grade(id, g, now?)          // 更新卡片与统计；触发订阅与 onSyncNeeded
    store.addCustomWord({ru,stress,tr,zh,pos,gender,aspect,example:{ru,zh},level})
    store.updateCustomWord(id, patch) / store.deleteCustomWord(id)
    store.setSettings(patch)          // 自动补 updatedAt
    store.resetProgress()             // 清空进度（保留自定义词与设置）
    store.exportPayload()             // 可 JSON.stringify 的同步负载
    store.importPayload(obj, mode)    // mode 'merge'|'replace'
    store.mergeRemote(remote)         // 按 updatedAt 逐项 LWW 合并 → { localChanged, remoteChanged, merged }
    store.flush()
    store.subscribe(fn)               // 返回取消函数；任何状态变化触发
    store.onSyncNeeded(fn)            // 返回取消函数；本地有未推送变更时触发
    store.markSynced(now?)            // 同步成功后记录 meta.lastSyncAt

持久化 key：rv.state.v1；GitHub 配置由 sync 自己存 rv.sync.cfg（token 不出现在任何导出里）。

## 6. GitHub 同步契约（public/js/sync.js）

    import { sync } from './sync.js';
    await sync.init(store);           // 读配置；有配置则尝试拉取合并
    sync.configure({ owner, repo, branch, path, token })  // 校验并保存，然后 pull
    sync.disconnect()
    sync.pull()                       // 拉远端 → store.mergeRemote → 必要时 push
    sync.push()                       // 立即推送（内部处理 409 → 重拉合并重试）
    sync.status()                     // { configured, state:'idle'|'syncing'|'ok'|'error'|'offline', lastSyncAt, error, pending }
    sync.onChange(fn)                 // 状态订阅

- 远端文件结构：JSON，内容即 store.exportPayload()（schema/updatedAt/cards/customWords/settings/stats）。
- 默认 path：russian-vocab/progress.json；默认 branch：main。
- 自动推送：store.onSyncNeeded 后防抖 4 秒；页面 hidden 时立即 flush；上线/可见时先 pull。
- 合并：逐卡 / 逐自定义词 / 逐日统计 / 设置，全部按 updatedAt 取新；本地领先则 push。
- 令牌安全：只存 localStorage，UI 掩码显示，不写日志、不进导出文件。

## 7. 前端契约（public/index.html，frontend 负责）

路由（hash）：

    #/home      今日：新词/复习任务、连续天数、开始按钮、快捷入口
    #/study     学习/复习卡片（支持 ?mode=new|review|daily）
    #/test      测试：选择题、拼写、听音
    #/browse    词表：搜索/筛选/单元分组、单词详情、朗读、添加自定义词
    #/stats     统计：掌握度、热力图、单元进度、正确率
    #/settings  设置：每日上限、显示选项、主题、同步面板、导出/导入、重置

- 必须预留挂载点：设置页内 <div id="sync-panel"></div>，由 sync-ui.js 渲染；设置页只负责放这个容器。
- 全局事件：window.dispatchEvent(new CustomEvent('rv:open-study', { detail:{mode} })) 由 app.js 处理。
- 启动顺序：await store.init() → await sync.init(store) → 渲染当前路由。
- 样式：移动优先，断点 768px；CSS 变量定义颜色/圆角/阴影；支持 prefers-color-scheme 与手动主题；触控目标 ≥44px；安全区 env(safe-area-inset-*)。
- 俄语单词用衬线字体栈（Georgia, 'Times New Roman', serif），重音符必须正常渲染。
- 不引外部 CDN / 字体 / 图片；图标用内联 SVG 或本地文件。

## 8. 代码约定

- 纯 ESM，浏览器直接加载，无打包。全部路径用相对路径（GitHub Pages 子目录可用）。
- 不用任何 npm 依赖（算法题外）。Node 脚本只用 node: 内置模块。
- 所有用户可见文案为中文；俄语原文保留原文。
- 不写 console.log 调试残留；错误要给用户可见提示。
- 文件编码 UTF-8，换行 LF。

## 9. 验收

- npm run validate 通过（0 错误）；npm run build 生成 public/data/words.json；
- npm test 全绿；npm run dev 后 http://localhost:5173 可用；
- 手机 390×844 与桌面 1280×900 布局正常；离线时页面可开（Service Worker）；
- 在 A 设备学几个词 → 推送 → B 设备拉取能看到进度；两设备同时学不同词合并后都在；
- GitHub 未配置时纯本地可用，导出/导入 JSON 可迁移。
