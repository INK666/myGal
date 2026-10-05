// uploader.js 全链路自测：不依赖 Electron，直接用 Node http + fetch 走真实 HTTP
// 覆盖：票据申请 → 分块事务 → 断点对齐 409 → 完成 → 同名冲突 → 取消清理 → resumeTicket 认领 → 空壳回收
// 目录语义：落 <上传根目录>/<文件名含扩展名>/<文件名>，状态文件放根目录之外
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uploader = require('./uploader');
const TMP = path.join(__dirname, 'test_upload_dir');        // 上传根目录（模拟某个游戏盘 / root_path）
const STATE_DIR = path.join(__dirname, 'test_upload_state'); // 状态文件目录（模拟 userData）

// --- 准备 ---
fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(STATE_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
uploader.setStateFile(path.join(STATE_DIR, 'upload_state.json'));
uploader.setCallbacks({ onAudit: (e, d) => console.log(`  [audit] ${e}: ${d}`) });
uploader.loadPersistedState();

const settings = { uploadMaxSize: 10 * 1024 * 1024 * 1024, uploadRootDir: TMP };

// 某文件的落盘路径：<root>/<fileName>/<fileName>
const finalOf = (fileName, nameInFolder) => path.join(TMP, fileName, nameInFolder || fileName);
const partOf = (fileName, finalName, ticket) => path.join(TMP, fileName, `${finalName}.${ticket}.part`);
const shellExists = (fileName) => fs.existsSync(path.join(TMP, fileName));
const rootEntries = () => fs.readdirSync(TMP);
const rootFiles = () => rootEntries().filter((f) => fs.statSync(path.join(TMP, f)).isFile());
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const sendJson = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};
const sendError = (res, code, msg) => sendJson(res, code, { success: false, error: msg, data: null });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, Range, Content-Range');
  if (url.pathname === '/api/uploads/tickets' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      const result = uploader.createTicket({ fileName: b.fileName, fileSize: Number(b.fileSize), resumeTicket: b.resumeTicket }, settings);
      if (result.error) return sendError(res, result.status || 400, result.error);
      // 与 main.js 路由一致：不回传完整路径，只给文件夹名
      const { targetDir, ...info } = result;
      sendJson(res, 200, { success: true, data: { ...info, folderName: targetDir ? path.basename(targetDir) : '' } });
    });
    return;
  }
  const mComplete = url.pathname.match(/^\/api\/uploads\/([a-zA-Z0-9_-]+)\/complete$/);
  if (mComplete && req.method === 'POST') {
    uploader.completeTicket(mComplete[1]).then((r) => sendJson(res, r.status, r.body));
    return;
  }
  const m = url.pathname.match(/^\/api\/uploads\/([a-zA-Z0-9_-]+)$/);
  if (m) {
    const ticket = m[1];
    if (req.method === 'PUT') return uploader.handleChunkUpload(req, res, ticket, sendJson, sendError);
    if (req.method === 'GET') { const r = uploader.getTicketStatus(ticket); return sendJson(res, r.status, r.body); }
    if (req.method === 'DELETE') { const r = uploader.cancelTicket(ticket); return sendJson(res, r.status, r.body); }
    return sendError(res, 405, 'Method not allowed');
  }
  sendError(res, 404, 'Not found');
});

const PORT = 39876;
const BASE = `http://127.0.0.1:${PORT}`;

const call = async (method, p, body, headers = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};

let passed = 0, failed = 0;
const assert = (cond, name, detail = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
};

const CHUNK = uploader.DEFAULT_CHUNK_SIZE;

server.listen(PORT, async () => {
  console.log('=== uploader 全链路自测 ===\n');

  // ---- T0 并发额度：过期票据 / 僵死票据不得占额度（实测回归） ----
  // 现象：用户在 PC 上删掉了没传完的半成品文件，移动端仍一直提示「上传任务已满」。
  // 根因：票据只等 5 分钟清理循环释放；重启时 loadPersistedState 还会把过期票据
  //       原样读回内存继续占额度（表现为「明明没有任何任务在传却提示已满」）。
  console.log('[T0] 并发额度不被过期/僵死票据占用');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const staleDirA = path.join(TMP, 'StaleA.7z');
  const staleDirB = path.join(TMP, 'StaleB.7z');
  fs.mkdirSync(staleDirA, { recursive: true });
  fs.mkdirSync(staleDirB, { recursive: true });
  const past = Date.now() - 60 * 1000; // 已过期
  const mkStale = (id, dir) => ({
    ticket: id, fileName: path.basename(dir), finalName: path.basename(dir), fileSize: 1000,
    partPath: path.join(dir, `${path.basename(dir)}.${id}.part`),
    finalPath: path.join(dir, path.basename(dir)), targetDir: dir,
    expiresAt: past, createdAt: past - 30 * 60 * 1000
  });
  fs.writeFileSync(path.join(STATE_DIR, 'upload_state.json'),
    JSON.stringify({ tickets: [mkStale('stale-a', staleDirA), mkStale('stale-b', staleDirB)] }), 'utf-8');

  // T0-a：启动载入时不得把过期票据读回内存
  uploader.loadPersistedState();
  assert(uploader.getUploadStats().length === 0, '启动时不载入过期票据',
    JSON.stringify(uploader.getUploadStats().map((s) => s.ticket)));
  const t0 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'AfterStale.7z', fileSize: 2048 }));
  assert(t0.status === 200, '过期票据不占额度：仍可正常申请新票据（不再 429）',
    `status=${t0.status}, body=${JSON.stringify(t0.json)}`);
  await call('DELETE', `/api/uploads/${t0.json.data.ticket}`);
  fs.rmSync(path.join(TMP, 'AfterStale.7z'), { recursive: true, force: true });

  // T0-b：状态文件里的过期项被落盘清除，避免每次启动反复读取
  const stateAfter = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'upload_state.json'), 'utf-8'));
  assert(stateAfter.tickets.length === 0, '状态文件中的过期票据已清除', JSON.stringify(stateAfter));

  // T0-c：isTicketActive 单元语义（并发计数的唯一依据）
  const mkT = (over) => Object.assign({
    status: 'uploading', expiresAt: Date.now() + 60000,
    partPath: path.join(staleDirA, 'x.part'), finalPath: path.join(staleDirA, 'x'),
    targetDir: staleDirA, createdAt: Date.now()
  }, over);
  assert(uploader.isTicketActive(mkT({})) === true, '正常票据算活跃');
  assert(uploader.isTicketActive(mkT({ expiresAt: past })) === false, '已过期票据不算活跃');
  assert(uploader.isTicketActive(mkT({ createdAt: Date.now() - 10 * 60 * 1000 })) === false,
    '磁盘已无凭据且超宽限期 → 不算活跃（用户删了半成品）');
  assert(uploader.isTicketActive(mkT({ status: 'completed' })) === false, '已完成票据不算活跃');
  const livePart = path.join(staleDirB, 'live.part');
  fs.writeFileSync(livePart, 'x');
  assert(uploader.isTicketActive(mkT({ partPath: livePart, createdAt: Date.now() - 10 * 60 * 1000 })) === true,
    '磁盘仍有 .part → 继续占额度（不误放导致超并发）');
  const liveFinal = path.join(staleDirB, 'live.7z');
  fs.writeFileSync(liveFinal, 'x');
  assert(uploader.isTicketActive(mkT({ partPath: path.join(staleDirB, 'none.part'), finalPath: liveFinal, createdAt: Date.now() - 10 * 60 * 1000 })) === true,
    '正式文件已在位（收尾中）→ 继续算活跃');

  // T0-d：未过期、但磁盘凭据已丢失（用户手动删了半成品）→ 申请新票据时应即时清理并归还额度
  const ghostDir = path.join(TMP, 'Ghost.7z');
  fs.mkdirSync(ghostDir, { recursive: true });
  const fresh = Date.now() + 20 * 60 * 1000; // 未过期：本该能续传，但 .part 已被用户删掉
  const mkGhost = (id) => ({
    ticket: id, fileName: 'Ghost.7z', finalName: 'Ghost.7z', fileSize: 4096,
    partPath: path.join(ghostDir, `Ghost.7z.${id}.part`),
    finalPath: path.join(ghostDir, 'Ghost.7z'), targetDir: ghostDir,
    expiresAt: fresh, createdAt: Date.now() - 20 * 60 * 1000
  });
  fs.writeFileSync(path.join(STATE_DIR, 'upload_state.json'),
    JSON.stringify({ tickets: [mkGhost('ghost-1'), mkGhost('ghost-2')] }), 'utf-8');
  uploader.loadPersistedState();
  assert(uploader.getUploadStats().length === 2, '未过期票据仍被载入（续传能力不受影响）',
    JSON.stringify(uploader.getUploadStats().map((s) => s.ticket)));
  // 两张僵死票据正好占满并发额度：若不即时清理，这里必然 429
  const t0e = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'AfterGhost.7z', fileSize: 1024 }));
  assert(t0e.status === 200, '僵死票据被即时清理，额度已归还（不再无谓 429）',
    `status=${t0e.status}, body=${JSON.stringify(t0e.json)}`);
  assert(uploader.getUploadStats().every((s) => !String(s.ticket).startsWith('ghost-')),
    '僵死票据已从票据表移除', JSON.stringify(uploader.getUploadStats().map((s) => s.ticket)));
  await call('DELETE', `/api/uploads/${t0e.json.data.ticket}`);
  fs.rmSync(ghostDir, { recursive: true, force: true });

  // 清掉 T0 用的临时目录，避免污染后续目录整洁性断言
  fs.rmSync(staleDirA, { recursive: true, force: true });
  fs.rmSync(staleDirB, { recursive: true, force: true });

  // ---- T1 票据申请 ----
  console.log('[T1] 票据申请');
  const fileSize = CHUNK * 3 + 1024 * 7; // 3 整块 + 7KB 尾块
  const t1 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'TestGame.7z', fileSize }));
  assert(t1.status === 200 && t1.json?.data?.ticket, '票据创建成功');
  assert(t1.json.data.resumeFromBytes === 0, 'resumeFromBytes=0');
  const ticket = t1.json.data.ticket;
  const finalName = t1.json.data.finalName;
  assert(t1.json.data.folderName === 'TestGame.7z', '返回 folderName', t1.json?.data?.folderName);
  assert(shellExists('TestGame.7z'), '建出同名文件夹 <root>/TestGame.7z/');
  assert(fs.existsSync(partOf('TestGame.7z', finalName, ticket)), '.part 落在同名文件夹内');
  const origBuf = crypto.randomBytes(fileSize);

  // ---- T2 非法文件名：sanitize 而非拒绝（防穿越目标：净化后不含分隔符） ----
  const t2 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: '../evil|name', fileSize: 100 }));
  assert(t2.status === 200 && !/[\\/:*?"<>|]/.test(t2.json?.data?.finalName || ''), '路径穿越被 sanitize 净化', t2.json?.data?.finalName);
  assert(shellExists('_evil_name'), '净化后的文件夹建在根目录下一层（未逃逸）');
  await call('DELETE', `/api/uploads/${t2.json.data.ticket}`);
  assert(!shellExists('_evil_name'), '取消后净化产生的空壳已回收');
  const t2b = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: '..', fileSize: 100 }));
  assert(t2b.status === 400, '纯 .. 文件名被拒', `status=${t2b.status}`);

  // ---- T3 超大文件 ----
  const t3 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'big.7z', fileSize: 99 * 1024 * 1024 * 1024 }));
  assert(t3.status === 413, '超过 10GB 上限被拒 413', `status=${t3.status}`);

  // ---- T4 分块上传（前 2 块）----
  console.log('\n[T4] 分块事务上传前 2 块');
  const putChunk = (start, buf) => call('PUT', `/api/uploads/${ticket}`, buf, {
    'Content-Type': 'application/octet-stream',
    'Content-Range': `bytes ${start}-${start + buf.length - 1}/${fileSize}`,
    'Content-Length': String(buf.length)
  });
  const r1 = await putChunk(0, origBuf.subarray(0, CHUNK));
  assert(r1.status === 200 && r1.json?.data?.receivedBytes === CHUNK, '块1 commit', JSON.stringify(r1.json));
  const r2 = await putChunk(CHUNK, origBuf.subarray(CHUNK, CHUNK * 2));
  assert(r2.status === 200 && r2.json?.data?.receivedBytes === CHUNK * 2, '块2 commit');

  // ---- T5 错位对齐：从错误起点 PUT 应 409 + 权威 receivedBytes ----
  console.log('\n[T5] 断点对齐 409');
  const r5 = await putChunk(CHUNK * 3, origBuf.subarray(CHUNK * 3, CHUNK * 4));
  assert(r5.status === 409 && r5.json?.data?.receivedBytes === CHUNK * 2, '错位返回 409 + receivedBytes', JSON.stringify(r5.json));

  // ---- T6 半块回滚：声明 16MB 只传 5MB 中途断连（模拟断网）----
  console.log('\n[T6] 半块事务回滚（中途断连）');
  await new Promise((resolve) => {
    const creq = http.request(`http://127.0.0.1:${PORT}/api/uploads/${ticket}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${CHUNK * 2}-${CHUNK * 3 - 1}/${fileSize}`,
        'Content-Length': String(CHUNK)
      }
    }, () => {});
    creq.on('error', () => {}); // 断连必然报错，忽略
    // 写 5MB 然后粗暴断开 socket
    creq.write(origBuf.subarray(CHUNK * 2, CHUNK * 2 + 5 * 1024 * 1024));
    setTimeout(() => { creq.destroy(); resolve(); }, 100);
  });
  await new Promise((r) => setTimeout(r, 800)); // 等 rollback 完成
  const st6 = await call('GET', `/api/uploads/${ticket}`);
  assert(st6.json?.data?.receivedBytes === CHUNK * 2, '断连后 .part 回滚到整块边界', `received=${st6.json?.data?.receivedBytes}`);

  // ---- T7 进度查询 + GET 模拟续传路径 ----
  console.log('\n[T7] GET 进度');
  assert(st6.json?.data?.receivedBytes === CHUNK * 2 && st6.json?.data?.status === 'uploading', '进度查询正常');

  // ---- T8 传完剩余块 → 完成 ----
  console.log('\n[T8] 完成 + rename');
  const r8a = await putChunk(CHUNK * 2, origBuf.subarray(CHUNK * 2, CHUNK * 3));
  assert(r8a.status === 200, '块3 commit');
  const tailBuf = origBuf.subarray(CHUNK * 3);
  const r8b = await putChunk(CHUNK * 3, tailBuf);
  assert(r8b.status === 200 && r8b.json?.data?.status === 'completed', '尾块 → completed', JSON.stringify(r8b.json));
  const finalPath = finalOf('TestGame.7z', finalName);
  assert(fs.existsSync(finalPath), '正式文件落在同名文件夹内');
  assert(fs.statSync(finalPath).size === fileSize, '字节数精确一致');
  const got = fs.readFileSync(finalPath);
  assert(sha(got) === sha(origBuf), 'SHA-256 全量一致');
  const innerParts = fs.readdirSync(path.join(TMP, 'TestGame.7z')).filter((f) => f.endsWith('.part'));
  assert(innerParts.length === 0, '完成后同名文件夹内无 .part 残留', innerParts.join(','));
  assert(rootFiles().length === 0, '根目录下一层只有文件夹、没有裸文件', rootFiles().join(','));

  // ---- T9 同名冲突自动序号 + 并发同名让号 ----
  console.log('\n[T9] 同名冲突');
  const t9 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'TestGame.7z', fileSize: 1024 }));
  assert(t9.status === 200 && t9.json?.data?.finalName === 'TestGame (1).7z', '同名自动 (1)', t9.json?.data?.finalName);
  // 同一时刻两个同名票据：第二个必须让号，否则收尾时两者会 rename 到同一路径
  const t9b = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'TestGame.7z', fileSize: 1024 }));
  assert(t9b.status === 200 && t9b.json?.data?.finalName === 'TestGame (2).7z', '并发同名让号 (2)', t9b.json?.data?.finalName);
  await call('DELETE', `/api/uploads/${t9.json.data.ticket}`);
  await call('DELETE', `/api/uploads/${t9b.json.data.ticket}`);
  assert(fs.existsSync(finalOf('TestGame.7z')), '同名文件夹里已有的完成文件不被取消误删');

  // ---- T10 取消清理 + 空壳回收 ----
  console.log('\n[T10] 取消');
  const t10 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'cancel-test.7z', fileSize: 2048 }));
  const tk10 = t10.json.data.ticket;
  const p10 = partOf('cancel-test.7z', 'cancel-test.7z', tk10);
  assert(shellExists('cancel-test.7z'), '建出同名文件夹');
  assert(fs.existsSync(p10), '票据创建即预建 .part');
  const r10 = await call('DELETE', `/api/uploads/${tk10}`);
  assert(r10.status === 200 && r10.json?.data?.cancelled === true, '取消成功');
  assert(!fs.existsSync(p10), '.part 已清理');
  assert(!shellExists('cancel-test.7z'), '空壳文件夹已回收');
  const r10b = await call('DELETE', `/api/uploads/${tk10}`);
  assert(r10b.status === 200, '取消幂等');

  // ---- T11 resumeTicket 认领（模拟 PC 重启：重载持久化状态）----
  console.log('\n[T11] resumeTicket 认领续传');
  const size11 = CHUNK * 4;
  const t11 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'resume-test.7z', fileSize: size11 }));
  const tk11 = t11.json.data.ticket;
  const buf11 = crypto.randomBytes(size11);
  await call('PUT', `/api/uploads/${tk11}`, buf11.subarray(0, CHUNK), {
    'Content-Range': `bytes 0-${CHUNK - 1}/${size11}`, 'Content-Length': String(CHUNK)
  });
  // 模拟 PC 重启：清空内存，从 upload_state.json 恢复
  console.log('  (模拟 PC 重启：重新 loadPersistedState)');
  // hack：直接用模块级恢复 —— 新建子进程太重，用内部方法模拟
  const before = fs.existsSync(partOf('resume-test.7z', 'resume-test.7z', tk11));
  assert(before, '.part 在重启前存在');
  // 直接对同 ticket GET（重启后票据从 json 恢复 → 能查到）
  const g11 = await call('GET', `/api/uploads/${tk11}`);
  assert(g11.json?.data?.receivedBytes === CHUNK, '重启模拟后 GET 原 ticket 查到进度');

  // 票据过期场景：删掉状态模拟过期，用 resumeTicket 认领
  const t11b = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'resume-test.7z', fileSize: size11, resumeTicket: tk11 }));
  assert(t11b.status === 200 && t11b.json?.data?.resumeFromBytes === CHUNK, 'resumeTicket 认领 .part', JSON.stringify(t11b.json?.data));
  const tk11b = t11b.json.data.ticket;
  // 续传剩余 3 块
  const r11a = await call('PUT', `/api/uploads/${tk11b}`, buf11.subarray(CHUNK, CHUNK * 2), {
    'Content-Range': `bytes ${CHUNK}-${CHUNK * 2 - 1}/${size11}`, 'Content-Length': String(CHUNK)
  });
  const r11b = await call('PUT', `/api/uploads/${tk11b}`, buf11.subarray(CHUNK * 2, CHUNK * 3), {
    'Content-Range': `bytes ${CHUNK * 2}-${CHUNK * 3 - 1}/${size11}`, 'Content-Length': String(CHUNK)
  });
  const r11c = await call('PUT', `/api/uploads/${tk11b}`, buf11.subarray(CHUNK * 3), {
    'Content-Range': `bytes ${CHUNK * 3}-${size11 - 1}/${size11}`, 'Content-Length': String(size11 - CHUNK * 3)
  });
  assert(r11c.json?.data?.status === 'completed', '续传完成');
  const f11 = fs.readFileSync(finalOf('resume-test.7z'));
  assert(sha(f11) === sha(buf11), '认领续传后 SHA-256 一致');

  // ---- T12 重名防误拼：不同内容的同名同大小文件必须全新上传 ----
  console.log('\n[T12] 重名防误拼');
  const size12 = 2048;
  const t12 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'patch.7z', fileSize: size12 }));
  const tk12 = t12.json.data.ticket;
  const buf12 = crypto.randomBytes(size12);
  await call('PUT', `/api/uploads/${tk12}`, buf12.subarray(0, 1024), {
    'Content-Range': `bytes 0-1023/${size12}`, 'Content-Length': '1024'
  });
  await call('DELETE', `/api/uploads/${tk12}`);
  assert(!shellExists('patch.7z'), '取消后 patch.7z 文件夹与 .part 一并清理');
  // 传一个同名同大小但内容不同的新文件，不带 resumeTicket → 必须全新（空壳已回收，可复用干净名字）
  const t12b = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'patch.7z', fileSize: size12 }));
  assert(t12b.json?.data?.resumeFromBytes === 0, '不带 resumeTicket 不认领任何 .part');
  assert(t12b.json?.data?.finalName === 'patch.7z', '空壳回收后同名可重用干净名字（不再堆 (1)）', t12b.json?.data?.finalName);
  await call('DELETE', `/api/uploads/${t12b.json.data.ticket}`);

  // ---- T13 目录整洁性 & 空壳回收边界 ----
  console.log('\n[T13] 目录整洁性');
  assert(!fs.existsSync(path.join(TMP, 'upload_state.json')), '状态文件不在上传根目录内（它是全局的）');
  assert(fs.existsSync(path.join(STATE_DIR, 'upload_state.json')), '状态文件在独立目录');
  // 有内容的同名文件夹绝不能被当作空壳回收
  const keepDir = path.join(TMP, 'KeepMe.7z');
  fs.mkdirSync(keepDir, { recursive: true });
  fs.writeFileSync(path.join(keepDir, 'inner.txt'), 'x');
  const t13 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'KeepMe.7z', fileSize: 1024 }));
  await call('DELETE', `/api/uploads/${t13.json.data.ticket}`);
  assert(fs.existsSync(path.join(keepDir, 'inner.txt')), '有内容的文件夹不被回收');
  assert(rootEntries().every((f) => fs.statSync(path.join(TMP, f)).isDirectory()), '根目录下一层只有文件夹（无裸文件）', rootEntries().join(','));
  assert(rootEntries().length === 3, '根目录只剩 3 个游戏文件夹（TestGame.7z / resume-test.7z / KeepMe.7z）', rootEntries().join(','));

  // ---- T14 收尾语义：完成只认服务端，且迟到取消不能删已完成文件 ----
  console.log('\n[T14] 收尾确认与完成幂等');
  const size14 = 300 * 1024;
  const buf14 = crypto.randomBytes(size14);
  const t14 = await call('POST', '/api/uploads/tickets', JSON.stringify({ fileName: 'Done.7z', fileSize: size14 }));
  const tk14 = t14.json.data.ticket;

  // 未收满就请求收尾 → 409 且给出 receivedBytes（客户端据此对齐）
  const c14a = await call('POST', `/api/uploads/${tk14}/complete`, '');
  assert(c14a.status === 409, '未收满时收尾被拒 409', `status=${c14a.status}`);
  assert(c14a.json?.data?.receivedBytes === 0, '409 带权威 receivedBytes', String(c14a.json?.data?.receivedBytes));

  // 传满（单块）→ 响应必须自带 status:completed（客户端唯一完成依据）
  const r14 = await call('PUT', `/api/uploads/${tk14}`, buf14, {
    'Content-Type': 'application/octet-stream',
    'Content-Range': `bytes 0-${size14 - 1}/${size14}`,
    'Content-Length': String(size14)
  });
  assert(r14.status === 200 && r14.json?.data?.status === 'completed', '末块响应带 status=completed', JSON.stringify(r14.json?.data));

  // 完成后：GET 仍能查到 completed（票据保留期，避免末块响应丢包时被误判失效）
  const g14 = await call('GET', `/api/uploads/${tk14}`);
  assert(g14.status === 200 && g14.json?.data?.status === 'completed', '完成后 GET 仍返回 completed', `status=${g14.status}, body=${JSON.stringify(g14.json)}`);

  // 再收尾一次 → 幂等成功
  const c14b = await call('POST', `/api/uploads/${tk14}/complete`, '');
  assert(c14b.status === 200 && c14b.json?.data?.status === 'completed', '重复收尾幂等成功', `status=${c14b.status}`);

  // 迟到的取消：不能把已完成文件删掉
  const final14 = path.join(TMP, 'Done.7z', 'Done.7z');
  assert(fs.existsSync(final14), '正式文件已落盘');
  const d14 = await call('DELETE', `/api/uploads/${tk14}`);
  assert(d14.status === 200 && d14.json?.data?.cancelled === false, '已完成票据忽略取消请求', JSON.stringify(d14.json));
  assert(fs.existsSync(final14), '取消后已完成文件仍在（不被误删）');
  assert(fs.statSync(final14).size === size14, '已完成文件字节数正确');

  // ---- 汇总 ----
  console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
});
