// ==========================================
// 移动端上传服务：票据 + 分块事务 + .part 生命周期
// 依据《安卓端上传实现计划.txt》v2.1 实现
// 关键设计：
//   - 整块事务：只有整块完整落盘才推进 receivedBytes，断开回滚到上一整块
//   - receivedBytes 以 .part 物理大小为唯一权威（stat.size），内存仅做缓存
//   - 落盘位置：<上传根目录>/<文件名含扩展名>/<文件名>  —— 每个上传独占一个同名文件夹
//     理由：①与"根目录下一层 = 一个游戏"的既有约定一致，解压就地即可启动（scan-executables 递归 6 层）
//           ②.part 与半成品互不干扰，取消/失败只清自己那份
//           ③不再需要 _incoming 这类内部暂存目录，也就没有"内部目录被当成游戏收录"的问题
//   - 空壳回收：同名文件夹若在取消/过期/失败后已空，立即删除，不留空目录
//   - upload_state.json 放用户数据目录（全局票据表，不属于任何游戏盘），只存元数据、低频写
//   - .part 保留 24h（mtime），PC 重启后可凭原 ticket 续传
//   - 续传认领只认 ticket（resumeTicket），绝不按文件名反查磁盘
//   - 完整性以保证「字节精确」为准（Content-Range + 落盘大小 + 终态 size 三重校验）
// ==========================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_STATE_FILE = 'upload_state.json';
const TICKET_TTL_MS = 30 * 60 * 1000;          // 票据 30 分钟无活动过期
const PART_MAX_AGE_MS = 24 * 60 * 60 * 1000;    // .part 保留 24 小时
const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024;   // 16MB
const MAX_ACTIVE_TICKETS = 2;                  // 并发上限
// 已完成票据保留期：收尾成功后不立即删票据，留一段时间让客户端能反复确认「已完成」
// （否则末块响应一旦丢包，客户端调 /complete 会拿到 404，被误判成票据失效）
const COMPLETED_TTL_MS = 10 * 60 * 1000;
// 僵死票据宽限期：票据未过期、但磁盘上既无 .part 也无正式文件时，视为已失效。
// 典型场景：用户手动删掉了没传完的半成品文件——光删文件不会动票据，必须让票据自己失效。
// 宽限 2 分钟是为了不误伤「刚申请、第一块还没落盘」的正常窗口。
const TICKET_STALE_GRACE_MS = 2 * 60 * 1000;

// 标记完成：状态置 completed + 保留票据 TTL（文件操作已完成，这里只管票据生命周期）
const markCompleted = (ticket, t) => {
  t.status = 'completed';
  t.completedAt = Date.now();
  t.expiresAt = Date.now() + COMPLETED_TTL_MS;
  persistState(); // persistState 会跳过 completed，状态文件不会因此膨胀
};

// ---------- 工具 ----------

const sanitizeFileName = (name) => {
  let n = String(name || '').trim();
  // 过滤 Windows 非法字符与控制字符（与 NativeDownloaderPlugin.java 对齐）
  n = n.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
  n = n.replace(/^[. ]+|[. ]+$/g, '');
  // 拒绝路径穿越形态
  if (!n || n === '.' || n === '..') return '';
  return n;
};

const isPathUnder = (filePath, dirPath) => {
  try {
    const resolvedFile = path.resolve(filePath).toLowerCase();
    const resolvedDir = path.resolve(dirPath).toLowerCase();
    if (resolvedFile === resolvedDir) return false;
    const relative = path.relative(resolvedDir, resolvedFile);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
};

// safeRename：Windows 上 fd 异步释放，rename 可能 EBUSY/EPERM，带退避重试
const safeRename = async (from, to, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      fs.renameSync(from, to);
      return true;
    } catch (err) {
      const code = err?.code || '';
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') throw err;
      if (i === retries - 1) return false;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  return false;
};

// safeUnlink：Windows 文件占用时删不掉记日志下次启动重试
const safeUnlink = (filePath) => {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (err) {
    console.warn(`[uploader] 删除失败(下次启动重试): ${filePath} -> ${err?.message || err}`);
    return false;
  }
};

const getDiskFreeBytes = (dirPath) => {
  try {
    const stat = fs.statfsSync ? fs.statfsSync(dirPath) : null;
    if (stat && typeof stat.bavail === 'number' && typeof stat.bsize === 'number') {
      return stat.bavail * stat.bsize;
    }
  } catch {}
  return null; // 无法探测时返回 null，调用方降级处理
};

// 空壳回收：同名文件夹在取消/过期/失败后若已空，就删掉它，别在游戏盘里攒空目录
// 只删「空」目录 —— 只要里面还有任何东西（用户解压出来的游戏、留着的压缩包）一律保留
const pruneEmptyTargetDir = (dir) => {
  try {
    if (!dir) return false;
    if (!fs.existsSync(dir)) return false;
    if (!fs.statSync(dir).isDirectory()) return false;
    if (fs.readdirSync(dir).length > 0) return false;
    fs.rmdirSync(dir);
    audit('shell-dir-pruned', dir);
    return true;
  } catch {
    return false;
  }
};

// ---------- 模块状态 ----------

// tickets: Map<ticket, { fileName, finalName, fileSize, partPath, finalPath, targetDir, expiresAt, status, createdAt }>
const tickets = new Map();
let stateFilePath = null;
let onUploadComplete = null; // 完成回调（主进程用来发系统通知）
let auditLogger = null;      // 审计日志回调（不记录 Token）

const partName = (finalName, ticket) => `${finalName}.${ticket}.part`;

const setStateFile = (p) => { stateFilePath = p; };
const setCallbacks = ({ onComplete, onAudit } = {}) => {
  if (typeof onComplete === 'function') onUploadComplete = onComplete;
  if (typeof onAudit === 'function') auditLogger = onAudit;
};

const audit = (event, detail = '') => {
  if (typeof auditLogger === 'function') {
    try { auditLogger(event, detail); } catch {}
  }
};

// ---------- upload_state.json：只存元数据，低频写 ----------

const loadPersistedState = () => {
  try {
    if (!stateFilePath || !fs.existsSync(stateFilePath)) return;
    const raw = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    if (!Array.isArray(raw?.tickets)) return;
    const now = Date.now();
    let dropped = 0;
    for (const t of raw.tickets) {
      if (!t?.ticket || !t?.partPath || !t?.fileName || !Number.isFinite(t?.fileSize)) continue;
      if (t.status === 'completed' || t.status === 'failed') continue;
      // 已过期票据绝不载入内存：否则重启后它会白白占着并发额度，
      // 直到 5 分钟清理循环第一次执行才释放（表现为「明明没有任务却提示已满」）。
      // 过期票据本来也无法续传（分块 PUT 会直接 403），丢弃是安全且正确的。
      if (Number(t.expiresAt || 0) <= now) {
        dropped++;
        continue;
      }
      tickets.set(t.ticket, {
        fileName: t.fileName,
        finalName: t.finalName || t.fileName,
        fileSize: t.fileSize,
        partPath: t.partPath,
        finalPath: t.finalPath || path.join(path.dirname(t.partPath), t.finalName || t.fileName),
        targetDir: t.targetDir || path.dirname(t.partPath),
        expiresAt: t.expiresAt || 0,
        status: 'uploading',
        createdAt: t.createdAt || Date.now()
      });
    }
    // 顺手把状态文件里的过期项落盘清掉，避免下次启动反复读取
    if (dropped > 0) {
      audit('state-pruned-on-load', `丢弃 ${dropped} 张过期票据`);
      persistState();
    }
  } catch (err) {
    console.warn('[uploader] 读取 upload_state.json 失败:', err?.message || err);
  }
};

const persistState = () => {
  try {
    if (!stateFilePath) return;
    const list = [];
    for (const [ticket, t] of tickets.entries()) {
      if (t.status === 'completed' || t.status === 'failed') continue;
      list.push({
        ticket,
        fileName: t.fileName,
        finalName: t.finalName,
        fileSize: t.fileSize,
        partPath: t.partPath,
        finalPath: t.finalPath,
        targetDir: t.targetDir,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt
      });
    }
    // 目录按需创建：没真正上传过就不会在磁盘上留下任何痕迹
    const stateDir = path.dirname(stateFilePath);
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify({ tickets: list }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[uploader] 写入 upload_state.json 失败:', err?.message || err);
  }
};

// receivedBytes 权威来源：.part 物理大小
const getReceivedBytes = (t) => {
  try {
    return fs.statSync(t.partPath).size;
  } catch {
    return 0;
  }
};

// 票据是否真正占用并发额度。三个条件同时满足才算「活跃」：
//   ①状态在传（uploading / finalizing）
//   ②尚未过期
//   ③磁盘上还有凭据（.part 或正式文件），或刚申请还没到宽限期
// 第 ③ 条专治「用户删了 .part 但票据还赖着占额度」——已经没有任何字节可续传，
// 这张票据在功能上等同于不存在，必须立刻把额度还回去。
const isTicketActive = (t, now = Date.now()) => {
  if (!t) return false;
  if (t.status !== 'uploading' && t.status !== 'finalizing') return false;
  if (Number(t.expiresAt || 0) <= now) return false;
  try {
    if (fs.existsSync(t.partPath) || fs.existsSync(t.finalPath)) return true;
  } catch {
    return true; // stat 出错时保守认定活跃，宁可占额度也不误删
  }
  return now - Number(t.createdAt || 0) < TICKET_STALE_GRACE_MS;
};

// ---------- 过期清理（挂进主进程已有 5 分钟循环） ----------

const cleanupExpired = () => {
  const now = Date.now();
  let changed = false;
  for (const [ticket, t] of tickets.entries()) {
    if (t.status === 'completed') {
      // 已完成票据：本地文件已就位，只等 TTL 到了把票据记录清掉（期间 GET/complete 可查权威状态）
      if (t.expiresAt <= now) {
        tickets.delete(ticket);
        changed = true;
      }
      continue;
    }
    if (t.status === 'finalizing') {
      // 收尾窗口极短，正常几毫秒内就变 completed；卡在这里且已过期时按「文件是否已就位」判定，
      // 就位就当完成（幂等），没就位就退回 uploading 交下一轮处理——避免这个状态永久占额度。
      if (t.expiresAt <= now) {
        if (fs.existsSync(t.finalPath)) {
          markCompleted(ticket, t);
        } else {
          t.status = 'uploading';
        }
        changed = true;
      }
      continue;
    }
    if (t.status !== 'uploading') continue;
    if (t.expiresAt > now) {
      // 未过期但磁盘上已无任何凭据（用户手动删了半成品文件）→ 票据作废，立即归还并发额度
      if (!isTicketActive(t, now)) {
        pruneEmptyTargetDir(t.targetDir);
        tickets.delete(ticket);
        changed = true;
        audit('stale-released', `${t.fileName} ticket=${ticket}`);
      }
      continue;
    }
    safeUnlink(t.partPath);
    pruneEmptyTargetDir(t.targetDir);
    tickets.delete(ticket);
    changed = true;
    audit('expired', `${t.fileName} (${t.fileSize}) ticket=${ticket}`);
  }
  // 扫 .part：mtime 超 24h 的无主残留清理
  sweepOrphanParts();
  if (changed) persistState();
};

const sweepOrphanParts = (maxAgeMs = PART_MAX_AGE_MS) => {
  try {
    const ticketDirs = new Set();
    for (const t of tickets.values()) {
      if (t.targetDir) ticketDirs.add(path.resolve(t.targetDir));
    }
    const dirs = new Set(ticketDirs);
    if (stateFilePath) dirs.add(path.dirname(path.resolve(stateFilePath)));
    const now = Date.now();
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.part')) continue;
        const fullPath = path.join(dir, entry.name);
        try {
          const st = fs.statSync(fullPath);
          if (now - st.mtimeMs < maxAgeMs) continue;
          // 活跃票据的 .part 跳过（防并发误删）
          let active = false;
          for (const t of tickets.values()) {
            if (path.resolve(t.partPath).toLowerCase() === path.resolve(fullPath).toLowerCase()) { active = true; break; }
          }
          if (!active) {
            safeUnlink(fullPath);
            audit('orphan-part-cleaned', fullPath);
          }
        } catch {}
      }
    }
    // 顺手回收空壳：只针对「已知票据的目标目录」，绝不去猜用户自己的空目录
    for (const dir of ticketDirs) pruneEmptyTargetDir(dir);
  } catch {}
};

// ---------- 票据申请 ----------

// 冲突判定：既要避开已完成文件，也要避开「另一个并发票据已占用的同名 .part」
// （否则两个票据会算出同一个 finalPath，收尾时互相覆盖）
const resolveFinalName = (targetDir, fileName) => {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  const isTaken = (name) => {
    try {
      if (fs.existsSync(path.join(targetDir, name))) return true;
      const prefix = `${name}.`;
      return fs.readdirSync(targetDir).some((f) => f.startsWith(prefix) && f.endsWith('.part'));
    } catch {
      return false;
    }
  };
  let candidate = fileName;
  let idx = 1;
  while (isTaken(candidate)) {
    candidate = `${base} (${idx})${ext}`;
    idx++;
    if (idx > 999) return null;
  }
  return candidate;
};

// 上传根目录（父目录）：文件最终落 <root>/<文件名含扩展名>/<文件名>
const resolveUploadRoot = (settings) =>
  String(settings?.uploadRootDir || settings?.uploadTargetDir || '').trim();

const createTicket = ({ fileName, fileSize, resumeTicket }, settings) => {
  const safeName = sanitizeFileName(fileName);
  if (!safeName) return { error: '文件名不合法', status: 400 };
  if (!Number.isFinite(fileSize) || fileSize <= 0 || !Number.isInteger(fileSize)) {
    return { error: 'fileSize 必须为正整数字节', status: 400 };
  }
  const maxSize = Number(settings.uploadMaxSize) > 0 ? Number(settings.uploadMaxSize) : 10 * 1024 * 1024 * 1024;
  if (fileSize > maxSize) {
    return { error: `文件超过上传上限 ${maxSize} 字节`, status: 413 };
  }

  const rootDir = resolveUploadRoot(settings);
  if (!rootDir || !fs.existsSync(rootDir)) {
    return { error: '上传根目录不可用，请在移动端选择 PC 端已配置的根目录', status: 503 };
  }
  // 同名文件夹（含扩展名）：解压就地即成为标准游戏目录，且与已有真游戏天然不同名
  const targetDir = path.join(rootDir, safeName);
  if (!isPathUnder(targetDir, rootDir) || !isPathUnder(path.join(targetDir, safeName), rootDir)) {
    return { error: '文件名校验失败', status: 400 };
  }
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    return { error: '无法创建上传文件夹: ' + (err?.message || String(err)), status: 503 };
  }

  // 磁盘预检：fileSize × 1.05
  const freeBytes = getDiskFreeBytes(rootDir);
  if (freeBytes !== null && freeBytes < fileSize * 1.05) {
    return { error: `磁盘空间不足，需要约 ${Math.ceil(fileSize * 1.05 / (1024 * 1024 * 1024))} GB（含冗余），当前剩余 ${(freeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`, status: 507 };
  }

  // 并发上限。
  // 关键：计数之前先跑一轮本地清理——过期票据、以及「用户删了半成品」的僵死票据
  // 必须在此刻就归还额度，绝不能等 5 分钟清理循环的下一跳（否则会出现
  // 「已经没有任务在传了，却一直提示上传任务已满」）。
  cleanupExpired();
  let activeCount = 0;
  for (const t of tickets.values()) if (isTicketActive(t)) activeCount++;
  if (activeCount >= MAX_ACTIVE_TICKETS) {
    return { error: '上传任务已达并发上限（2）', status: 429 };
  }

  let resumeFromBytes = 0;
  let finalName = null;

  // 续传认领：只认 resumeTicket，禁止文件名反查
  if (resumeTicket) {
    const old = tickets.get(String(resumeTicket));
    if (old && old.fileName === safeName && old.fileSize === fileSize && fs.existsSync(old.partPath)) {
      const partSize = getReceivedBytes(old);
      if (partSize > 0 && partSize < fileSize) {
        // 旧票据作废，新票据认领同一 .part
        const oldPart = old.partPath;
        const newTicket = crypto.randomBytes(24).toString('base64url');
        const newPart = partName(old.finalName, newTicket);
        try {
          fs.renameSync(oldPart, path.join(targetDir, newPart));
          resumeFromBytes = partSize;
          finalName = old.finalName;
          tickets.delete(String(resumeTicket));
          const t = {
            fileName: safeName,
            finalName,
            fileSize,
            partPath: path.join(targetDir, newPart),
            finalPath: path.join(targetDir, finalName),
            targetDir,
            expiresAt: Date.now() + TICKET_TTL_MS,
            status: 'uploading',
            createdAt: Date.now()
          };
          tickets.set(newTicket, t);
          persistState();
          audit('ticket-resumed', `${safeName} from ${resumeFromBytes} ticket=${newTicket}`);
          return {
            ticket: newTicket,
            finalName,
            resumeFromBytes,
            chunkSize: DEFAULT_CHUNK_SIZE,
            expiresAt: t.expiresAt,
            targetDir
          };
        } catch (err) {
          // 跨目录/跨盘 rename 失败（例如用户本次换了落盘根目录）→ 放弃认领，走全新上传
          audit('resume-abandoned', `${safeName} ticket=${resumeTicket} ${err?.code || err?.message || ''}`);
          resumeFromBytes = 0;
          finalName = null;
        }
      }
      // 旧 .part 不存在 / 已传满 / 认领失败 → 清掉旧票据与残留，走全新上传
      tickets.delete(String(resumeTicket));
      safeUnlink(old.partPath);
      pruneEmptyTargetDir(old.targetDir);
    }
  }

  finalName = resolveFinalName(targetDir, safeName);
  if (!finalName) return { error: '无法分配唯一文件名', status: 500 };

  const ticket = crypto.randomBytes(24).toString('base64url');
  const partPath = path.join(targetDir, partName(finalName, ticket));

  // 预建 0 字节 .part：后续 r+ 定位写不会 ENOENT
  fs.closeSync(fs.openSync(partPath, 'w'));

  const t = {
    fileName: safeName,
    finalName,
    fileSize,
    partPath,
    finalPath: path.join(targetDir, finalName),
    targetDir,
    expiresAt: Date.now() + TICKET_TTL_MS,
    status: 'uploading',
    createdAt: Date.now()
  };
  tickets.set(ticket, t);
  persistState();
  audit('ticket-created', `${safeName} (${fileSize}) ticket=${ticket}`);
  return {
    ticket,
    finalName,
    resumeFromBytes: 0,
    chunkSize: DEFAULT_CHUNK_SIZE,
    expiresAt: t.expiresAt,
    targetDir
  };
};

// ---------- 分块事务 PUT ----------

const parseContentRange = (header) => {
  // Content-Range: bytes <start>-<end>/<total>
  const m = String(header || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) };
};

// 收尾：.part → 正式文件（rename）+ 注销票据 + 通知。幂等：PUT 末块和 /complete 接口都可重复调用。
// 返回 true 表示服务端**确实已完成收尾**——客户端只有拿到 true（或响应里 status:'completed'）才允许报完成。
const finalizeTicket = async (ticket, t) => {
  if (t.status === 'completed') return true;
  t.expiresAt = Date.now() + TICKET_TTL_MS;
  const received = getReceivedBytes(t);
  // .part 已不在：若正式文件已存在，说明上一次收尾其实成功了（幂等判定，不能误报失败）
  if (!fs.existsSync(t.partPath)) {
    if (fs.existsSync(t.finalPath)) {
      markCompleted(ticket, t);
      return true;
    }
    audit('finalize-missing-part', `${t.finalName} ticket=${ticket}`);
    return false;
  }
  if (received !== t.fileSize) return false;

  t.status = 'finalizing';
  const ok = await safeRename(t.partPath, t.finalPath);
  if (!ok) {
    t.status = 'uploading'; // 退回可重试态
    audit('finalize-failed', `${t.finalName} ticket=${ticket}`);
    return false;
  }
  markCompleted(ticket, t);
  audit('completed', `${t.finalName} (${t.fileSize}) ticket=${ticket}`);
  if (typeof onUploadComplete === 'function') {
    try { onUploadComplete({ fileName: t.finalName, filePath: t.finalPath, fileSize: t.fileSize, targetDir: t.targetDir }); } catch {}
  }
  return true;
};

const handleChunkUpload = (req, res, ticket, sendJson, sendError) => {
  const t = tickets.get(ticket);
  if (!t || t.status !== 'uploading') {
    sendError(res, 404, '上传票据不存在或已完成');
    return;  }
  if (t.expiresAt <= Date.now()) {
    safeUnlink(t.partPath);
    pruneEmptyTargetDir(t.targetDir);
    tickets.delete(ticket);
    persistState();
    sendError(res, 403, '上传票据已过期，请重新申请');
    return;
  }

  const range = parseContentRange(req.headers['content-range']);
  const declaredLength = Number(req.headers['content-length'] || '0');

  if (!range) {
    sendError(res, 400, '缺少合法的 Content-Range 头');
    return;
  }
  if (range.total !== t.fileSize) {
    sendError(res, 409, `Content-Range total(${range.total}) 与票据 fileSize(${t.fileSize}) 不一致`);
    return;
  }

  const received = getReceivedBytes(t);
  if (range.start !== received) {
    // 整块边界对齐：返回服务端权威 receivedBytes，客户端据此校正
    sendJson(res, 409, {
      success: false,
      error: '分块起点与服务端不一致，请从 receivedBytes 处重传',
      data: { receivedBytes: received }
    });
    return;
  }
  const expectedLen = range.end - range.start + 1;
  if (range.start + expectedLen > t.fileSize) {
    sendError(res, 400, '分块超出文件总大小');
    return;
  }

  let writeStream = null;
  let chunkBytes = 0;
  let committedBefore = received;
  let aborted = false;
  let lastErr = null;

  const rollback = () => {
    if (aborted) return;
    aborted = true;
    if (writeStream) {
      try { writeStream.destroy(); } catch {}
    }
    // Windows 句柄陷阱：destroy 后立即 truncate 仍可能 EPERM，做一次小退避
    const tryTruncate = (attempt) => {
      try {
        const st = fs.statSync(t.partPath);
        if (st.size !== committedBefore) fs.truncateSync(t.partPath, committedBefore);
      } catch (err) {
        if (attempt < 3) {
          setTimeout(() => tryTruncate(attempt + 1), 200);
        } else {
          lastErr = err;
          console.warn(`[uploader] truncate 回滚失败 ticket=${ticket}:`, err?.message || err);
        }
      }
    };
    tryTruncate(0);
  };

  req.on('aborted', () => { rollback(); });
  res.on('close', () => { if (!res.writableEnded) rollback(); });

  const finishChunk = () => {
    const actual = getReceivedBytes(t);
    const expected = committedBefore + chunkBytes;
    if (actual !== expected) {
      rollback();
      sendError(res, 500, `落盘字节数异常：期望 ${expected} 实际 ${actual}`);
      return;
    }
    // 整块 commit：推进 receivedBytes（即 .part 物理大小）+ 票据续期
    t.expiresAt = Date.now() + TICKET_TTL_MS;

    if (actual === t.fileSize) {
      // 全部收满：收尾。响应里带 status:'completed' 才算成功——
      // 客户端以此为唯一完成依据，避免「rename 没成功却报完成」
      const doFinalize = async () => {
        const ok = await finalizeTicket(ticket, t);
        if (!ok) {
          sendError(res, 500, '最终重命名失败（文件被占用），请稍后重试收尾');
          return;
        }
        sendJson(res, 200, {
          success: true,
          data: { receivedBytes: t.fileSize, status: 'completed', finalName: t.finalName }
        });
      };
      doFinalize();
      return;
    }

    sendJson(res, 200, { success: true, data: { receivedBytes: actual, status: 'uploading' } });
  };

  // 流式写盘 + 背压：严格检查 write() 返回值等 drain，绝不堆积内存
  writeStream = fs.createWriteStream(t.partPath, { flags: 'r+', start: committedBefore });
  writeStream.on('error', (err) => {
    lastErr = err;
    rollback();
    if (!res.headersSent) sendError(res, 500, '写入失败: ' + (err?.message || String(err)));
  });
  writeStream.on('close', () => {
    if (aborted) return;
    if (chunkBytes === expectedLen) finishChunk();
  });

  req.on('data', (chunk) => {
    if (aborted) { req.destroy(); return; }
    chunkBytes += chunk.length;
    if (chunkBytes > expectedLen) {
      // 超出声明长度：恶意或异常请求，回滚
      aborted = true;
      try { writeStream.destroy(); } catch {}
      req.destroy();
      const tryTruncate = (attempt) => {
        try {
          const st = fs.statSync(t.partPath);
          if (st.size !== committedBefore) fs.truncateSync(t.partPath, committedBefore);
        } catch (err) {
          if (attempt < 3) setTimeout(() => tryTruncate(attempt + 1), 200);
        }
      };
      tryTruncate(0);
      if (!res.headersSent) sendError(res, 400, '请求体超出 Content-Range 声明长度');
      return;
    }
    if (!writeStream.write(chunk)) {
      req.pause();
      writeStream.once('drain', () => { if (!aborted) req.resume(); });
    }
  });

  req.on('end', () => {
    if (aborted) return;
    if (chunkBytes !== expectedLen) {
      // 半块：事务回滚，客户端重传整块
      rollback();
      if (!res.headersSent) {
        sendError(res, 400, `分块不完整：期望 ${expectedLen} 字节，实际收到 ${chunkBytes}`);
      }
      return;
    }
    writeStream.end(); // close 事件里 finishChunk
  });
};

// ---------- 进度 / 取消 ----------

const getTicketStatus = (ticket) => {
  const t = tickets.get(ticket);
  if (!t) return { status: 404, body: { success: false, error: '票据不存在或已过期' } };
  if (t.expiresAt <= Date.now() && t.status === 'uploading') {
    safeUnlink(t.partPath);
    pruneEmptyTargetDir(t.targetDir);
    tickets.delete(ticket);
    persistState();
    audit('expired', `${t.fileName} ticket=${ticket}`);
    return { status: 404, body: { success: false, error: '票据已过期，请重新申请（可带 resumeTicket 续传）' } };
  }
  const received = t.status === 'completed' ? t.fileSize : getReceivedBytes(t);
  return {
    status: 200,
    body: {
      success: true,
      data: {
        status: t.status,
        receivedBytes: received,
        fileSize: t.fileSize,
        finalName: t.finalName,
        chunkSize: DEFAULT_CHUNK_SIZE,
        expiresAt: t.expiresAt
      }
    }
  };
};

const cancelTicket = (ticket) => {
  const t = tickets.get(ticket);
  if (!t) return { status: 200, body: { success: true, data: { cancelled: false, note: '票据不存在（幂等成功）' } } };
  if (t.status === 'completed') {
    // 已完成：正式文件已就位，绝不能因为一个迟到的取消请求把文件删掉
    return { status: 200, body: { success: true, data: { cancelled: false, note: '票据已完成，忽略取消' } } };
  }
  safeUnlink(t.partPath);
  pruneEmptyTargetDir(t.targetDir);
  tickets.delete(ticket);
  persistState();
  audit('cancelled', `${t.fileName} ticket=${ticket}`);
  return { status: 200, body: { success: true, data: { cancelled: true } } };
};

// POST /api/uploads/:ticket/complete —— 客户端在「字节已收满但没拿到 completed 确认」时主动请求收尾。
// 幂等：重复调用安全；未收满返回 409 并给出 receivedBytes（客户端据此对齐后继续传）。
const completeTicket = async (ticket) => {
  const t = tickets.get(ticket);
  if (!t) {
    return { status: 404, body: { success: false, error: '上传票据不存在（可能已完成或已过期）' } };
  }
  // 已完成：直接回权威状态（幂等）。注意不能走下面的字节校验——
  // 此时 .part 已被 rename 成正式文件，stat 会得 0。
  if (t.status === 'completed') {
    return {
      status: 200,
      body: { success: true, data: { status: 'completed', finalName: t.finalName, receivedBytes: t.fileSize } }
    };
  }
  const received = getReceivedBytes(t);
  if (received !== t.fileSize) {
    return {
      status: 409,
      body: {
        success: false,
        error: '尚未接收完整，无法收尾',
        data: { receivedBytes: received, fileSize: t.fileSize, status: t.status }
      }
    };
  }
  const ok = await finalizeTicket(ticket, t);
  if (!ok) {
    return { status: 500, body: { success: false, error: '服务端收尾失败（文件可能被占用），请重试', data: { receivedBytes: received } } };
  }
  return {
    status: 200,
    body: { success: true, data: { status: 'completed', finalName: t.finalName, receivedBytes: t.fileSize } }
  };
};

const getUploadStats = () => {
  const list = [];
  for (const [ticket, t] of tickets.entries()) {
    list.push({
      ticket,
      fileName: t.fileName,
      fileSize: t.fileSize,
      receivedBytes: getReceivedBytes(t),
      status: t.status,
      expiresAt: t.expiresAt
    });
  }
  return list;
};

module.exports = {
  setStateFile,
  setCallbacks,
  loadPersistedState,
  cleanupExpired,
  sweepOrphanParts,
  createTicket,
  handleChunkUpload,
  getTicketStatus,
  cancelTicket,
  completeTicket,
  getUploadStats,
  isTicketActive,
  sanitizeFileName,
  TICKET_TTL_MS,
  PART_MAX_AGE_MS,
  TICKET_STALE_GRACE_MS,
  DEFAULT_CHUNK_SIZE,
  MAX_ACTIVE_TICKETS
};
