# 俄语背单词 · Ру́сский слова́рь

手机和电脑都能用、数据在设备间同步的俄语背单词 PWA。纯静态站点，无需服务器：同步借 GitHub 私有仓库，托管借 GitHub Pages（或任意静态托管）。

## 功能

- **12 个主题单元 / 720 词**，覆盖问候、数字时间、家庭、学习、家居、饮食购物、城市交通、日常天气、健康运动、休闲影音、旅行、情感性格；单元难度由 A1 递增到 B1，单元内也由易到难。
- **间隔重复（SM-2 改良版）**：忘了 / 模糊 / 记得 / 简单四档评分，自动安排下次复习；每日新词与复习上限可调。
- **学习 / 测试 / 词表 / 统计 / 设置** 五个主界面；选择题（俄→中、中→俄、听音）与拼写测试。
- **俄语发音**：浏览器语音合成（ru-RU），无需联网音频文件。
- **重音标注**：每个词带重音符（U+0301），手机电脑都清晰显示。
- **自定义生词**：可随时添加教材/课堂生词，带重音、性别、体、例句，纳入同一套复习。
- **多端同步**：GitHub 私有仓库当后端，逐词「最后修改胜出」合并，A 手机学的和 B 电脑学的都在。
- **PWA**：可添加到手机主屏幕，离线可打开（HTTPS 或本机 localhost）。

## 快速开始（电脑）

需要 Node.js 18+（不用 npm install，项目零依赖）。

    cd 俄语-ai/vocab-site
    npm run dev

浏览器打开 http://localhost:5173 。

## 手机上打开

1. 电脑和手机连同一个 Wi-Fi；
2. 运行 npm run dev，终端会打印「手机访问: http://192.168.x.x:5173/」；
3. 手机浏览器输入该地址即可。

注意：局域网 http 地址能正常学习与同步，但 Service Worker/离线缓存与「添加到主屏幕」需要 HTTPS，正式用请按下一节部署到 GitHub Pages（自带 HTTPS）。

## 部署到 GitHub Pages（推荐，手机随时可用）

1. 在 GitHub 新建仓库（公开私有均可，私有仓库的 Pages 需要付费计划；建议公开仓库放站点、私有仓库放进度数据）；
2. 把本目录（俄语-ai/vocab-site 里的内容）推到这个仓库根目录；
3. 仓库 Settings → Pages → Source 选 GitHub Actions；工程自带 .github/workflows/pages.yml，推送后自动构建 public/ 并发布；
4. 得到 https://<用户名>.github.io/<仓库名>/ ，手机打开后可「添加到主屏幕」。

详细步骤与备选托管见 docs/DEPLOY.md。

## 配置同步（GitHub 私有仓库）

1. 新建一个**私有**仓库（例如 russian-vocab-sync），初始化 README；
2. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens，新建 token：只授权这个私有仓库，权限 Contents: Read and write；
3. 打开应用 → 设置 → 同步：填 owner、repo、branch（main）、文件路径（russian-vocab/progress.json）、token，点「连接并同步」；
4. 手机、电脑各配一次（token 相同），之后自动同步。

安全提示：token 等同于密码，只存在本机浏览器；不要截图/分享，泄露后去 GitHub 撤销重发。进度数据只存在你的私有仓库，站点本身不保存任何用户数据。

更细的说明和错误排查见 docs/GITHUB-SYNC.md。

## 数据与隐私

- 学习进度默认只在本机浏览器（localStorage）；配置 GitHub 后才上传到你自己的私有仓库。
- 导出的 JSON 备份不包含 token。
- 「重置进度」会清空学习记录（云端旧记录也会被墓碑覆盖，不会复活）。

## 词库

- 内置 720 词按主题分 12 单元，难度 A1→B1 递增，每词带重音、转写、中文释义、词性/性/体、例句。
- 参考大学俄语（东方新版）第一册的入门主题编排，但**不是教材原文照搬**；教材生词可用「添加生词」自行补充。
- 词库源文件在 data-src/units/*.json，改完执行 npm run build 重新生成 public/data/words.json。

## 目录结构

    vocab-site/
    ├── public/            站点根目录（部署时发布它）
    │   ├── index.html
    │   ├── css/  js/  icons/
    │   ├── data/words.json   由构建生成
    │   ├── manifest.webmanifest  sw.js
    ├── data-src/units/    词库源（12 个 JSON）
    ├── scripts/           serve / build / validate / audit
    ├── tests/             node:test 单测
    ├── docs/              契约、同步、部署说明
    └── package.json

## 开发命令

    npm run dev       本地服务器（0.0.0.0:5173，打印局域网地址）
    npm run build     合并词库 → public/data/words.json
    npm run validate  词库校验（结构、重音、转写、去重）
    npm run audit     词库复核辅助（例句/释义/转写可疑项）
    npm test          SRS / store / 同步 单测（直接 node 跑，不 spawn）

## 常见问题

- **手机打不开**：确认同一 Wi-Fi、电脑防火墙放行 5173 端口；或改用 GitHub Pages。
- **没有声音**：浏览器/系统缺少俄语语音包；Chrome/Edge 可在系统设置里安装「俄语」语音。
- **同步报 401/403/404**：token 失效、权限不足或仓库名写错，见 docs/GITHUB-SYNC.md。
- **同步冲突**：按每个词的修改时间合并，不会整份覆盖；两端都学过的词以最后修改为准。