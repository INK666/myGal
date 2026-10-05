/**
 * 验证 stopApiServer 的关闭行为 —— 复现并锁死「设置页点保存卡住」这个 bug。
 *
 * 背景：PC 端设置页改「允许移动端上传」后点保存，界面卡在「保存中…」不响应。
 *
 * 坑：server.close() 的回调要等**所有已建立连接**关闭才触发，而它自己不会去关它们。
 *     移动端会保持 keep-alive 长连接，若此时正有一个请求在进行（刷新库 / 拉列表 / 上传），
 *     close 回调便迟迟不来 → await stopApiServer() 不 resolve → IPC 不返回 → 按钮卡住。
 *
 * 重要：必须在**真实运行时**下测，Node 18 与 Node 22 对 idle 连接的处理不同！
 *   本机 Electron 28.3.3 内置 Node 18.18.2（应用实际跑的环境）。
 *   跑法：ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe scripts/test-api-server-stop.js
 */
const http = require('http');

const KEEP_ALIVE_TIMEOUT = 120000; // 与 main.js 中 server.keepAliveTimeout 一致
const PROBE_MS = 2500;             // 探测窗口：超过这么久没关掉 → 判定为「卡住」
const API_STOP_GRACE_MS = 2000;    // 与 main.js 中同名常量一致

let passed = 0;
let failed = 0;
const assert = (cond, label, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startServer = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler || ((req, res) => res.end('ok')));
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;
  server.headersTimeout = 120000;
  server.requestTimeout = 180000;
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const countConns = (server) => new Promise((resolve) => {
  server.getConnections((err, count) => resolve(err ? -1 : count));
});

const freeSockets = (agent) =>
  Object.values(agent?.freeSockets || {}).reduce((n, arr) => n + arr.filter((s) => !s.destroyed).length, 0);

// 打完一次请求后保留 agent → 连接进入 idle keep-alive（移动端 App 的常态）
const makeIdleKeepAlive = (port) => new Promise((resolve, reject) => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const req = http.get({ host: '127.0.0.1', port, agent }, (res) => {
    res.resume();
    res.on('end', () => resolve(agent));
  });
  req.on('error', reject);
});

// 连接已建立、请求已发出、但服务器**故意不回应** → 请求处于 in-flight（刷新库/上传进行中）
const makeInFlight = (port) => new Promise((resolve, reject) => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const req = http.get({ host: '127.0.0.1', port, agent }, () => {});
  req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
  req.on('socket', (socket) => {
    if (socket.connecting) socket.once('connect', () => resolve(agent));
    else resolve(agent);
  });
});

// —— 旧逻辑：只有 server.close(cb)，没有断连兜底 ——
const stopOld = (server) => new Promise((resolve) => {
  server.close(() => resolve());
});

// —— 新逻辑：与 main.js 中 stopApiServer 实现保持一致 ——
const stopNew = (server, graceMs = API_STOP_GRACE_MS) => new Promise((resolve) => {
  let settled = false, graceTimer = null, bailTimer = null;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (graceTimer) clearTimeout(graceTimer);
    if (bailTimer) clearTimeout(bailTimer);
    resolve();
  };
  server.close(finish);
  try { server.closeIdleConnections?.(); } catch {}
  graceTimer = setTimeout(() => {
    try { server.closeAllConnections?.(); } catch {}
    bailTimer = setTimeout(finish, 500);
  }, graceMs);
});

// 带探测窗口地测量关闭耗时
const measureStop = async (stopFn, server) => {
  const t0 = Date.now();
  let closed = false;
  const pending = stopFn(server).then(() => { closed = true; });
  await Promise.race([pending, sleep(PROBE_MS)]);
  return { closed, elapsed: Date.now() - t0, pending };
};

(async () => {
  console.log(`运行时 Node ${process.versions.node}  (Electron ${process.versions.electron || 'n/a'})`);
  console.log(`探测窗口 ${PROBE_MS}ms，强断宽限 ${API_STOP_GRACE_MS}ms\n`);

  // ============ 场景 A：空闲 keep-alive 连接 ============
  console.log('=== 场景 A：移动端连着但没在发请求（空闲 keep-alive）===\n');
  {
    const s = await startServer();
    const agent = await makeIdleKeepAlive(s.address().port);
    console.log(`  [诊断] 服务器侧连接数=${await countConns(s)}, agent 空闲 socket=${freeSockets(agent)}`);
    const r = await measureStop(stopOld, s);
    console.log(`  [旧逻辑] closed=${r.closed} 耗时=${r.elapsed}ms`);
    assert(
      !r.closed,
      `旧逻辑：空闲连接导致 close 挂住（用户遇到的卡住）`
    );
    agent.destroy();
    await Promise.race([r.pending, sleep(1200)]); // 松开连接让旧逻辑收尾，避免残留
  }

  // ============ 场景 B：进行中的请求（真正的推手）============
  console.log('\n=== 场景 B：移动端正有请求进行中（刷新库 / 拉列表 / 上传）===\n');
  {
    const s = await startServer(() => { /* 故意不回应 → 请求 in-flight */ });
    const agent = await makeInFlight(s.address().port);
    await sleep(150); // 等请求真正到达服务器
    console.log(`  [诊断] 服务器侧连接数=${await countConns(s)}`);
    const r = await measureStop(stopOld, s);
    console.log(`  [旧逻辑] closed=${r.closed} 耗时=${r.elapsed}ms`);
    assert(!r.closed, '旧逻辑：in-flight 请求导致 close 挂住');
    agent.destroy();
    await Promise.race([r.pending, sleep(1200)]);
  }

  // ============ 场景 C：新逻辑 —— 两种连接状态都必须能关闭 ============
  console.log('\n=== 场景 C：新逻辑（空闲连接）===\n');
  {
    const s = await startServer();
    const agent = await makeIdleKeepAlive(s.address().port);
    const r = await measureStop(stopNew, s);
    assert(r.closed, '新逻辑：空闲连接下能关闭', `耗时 ${r.elapsed}ms`);
    assert(r.elapsed < 600, '新逻辑：空闲连接下耗时 < 600ms（closeIdleConnections 直接断开）', `实测 ${r.elapsed}ms`);
    agent.destroy();
  }

  console.log('\n=== 场景 D：新逻辑（in-flight 请求，宽限后强断）===\n');
  {
    const s = await startServer(() => { /* 不回应 */ });
    const agent = await makeInFlight(s.address().port);
    await sleep(150);
    const r = await measureStop(stopNew, s);
    assert(r.closed, '新逻辑：in-flight 下仍能关闭（绝不永久挂起）', `耗时 ${r.elapsed}ms`);
    assert(
      r.elapsed >= API_STOP_GRACE_MS - 100 && r.elapsed < API_STOP_GRACE_MS + 1500,
      `新逻辑：耗时落在宽限窗口（约 ${API_STOP_GRACE_MS}~${API_STOP_GRACE_MS + 1000}ms）`,
      `实测 ${r.elapsed}ms`
    );
    agent.destroy();
  }

  console.log('\n=== 场景 E：无任何连接（应几乎瞬时）===\n');
  {
    const s = await startServer();
    const r = await measureStop(stopNew, s);
    assert(r.closed && r.elapsed < 200, '新逻辑：无连接时 < 200ms 关闭', `实测 ${r.elapsed}ms`);
  }

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
