# GitHub 同步配置与排错

应用把学习进度（卡片、自定义词、每日统计、设置）同步到你自己的 **GitHub 私有仓库**，
用 GitHub Contents API 读写一个 JSON 文件。不需要服务器、不需要数据库，也不经过任何第三方。

- 远端文件默认：`russian-vocab/progress.json`（可改）
- 默认分支：`main`（可改）
- 数据只存在你自己的私有仓库里；站点本身是公开的静态页面，同步数据不在站点里。

> 不配置同步也能正常使用：进度保存在本机浏览器 localStorage，可用「导出 / 导入 JSON」迁移。

---

## 一、准备：创建私有仓库

1. 打开 <https://github.com/new>。
2. **Repository name**：例如 `russian-vocab-progress`（名字随意）。
3. 可见性选 **Private**（必须私有，否则进度会公开）。
4. 勾选 **Add a README file**（很重要：空仓库没有分支，第一次同步会报「仓库为空或分支不存在」）。
5. 点 **Create repository**。
6. 确认仓库的默认分支是 **main**（页面左上角分支下拉框里能看到）。如果是 `master`，同步配置里的分支就要填 `master`。

## 二、准备：创建 fine-grained Personal Access Token

Token 相当于这个仓库的「写入密码」，只给应用用。

1. 打开 <https://github.com/settings/tokens?type=beta>（Settings → Developer settings → Personal access tokens → Fine-grained tokens）。
2. 点 **Generate new token**。
3. 填写：
   - **Token name**：例如 `russian-vocab-sync`
   - **Expiration**：建议 90 天或 1 年（到期前重新生成一次即可）
   - **Resource owner**：你自己
   - **Repository access** → **Only select repositories** → 只勾选刚才创建的私有仓库
   - **Permissions → Repository permissions → Contents**：选 **Read and write**
   - （Metadata 会自动带上 Read-only，保持默认）
4. 点 **Generate token**，立刻复制 `github_pat_...` 开头的字符串。

> Token 只显示一次，关掉页面就再也看不到；丢了就重新生成一个。
> 不推荐用 Classic token（需要 `repo` 大范围权限，能访问你所有仓库）。

## 三、在应用里配置

打开应用 → **设置** → 「同步（GitHub 私有仓库）」区域：

| 字段 | 填什么 | 示例 |
| --- | --- | --- |
| 仓库所有者（owner） | 你的 GitHub **用户名**（不是昵称） | `octocat` |
| 仓库名（repo） | 第 1 步创建的仓库名 | `russian-vocab-progress` |
| 分支（branch） | 仓库默认分支 | `main` |
| 远端文件路径 | 同步文件在仓库里的路径 | `russian-vocab/progress.json` |
| Personal Access Token | 第 2 步复制的 token | `github_pat_...` |

点 **「连接并同步」**：

1. 应用先调用 `GET /repos/{owner}/{repo}` 验证仓库和权限（401/403/404 会直接给出中文提示）；
2. 再检查分支是否存在（空仓库/分支写错会提示先创建 README）；
3. 然后拉取远端文件并合并；远端还没有文件时不算错误，本地有进度会自动推送创建。

token 输入框右侧的「显示 / 隐藏」可切换明文；token 只保存在本机 `localStorage`。

## 四、每台设备各配一次

token 存在**各自浏览器**里，不会互相同步。手机、电脑、平板都要各填一次。
填完第一次后，之后应用启动会自动拉取。

## 五、同步什么时候发生

- 学习/改设置/加自定义词后：防抖 **4 秒**自动推送；
- 页面切到后台/隐藏时：立即推送，避免关页面丢进度；
- 浏览器恢复在线、页面回到前台：先拉取合并，若本地有领先数据再推送；
- 推送失败：状态变「离线 / 同步失败」，保留待推送标记，**60 秒后自动重试，最多 3 次**；恢复在线也会重试；
- 设置页可随时点「立即同步」；顶部状态徽标点一下也会立即拉取。

## 六、冲突合并规则

所有合并都在本地完成（`store.mergeRemote`），逐项比较 `updatedAt`，**新的赢**：

- **每张卡片**：按单词 id 比较，取 `updatedAt` 更新的；卡片被删除时留 `deleted: true` 墓碑，旧设备不会把已删进度复活；
- **每个自定义词**：同上，按 `updatedAt`；删除同样是墓碑；
- **每日统计**：按日期 key 逐日比较 `updatedAt`；
- **设置**：整体取 `updatedAt` 新的那份；
- 拉取后如果发现本地还有远端没有的数据，会自动再推送一次；
- 推送遇到 409（远端刚被别的设备改过）：自动重新读取、合并、用新版本 sha 重试，最多 3 次。

⚠️ 因为按时间戳「新的赢」，请保证设备时间准确（开启「自动设置时间」）。
如果某台设备时钟明显偏快，它的旧操作可能覆盖别的新操作。

## 七、安全提示

- Token ≈ 该仓库的写入密码：**不要截图、不要发群里、不要写进代码/网页/仓库**；
- 只授权一个仓库、只给 Contents 读写，不要给 `repo` 全权限；
- Token 只存本机浏览器 localStorage，不会出现在导出 JSON、日志或同步数据里；界面上始终打码显示；
- 公共电脑用完请点「断开连接」，并撤销 token；
- 换手机/卖设备/怀疑泄露：到 GitHub「Settings → Developer settings → Personal access tokens」**Revoke** 旧 token，重新生成一个，在新设备重配；
- 应用本身不发送任何分析数据，唯一的外部请求就是 `api.github.com`。

## 八、常见错误排查

| 提示 | 原因 | 处理 |
| --- | --- | --- |
| **401 Token 无效或已过期** | token 复制不全、已被撤销、已过期 | 重新生成 token，粘贴完整字符串重配 |
| **403 GitHub 拒绝访问 / 权限不足** | token 没勾选该仓库、只给了只读、或接口限流 | 检查 Repository access 是否只勾了该仓库；Contents 是否为 Read and write；限流（x-ratelimit-remaining: 0）等约 1 小时 |
| **404 仓库不存在或无权限** | owner/repo 拼错；token 未授权该仓库 | 核对用户名与仓库名大小写；重新编辑 token 的仓库授权 |
| **仓库为空或分支不存在** | 仓库没有 README、没有提交、分支名不对 | 在 GitHub 网页给仓库加个 README 并提交；确认分支名（main / master） |
| **409 同步冲突** | 两台设备同时推送 | 通常自动重试会成功；仍失败就再点「立即同步」，或稍等重试 |
| **422 Branch not found** | 分支名写错 / 仓库为空 | 同上，先建 README 提交，确认分支名 |
| **网络错误：无法连接 GitHub** | 断网、公司网络拦截、代理问题 | 检查网络；应用会保留待推送并自动重试 |
| **云端数据版本过新** | 远端数据来自更新版本的应用 | 更新到最新版应用后再同步 |
| **远端同步文件不是合法 JSON** | 手动改坏了 JSON | 见下方「手动恢复」 |

## 九、验证多端同步

1. A 设备学几个词 → 设置里点「立即同步」，状态显示「已同步」；
2. 打开 B 设备（已配置）→ 回到前台会自动拉取，或在设置里点「立即同步」；
3. B 设备能看到 A 的进度；B 再学几个不同的词 → 同步；
4. 回 A 拉取，两台设备的进度应合并（各自独有的卡片都在）；
5. 两台同时学不同词再同步，检查合并后都在——这验证了逐项 LWW 合并。

## 十、手动恢复（JSON 损坏 / 换仓库）

1. 在应用设置里「导出 JSON」到本地，这是最新备份；
2. 到 GitHub 网页打开 `russian-vocab/progress.json`，点右上角铅笔编辑，或用「删除文件」删掉；
3. 回到应用点「立即同步」（远端 404 时会用本地数据重新创建文件）；
4. 如果远端数据更重要：直接编辑远端 JSON 修好标点后再拉取；
5. 换仓库：设置里先「断开连接」，再填新仓库配置并同步。

