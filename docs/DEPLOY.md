# 部署指南

本工程是**纯静态站点 + 零依赖 Node 脚本**：没有 npm 依赖、没有前端构建框架。
「构建」只是把 `data-src/units/*.json` 合并生成 `public/data/words.json`，
之后 `public/` 目录原样丢到任何静态托管即可。

- 站点入口：`public/index.html`
- 构建命令：`npm run build`（= `node scripts/build-data.mjs`）
- 发布目录：`public/`
- 无需 `npm install`（没有依赖）；Node 18+ 即可。

---

## 方案 A：GitHub Pages（推荐）

### A1. 仓库结构

把 **本工程目录（`俄语-ai/vocab-site/` 的全部内容）作为 GitHub 仓库根**：

```
<repo>/
├── .github/workflows/pages.yml   # 本指南附带的自动部署工作流
├── package.json
├── data-src/units/*.json          # 词库源文件
├── scripts/                       # validate / build / serve
├── public/                        # 站点（构建后部署这个目录）
├── tests/
└── docs/
```

> 如果仓库是 monorepo（工程在子目录），需要把 `pages.yml` 里的 `working-directory`、
> `upload-pages-artifact` 的 `path`（改成 `<子目录>/public`）一起调整。

### A2. 启用 GitHub Actions 部署

1. 把整个工程推到仓库的 `main` 分支（`.github/workflows/pages.yml` 要一起提交）；
2. 打开仓库 **Settings → Pages**；
3. **Build and deployment → Source** 选 **GitHub Actions**（不要选 Deploy from a branch）；
4. 等 Actions 跑完：`Actions` 里看到 **Deploy to GitHub Pages** 绿色勾；
5. 站点地址：`https://<用户名>.github.io/<仓库名>/`。

工作流内容：

1. 检出代码 → 装 Node 20；
2. `npm run build` 校验词库并生成 `public/data/words.json`；
3. 用 `upload-pages-artifact` 打包 `public/`；
4. 用 `deploy-pages` 发布。

之后每次 push 到 `main` 自动重新构建部署；也可以在 Actions 页面手动 `Run workflow`。

### A3. 手机添加到主屏幕

- iPhone Safari：打开站点 → 分享按钮 → **添加到主屏幕**；
- Android Chrome：右上角菜单 → **安装应用 / 添加到主屏幕**。

必须在 **HTTPS** 下（`*.github.io` 自带 HTTPS），否则 Service Worker 与安装会被浏览器禁用。

### A4. 注意事项

- **子路径部署**：站点在 `https://<用户名>.github.io/<仓库名>/`，所有资源必须用**相对路径**
  （`./js/app.js`、`data/words.json`，不能用 `/js/app.js`）。工程已遵守该约定，新增资源时也别写死根路径。
- **同步数据不进站点**：学习进度存在你自己的私有 GitHub 仓库（见 `docs/GITHUB-SYNC.md`），
  部署到公开 Pages 也不会公开进度。
- 首次部署若 404：确认 Settings→Pages 的 Source 是 **GitHub Actions**，且 Actions 已成功跑过一次。
- 更新后手机看到旧版：强制刷新一次（Safari 清网站数据 / Chrome 下拉刷新），Service Worker 会更新缓存。

---

## 方案 B：任意静态托管（Netlify / Vercel / Cloudflare Pages）

共同配置：

| 配置项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Publish / Output directory | `public` |
| Install command | 留空（无依赖）或 `npm install`（也很快，因为没有依赖） |
| Node 版本 | 18 或 20 |
| 环境变量 | 无 |

- **Netlify**：New site from Git → 上述三项填好即可；
- **Vercel**：Framework Preset 选 **Other**，Build Command `npm run build`，Output Directory `public`；
- **Cloudflare Pages**：Build command `npm run build`，Build output directory `public`。

这些平台默认给根路径 HTTPS，Service Worker / PWA 安装正常。
若是自建 Nginx/Apache：把 `public/` 整个目录作为站点根，并保证 `sw.js` 不被长期缓存
（建议 `Cache-Control: no-cache`）。

---

## 方案 C：本机运行（开发 / 内网试用）

```bash
cd 俄语-ai/vocab-site
npm run dev        # = node scripts/serve.mjs
```

- 电脑访问：<http://localhost:5173/>
- 手机（同一 Wi-Fi）：终端会打印 `http://<局域网 IP>:5173/`，手机浏览器打开该地址。
  首次可能需要放行 Windows 防火墙的 Node 入站连接。

### 本机模式的限制

- 局域网 `http://192.168.x.x:5173` **不是安全上下文**（浏览器只把 localhost / HTTPS 当安全上下文），
  因此 **Service Worker、离线缓存、PWA 安装会受限或被禁用**，页面本身仍可正常使用；
- GitHub 同步不受影响：`api.github.com` 支持 CORS，只要手机能上网就能同步；
- 想在手机上完整体验 PWA（离线、添加到主屏幕），请用方案 A/B 的 HTTPS 地址，或临时用
  `cloudflared tunnel` / `ngrok` 之类的 HTTPS 隧道指向本机 5173 端口（注意不要长期暴露未受控服务）。

---

## 构建与部署前检查清单

1. `npm run validate`：词库 0 错误（`build` 会自动校验，失败则不产出）；
2. `npm run build`：生成 `public/data/words.json`；
3. `node tests/srs.test.mjs && node tests/store.test.mjs && node tests/sync.test.mjs`：全绿；
4. 本地 `npm run dev` 打开页面，离线再打开一次（验证 Service Worker）；
5. 部署后打开 `https://.../`：检查 DevTools Console 无 404、Application → Service Workers 已激活；
6. 手机安装到主屏幕 → 打开 → 学习几个词 → 设置里配置 GitHub 同步（见 `docs/GITHUB-SYNC.md`）；
7. 另一台设备配同一个私有仓库 → 验证进度合并。

## 常见部署问题

| 现象 | 排查 |
| --- | --- |
| Pages 页面 404 | Source 是否选了 GitHub Actions；Actions 是否成功；仓库是否 Private（私有仓库 Pages 需要 Pro/公开仓库） |
| 页面打开但 JS/CSS 404 | 是否把 `public/` 当成了站点根却用绝对路径引用；本工程路径是相对路径，部署目录必须是 `public` 的内容 |
| `data/words.json` 404 | 部署前没跑 `npm run build`（Pages 工作流已包含该步骤） |
| 改了词库线上没更新 | Actions 是否触发；强刷浏览器 / Service Worker 缓存 |
| 手机无法安装 PWA | 必须 HTTPS；Safari 需通过分享菜单添加 |
| 同步报 404/401 | 见 `docs/GITHUB-SYNC.md` 的「常见错误排查」 |
| 帮助链接打不开 | `docs/` 不在 `public/` 里，部署后站点上的 `docs/GITHUB-SYNC.md` 链接可能 404；完整说明看仓库里的 `docs/GITHUB-SYNC.md`。如需线上可读，可让构建脚本额外把 docs 复制进 `public/docs`（需改 `scripts/build-data.mjs`，由工程负责人评估） |
