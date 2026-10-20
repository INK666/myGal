# myGal 项目长期记忆

## 工程结构约定

- **游戏库语义：root_path 下一层 = 一个游戏**。`import-games`（main.js）只 readdir 根目录一层，每个目录/文件直接入库。因此**任何内部产物都不能直接放在 root_path 根目录**，否则会被当成游戏。
  - 已踩坑：上传暂存目录 `_incoming` 被自动入库成假游戏（game id 26，还带 game_paths 两条 + run_history 一条）。已清理，且加了 `INTERNAL_DIR_NAMES` 黑名单兜底（main.js）。
- **启动 exe 是递归的**：`scan-executables` maxDepth=6（main.js）。所以游戏被多包一层目录仍能启动——这是"上传落同名文件夹、解压就地即用"能成立的前提。
- **移动端上传落盘约定（v3）**：`<所选根目录>/<文件名含扩展名>/<文件名>`。同名文件夹 = 未来解压即用的游戏目录。
- **`upload_state.json` 属于全局票据表**，放 `userData/uploads/`，**不放**任何 root_path 内（放根目录会污染游戏盘，且换根目录后旧票据失联）。

## 本机环境坑

- **活动数据目录是 `%APPDATA%\gamemanage\gamemanage.db`**，不是项目里的 `D:\myGal\electron-data\`（那份 root_paths 为空，是旧的/副本）。`main.js` 里 `app.setPath('userData', __dirname/electron-data)` 只在开发直跑时生效；打包/实际运行用的是 Roaming。
- **读数据库别用项目里的 node**：`node_modules/better-sqlite3` 是为 Electron（ABI 119）编译的，普通 node（ABI 127）加载会报 `NODE_MODULE_VERSION` 不匹配。改用系统 Python 内置 sqlite3（只读打开：`sqlite3.connect('file:<path>?mode=ro', uri=True)`）。
- SQLite 的 `CURRENT_TIMESTAMP` / `created_at` 列存的是 **UTC**，比本地时间少 8 小时，排查时间线时要 +8 才能对上文件 mtime。
- 改 main.js 后必须 `node --check`。**不要再建 `main.js.bak-*` 备份文件** —— `build` 没有 `files` 白名单，备份会被 electron-builder 打进 `app.asar`，污染产物（已在包内搜到过旧代码，白花时间排查）。项目在 git 仓库内，回退交给 git。
- **改完 main.js / uploader.js 必须重跑 `node scripts/build-all.js --pc`**（纯 PC 端约 46 秒，产出 `release/myGal Setup 1.3.5.exe` + `win-unpacked/`）。打包前**必须关掉所有 myGal.exe**，否则 app.asar 被占用直接报错。
  - **master 实际运行的是 `release\win-unpacked\myGal.exe`**（不是安装版），所以打包完重开那个 exe 即生效（要重启，旧进程不会热加载）。
  - 校验产物真带新代码：asar 是明文容器可直接搜，**但绝不要用 `grep -a -c` 统计次数** —— 二进制流的换行切分与源码行不对应，会得出「新形式 2 次、旧形式 1 次」这类假象。**用 Python 字节精确计数**：`open(asar,'rb').read().count(b"<标识符>")`。
  - **已知脏点**：`build` 字段没有 `files` 白名单，electron-builder 默认 `**/*`，于是 `android-app/`（含 src/dist/构建产物）和 `main.js.bak-*` 备份**都会被打进 PC 的 app.asar**（表现为包内能搜到安卓端类名、或搜到旧代码字符串）。排查「包里有旧代码」时先确认命中的是不是这些冗余副本。
- **Git Bash（MSYS）会把以 `/` 开头的命令行参数当路径自动转换**：把 `/api/xxx` 这类字符串传给 CLI 工具时会被改写成 `C:/Users/<用户>/.../PortableGit/versions/<ver>/api/xxx`，表现为「明明代码里有却匹配不到」。传这类参数要加 `MSYS_NO_PATHCONV=1` 前缀（本轮 `verify-apk-assets.py` 的标记检查就踩了这个）。
- **版本号只有 3 处真源**：`package.json`、`android-app/package.json`、`android-app/android/app/build.gradle`（`versionName` 要改，`versionCode` 要 +1）。界面上的版本显示全是**动态读取**（PC 端 `app.getVersion()`，main.js:1515/4604；安卓端经 API 取），**没有任何硬编码**，不用改 UI。`package-lock.json` 里的 version 长期落后于 package.json（1.3.4 vs 1.3.5），不影响构建，顺手同步即可。
- **出包入口**：`一键打包.bat`（交互式：1=全量 2=仅PC 3=仅安卓）→ 底层 `node scripts/build-all.js [--pc|--android] [--open]`。全量产出 `release/myGal Setup <v>.exe` + `release/myGal-Mobile-<v>.apk`（assembleRelease）。
  但 **debug 包要单独再编一次**：`cd android-app/android && ./gradlew :app:assembleDebug`，否则 `app/build/outputs/apk/debug/app-debug.apk` 的 versionName/versionCode 还是旧的。用户会装的可能是任意一个，出包时两个都更新最省事。

## 移动端 ↔ PC 端 数据同步语义

- **自动同步（进 App / 断线重连，`syncOfflineCache(false)`，App.jsx:443）**：**只拉 PC 数据库已有数据**（getTags/getRootPaths/getAllGames），**不调** `/api/library/refresh`、不让 PC 重扫文件系统。所以 PC 端刚拖进根目录的新游戏，进 App 看不到——必须手动刷新（或 PC 端 UI 点刷新）才会被收录。这是刻意的：重扫真读文件系统，大库（4T）每次连接都扫会拖死 PC。
- **移动端刷新（Navbar 刷新按钮 → `App.jsx` 的 `onRefreshList`）**：
  - **在线 → 先让 PC 端重扫游戏库（`POST /api/library/refresh`），成功后再 `syncOfflineCache(true)` 拉最新列表。**
  - 离线 → 只刷移动端本地（`loadMetadata()` + `loadGames(1, false)`），不发任何 PC 请求。
  - PC 端该接口内部调 `runImportGames(null)` —— 即原 `ipcMain.handle('import-games')` 抽出来的**普通函数**（该 handler 不依赖 `event`，可跨 IPC/HTTP 复用），并用模块级 `libraryRefreshInFlight` 做 **Promise 去重**（连点刷新不重复扫描大库）。
  - 移动端**必须对 404 / 任何失败降级为「直接同步」**：老版本 PC 端没有这个路由，不能因为扫描失败阻断刷新。`api.refreshPcLibrary()` 的超时设 **120s**（默认 8s 远不够大库扫描）。
- **搜索口径必须两端一致（4 字段：name / alias / path / tags）**。移动端搜索是**纯本地全量过滤**（`filterOfflineGames`，先过滤全量缓存再前端分页切片），不走 PC 搜索接口；PC 端走 `search-games` → `queryApiGames` 的 SQL。**曾漏 tags 导致移动端搜不到标签**（2026-10-13 修复）。移动端 `g.tags` 是**字符串数组**（PC `processGames` 把 `GROUP_CONCAT` 的逗号串 `split(',')` 了），但 `App.jsx` 的标签自愈逻辑兼容 `{name}` 对象元素，匹配时两种都要处理。

## PC 端主进程（Electron）行为约定

- **主进程行为必须在真实运行时验证，不能拿系统 node 测**：本机 Electron **28.3.3 → 内置 Node 18.18.2**，与系统 Node 22 存在行为差异。
  跑法：`ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script.js>`。
  - **实例（差点误判）**：`server.close()` 对 idle 的 keep-alive 连接，**Node 18 会挂住、Node 22 立即关闭**（Node 19+ 改了此行为）。用 Node 22 测完全复现不出线上问题。
- **`stopApiServer()` 必须保持三重保险，勿简化成裸 `server.close(cb)`**：
  1. `close()` 后立刻 `server.closeIdleConnections()`；
  2. `API_STOP_GRACE_MS`(2s) 后 `server.closeAllConnections()` 强断进行中的请求，再留 500ms 让回调触发；
  3. `settled` 标志 + 兜底 `resolve()`，**任何情况下都必须 resolve**。
  原因：`server.close()` 回调要等**所有已建立连接**关闭才触发，而它**不会主动关连接**。移动端 `downloadManager` 每 **3 秒**轮询 → 连接被反复复用 → `keepAliveTimeout`(120s) **永不到期** → 连接永不 idle → 回调永不触发 → `await stopApiServer()` 永久 pending → 设置页「保存并重启」**无限卡在「保存中…」**（用户只能手动退出，等下去也不会好）。
- **设置项分两类，别一律重启服务**：
  - **需要重启**：只有 `enabled` / `host` / `port`（监听参数）。
  - **不需要重启**：`allowUpload` / `exposeFullPath` / `allowRemoteLaunch` / 上传目录 / 大小上限 —— `handleApiRequest` **第一行就是 `getApiSettingsFromDb()`**，全部**每请求实时读**，保存后下一个请求立即生效。
  - `save-api-settings` 返回 `restarted` 字段供 UI 如实提示；`SettingsModal` 显示「已保存（无需重启，即时生效）」或「已保存并重启」。
- 回归测试：`ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe scripts/test-api-server-stop.js`（旧/新逻辑 × 空闲连接 / in-flight / 无连接，共 7 条）。

## 上传功能的边界

- 完整性保证靠「字节精确」：Content-Range 对齐 + 整块事务 + 终态 size 三重校验；**不做全量 SHA-256**（7GB 全量算会卡几分钟，收益低）。
- 续传只认 `resumeTicket`（票据），**绝不按文件名反查磁盘**（防同名不同内容的误拼）；票据失效时客户端带 resumeTicket 重新 POST 认领。
- 分块事务：只有整块落盘才推进 receivedBytes，断开回滚到上一整块边界；Windows 上 truncate 前必须先 `writeStream.destroy()` 释放句柄，rename 要等 `close` 事件 + 退避重试。
- **完成判定只认服务端**：末块 PUT 响应带 `status:"completed"` 才算完成（服务端 rename 成功后才回）；否则客户端调 `POST /api/uploads/:ticket/complete`（幂等）收尾。已完成票据保留 10 分钟（`COMPLETED_TTL_MS`）再清理，`cancelTicket` 对已完成票据拒绝删除。
- **并发额度的唯一判据是 `isTicketActive(t)`** = 状态在传(含 finalizing) && 未过期 && (磁盘有 `.part` 或正式文件 || 距 createdAt 未超 2min 宽限)。**绝不要再写成「只数 status==='uploading'」**——那样用户手动删掉 `.part` 后票据会一直白占额度，表现为「明明没有任务在传却提示上传任务已满」（已实测踩坑）。
  - 排查该症状的入口：看 `%APPDATA%\gamemanage\uploads\upload_state.json` 里票据的 `expiresAt` 是否已过，以及 `partPath` 指向的 `.part` 是否还存在。
  - 申请票据时**先 `cleanupExpired()` 再计数**；`loadPersistedState` 必须丢弃过期票据（否则重启后白占额度直到 5 分钟循环首次执行）；main.js 启动时 `loadPersistedState()` 后立即 `cleanupExpired()`。

## Capacitor / Android 原生插件坑

- **`PluginCall.getLong(name, default)` 只在值是 `Long` 时返回，其他一律静默返回默认值**（源码：`if (value instanceof Long) return ...; return defaultValue;`）。JS 传来的普通整数被 JSON 解析成 **Integer**，于是 `getLong("fileSize", 0L)` 得到 **0**——曾导致原生上传循环一次不跑却上报「已完成」，PC 端只剩 0 字节 `.part`。**凡是 JS 传数字进原生，一律用 `call.getData().opt(k)` + 自写 Number/String→long 转换**，并注意 `getDouble` 同样不认 Long。
- 同类：`getInt` 只认 Integer、`getDouble` 只认 Double/Float/Integer —— 都不要直接依赖。
- 改完前端资源后，gradle 可能秒回 `BUILD SUCCESSFUL` 却用的旧 assets；**必须打开 APK 校验 `assets/public/assets/index-*.js` 的文件名/大小是否与 `dist/assets/` 一致**。
- `npx cap sync` 会被本机 safe-delete 守卫拦下导致删到一半 → 用 `NODE_OPTIONS= npx cap sync android` 绕过（删的是 cap 自己生成的构建产物，非用户数据）。
- 安卓端高频订阅（下载/上传进度）会让列表每秒重渲染 → 闪屏。修法：行组件 `React.memo` + **传原始值而非被原地修改的对象**（否则 memo 永远判等、UI 卡旧状态）+ 订阅处加签名短路。
- **长列表（几十~几百项）三条硬约定**，违反任一条都会「卡顿 + 显示不全」（247 项的文件浏览页实测踩全了）：
  1. 滚动容器写 `flex-1 overflow-y-auto` 时**必须同时加 `min-h-0`**——flex 子项默认 `min-height:auto`，长内容会把容器顶开，溢出部分被外层 `overflow-hidden` 裁掉，表现为「底部的项既看不到也滚不到」。
  2. **行内禁用 `glass-panel`/任何 `backdrop-filter`**——几百行就是几百个模糊合成层，WebView 掉帧并把来不及合成的行渲染成空白。行改用 `bg-slate-900/75`（与原 `rgba(15,23,42,.75)` 视觉等价，因为后方背景本就不透明）。另把行上 `transition-all` 收窄成 `transition-colors`。
  3. **分批挂载**：首屏 `FILE_PAGE_SIZE`(=60) 项 + 滚到距底 320px 自动续加（`visibleItems`/`growVisible`/`handleListScroll`），切目录/搜索/排序时重置回首批。
  另：行内匹配下载任务别用 `downloadTasks.find()`（每帧 O(n²)），先建 Map 索引（`taskIndex`，键 `p:<relPath>` / `n:<fileName>`，`.zip` 去掉后缀再存一份）。
- **游戏库主列表（数千款）三条约定**（上条长列表规则的延伸，用户有 4T 库，必须遵守）：
  1. `GameCard` 必须 `React.memo` + **字段级比较**（`arePropsEqual` 只看 `id/name/alias/pinned/hasCover/coverUrl/updatedAt/tags` + viewMode + onSelect），且父组件**只能传稳定回调** —— App 里写 `onSelect={setSelectedGame}`（setState 引用恒定）；**一旦写成内联箭头 `onClick={(x)=>...}`，memo 全部失效**。卡片内也不能有 `backdrop-filter`（每卡一个模糊层，改用 `bg-slate-900/75`，与原 glass-panel 的 `rgba(15,23,42,.75)` 视觉等价）。
  2. 卡片外层加 `content-visibility:auto`：index.css 里 `.cv-auto`(320px) / `.cv-auto-grid3`(210px) / `.cv-auto-list`(96px)，`contain-intrinsic-size` 用 `auto <估算>` 让浏览器记住实测高度。**没有这一条，滚动到几百项时合成层会爆**。
  3. **封面预热必须有上限**：`preloadCovers(serverUrl, games, token, onProgress, limit)` 只等首屏 `COVER_PRELOAD_PRIORITY`(=150) 张（进度条只反映这批 → 列表秒开），剩余交给 `startBackgroundCoverFill`（并发 2 + 80ms 节流 + `bgCoverFillRef` 可取消）。**绝不要不传 limit 全量预热** —— 原实现就是全量，几千款游戏会持续几十分钟占满网络 + 海量 IndexedDB 写入。
  - `preloadOneCover(serverUrl, g, token)` = 抽出的单张预热逻辑，两条路径共用。**注意两个阶段的切片语义必须一致（都是「先滤掉无封面者再按序号跳过」），否则改 limit 时会漏网或重复。**
- **CoverImage 必须「缓存优先、网络兜底」**（2026-10-05 修复）：`useState` 初始值**绝不要 `return src`** —— `<img>` 一旦挂上 http 地址浏览器立刻发请求，离线时 N 张卡 = N 个挂起的废请求（img 请求是渲染引擎行为，JS 拦不住，组件不知道离线）。正确顺序：初始 `imageSrc=null`（只显示 spinner）→ effect 里先查内存 blobCache → 再查 IndexedDB（命中即用 blob）→ 都未命中才 `setImageSrc(src)` 走网络。版本不一致走 **stale-while-revalidate**（先显示旧缓存 + 后台静默刷新），**不要弃用缓存直接走网络**（离线必裂开）。render 时 `imageSrc &&` 才渲染 `<img>`（`src={null}` 的 img 会请求当前页）。另：`blobCache`（模块级 Map）重启必清空，冷启动所有封面都要过 IndexedDB，首次 `indexedDB.open()` 的磁盘 I/O 会让封面「晚一拍」——这是正常现象不是丢缓存。
