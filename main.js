const { app, BrowserWindow, dialog, ipcMain, shell, protocol, screen, desktopCapturer, net, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const uploader = require('./uploader');
const UPLOAD_STATE_FILE = 'upload_state.json';

const isDev = process.argv.includes('--dev') || !app.isPackaged;

if (isDev) {
  app.setPath('userData', path.join(__dirname, 'electron-data'));
  app.setPath('cache', path.join(__dirname, 'electron-data', 'Cache'));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (app.isReady()) {
      showMainWindow();
      return;
    }
    app.once('ready', () => showMainWindow());
  });
}

let mainWindow;
let db;
let tray;
let isQuitting = false;

const getCoversDir = () => path.join(app.getPath('userData'), 'covers');
const getBackgroundsDir = () => path.join(app.getPath('userData'), 'backgrounds');

const isPathUnderDirectory = (filePath, dirPath) => {
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

const getArchiveCacheDir = () => path.join(app.getPath('userData'), 'archive_cache');

const safeUnlinkArchive = (archivePath) => {
  if (!archivePath || typeof archivePath !== 'string') return;
  const cacheDir = getArchiveCacheDir();
  // 严格安全四重防御机制：绝对不触碰任何用户游戏原文件
  // 1. 目标必须严格位于 App 的 archive_cache 专属目录下，绝不可在游戏目录或其它任何外部路径
  if (!isPathUnderDirectory(archivePath, cacheDir)) return;
  // 2. 文件名必须以专属临时打包命名前缀 mygal_archive_ 开头并以 .zip 结尾
  const fileName = path.basename(archivePath);
  if (!fileName.startsWith('mygal_archive_') || !fileName.endsWith('.zip')) return;
  // 3. 严格必须为单文件实体，绝不允许删除任何目录结构
  try {
    if (!fs.existsSync(archivePath)) return;
    const st = fs.statSync(archivePath);
    if (!st.isFile()) return;
    // 4. 执行单文件物理删除
    fs.unlinkSync(archivePath);
  } catch {}
};

const cleanArchiveCache = (maxAgeMs = 12 * 60 * 60 * 1000) => {
  try {
    const dir = getArchiveCacheDir();
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith('mygal_archive_') && entry.name.endsWith('.zip')) {
        const fullPath = path.join(dir, entry.name);
        try {
          const st = fs.statSync(fullPath);
          if (now - st.mtimeMs >= maxAgeMs) {
            safeUnlinkArchive(fullPath);
          }
        } catch {}
      }
    }
  } catch {}
};
const safeUnlinkCover = (coverPath, excludeGameId = null) => {
  if (!coverPath) return;
  if (typeof coverPath !== 'string') return;
  if (!path.isAbsolute(coverPath)) return;

  if (db) {
    try {
      const query = excludeGameId !== null && excludeGameId !== undefined
        ? db.prepare('SELECT COUNT(*) as count FROM games WHERE cover_path = ? AND id != ?').get(coverPath, excludeGameId)
        : db.prepare('SELECT COUNT(*) as count FROM games WHERE cover_path = ?').get(coverPath);
      if (query && query.count > 0) {
        return;
      }
    } catch {}
  }

  const coversDir = getCoversDir();
  const legacyCoversDir = path.join(__dirname, 'covers');
  const allow =
    isPathUnderDirectory(coverPath, coversDir) ||
    isPathUnderDirectory(coverPath, legacyCoversDir);
  if (!allow) return;

  try {
    if (fs.existsSync(coverPath)) {
      fs.unlinkSync(coverPath);
    }
  } catch {}
};

const safeUnlinkBackground = (bgPath) => {
  if (!bgPath) return;
  if (typeof bgPath !== 'string') return;
  if (!path.isAbsolute(bgPath)) return;

  const backgroundsDir = getBackgroundsDir();
  const allow = isPathUnderDirectory(bgPath, backgroundsDir);
  if (!allow) return;

  try {
    if (fs.existsSync(bgPath)) {
      fs.unlinkSync(bgPath);
    }
  } catch {}
};

const sanitizeFilenameComponent = (value) => {
  if (!value) return 'cover';
  const cleaned = String(value)
    .replace(/[\x00-\x1F<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || 'cover';
};

const parseRegexInput = (raw, defaultFlags = '') => {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  if (text.startsWith('/') && text.length >= 2) {
    const lastSlash = text.lastIndexOf('/');
    if (lastSlash > 0) {
      const pattern = text.slice(1, lastSlash);
      const flags = text.slice(lastSlash + 1);
      if (/^[a-z]*$/i.test(flags)) {
        return new RegExp(pattern, flags);
      }
    }
  }
  return new RegExp(text, defaultFlags);
};

const applyCustomRegex = (rawTitle, cfg = {}, { strict = false } = {}) => {
  let value = '';
  try {
    value = String(rawTitle ?? '');
  } catch {
    value = '';
  }
  if (!value) return value;
  if (value.length > 5000) value = value.slice(0, 5000);

  const replaceRegexRaw = cfg?.replaceRegex ?? cfg?.replacePattern ?? '';
  const replaceToRaw = cfg?.replaceTo ?? '';
  const extractRegexRaw = cfg?.extractRegex ?? cfg?.extractPattern ?? '';

  const replaceRegexText = String(replaceRegexRaw ?? '').trim();
  const extractRegexText = String(extractRegexRaw ?? '').trim();

  if (replaceRegexText) {
    if (replaceRegexText.length > 500) {
      if (strict) throw new Error('替换正则过长');
    } else {
    try {
      const re = parseRegexInput(replaceRegexRaw, 'g');
      if (re) value = value.replace(re, String(replaceToRaw ?? ''));
    } catch (e) {
      if (strict) {
        const msg = e?.message || String(e);
        throw new Error(`替换正则无效：${msg}`);
      }
    }
    }
  }

  if (extractRegexText) {
    if (extractRegexText.length > 500) {
      if (strict) throw new Error('提取正则过长');
    } else {
    try {
      const re = parseRegexInput(extractRegexRaw, '');
      if (re) {
        const m = re.exec(value);
        value = m ? String((m.length > 1 ? m[1] : m[0]) ?? '') : '';
      }
    } catch (e) {
      if (strict) {
        const msg = e?.message || String(e);
        throw new Error(`提取正则无效：${msg}`);
      }
    }
    }
  }

  return value;
};

const normalizeGameTitle = (rawName) => {
  let name = '';
  try {
    name = String(rawName ?? '').trim();
  } catch {
    name = '';
  }
  if (!name) return '';

  name = name.replace(/^[._-]+/, '').trim();

  const knownSuffixes = [
    '.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst',
    '.zip', '.rar', '.7z', '.iso', '.cab',
    '.gz', '.bz2', '.xz', '.zst',
    '.exe', '.msi', '.bin', '.dmg', '.pkg',
    '.nsp', '.xci', '.cia', '.wbfs', '.rvz', '.cso', '.chd'
  ];

  while (true) {
    const before = name;
    const lower = name.toLowerCase();

    for (const suffix of knownSuffixes) {
      if (lower.endsWith(suffix)) {
        name = name.slice(0, -suffix.length).trim();
        break;
      }
    }

    name = name.replace(/(\.part\d+|\.\d{3,4})$/i, '').trim();

    const dotAscii = name.indexOf('.');
    const dotFull = name.indexOf('．');
    const dotCn = name.indexOf('。');
    const dotIndices = [dotAscii, dotFull, dotCn].filter((n) => n !== -1);
    const dotIndex = dotIndices.length > 0 ? Math.min(...dotIndices) : -1;
    if (dotIndex > 0 && dotIndex < name.length - 1) {
      const tail = name.slice(dotIndex + 1);
      if (!/\s/.test(tail)) {
        name = name.slice(0, dotIndex).trim();
      }
    }

    if (name === before) break;
  }

  name = name
    .replace(/[\[\(（【［].*?[\]\)）】］]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hintKeywords = ['解压', '密码'];
  let hintIndex = -1;
  for (const k of hintKeywords) {
    const idx = name.indexOf(k);
    if (idx !== -1 && (hintIndex === -1 || idx < hintIndex)) {
      hintIndex = idx;
    }
  }
  if (hintIndex !== -1) {
    name = name.slice(0, hintIndex).replace(/\s+/g, ' ').trim();
  }

  name = name.replace(/[._-]+$/g, '').trim();
  name = name.replace(/(?:\s*[-_ ]*(?:ver|v)\s*[0-9])$/i, '').trim();

  return name;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const fetchFn = typeof net?.fetch === 'function' ? net.fetch.bind(net) : fetch;
  const maxRetries = 4;
  const baseBackoffMs = 500;
  const maxBackoffMs = 15000;

  const parseRetryAfterMs = (value) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.round(seconds * 1000));
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return null;
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { ...options, signal: controller.signal });
      if (res.status !== 429 || attempt === maxRetries) {
        return res;
      }

      const retryAfterMs = parseRetryAfterMs(res.headers?.get?.('retry-after'));
      const expBackoff = Math.min(maxBackoffMs, baseBackoffMs * (2 ** attempt));
      const jitter = Math.floor(Math.random() * 250);
      const waitMs = Math.min(maxBackoffMs, (retryAfterMs ?? expBackoff) + jitter);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const downloadImageBuffer = async (url) => {
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'GameManage/1.0'
    }
  });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const getSettingValue = (key) => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value ?? null;
  } catch {
    return null;
  }
};

const getBooleanSetting = (key, defaultValue = true) => {
  const raw = getSettingValue(key);
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultValue;
};

let igdbAuthCache = { token: null, expiresAt: 0 };

const getIgdbAccessToken = async (clientId, clientSecret) => {
  const now = Date.now();
  if (igdbAuthCache.token && igdbAuthCache.expiresAt > now) {
    return igdbAuthCache.token;
  }

  const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);
  tokenUrl.searchParams.set('grant_type', 'client_credentials');

  const res = await fetchWithTimeout(tokenUrl.toString(), { method: 'POST' }, 15000);
  if (!res.ok) {
    throw new Error(`igdb token failed: ${res.status}`);
  }
  const json = await res.json();
  const token = json?.access_token;
  const expiresIn = Number(json?.expires_in || 0);
  if (!token || !expiresIn) {
    throw new Error('igdb token invalid');
  }
  igdbAuthCache = {
    token,
    expiresAt: now + Math.max(0, (expiresIn * 1000) - 60_000)
  };
  return token;
};

let ymgalAuthCache = { token: null, expiresAt: 0 };

const getYmgalAccessToken = async () => {
  const now = Date.now();
  if (ymgalAuthCache.token && ymgalAuthCache.expiresAt > now) {
    return ymgalAuthCache.token;
  }

  const clientId = getSettingValue('ymgalClientId') || 'ymgal';
  const clientSecret = getSettingValue('ymgalClientSecret') || 'luna0327';

  const tokenUrl = new URL('https://www.ymgal.games/oauth/token');
  tokenUrl.searchParams.set('grant_type', 'client_credentials');
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);
  tokenUrl.searchParams.set('scope', 'public');

  const res = await fetchWithTimeout(tokenUrl.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'GameManage/1.0',
      Accept: 'application/json;charset=utf-8'
    }
  }, 15000);
  if (!res.ok) {
    throw new Error(`ymgal token failed: ${res.status}`);
  }
  const json = await res.json();
  const token = json?.access_token;
  const expiresIn = Number(json?.expires_in || 0);
  if (!token) {
    throw new Error('ymgal token invalid');
  }

  ymgalAuthCache = {
    token,
    expiresAt: now + Math.max(0, ((expiresIn || 3600) * 1000) - 60_000)
  };
  return token;
};

const trySteamGridDbCover = async (title) => {
  const apiKey = getSettingValue('steamgriddbApiKey');
  if (!apiKey) return null;

  const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`;
  const searchRes = await fetchWithTimeout(searchUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'GameManage/1.0'
    }
  });
  if (!searchRes.ok) {
    return null;
  }
  const searchJson = await searchRes.json();
  const first = Array.isArray(searchJson?.data) ? searchJson.data[0] : null;
  const sgdbGameId = first?.id;
  if (!sgdbGameId) return null;

  const gridsUrl = `https://www.steamgriddb.com/api/v2/grids/game/${sgdbGameId}?dimensions=600x900&types=static`;
  const gridsRes = await fetchWithTimeout(gridsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'GameManage/1.0'
    }
  });
  if (!gridsRes.ok) {
    return null;
  }
  const gridsJson = await gridsRes.json();
  const grid = Array.isArray(gridsJson?.data) ? gridsJson.data[0] : null;
  const url = grid?.url;
  if (!url) return null;

  return { provider: 'SteamGridDB', url };
};

const tryIgdbCover = async (title) => {
  const clientId = getSettingValue('igdbClientId');
  const clientSecret = getSettingValue('igdbClientSecret');
  if (!clientId || !clientSecret) return null;

  const token = await getIgdbAccessToken(clientId, clientSecret);
  const body = `search "${title.replace(/"/g, '\\"')}"; fields name,cover.image_id; limit 5;`;
  const res = await fetchWithTimeout('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain'
    },
    body
  });
  if (!res.ok) return null;

  const json = await res.json();
  const first = Array.isArray(json) ? json.find(g => g?.cover?.image_id) : null;
  const imageId = first?.cover?.image_id;
  if (!imageId) return null;

  const url = `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${imageId}.jpg`;
  return { provider: 'IGDB', url };
};

const tryVndbV2Cover = async (title) => {
  const res = await fetchWithTimeout('https://api.vndb.org/kana/vn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'GameManage/1.0'
    },
    body: JSON.stringify({
      filters: ['search', '=', title],
      fields: 'title,image.url,developers.name',
      results: 5
    })
  }, 15000);
  if (!res.ok) return null;

  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const first = results.find(r => r?.image?.url) || null;
  const url = first?.image?.url;
  if (!url) return null;

  const devs = Array.isArray(first?.developers) ? first.developers : [];
  const vendors = uniqCaseInsensitive(devs.map((d) => (typeof d === 'string' ? d : d?.name)).filter(Boolean));

  return { provider: 'VNDBv2', url, vendors };
};

const tryYmgalCover = async (title) => {
  const buildUrl = () => {
    const u = new URL('https://www.ymgal.games/open/archive/search-game');
    u.searchParams.set('mode', 'accurate');
    u.searchParams.set('keyword', title);
    u.searchParams.set('similarity', '70');
    return u.toString();
  };

  const request = async (token) => {
    return await fetchWithTimeout(buildUrl(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'GameManage/1.0',
        Accept: 'application/json;charset=utf-8',
        version: '1'
      }
    }, 15000);
  };

  let token = await getYmgalAccessToken();
  let res = await request(token);
  if (res.status === 401 || res.status === 403) {
    ymgalAuthCache = { token: null, expiresAt: 0 };
    token = await getYmgalAccessToken();
    res = await request(token);
  }
  if (!res.ok) return null;

  const json = await res.json();
  const data = json?.data ?? null;

  const pickMainImg = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) {
      const picked = value.find(v => v?.mainImg || v?.main_img || v?.main_image) || null;
      return picked?.mainImg || picked?.main_img || picked?.main_image || null;
    }
    if (typeof value === 'object') {
      return value?.mainImg || value?.main_img || value?.main_image || null;
    }
    return null;
  };

  const url =
    pickMainImg(data?.game) ||
    pickMainImg(data?.games) ||
    pickMainImg(data?.list) ||
    pickMainImg(data) ||
    null;
  if (!url) return null;

  return { provider: 'Ymgal', url };
};

const tryVndbCover = async (title) => {
  const token = getSettingValue('vndbToken');
  if (!token) return null;

  const request = async (authorization) => {
    const res = await fetchWithTimeout('https://api.vndb.org/kana/vn', {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        'User-Agent': 'GameManage/1.0'
      },
      body: JSON.stringify({
        filters: ['search', '=', title],
        fields: 'title,image.url,developers.name',
        results: 5
      })
    }, 15000);
    return res;
  };

  let res = await request(`token ${token}`);
  if (res.status === 401 || res.status === 403) {
    res = await request(`Bearer ${token}`);
  }
  if (!res.ok) return null;

  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const first = results.find(r => r?.image?.url) || null;
  const url = first?.image?.url;
  if (!url) return null;

  const devs = Array.isArray(first?.developers) ? first.developers : [];
  const vendors = uniqCaseInsensitive(devs.map((d) => (typeof d === 'string' ? d : d?.name)).filter(Boolean));

  return { provider: 'VNDB', url, vendors };
};

const tryVndbV2Vendors = async (title) => {
  const res = await fetchWithTimeout('https://api.vndb.org/kana/vn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'GameManage/1.0'
    },
    body: JSON.stringify({
      filters: ['search', '=', title],
      fields: 'title,developers.name',
      results: 5
    })
  }, 15000);
  if (!res.ok) return [];

  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const first = results.find(r => Array.isArray(r?.developers) && r.developers.length > 0) || null;
  const devs = Array.isArray(first?.developers) ? first.developers : [];
  return uniqCaseInsensitive(devs.map((d) => (typeof d === 'string' ? d : d?.name)).filter(Boolean));
};

const pickBestSteamApp = (apps, title) => {
  const norm = title.toLowerCase();
  const exact = apps.find(a => String(a?.name || '').toLowerCase() === norm);
  if (exact) return exact;
  const starts = apps.find(a => String(a?.name || '').toLowerCase().startsWith(norm));
  if (starts) return starts;
  return apps[0] || null;
};

function normalizeVendorName(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

function uniqCaseInsensitive(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = normalizeVendorName(v);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

const fetchSteamVendors = async (appid) => {
  const fetchDetails = async (lang) => {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&l=${encodeURIComponent(lang)}`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'GameManage/1.0' } }, 15000);
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.[appid]?.data;
    if (!data) return null;
    const devs = Array.isArray(data?.developers) ? data.developers : [];
    const pubs = Array.isArray(data?.publishers) ? data.publishers : [];
    const merged = uniqCaseInsensitive([...devs, ...pubs]);
    return merged.length > 0 ? merged : null;
  };

  for (const lang of ['schinese', 'english']) {
    try {
      const vendors = await fetchDetails(lang);
      if (vendors && vendors.length > 0) return vendors;
    } catch {}
  }

  return [];
};

const resolveSteamAppId = async (title) => {
  const storeSearch = async (lang, cc) => {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=${encodeURIComponent(lang)}&cc=${encodeURIComponent(cc)}&category1=998&infinite=0`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'GameManage/1.0' } });
    if (!res.ok) return null;
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    if (items.length === 0) return null;
    const picked = pickBestSteamApp(items, title);
    const id = picked?.id;
    return id ? String(id) : null;
  };

  const tryIds = [
    async () => await storeSearch('schinese', 'CN'),
    async () => await storeSearch('english', 'US')
  ];

  for (const fn of tryIds) {
    try {
      const id = await fn();
      if (id) return id;
    } catch {}
  }

  try {
    const searchUrl = `https://steamcommunity.com/actions/SearchApps/?term=${encodeURIComponent(title)}`;
    const res = await fetchWithTimeout(searchUrl, { headers: { 'User-Agent': 'GameManage/1.0' } });
    if (!res.ok) return null;
    const apps = await res.json();
    if (!Array.isArray(apps) || apps.length === 0) return null;
    const picked = pickBestSteamApp(apps, title);
    const appid = picked?.appid;
    return appid ? String(appid) : null;
  } catch {
    return null;
  }
};

const trySteamCover = async (title) => {
  const appid = await resolveSteamAppId(title);
  if (!appid) return null;

  const candidates = [
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.png`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_616x353.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_616x353.png`
  ];

  for (const url of candidates) {
    const imgRes = await fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'GameManage/1.0' } }, 15000);
    if (imgRes.ok && String(imgRes.headers.get('content-type') || '').startsWith('image/')) {
      let vendors = [];
      try {
        vendors = await fetchSteamVendors(appid);
      } catch {}
      return { provider: 'Steam', url, vendors, appid };
    }
  }

  const tryAppDetails = async (lang) => {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&l=${encodeURIComponent(lang)}`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'GameManage/1.0' } }, 15000);
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.[appid]?.data;
    const header = data?.header_image;
    const capsule = data?.capsule_image;
    const out = header || capsule;
    if (!out) return null;
    const check = await fetchWithTimeout(out, { method: 'GET', headers: { 'User-Agent': 'GameManage/1.0' } }, 15000);
    if (check.ok && String(check.headers.get('content-type') || '').startsWith('image/')) {
      const devs = Array.isArray(data?.developers) ? data.developers : [];
      const pubs = Array.isArray(data?.publishers) ? data.publishers : [];
      const vendors = uniqCaseInsensitive([...devs, ...pubs]);
      return { imageUrl: out, vendors };
    }
    return null;
  };

  for (const lang of ['schinese', 'english']) {
    try {
      const result = await tryAppDetails(lang);
      if (result?.imageUrl) {
        return { provider: 'Steam', url: result.imageUrl, vendors: result.vendors || [], appid };
      }
    } catch {}
  }

  return null;
};

const tryBangumiCover = async (title) => {
  const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(title)}?type=4&responseGroup=small&max_results=5`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'GameManage/1.0',
      Accept: 'application/json'
    }
  }, 15000);
  if (!res.ok) return null;
  const json = await res.json();
  const list = Array.isArray(json?.list) ? json.list : [];
  const picked = list.find(i => i?.images?.large || i?.images?.common || i?.images?.medium || i?.images?.small) || null;
  const img = picked?.images || null;
  const out = img?.large || img?.common || img?.medium || img?.small || null;
  if (!out) return null;
  return { provider: 'Bangumi', url: out };
};

const tryDlsiteCover = async (title) => {
  // DLsite 特殊处理：只通过作品编号刮削，不进行名称搜索
  // 常见格式：
  // [VJ01001150][HolicWorks] 水都は薄明
  // (RJ298544) [あきらめ部] 魔法少女ルミエ v1.02
  // [RJ288122][CANDY VOICE] ねこぐらし。
  
  const titleStr = String(title || '');
  
  // 从各种括号和位置中提取编号
  const patterns = [
    // 匹配方括号内的编号：[RJ123456] 或 [VJ01001150]
    /\[((?:RJ|VJ|BJ|RE)\d{6,8})\]/i,
    // 匹配圆括号内的编号：(RJ123456)
    /\(((?:RJ|VJ|BJ|RE)\d{6,8})\)/i,
    // 匹配任意位置的编号（不在括号内）
    /((?:RJ|VJ|BJ|RE)\d{6,8})/i
  ];
  
  let workno = '';
  for (const pattern of patterns) {
    const match = titleStr.match(pattern);
    if (match && match[1]) {
      workno = match[1].toUpperCase();
      console.log(`[DLsite] 从标题中提取到编号: ${workno}`);
      break;
    }
  }
  
  // 如果有作品编号，直接用编号查询
  if (workno) {
    const result = await tryDlsiteByWorkno(workno);
    if (result) {
      console.log(`[DLsite] 通过编号成功获取: ${workno}`);
      return result;
    } else {
      console.log(`[DLsite] 编号 ${workno} 查询失败`);
    }
  } else {
    console.log(`[DLsite] 未找到编号，跳过刮削（DLsite 必须有 RJ/VJ/BJ/RE 编号）`);
  }
  
  // DLsite 不进行名称搜索，避免错误匹配
  return null;
};

// 通过作品编号查询（原有逻辑）
const tryDlsiteByWorkno = async (workno) => {
  const pickObject = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    if (typeof value === 'object') return value;
    return null;
  };

  const pickUrl = (obj) => {
    const direct =
      obj?.work_image ||
      obj?.work_image_url ||
      obj?.main_image ||
      obj?.main_image_url ||
      obj?.image_main ||
      obj?.image_main_url ||
      obj?.image ||
      obj?.image_url ||
      obj?.images?.main ||
      obj?.images?.cover ||
      obj?.images?.thumb ||
      obj?.work_image_main ||
      null;
    if (typeof direct === 'string') {
      if (direct.startsWith('http')) return direct;
      if (direct.startsWith('//')) return `https:${direct}`;
    }
    if (direct && typeof direct === 'object') {
      const nested = direct?.url || direct?.large || direct?.common || direct?.medium || direct?.small || null;
      if (typeof nested === 'string') {
        if (nested.startsWith('http')) return nested;
        if (nested.startsWith('//')) return `https:${nested}`;
      }
    }
    return null;
  };

  const toNameList = (value) => {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(toNameList);
    if (typeof value === 'object') {
      const name = value?.name || value?.maker_name || value?.circle_name || value?.brand_name || null;
      return name ? [name] : [];
    }
    return [];
  };

  const headers = {
    'User-Agent': 'GameManage/1.0',
    Accept: 'application/json'
  };

  const locales = ['ja_jp', 'zh_cn', 'en_us'];  // 优先日语
  const sections = ['maniax', 'girls-pro', 'home', 'pro'];  // 添加 girls-pro (女性向BL区)

  const fetchOne = async (section, locale) => {
    const apiUrl = `https://www.dlsite.com/${section}/api/=/product.json?workno=${encodeURIComponent(workno)}&locale=${encodeURIComponent(locale)}`;
    let res = null;
    try {
      res = await fetchWithTimeout(apiUrl, { headers }, 10000);
    } catch {
      return null;
    }
    if (!res?.ok) return null;

    let json = null;
    try {
      json = await res.json();
    } catch {
      return null;
    }

    const candidate =
      pickObject(json) ||
      pickObject(json?.[workno]) ||
      pickObject(json?.product) ||
      pickObject(json?.work) ||
      null;

    const urlOut = pickUrl(candidate);
    if (!urlOut) return null;

    const vendors = uniqCaseInsensitive([
      ...toNameList(candidate?.maker_name),
      ...toNameList(candidate?.makerName),
      ...toNameList(candidate?.maker),
      ...toNameList(candidate?.circle),
      ...toNameList(candidate?.circle_name),
      ...toNameList(candidate?.brand),
      ...toNameList(candidate?.brand_name),
      ...toNameList(candidate?.publisher),
      ...toNameList(candidate?.publisher_name)
    ]);

    return { provider: 'DLsite', url: urlOut, vendors };
  };

  // 优先尝试成人区（maniax），因为大部分游戏在这里
  for (const section of sections) {
    for (const locale of locales) {
      const result = await fetchOne(section, locale);
      if (result?.url) return result;
    }
  }

  return null;
};

// 通过名称搜索（新增功能）
const tryDlsiteByName = async (title) => {
  let rawTitle = '';
  try {
    rawTitle = typeof title === 'string' ? title : String(title ?? '');
  } catch {
    rawTitle = '';
  }
  const trimmedTitle = rawTitle.trim();
  if (!trimmedTitle) return null;
  
  // 清理标题：移除常见的文件扩展名、括号内容等
  let cleanTitle = trimmedTitle
    .replace(/\.(zip|rar|7z|exe)$/i, '')  // 移除文件扩展名
    .replace(/\[.*?\]/g, '')  // 移除方括号内容
    .replace(/\(.*?\)/g, '')  // 移除圆括号内容
    .replace(/【.*?】/g, '')  // 移除中文书名号内容
    .trim();
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br'
  };

  // 尝试多个分区和搜索策略（保守策略：只用完整标题）
  const searchStrategies = [
    { section: 'girls-pro', keyword: cleanTitle },  // 优先女性向BL区
    { section: 'maniax', keyword: cleanTitle },
    { section: 'home', keyword: cleanTitle },
    // 如果清理后的标题和原标题不同，也尝试原标题
    ...(cleanTitle !== trimmedTitle ? [
      { section: 'girls-pro', keyword: trimmedTitle },
      { section: 'maniax', keyword: trimmedTitle },
      { section: 'home', keyword: trimmedTitle }
    ] : [])
  ];
  
  for (const { section, keyword } of searchStrategies) {
    try {
      // 使用更简单的搜索URL格式
      const searchUrl = `https://www.dlsite.com/${section}/fsr/=/language/jp/keyword/${encodeURIComponent(keyword)}/order/trend`;
      
      console.log(`[DLsite] 搜索: ${keyword} (${section})`);
      
      const res = await fetchWithTimeout(searchUrl, { 
        headers,
        redirect: 'follow'
      }, 10000);
      
      if (!res?.ok) {
        console.log(`[DLsite] 搜索失败 (HTTP ${res?.status}): ${keyword}`);
        continue;
      }
      
      const html = await res.text();
      
      // 尝试多种正则模式来匹配作品编号
      const patterns = [
        // 模式1：标准的作品链接
        /\/work\/=\/product_id\/((?:RJ|VJ|BJ|RE)\d{6,8})\.html/gi,
        // 模式2：直接的作品ID（可能在data属性中）
        /product_id["\s:=]+((?:RJ|VJ|BJ|RE)\d{6,8})/gi,
        // 模式3：作品页面链接的另一种格式
        /\/((?:RJ|VJ|BJ|RE)\d{6,8})\.html/gi
      ];
      
      let foundWorknos = new Set();
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          if (match[1]) {
            foundWorknos.add(match[1].toUpperCase());
          }
        }
      }
      
      console.log(`[DLsite] 找到 ${foundWorknos.size} 个作品编号`);
      
      // 只尝试第一个作品编号（最相关的结果）
      const worknos = Array.from(foundWorknos).slice(0, 1);
      for (const workno of worknos) {
        console.log(`[DLsite] 尝试作品编号: ${workno}`);
        const result = await tryDlsiteByWorkno(workno);
        if (result) {
          console.log(`[DLsite] 成功获取封面: ${workno}`);
          return result;
        }
      }
      
      if (foundWorknos.size === 0) {
        console.log(`[DLsite] 未找到作品编号，可能没有搜索结果`);
      }
      
    } catch (error) {
      console.error(`[DLsite] 搜索异常 (${section}):`, error.message);
      continue;
    }
  }
  
  console.log(`[DLsite] 所有搜索策略均失败: ${title}`);
  console.log(`[DLsite] 提示：DLsite 搜索索引可能不完整，建议在文件名中包含作品编号（RJ/VJ/BJ/RE + 数字）`);
  return null;
};

function createWindow() {
  if (isDev) {
    const devDataDir = path.join(__dirname, 'electron-data');
    if (!fs.existsSync(devDataDir)) {
      fs.mkdirSync(devDataDir, { recursive: true });
    }
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: 'rgba(0,0,0,0)',
      symbolColor: '#ffffff',
      height: 40
    },
    backgroundColor: '#0f172a'
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // 注释掉自动打开开发者工具的代码
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (process.platform !== 'win32') return;
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!tray) createTray();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
  }
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function resolveTrayIconPath() {
  const candidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(app.getAppPath(), 'icon.ico'),
    process.resourcesPath ? path.join(process.resourcesPath, 'icon.ico') : null
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || path.join(__dirname, 'icon.ico');
}

function createTray() {
  if (tray) return;
  const iconPath = resolveTrayIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('myGal');

  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'gamemanage.db');
  db = new Database(dbPath);
  
  // 启用外键约束
  db.exec('PRAGMA foreign_keys = ON;');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    
    CREATE TABLE IF NOT EXISTS root_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_refreshed_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      cover_path TEXT,
      root_path_id INTEGER,
      is_manual INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      alias TEXT,
      imported_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (root_path_id) REFERENCES root_paths(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1'
    );
    
    CREATE TABLE IF NOT EXISTS game_tags (
      game_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (game_id, tag_id),
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS game_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      path TEXT NOT NULL UNIQUE,
      root_path_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (root_path_id) REFERENCES root_paths(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ignored_game_paths (
      path TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER,
      game_name TEXT,
      exe_path TEXT NOT NULL,
      method TEXT,
      needs_user_confirm INTEGER DEFAULT 0,
      launched_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_run_history_launched_at ON run_history(launched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
    CREATE INDEX IF NOT EXISTS idx_games_root_path_id ON games(root_path_id);
    CREATE INDEX IF NOT EXISTS idx_game_paths_game_id ON game_paths(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_paths_root_path_id ON game_paths(root_path_id);
  `);
  
  // 数据迁移：将旧的单个根目录设置迁移到root_paths表
  try {
    const columns = db.prepare('PRAGMA table_info(games)').all();
    const hasRootPathId = columns.some(col => col.name === 'root_path_id');
    const hasIsManual = columns.some(col => col.name === 'is_manual');
    const hasAlias = columns.some(col => col.name === 'alias');
    const hasPinned = columns.some(col => col.name === 'pinned');
    const hasImportedAt = columns.some(col => col.name === 'imported_at');
    
    if (!hasRootPathId) {
      db.exec('ALTER TABLE games ADD COLUMN root_path_id INTEGER;');
    }
    if (!hasIsManual) {
      db.exec('ALTER TABLE games ADD COLUMN is_manual INTEGER DEFAULT 0;');
    }
    if (!hasPinned) {
      db.exec('ALTER TABLE games ADD COLUMN pinned INTEGER DEFAULT 0;');
    }
    if (!hasAlias) {
      db.exec('ALTER TABLE games ADD COLUMN alias TEXT;');
    }
    if (!hasImportedAt) {
      db.exec('ALTER TABLE games ADD COLUMN imported_at INTEGER;');
    }
    db.exec('UPDATE games SET is_manual = 0 WHERE is_manual IS NULL;');
    db.exec('UPDATE games SET pinned = 0 WHERE pinned IS NULL;');
    db.exec(`
      UPDATE games
      SET imported_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000
      WHERE imported_at IS NULL OR imported_at <= 0
    `);

    const rootColumns = db.prepare('PRAGMA table_info(root_paths)').all();
    const hasLastRefreshedAt = rootColumns.some(col => col.name === 'last_refreshed_at');
    if (!hasLastRefreshedAt) {
      db.exec('ALTER TABLE root_paths ADD COLUMN last_refreshed_at INTEGER;');
    }
    db.exec(`
      UPDATE root_paths
      SET last_refreshed_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000
      WHERE last_refreshed_at IS NULL OR last_refreshed_at <= 0
    `);
    
    const oldRootPath = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath');
    if (oldRootPath && oldRootPath.value) {
      const insertRootPath = db.prepare('INSERT OR IGNORE INTO root_paths (path) VALUES (?)');
      insertRootPath.run(oldRootPath.value);
      
      const rootPathId = db.prepare('SELECT id FROM root_paths WHERE path = ?').get(oldRootPath.value).id;
      
      const updateGames = db.prepare('UPDATE games SET root_path_id = ? WHERE root_path_id IS NULL');
      updateGames.run(rootPathId);
      
      const deleteOldSetting = db.prepare('DELETE FROM settings WHERE key = ?');
      deleteOldSetting.run('rootPath');
    }
    
    db.exec(`
      INSERT OR IGNORE INTO game_paths (game_id, path, root_path_id, created_at)
      SELECT id, path, root_path_id, created_at FROM games
      WHERE path IS NOT NULL
    `);
  } catch (error) {
    console.error('数据迁移失败:', error);
  }

  try {
    const gameIds = db.prepare('SELECT DISTINCT game_id AS id FROM run_history WHERE game_id IS NOT NULL').all()
      .map(r => r.id)
      .filter((v) => Number.isFinite(Number(v)))
      .map((v) => Number(v));

    if (gameIds.length > 0) {
      const pickKeepStmt = db.prepare(`
        SELECT id
        FROM run_history
        WHERE game_id = ?
        ORDER BY launched_at DESC, id DESC
        LIMIT 1
      `);
      const deleteOthersStmt = db.prepare('DELETE FROM run_history WHERE game_id = ? AND id <> ?');
      db.transaction(() => {
        for (const gid of gameIds) {
          const keepId = pickKeepStmt.get(gid)?.id ?? null;
          if (Number.isFinite(Number(keepId))) {
            deleteOthersStmt.run(gid, Number(keepId));
          }
        }
      })();
    }
  } catch {}

  try {
    trySyncCoversFromAlternateDb();
  } catch {}

  try {
    sanitizeMismatchedCovers();
  } catch {}
}

const sanitizeMismatchedCovers = () => {
  try {
    const rows = db.prepare("SELECT id, name, cover_path FROM games WHERE cover_path IS NOT NULL AND cover_path != ''").all();
    if (!Array.isArray(rows) || rows.length === 0) return;
    const resetStmt = db.prepare("UPDATE games SET cover_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    
    db.transaction(() => {
      for (const row of rows) {
        const cPath = row.cover_path;
        if (!cPath) continue;
        const bName = path.basename(cPath);
        const match = bName.match(/^(\d+)_/);
        if (match) {
          const ownerId = Number.parseInt(match[1], 10);
          if (Number.isFinite(ownerId) && ownerId !== Number(row.id)) {
            resetStmt.run(row.id);
          }
        }
      }
    })();
  } catch (err) {
    console.warn('sanitizeMismatchedCovers failed:', err);
  }
};

const trySyncCoversFromAlternateDb = () => {
  try {
    const candidateDbPaths = [
      path.join(os.homedir(), 'AppData', 'Roaming', 'gamemanage', 'gamemanage.db'),
      process.env.APPDATA ? path.join(process.env.APPDATA, 'gamemanage', 'gamemanage.db') : '',
      path.join(__dirname, 'electron-data', 'gamemanage.db'),
      path.join(process.cwd(), 'electron-data', 'gamemanage.db')
    ].filter(Boolean);

    const currentDbPath = path.resolve(path.join(app.getPath('userData'), 'gamemanage.db'));

    for (const altPath of candidateDbPaths) {
      const resolvedAlt = path.resolve(altPath);
      if (resolvedAlt.toLowerCase() === currentDbPath.toLowerCase() || !fs.existsSync(resolvedAlt)) continue;
      try {
        const altDb = new Database(resolvedAlt, { readonly: true });
        const altGames = altDb.prepare('SELECT path, cover_path, name FROM games WHERE cover_path IS NOT NULL').all();
        altDb.close();

        if (Array.isArray(altGames) && altGames.length > 0) {
          const updateStmtByPath = db.prepare("UPDATE games SET cover_path = ? WHERE path = ? AND (cover_path IS NULL OR cover_path = '')");
          const updateStmtByName = db.prepare("UPDATE games SET cover_path = ? WHERE name = ? AND (cover_path IS NULL OR cover_path = '')");
          db.transaction(() => {
            for (const g of altGames) {
              if (!g.cover_path) continue;
              let targetCover = g.cover_path;
              if (!fs.existsSync(targetCover)) {
                const bName = path.basename(targetCover);
                const altCoverDirs = [
                  path.join(app.getPath('userData'), 'covers'),
                  path.join(os.homedir(), 'AppData', 'Roaming', 'gamemanage', 'covers'),
                  path.join(__dirname, 'electron-data', 'covers')
                ];
                for (const cd of altCoverDirs) {
                  const candidate = path.join(cd, bName);
                  if (fs.existsSync(candidate)) {
                    targetCover = candidate;
                    break;
                  }
                }
              }
              if (fs.existsSync(targetCover)) {
                if (g.path) updateStmtByPath.run(targetCover, g.path);
                if (g.name) updateStmtByName.run(targetCover, g.name);
              }
            }
          })();
        }
      } catch {}
    }
  } catch {}
};

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('select-directories', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections']
  });

  if (result.canceled) return [];
  return Array.isArray(result.filePaths) ? result.filePaths : [];
});

ipcMain.handle('select-cover', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
    ]
  });
  
  return result;
});

ipcMain.handle('select-background', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
  });
  return result;
});

ipcMain.handle('get-settings', async () => {
  try {
    const settingKey = 'projectBackgroundPath';
    const current = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey)?.value;
    if (current === null || current === undefined || String(current).trim() === '') {
      const defaultSourcePath = path.join(__dirname, 'photo.jpg');
      if (fs.existsSync(defaultSourcePath)) {
        const ext = path.extname(defaultSourcePath).toLowerCase().replace('.', '');
        const allowed = new Set(['jpg', 'jpeg', 'png']);
        if (allowed.has(ext)) {
          const backgroundsDir = getBackgroundsDir();
          fs.mkdirSync(backgroundsDir, { recursive: true });

          const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
          const newPath = path.join(backgroundsDir, `project-background.${normalizedExt}`);

          try {
            if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          } catch {}

          try {
            fs.copyFileSync(defaultSourcePath, newPath);
            db.prepare(`
              INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = ?
            `).run(settingKey, newPath, newPath);
          } catch {}
        }
      }
    }
  } catch {}
  const stmt = db.prepare('SELECT key, value FROM settings');
  const rows = stmt.all();
  const settings = {};
  rows.forEach(row => {
    settings[row.key] = row.value;
  });
  return settings;
});

ipcMain.handle('get-app-version', async () => {
  try {
    return { success: true, version: app.getVersion() };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('normalize-game-title', async (event, rawName, options) => {
  try {
    const cleaned = applyCustomRegex(rawName, options, { strict: true });
    return { success: true, value: normalizeGameTitle(cleaned) };
  } catch (error) {
    return { success: false, error: error?.message || String(error), value: '' };
  }
});

// 根目录管理IPC事件
try {
  ipcMain.handle('get-root-paths', async () => {
    const stmt = db.prepare('SELECT * FROM root_paths ORDER BY created_at DESC');
    return stmt.all();
  });
  
  ipcMain.handle('add-root-path', async (event, rootPath) => {
    if (!rootPath || !fs.existsSync(rootPath)) {
      return { success: false, error: '目录不存在' };
    }
    
    const stmt = db.prepare('INSERT OR IGNORE INTO root_paths (path) VALUES (?)');
    const result = stmt.run(rootPath);
    return { success: true, id: result.lastInsertRowid };
  });
  
  ipcMain.handle('delete-root-path', async (event, rootPathId) => {
    try {
      const coversToDelete = db.prepare(`
        SELECT g.cover_path AS cover_path
        FROM games g
        WHERE g.id IN (
          SELECT DISTINCT gp.game_id
          FROM game_paths gp
          WHERE gp.root_path_id = ?
          EXCEPT
          SELECT DISTINCT gp2.game_id
          FROM game_paths gp2
          WHERE gp2.root_path_id != ? OR gp2.root_path_id IS NULL
        )
      `).all(rootPathId, rootPathId)
        .map(r => r.cover_path)
        .filter(Boolean);

      db.transaction(() => {
        const deleteGamePathsByRoot = db.prepare('DELETE FROM game_paths WHERE root_path_id = ?');
        deleteGamePathsByRoot.run(rootPathId);

        const resyncGames = db.prepare(`
          UPDATE games
          SET
            path = (
              SELECT gp.path
              FROM game_paths gp
              WHERE gp.game_id = games.id
              ORDER BY (gp.root_path_id IS NULL) DESC, gp.created_at DESC, gp.id DESC
              LIMIT 1
            ),
            root_path_id = (
              SELECT gp.root_path_id
              FROM game_paths gp
              WHERE gp.game_id = games.id
              ORDER BY (gp.root_path_id IS NULL) DESC, gp.created_at DESC, gp.id DESC
              LIMIT 1
            ),
            updated_at = CURRENT_TIMESTAMP
          WHERE id IN (SELECT DISTINCT game_id FROM game_paths)
        `);
        resyncGames.run();

        const deleteGamesWithoutPaths = db.prepare(`
          DELETE FROM games
          WHERE id NOT IN (SELECT DISTINCT game_id FROM game_paths)
        `);
        deleteGamesWithoutPaths.run();

        const deleteRoot = db.prepare('DELETE FROM root_paths WHERE id = ?');
        deleteRoot.run(rootPathId);

        const cleanupOrphanGameTags = db.prepare(`
          DELETE FROM game_tags
          WHERE game_id NOT IN (SELECT id FROM games)
        `);
        cleanupOrphanGameTags.run();
      })();

      coversToDelete.forEach(p => safeUnlinkCover(p));
      return { success: true };
    } catch (error) {
      console.error('delete-root-path failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('add-game-directory', async (event, gamePath) => {
    if (!gamePath || !fs.existsSync(gamePath)) {
      return { success: false, error: '目录不存在' };
    }
    
    const name = path.basename(gamePath);
    const findGameByPathStmt = db.prepare(`
      SELECT g.id FROM games g
      WHERE g.path = ?
      UNION
      SELECT gp.game_id AS id FROM game_paths gp
      WHERE gp.path = ?
    `);
    
    const existing = findGameByPathStmt.get(gamePath, gamePath);
    if (existing) {
      return { success: false, error: '游戏已存在' };
    }
    
    const findManualGameByNameStmt = db.prepare(`
      SELECT id FROM games WHERE name = ? AND is_manual = 1 ORDER BY updated_at DESC LIMIT 1
    `);
    
    const insertGameStmt = db.prepare(`
      INSERT INTO games (name, path, root_path_id, is_manual, imported_at)
      VALUES (?, ?, NULL, 1, ?)
    `);
    
    const insertGamePathStmt = db.prepare(`
      INSERT OR IGNORE INTO game_paths (game_id, path, root_path_id)
      VALUES (?, ?, NULL)
    `);

    const updateImportedAtStmt = db.prepare(`
      UPDATE games SET imported_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    
    const existingByName = findManualGameByNameStmt.get(name);
    if (existingByName) {
      const now = Date.now();
      const info = insertGamePathStmt.run(existingByName.id, gamePath);
      if ((info?.changes || 0) > 0) {
        updateImportedAtStmt.run(now, existingByName.id);
      }
      return { success: true, id: existingByName.id };
    }
    
    const result = insertGameStmt.run(name, gamePath, Date.now());
    insertGamePathStmt.run(result.lastInsertRowid, gamePath);
    
    return { success: true, id: result.lastInsertRowid };
  });
} catch (error) {
  console.error('根目录管理IPC事件注册失败:', error);
}

ipcMain.handle('save-setting', async (event, key, value) => {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `);
  stmt.run(key, value, value);
  return true;
});

ipcMain.handle('set-project-background', async (event, sourcePath) => {
  try {
    const settingKey = 'projectBackgroundPath';
    if (!sourcePath) {
      const old = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey)?.value;
      safeUnlinkBackground(old);
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
      `).run(settingKey, '', '');
      return { success: true, path: '' };
    }

    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || !fs.existsSync(sourcePath)) {
      return { success: false, error: '文件不存在' };
    }

    const ext = path.extname(sourcePath).toLowerCase().replace('.', '');
    const allowed = new Set(['jpg', 'jpeg', 'png']);
    if (!allowed.has(ext)) {
      return { success: false, error: '仅支持 jpg/png' };
    }

    const backgroundsDir = getBackgroundsDir();
    fs.mkdirSync(backgroundsDir, { recursive: true });

    const old = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey)?.value;
    safeUnlinkBackground(old);

    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
    const newPath = path.join(backgroundsDir, `project-background.${normalizedExt}`);

    try {
      if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    } catch {}

    fs.copyFileSync(sourcePath, newPath);

    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).run(settingKey, newPath, newPath);

    return { success: true, path: newPath };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('clear-project-background', async () => {
  const settingKey = 'projectBackgroundPath';
  try {
    const old = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey)?.value;
    safeUnlinkBackground(old);
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).run(settingKey, '', '');
    return true;
  } catch {
    return false;
  }
});

// 根目录下不允许被收进游戏库的内部目录名（上传等功能的内部产物）
const INTERNAL_DIR_NAMES = new Set(['_incoming']);

// 进行中的游戏库重扫（Promise 去重）：大库扫描要数秒，用户连点刷新时只跑一次，避免重复扫描
let libraryRefreshInFlight = null;

/**
 * 重新扫描所有根目录：新增的收录入库、已消失的标记删除，并回收封面。
 * 抽成普通函数，供 IPC（PC 端 UI 的「刷新游戏库」）与 HTTP API（移动端刷新）共用。
 * 本函数不依赖 event，可安全地在 IPC / HTTP 两种上下文里调用。
 */
async function runImportGames(rootPathId = null) {
  let rootPaths = [];
  const allDbRoots = db.prepare('SELECT id, path FROM root_paths').all();
  
  if (rootPathId) {
    // 从特定根目录导入
    const rootPath = allDbRoots.find(rp => rp.id === rootPathId);
    if (!rootPath || !fs.existsSync(rootPath.path)) {
      return { success: false, error: '目录不存在或不可访问' };
    }
    rootPaths = [rootPath];
  } else {
    // 从所有有效根目录导入
    rootPaths = allDbRoots.filter(rp => fs.existsSync(rp.path));
    
    if (rootPaths.length === 0 && allDbRoots.length > 0) {
      return { success: false, error: '没有有效的根目录（可能目录不存在或移动硬盘未连接）' };
    }
    if (rootPaths.length === 0) {
      return { success: false, error: '没有配置根目录' };
    }
  }
  
  const insertGameStmt = db.prepare(`
    INSERT INTO games (name, path, root_path_id, is_manual, imported_at)
    VALUES (?, ?, ?, 0, ?)
  `);
  
  const insertGamePathStmt = db.prepare(`
    INSERT OR IGNORE INTO game_paths (game_id, path, root_path_id)
    VALUES (?, ?, ?)
  `);

  const updateRootLastRefreshedAtStmt = db.prepare(`
    UPDATE root_paths SET last_refreshed_at = ? WHERE id = ?
  `);
  
  const findGameByPathStmt = db.prepare(`
    SELECT g.id FROM games g
    WHERE g.path = ?
    UNION
    SELECT gp.game_id AS id FROM game_paths gp
    WHERE gp.path = ?
  `);

  const isIgnoredPathStmt = db.prepare(`
    SELECT 1 AS ignored
    FROM ignored_game_paths
    WHERE path = ?
    LIMIT 1
  `);
  
  const findScannedGameByNameStmt = db.prepare(`
    SELECT id
    FROM games
    WHERE name = ? AND (is_manual IS NULL OR is_manual = 0)
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);
  
  const updateGameNameStmt = db.prepare(`
    UPDATE games SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  const updateImportedAtStmt = db.prepare(`
    UPDATE games SET imported_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  
  let totalImported = 0;
  const importedGameIds = [];
  const knownExistingPaths = new Set();
  
  // 优化：异步并发扫描根目录，限制并发数为 4
  const batchSize = 4;
  
  for (let i = 0; i < rootPaths.length; i += batchSize) {
    const batch = rootPaths.slice(i, i + batchSize);
    
    // 并发扫描这一批根目录
    const batchResults = await Promise.all(
      batch.map(async (rootPath) => {
        try {
          const entries = await fs.promises.readdir(rootPath.path, { withFileTypes: true });
          const gameItems = entries
            .filter(entry => {
              if (entry.isDirectory()) {
                // 内部目录不当作游戏收录（历史遗留的上传暂存目录 _incoming 等）
                if (INTERNAL_DIR_NAMES.has(entry.name)) return false;
                return true;
              }
              if (entry.isFile()) {
                const lower = entry.name.toLowerCase();
                if (lower.startsWith('.')) return false;
                if (lower === 'desktop.ini') return false;
                if (lower === 'thumbs.db') return false;
                return true;
              }
              return false;
            })
            .map(entry => entry.name);
          
          return { rootPath, gameItems, success: true };
        } catch (error) {
          console.error(`Failed to scan root path ${rootPath.path}:`, error);
          return { rootPath, gameItems: [], success: false };
        }
      })
    );
    
    // 关键优化：使用事务批量执行入库与更新操作，消除单条写入的磁盘 fsync 阻塞
    db.transaction(() => {
      for (const { rootPath, gameItems, success } of batchResults) {
        if (!success) continue;
        
        const refreshedAt = Date.now();
        
        gameItems.forEach(name => {
          const gamePath = path.join(rootPath.path, name);
          knownExistingPaths.add(gamePath);

          if (isIgnoredPathStmt.get(gamePath)) {
            return;
          }
          const existing = findGameByPathStmt.get(gamePath, gamePath);
          
          if (existing) {
            updateGameNameStmt.run(name, existing.id);
            const info = insertGamePathStmt.run(existing.id, gamePath, rootPath.id);
            if ((info?.changes || 0) > 0) {
              updateImportedAtStmt.run(refreshedAt, existing.id);
            }
          } else {
            const existingByName = findScannedGameByNameStmt.get(name);
            if (existingByName) {
              const info = insertGamePathStmt.run(existingByName.id, gamePath, rootPath.id);
              if ((info?.changes || 0) > 0) {
                updateImportedAtStmt.run(refreshedAt, existingByName.id);
              }
            } else {
              const result = insertGameStmt.run(name, gamePath, rootPath.id, refreshedAt);
              insertGamePathStmt.run(result.lastInsertRowid, gamePath, rootPath.id);
              importedGameIds.push(result.lastInsertRowid);
            }
            totalImported++;
          }
        });

        updateRootLastRefreshedAtStmt.run(refreshedAt, rootPath.id);
      }
    })();
  }
  
  // ========== 检查失效文件与清理 ==========
  
  // 在线与离线根目录分类（保护离线移动硬盘不被清空）
  const onlineRootIds = new Set(allDbRoots.filter(rp => fs.existsSync(rp.path)).map(rp => rp.id));
  const offlineRootIds = new Set(allDbRoots.filter(rp => !fs.existsSync(rp.path)).map(rp => rp.id));

  // 作用域收敛：如果指定了 rootPathId，只检索与该根目录相关的游戏
  const allGames = rootPathId
    ? db.prepare(`
        SELECT DISTINCT g.id, g.path, g.root_path_id
        FROM games g
        LEFT JOIN game_paths gp ON gp.game_id = g.id
        WHERE g.root_path_id = ? OR gp.root_path_id = ?
      `).all(rootPathId, rootPathId)
    : db.prepare('SELECT id, path, root_path_id FROM games').all();

  let totalDeleted = 0;

  // 获取相关游戏的所有路径
  const allGamePaths = rootPathId
    ? db.prepare(`
        SELECT gp.game_id, gp.id, gp.path, gp.root_path_id, gp.created_at
        FROM game_paths gp
        WHERE gp.game_id IN (
          SELECT DISTINCT g.id FROM games g
          LEFT JOIN game_paths gp2 ON gp2.game_id = g.id
          WHERE g.root_path_id = ? OR gp2.root_path_id = ?
        )
      `).all(rootPathId, rootPathId)
    : db.prepare(`
        SELECT game_id, id, path, root_path_id, created_at 
        FROM game_paths
      `).all();

  // 按 game_id 分组
  const pathsByGameId = new Map();
  allGamePaths.forEach(p => {
    if (!pathsByGameId.has(p.game_id)) {
      pathsByGameId.set(p.game_id, []);
    }
    pathsByGameId.get(p.game_id).push(p);
  });

  // 收集需要检查的路径（削减冗余：本次扫描刚刚确认存在的路径直接标为 true，不重复送给 Worker）
  const pathExistsMap = new Map();
  knownExistingPaths.forEach(p => {
    pathExistsMap.set(p, true);
  });

  const pathsToCheck = [];
  
  allGames.forEach(game => {
    const paths = pathsByGameId.get(game.id) || [];
    const pathList = paths.length > 0 ? paths : [{ 
      id: null, 
      path: game.path, 
      root_path_id: game.root_path_id, 
      created_at: null 
    }];

    pathList.forEach(p => {
      if (p.path) {
        // 如果是指定根目录刷新，且该路径不属于当前根目录，则不检查（保持原样）
        if (rootPathId && p.root_path_id !== rootPathId) {
          return;
        }
        // 如果属于离线根目录（如未插上的移动硬盘），不检查也不删除（启动离线保护）
        if (!rootPathId && p.root_path_id && offlineRootIds.has(p.root_path_id)) {
          return;
        }
        // 如果本次扫描中未确认为存在，则需要加入 Worker 检查队列
        if (!pathExistsMap.has(p.path)) {
          pathsToCheck.push(p.path);
        }
      }
    });
  });

  // 只有存在未确定状态的路径时，才唤起 Worker 线程异步检查
  if (pathsToCheck.length > 0) {
    const uniquePathsToCheck = [...new Set(pathsToCheck)];
    const workerResults = await new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'workers', 'pathChecker.js');
      const worker = new Worker(workerPath, {
        workerData: { paths: uniquePathsToCheck }
      });

      worker.on('message', (msg) => {
        if (msg.type === 'complete') {
          resolve(msg.results);
          worker.terminate();
        } else if (msg.type === 'error') {
          reject(new Error(msg.error));
          worker.terminate();
        }
      });

      worker.on('error', (error) => {
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });

    Object.entries(workerResults || {}).forEach(([p, exists]) => {
      pathExistsMap.set(p, exists);
    });
  }

  // 预先准备 SQL 语句
  const selectCoverStmt = db.prepare('SELECT cover_path FROM games WHERE id = ?');
  const deleteGameStmt = db.prepare('DELETE FROM games WHERE id = ?');
  const deleteGamePathsByGameIdStmt = db.prepare('DELETE FROM game_paths WHERE game_id = ?');
  const deleteGameTagsByGameIdStmt = db.prepare('DELETE FROM game_tags WHERE game_id = ?');
  const deleteGamePathByIdStmt = db.prepare('DELETE FROM game_paths WHERE id = ?');
  const deleteGamePathByPathStmt = db.prepare('DELETE FROM game_paths WHERE game_id = ? AND path = ?');
  const updateGameStmt = db.prepare('UPDATE games SET path = ?, root_path_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  
  const coversToDelete = [];

  // 使用事务批量处理失效路径清理和孤儿游戏删除
  db.transaction(() => {
    allGames.forEach(game => {
      const paths = pathsByGameId.get(game.id) || [];
      const pathList = paths.length > 0 ? paths : [{ 
        id: null, 
        path: game.path, 
        root_path_id: game.root_path_id, 
        created_at: null 
      }];

      const validPaths = [];
      const invalidPaths = [];

      pathList.forEach(p => {
        if (!p.path) {
          invalidPaths.push(p);
          return;
        }

        // 情况 1：指定单目录刷新，非当前刷新根目录的路径一律保留
        if (rootPathId && p.root_path_id !== rootPathId) {
          validPaths.push(p);
          return;
        }

        // 情况 2：离线根目录（如未插上的移动硬盘）启动保护，一律保留
        if (!rootPathId && p.root_path_id && offlineRootIds.has(p.root_path_id)) {
          validPaths.push(p);
          return;
        }

        // 情况 3：在线根目录或手动添加的路径，根据物理检查结果判定
        const exists = pathExistsMap.get(p.path);
        if (exists) {
          validPaths.push(p);
        } else {
          invalidPaths.push(p);
        }
      });

      if (validPaths.length === 0) {
        const row = selectCoverStmt.get(game.id);
        if (row?.cover_path) {
          coversToDelete.push(row.cover_path);
        }
        deleteGamePathsByGameIdStmt.run(game.id);
        deleteGameTagsByGameIdStmt.run(game.id);
        deleteGameStmt.run(game.id);
        totalDeleted++;
        return;
      }

      // 清理该游戏已失效的路径记录
      invalidPaths.forEach(p => {
        if (p.id) {
          deleteGamePathByIdStmt.run(p.id);
        } else if (p.path) {
          deleteGamePathByPathStmt.run(game.id, p.path);
        }
      });

      validPaths.sort((a, b) => {
        const aManualScore = a.root_path_id === null || a.root_path_id === undefined ? 1 : 0;
        const bManualScore = b.root_path_id === null || b.root_path_id === undefined ? 1 : 0;
        if (aManualScore !== bManualScore) {
          return bManualScore - aManualScore;
        }
        const aCreated = a.created_at || '';
        const bCreated = b.created_at || '';
        if (aCreated !== bCreated) {
          return bCreated.localeCompare(aCreated);
        }
        const aId = a.id || 0;
        const bId = b.id || 0;
        return bId - aId;
      });

      const primary = validPaths[0];
      updateGameStmt.run(primary.path, primary.root_path_id, game.id);
      insertGamePathStmt.run(game.id, primary.path, primary.root_path_id);
    });

    // 兜底清理孤立记录
    db.prepare('DELETE FROM game_paths WHERE game_id NOT IN (SELECT id FROM games)').run();
    db.prepare('DELETE FROM game_tags WHERE game_id NOT IN (SELECT id FROM games)').run();
  })();

  // 事务完成后再异步删除封面文件（不阻塞数据库操作）
  coversToDelete.forEach(p => safeUnlinkCover(p));

  return { success: true, imported: totalImported, deleted: totalDeleted, importedGameIds };
}

// PC 端 UI 的「刷新游戏库」入口：保持原有 IPC 契约不变
ipcMain.handle('import-games', async (event, rootPathId = null) => runImportGames(rootPathId));

ipcMain.handle('reset-database', async () => {
  try {
    db.transaction(() => {
      db.exec(`
        DELETE FROM game_tags;
        DELETE FROM game_paths;
        DELETE FROM games;
        DELETE FROM tags;
        DELETE FROM root_paths;
        DELETE FROM settings;
        DELETE FROM ignored_game_paths;
        DELETE FROM run_history;
        DELETE FROM sqlite_sequence WHERE name IN ('games','tags','root_paths','game_paths','run_history');
      `);
    })();
    
    const coversDir = getCoversDir();
    const backgroundsDir = getBackgroundsDir();
    const legacyCoversDir = path.join(__dirname, 'covers');
    for (const dir of [coversDir, legacyCoversDir, backgroundsDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('reset-database failed:', error);
    return { success: false, error: error.message };
  }
});

const processGames = (games) => {
  const pathStmt = db.prepare('SELECT path, root_path_id FROM game_paths WHERE game_id = ?');
  
  return games.map(game => {
    const extraPaths = pathStmt.all(game.id);
    const pathSet = new Set();
    const rootPathIdSet = new Set();
    
    const extraPathSet = new Set(extraPaths.map(p => p.path).filter(Boolean));
    if (game.path && (extraPathSet.has(game.path) || fs.existsSync(game.path))) {
      pathSet.add(game.path);
    }
    
    extraPaths.forEach(p => {
      if (p.path) {
        pathSet.add(p.path);
      }
      if (p.root_path_id !== null && p.root_path_id !== undefined) {
        rootPathIdSet.add(Number(p.root_path_id));
      }
    });

    if (game.root_path_id !== null && game.root_path_id !== undefined) {
      rootPathIdSet.add(Number(game.root_path_id));
    }

    let validCoverPath = game.cover_path;
    if (validCoverPath) {
      if (!fs.existsSync(validCoverPath)) {
        try {
          db.prepare('UPDATE games SET cover_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(game.id);
        } catch {}
        validCoverPath = null;
      }
    }
    
    return {
      ...game,
      cover_path: validCoverPath ? `file:///${validCoverPath.replace(/\\/g, '/')}?t=${Date.now()}` : null,
      tags: game.tags ? game.tags.split(',') : [],
      paths: Array.from(pathSet),
      root_path_ids: Array.from(rootPathIdSet).filter(Number.isFinite).sort((a, b) => a - b)
    };
  });
};

const buildGameOrderByClause = (sortFieldRaw = 'imported_at', sortOrderRaw = 'desc') => {
  const sortField = typeof sortFieldRaw === 'string' ? sortFieldRaw.trim().toLowerCase() : '';
  const sortOrder = typeof sortOrderRaw === 'string' ? sortOrderRaw.trim().toLowerCase() : '';
  const orderSql = sortOrder === 'asc' ? 'ASC' : 'DESC';

  if (sortField === 'name') {
    return `ORDER BY g.pinned DESC, LOWER(TRIM(COALESCE(g.name, ''))) ${orderSql}, COALESCE(g.imported_at, 0) ASC, g.id ASC`;
  }

  return `ORDER BY g.pinned DESC, COALESCE(g.imported_at, 0) ${orderSql}, g.id DESC`;
};

ipcMain.handle('get-games', async (event, { page = 1, pageSize = 20, rootPathId: rootPathIdRaw = null, sortField: sortFieldRaw = 'imported_at', sortOrder: sortOrderRaw = 'desc' } = {}) => {
  const offset = (page - 1) * pageSize;
  const rootPathKey = typeof rootPathIdRaw === 'string' ? rootPathIdRaw.trim().toLowerCase() : '';
  const isOthers = rootPathKey === 'others';
  const parsedRootPathId = isOthers ? Number.NaN : Number.parseInt(String(rootPathIdRaw ?? ''), 10);
  const rootPathId = Number.isFinite(parsedRootPathId) ? parsedRootPathId : null;

  const orderByClause = buildGameOrderByClause(sortFieldRaw, sortOrderRaw);
  
  const total = isOthers
    ? db.prepare(`
      SELECT COUNT(*) as count
      FROM games g
      WHERE g.is_manual = 1
    `).get().count
    : rootPathId
    ? db.prepare(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM games g
      WHERE g.root_path_id = ?
        OR EXISTS (
          SELECT 1 FROM game_paths gp
          WHERE gp.game_id = g.id AND gp.root_path_id = ?
        )
    `).get(rootPathId, rootPathId).count
    : db.prepare('SELECT COUNT(*) as count FROM games').get().count;
  
  const games = isOthers
    ? db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE g.is_manual = 1
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(pageSize, offset)
    : rootPathId
    ? db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE g.root_path_id = ?
        OR EXISTS (
          SELECT 1 FROM game_paths gp
          WHERE gp.game_id = g.id AND gp.root_path_id = ?
        )
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(rootPathId, rootPathId, pageSize, offset)
    : db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);
  
  return {
    games: processGames(games),
    total
  };
});

ipcMain.handle('search-games', async (event, query, { page = 1, pageSize = 20, rootPathId: rootPathIdRaw = null, sortField: sortFieldRaw = 'imported_at', sortOrder: sortOrderRaw = 'desc' } = {}) => {
  if (!query || !query.trim()) {
    return { games: [], total: 0 };
  }
  
  const offset = (page - 1) * pageSize;
  const searchPattern = `%${query}%`;
  const rootPathKey = typeof rootPathIdRaw === 'string' ? rootPathIdRaw.trim().toLowerCase() : '';
  const isOthers = rootPathKey === 'others';
  const parsedRootPathId = isOthers ? Number.NaN : Number.parseInt(String(rootPathIdRaw ?? ''), 10);
  const rootPathId = Number.isFinite(parsedRootPathId) ? parsedRootPathId : null;

  const orderByClause = buildGameOrderByClause(sortFieldRaw, sortOrderRaw);
  
  const total = isOthers
    ? db.prepare(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE (g.name LIKE ? OR g.alias LIKE ? OR g.path LIKE ? OR t.name LIKE ?)
        AND g.is_manual = 1
    `).get(searchPattern, searchPattern, searchPattern, searchPattern).count
    : rootPathId
    ? db.prepare(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE (g.name LIKE ? OR g.alias LIKE ? OR g.path LIKE ? OR t.name LIKE ?)
        AND (
          g.root_path_id = ?
          OR EXISTS (
            SELECT 1 FROM game_paths gp
            WHERE gp.game_id = g.id AND gp.root_path_id = ?
          )
        )
    `).get(searchPattern, searchPattern, searchPattern, searchPattern, rootPathId, rootPathId).count
    : db.prepare(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE g.name LIKE ? OR g.alias LIKE ? OR g.path LIKE ? OR t.name LIKE ?
    `).get(searchPattern, searchPattern, searchPattern, searchPattern).count;
  
  const games = isOthers
    ? db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE (g.name LIKE ? OR g.alias LIKE ? OR g.path LIKE ? OR t.name LIKE ?)
        AND g.is_manual = 1
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(searchPattern, searchPattern, searchPattern, searchPattern, pageSize, offset)
    : rootPathId
    ? db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE (g.name LIKE ? OR g.alias LIKE ? OR g.path LIKE ? OR t.name LIKE ?)
        AND (
          g.root_path_id = ?
          OR EXISTS (
            SELECT 1 FROM game_paths gp
            WHERE gp.game_id = g.id AND gp.root_path_id = ?
          )
        )
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(searchPattern, searchPattern, searchPattern, searchPattern, rootPathId, rootPathId, pageSize, offset)
    : db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      LEFT JOIN game_tags gt ON g.id = gt.game_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE g.name LIKE ? OR g.alias LIKE ? OR g.path LIKE ? OR t.name LIKE ?
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(searchPattern, searchPattern, searchPattern, searchPattern, pageSize, offset);
  
  return {
    games: processGames(games),
    total
  };
});

ipcMain.handle('update-game-alias', async (event, gameId, alias) => {
  const normalized = String(alias ?? '').trim();
  const value = normalized ? normalized : null;
  db.prepare('UPDATE games SET alias = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, gameId);
  return true;
});

ipcMain.handle('update-game-pinned', async (event, gameId, pinned) => {
  const value = pinned ? 1 : 0;
  const info = db.prepare('UPDATE games SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, gameId);
  return info.changes > 0;
});

ipcMain.handle('update-game-cover', async (event, gameId, coverPath) => {
  const game = db.prepare('SELECT name, cover_path FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return false;
  }
  
  safeUnlinkCover(game.cover_path, gameId);
  
  if (!coverPath) {
    const stmt = db.prepare('UPDATE games SET cover_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(gameId);
    return true;
  }
  
  const coversDir = getCoversDir();
  if (!fs.existsSync(coversDir)) {
    fs.mkdirSync(coversDir, { recursive: true });
  }
  
  const ext = path.extname(coverPath);
  const sanitizedName = game.name.replace(/[<>:"/\\|?*]/g, '_');
  const newFileName = `${gameId}_${sanitizedName}${ext || '.jpg'}`;
  const newCoverPath = path.join(coversDir, newFileName);
  
  fs.copyFileSync(coverPath, newCoverPath);
  
  const stmt = db.prepare('UPDATE games SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  stmt.run(newCoverPath, gameId);
  return true;
});

const ensureTagIdByName = (name) => {
  const normalized = normalizeVendorName(name);
  if (!normalized) return null;
  const existing = db
    .prepare('SELECT id, name FROM tags WHERE lower(name) = lower(?) LIMIT 1')
    .get(normalized);
  if (existing?.id) return Number(existing.id);

  try {
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(normalized);
  } catch {}

  const created = db
    .prepare('SELECT id FROM tags WHERE lower(name) = lower(?) LIMIT 1')
    .get(normalized);
  return created?.id ? Number(created.id) : null;
};

const addTagsToGameByNames = (gameId, names) => {
  const id = Number(gameId);
  if (!Number.isFinite(id)) return [];

  const uniqueNames = uniqCaseInsensitive(Array.isArray(names) ? names : []);
  if (uniqueNames.length === 0) return [];

  const limited = uniqueNames.slice(0, 12);
  const added = [];

  db.transaction(() => {
    for (const name of limited) {
      const tagId = ensureTagIdByName(name);
      if (!tagId) continue;
      const info = db
        .prepare('INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?, ?)')
        .run(id, tagId);
      if (info?.changes > 0) {
        added.push(name);
      }
    }
  })();

  return added;
};

const scrapeGameCoverCore = async (gameId) => {
  const game = db.prepare('SELECT id, name, alias, path, cover_path FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: '游戏不存在' };
  }

  let rawPathName = '';
  try {
    const rawPath = typeof game.path === 'string' ? game.path : String(game.path ?? '');
    const trimmedPath = rawPath.trim();
    rawPathName = trimmedPath ? path.basename(trimmedPath) : '';
  } catch {
    rawPathName = '';
  }
  let rawName = '';
  try {
    rawName = String(game.name ?? '').trim();
  } catch {
    rawName = '';
  }
  let rawAlias = '';
  try {
    rawAlias = String(game.alias ?? '').trim();
  } catch {
    rawAlias = '';
  }
  const customRegexCfg = {
    replaceRegex: getSettingValue('scrapeCustomReplaceRegex') ?? '',
    replaceTo: getSettingValue('scrapeCustomReplaceTo') ?? '',
    extractRegex: getSettingValue('scrapeCustomExtractRegex') ?? ''
  };

  const rawNameCustom = applyCustomRegex(rawName, customRegexCfg, { strict: false });
  const rawAliasCustom = applyCustomRegex(rawAlias, customRegexCfg, { strict: false });
  const rawPathNameCustom = applyCustomRegex(rawPathName, customRegexCfg, { strict: false });

  const nameForNormalize = String(rawNameCustom ?? '').trim() ? rawNameCustom : rawName;
  const aliasForNormalize = String(rawAliasCustom ?? '').trim() ? rawAliasCustom : rawAlias;
  const pathNameForNormalize = String(rawPathNameCustom ?? '').trim() ? rawPathNameCustom : rawPathName;

  const normalizedName = normalizeGameTitle(nameForNormalize);
  const normalizedAlias = normalizeGameTitle(aliasForNormalize);
  const normalizedPathName = normalizeGameTitle(pathNameForNormalize);

  const candidates = [
    ...(rawAlias ? [normalizedAlias, String(aliasForNormalize || '').trim(), rawAlias] : []),
    normalizedName,
    String(nameForNormalize || '').trim(),
    rawName,
    normalizedPathName,
    String(pathNameForNormalize || '').trim(),
    String(rawPathName || '').trim()
  ]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === idx);

  const tried = [];
  const attempts = [];

  const providerToggleKeyByName = {
    SteamGridDB: 'scrapeEnableSteamGridDB',
    IGDB: 'scrapeEnableIGDB',
    VNDBv2: 'scrapeEnableVNDBv2',
    Ymgal: 'scrapeEnableYmgal',
    VNDB: 'scrapeEnableVNDB',
    Steam: 'scrapeEnableSteam',
    Bangumi: 'scrapeEnableBangumi',
    DLsite: 'scrapeEnableDLsite'
  };

  const providerDefaultEnabledByName = {
    VNDBv2: true,
    Ymgal: true,
    Bangumi: true,
    Steam: false,
    SteamGridDB: false,
    IGDB: false,
    VNDB: false,
    DLsite: false
  };

  const providerFns = [
    { name: 'VNDBv2', fn: tryVndbV2Cover },
    { name: 'Ymgal', fn: tryYmgalCover },
    { name: 'Bangumi', fn: tryBangumiCover },
    { name: 'Steam', fn: trySteamCover },
    { name: 'SteamGridDB', fn: trySteamGridDbCover },
    { name: 'IGDB', fn: tryIgdbCover },
    { name: 'VNDB', fn: tryVndbCover },
    { name: 'DLsite', fn: tryDlsiteCover }
  ].filter((p) => getBooleanSetting(providerToggleKeyByName[p.name], providerDefaultEnabledByName[p.name]));

  try {
    let found = null;
    let dlsiteTriedFirst = false;

    // 特殊处理：如果是 DLsite 游戏（包含编号）且 DLsite 已启用，优先用 DLsite 刮削
    const dlsiteEnabled = getBooleanSetting(providerToggleKeyByName.DLsite, providerDefaultEnabledByName.DLsite);
    const hasWorkNo = candidates.some((t) => /((?:RJ|VJ|BJ|RE)\d{6,8})/i.test(String(t || '')));
    
    if (dlsiteEnabled && hasWorkNo) {
      console.log('[刮削] 检测到 DLsite 编号，优先使用 DLsite 刮削');
      dlsiteTriedFirst = true;
      
      for (const query of candidates) {
        // 只对包含编号的 query 尝试 DLsite
        if (/((?:RJ|VJ|BJ|RE)\d{6,8})/i.test(String(query || ''))) {
          tried.push('DLsite');
          try {
            const result = await tryDlsiteCover(query);
            if (result?.url) {
              attempts.push({ query, provider: 'DLsite', ok: true });
              found = { ...result, query };
              console.log(`[刮削] DLsite 成功: ${query}`);
              break;
            }
            attempts.push({ query, provider: 'DLsite', ok: false, error: 'not_found' });
          } catch (e) {
            attempts.push({ query, provider: 'DLsite', ok: false, error: e?.message || String(e) });
          }
        }
      }
    }

    // 如果 DLsite 没有找到，或者不是 DLsite 游戏，使用常规流程
    if (!found?.url) {
      for (const query of candidates) {
        tried.length = 0;
        for (const p of providerFns) {
          // 如果 DLsite 已经在上面优先尝试过了，这里跳过
          if (p.name === 'DLsite' && dlsiteTriedFirst) continue;
          
          tried.push(p.name);
          try {
            const result = await p.fn(query);
            if (result?.url) {
              attempts.push({ query, provider: p.name, ok: true });
              found = { ...result, query };
              break;
            }
            attempts.push({ query, provider: p.name, ok: false, error: 'not_found' });
          } catch (e) {
            attempts.push({ query, provider: p.name, ok: false, error: e?.message || String(e) });
          }
        }
        if (found?.url) break;
      }
    }

    if (!found?.url) {
      return { success: false, error: '未找到可用封面', tried, queries: candidates, attempts };
    }

    const buffer = await downloadImageBuffer(found.url);
    let out = buffer;
    try {
      out = await sharp(buffer).resize(600, 900, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
    } catch {
      out = buffer;
    }

    const coversDir = getCoversDir();
    fs.mkdirSync(coversDir, { recursive: true });

    const safeTitle = sanitizeFilenameComponent(found.query || candidates[0] || game.name);
    const fileName = `${gameId}_${safeTitle}.jpg`;
    const newCoverPath = path.join(coversDir, fileName);

    safeUnlinkCover(game.cover_path, gameId);

    fs.writeFileSync(newCoverPath, out);
    db.prepare('UPDATE games SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newCoverPath, gameId);

    let vendorNames = uniqCaseInsensitive(Array.isArray(found?.vendors) ? found.vendors : []);

    if (vendorNames.length === 0) {
      const steamEnabled = getBooleanSetting(providerToggleKeyByName.Steam, providerDefaultEnabledByName.Steam);
      if (steamEnabled) {
        for (const query of candidates) {
          try {
            const appid = await resolveSteamAppId(query);
            if (!appid) continue;
            const vendors = await fetchSteamVendors(appid);
            if (Array.isArray(vendors) && vendors.length > 0) {
              vendorNames = vendors;
              break;
            }
          } catch {}
        }
      }
    }

    if (vendorNames.length === 0) {
      const vndbV2Enabled = getBooleanSetting(providerToggleKeyByName.VNDBv2, providerDefaultEnabledByName.VNDBv2);
      if (vndbV2Enabled) {
        for (const query of candidates) {
          try {
            const vendors = await tryVndbV2Vendors(query);
            if (Array.isArray(vendors) && vendors.length > 0) {
              vendorNames = vendors;
              break;
            }
          } catch {}
        }
      }
    }

    if (vendorNames.length === 0) {
      const dlsiteEnabled = getBooleanSetting(providerToggleKeyByName.DLsite, providerDefaultEnabledByName.DLsite);
      const hasWorkNo = candidates.some((t) => /((?:RJ|VJ|BJ|RE)\d{6,8})/i.test(String(t || '')));
      if (dlsiteEnabled && hasWorkNo) {
        for (const query of candidates) {
          try {
            const result = await tryDlsiteCover(query);
            const vendors = Array.isArray(result?.vendors) ? result.vendors : [];
            if (vendors.length > 0) {
              vendorNames = vendors;
              break;
            }
          } catch {}
        }
      }
    }

    const vendorTags = addTagsToGameByNames(gameId, vendorNames);

    return { success: true, provider: found.provider, query: found.query, coverPath: newCoverPath, vendorTags };
  } catch (error) {
    return { success: false, error: error?.message || String(error), tried, queries: candidates, attempts };
  }
};

ipcMain.handle('scrape-game-cover', async (event, gameId) => {
  return scrapeGameCoverCore(gameId);
});

ipcMain.handle('delete-game', async (event, gameId, deleteFiles = false) => {
  try {
    const game = db.prepare('SELECT id, cover_path, path FROM games WHERE id = ?').get(gameId);
    if (!game) return false;

    const extraPaths = db.prepare('SELECT path FROM game_paths WHERE game_id = ?').all(gameId);
    const pathSet = new Set([
      game.path,
      ...extraPaths.map((r) => r?.path).filter(Boolean)
    ]);

    // 获取所有根目录路径，防止误删
    const rootPaths = db.prepare('SELECT path FROM root_paths').all().map(r => r.path.toLowerCase());

    const insertIgnoredPathStmt = db.prepare(
      'INSERT OR IGNORE INTO ignored_game_paths (path) VALUES (?)'
    );

    const tx = db.transaction(() => {
      // 只有在仅移除记录（不删除文件）时，才加入忽略列表，防止下次扫描又出来
      if (!deleteFiles) {
        for (const p of pathSet) {
          if (p) insertIgnoredPathStmt.run(p);
        }
      }
      db.prepare('DELETE FROM game_tags WHERE game_id = ?').run(gameId);
      db.prepare('DELETE FROM game_paths WHERE game_id = ?').run(gameId);
      db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
    });
    tx();

    if (deleteFiles) {
      for (const p of pathSet) {
        if (!p) continue;
        try {
          // 安全检查：如果是根目录，则不删除
          if (rootPaths.includes(p.toLowerCase())) {
            console.warn(`Skipping deletion of root path: ${p}`);
            continue;
          }
          if (fs.existsSync(p)) {
            // 彻底删除文件/目录
            fs.rmSync(p, { recursive: true, force: true });
          }
        } catch (err) {
          console.error(`Failed to delete file/directory: ${p}`, err);
        }
      }
    }

    safeUnlinkCover(game.cover_path, gameId);
    return true;
  } catch (error) {
    console.error('delete-game failed:', error);
    return false;
  }
});

ipcMain.handle('get-ignored-game-paths', async () => {
  try {
    const rows = db.prepare('SELECT path, created_at FROM ignored_game_paths ORDER BY created_at DESC').all();
    return { success: true, items: rows };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('restore-ignored-game-paths', async (event, paths) => {
  try {
    const list = Array.isArray(paths) ? paths.map((p) => String(p || '').trim()).filter(Boolean) : [];
    if (list.length === 0) return { success: true, restored: 0 };

    const delStmt = db.prepare('DELETE FROM ignored_game_paths WHERE path = ?');
    let restored = 0;
    db.transaction(() => {
      for (const p of list) {
        const res = delStmt.run(p);
        restored += res.changes || 0;
      }
    })();

    return { success: true, restored };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('clear-ignored-game-paths', async () => {
  try {
    const res = db.prepare('DELETE FROM ignored_game_paths').run();
    return { success: true, restored: res.changes || 0 };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('get-tags', async () => {
  return db.prepare('SELECT * FROM tags ORDER BY name').all();
});

ipcMain.handle('create-tag', async (event, name, color) => {
  const stmt = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)');
  const result = stmt.run(name, color);
  return { id: result.lastInsertRowid, name, color };
});

ipcMain.handle('update-tag', async (event, tagId, name, color) => {
  const stmt = db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?');
  stmt.run(name, color, tagId);
  return true;
});

ipcMain.handle('delete-tag', async (event, tagId) => {
  const stmt = db.prepare('DELETE FROM tags WHERE id = ?');
  stmt.run(tagId);
  return true;
});

ipcMain.handle('add-tag-to-game', async (event, gameId, tagId) => {
  const stmt = db.prepare('INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?, ?)');
  stmt.run(gameId, tagId);
  return true;
});

ipcMain.handle('remove-tag-from-game', async (event, gameId, tagId) => {
  const stmt = db.prepare('DELETE FROM game_tags WHERE game_id = ? AND tag_id = ?');
  stmt.run(gameId, tagId);
  return true;
});

ipcMain.handle('get-game-tags', async (event, gameId) => {
  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN game_tags gt ON t.id = gt.tag_id
    WHERE gt.game_id = ?
  `).all(gameId);
  return tags;
});

ipcMain.handle('get-all-tags', async () => {
  return db.prepare('SELECT * FROM tags ORDER BY name').all();
});

ipcMain.handle('get-games-by-tag', async (event, tagName, { page = 1, pageSize = 20, rootPathId: rootPathIdRaw = null, sortField: sortFieldRaw = 'imported_at', sortOrder: sortOrderRaw = 'desc' } = {}) => {
  const offset = (page - 1) * pageSize;
  const rootPathKey = typeof rootPathIdRaw === 'string' ? rootPathIdRaw.trim().toLowerCase() : '';
  const isOthers = rootPathKey === 'others';
  const parsedRootPathId = isOthers ? Number.NaN : Number.parseInt(String(rootPathIdRaw ?? ''), 10);
  const rootPathId = Number.isFinite(parsedRootPathId) ? parsedRootPathId : null;

  const orderByClause = buildGameOrderByClause(sortFieldRaw, sortOrderRaw);
  
  const total = isOthers
    ? db.prepare(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM games g
      JOIN game_tags gt ON g.id = gt.game_id
      JOIN tags t ON gt.tag_id = t.id
      WHERE t.name = ?
        AND g.is_manual = 1
    `).get(tagName).count
    : rootPathId
    ? db.prepare(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM games g
      JOIN game_tags gt ON g.id = gt.game_id
      JOIN tags t ON gt.tag_id = t.id
      WHERE t.name = ?
        AND (
          g.root_path_id = ?
          OR EXISTS (
            SELECT 1 FROM game_paths gp
            WHERE gp.game_id = g.id AND gp.root_path_id = ?
          )
        )
    `).get(tagName, rootPathId, rootPathId).count
    : db.prepare(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM games g
      JOIN game_tags gt ON g.id = gt.game_id
      JOIN tags t ON gt.tag_id = t.id
      WHERE t.name = ?
    `).get(tagName).count;
  
  const games = isOthers
    ? db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      JOIN game_tags gt ON g.id = gt.game_id
      JOIN tags t ON gt.tag_id = t.id
      WHERE t.name = ?
        AND g.is_manual = 1
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(tagName, pageSize, offset)
    : rootPathId
    ? db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      JOIN game_tags gt ON g.id = gt.game_id
      JOIN tags t ON gt.tag_id = t.id
      WHERE t.name = ?
        AND (
          g.root_path_id = ?
          OR EXISTS (
            SELECT 1 FROM game_paths gp
            WHERE gp.game_id = g.id AND gp.root_path_id = ?
          )
        )
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(tagName, rootPathId, rootPathId, pageSize, offset)
    : db.prepare(`
      SELECT g.*, GROUP_CONCAT(t.name) as tags
      FROM games g
      JOIN game_tags gt ON g.id = gt.game_id
      JOIN tags t ON gt.tag_id = t.id
      WHERE t.name = ?
      GROUP BY g.id
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(tagName, pageSize, offset);
  
  return {
    games: processGames(games),
    total
  };
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return true;
  }
  return false;
});

ipcMain.handle('show-item-in-folder', async (event, filePath, gameMeta) => {
  const raw = typeof filePath === 'string' ? filePath.trim() : '';
  if (!raw) return false;
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) return false;
  shell.showItemInFolder(resolved);
  if (gameMeta?.logRunHistory) {
    tryLogRunHistory({
      ...gameMeta,
      exePath: resolved,
      method: 'show-item-in-folder',
      needsUserConfirm: false
    });
  }
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    const raw = typeof url === 'string' ? url.trim() : '';
    if (!raw) return { success: false, error: '无效链接' };
    if (!/^https?:\/\//i.test(raw)) return { success: false, error: '仅支持 http/https 链接' };
    await shell.openExternal(raw);
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('get-run-history', async (event, params) => {
  try {
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(params?.limit ?? 50), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(params?.offset ?? 0), 10) || 0);
    const total = db.prepare('SELECT COUNT(1) AS c FROM run_history').get()?.c || 0;
    const items = db.prepare(`
      SELECT id, game_id, game_name, exe_path, method, needs_user_confirm, launched_at
      FROM run_history
      ORDER BY launched_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { success: true, items, total };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('clear-run-history', async () => {
  try {
    db.prepare('DELETE FROM run_history').run();
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('scan-executables', async (event, rootPaths) => {
  const roots = (Array.isArray(rootPaths) ? rootPaths : [rootPaths])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .map((p) => path.resolve(p));

  const maxDepth = 6;
  const maxResults = 200;
  const maxVisitedDirs = 3000;

  const ignoreDirNames = new Set([
    '.git',
    '.svn',
    'node_modules',
    'Steamworks Shared',
    'CommonRedist',
    '__MACOSX'
  ]);

  const byPathKey = new Map();

  const pushResult = async (root, fullPath) => {
    const key = fullPath.toLowerCase();
    if (byPathKey.has(key)) return;
    let size = null;
    try {
      const st = await fs.promises.stat(fullPath);
      size = typeof st.size === 'number' ? st.size : null;
    } catch {}
    const relativePath = path.relative(root, fullPath);
    byPathKey.set(key, {
      path: fullPath,
      name: path.basename(fullPath),
      relativePath: relativePath,
      size
    });
  };

  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const st = await fs.promises.stat(root);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    const queue = [{ dir: root, depth: 0 }];
    let visitedDirs = 0;

    while (queue.length > 0 && byPathKey.size < maxResults && visitedDirs < maxVisitedDirs) {
      const current = queue.shift();
      visitedDirs += 1;

      let entries = [];
      try {
        entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of entries) {
        if (byPathKey.size >= maxResults) break;
        const full = path.join(current.dir, ent.name);
        if (ent.isDirectory()) {
          if (current.depth >= maxDepth) continue;
          if (ignoreDirNames.has(ent.name)) continue;
          queue.push({ dir: full, depth: current.depth + 1 });
          continue;
        }
        if (!ent.isFile()) continue;
        if (path.extname(ent.name).toLowerCase() !== '.exe') continue;
        await pushResult(root, full);
      }
    }
  }

  const items = Array.from(byPathKey.values())
    .sort((a, b) => {
      const aRel = String(a.relativePath || '');
      const bRel = String(b.relativePath || '');
      const aDepth = aRel.split(path.sep).length;
      const bDepth = bRel.split(path.sep).length;
      if (aDepth !== bDepth) return aDepth - bDepth;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });

  return { success: true, items };
});

const resolveLaunchTargetExecutable = (exePath, rootPaths) => {
  if (typeof exePath !== 'string' || !exePath.trim()) {
    return { success: false, error: '无效的可执行文件路径' };
  }
  const resolvedExe = path.resolve(exePath);
  if (!path.isAbsolute(resolvedExe)) {
    return { success: false, error: '无效的可执行文件路径' };
  }
  if (path.extname(resolvedExe).toLowerCase() !== '.exe') {
    return { success: false, error: '仅支持运行 exe 文件' };
  }
  if (!fs.existsSync(resolvedExe)) {
    return { success: false, error: '文件不存在' };
  }

  const roots = (Array.isArray(rootPaths) ? rootPaths : [rootPaths])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .map((p) => path.resolve(p));

  if (roots.length > 0) {
    const allowed = roots.some((root) => isPathUnderDirectory(resolvedExe, root));
    if (!allowed) {
      return { success: false, error: '不允许运行该路径下的程序' };
    }
  }

  return { success: true, resolvedExe, exeDir: path.dirname(resolvedExe), roots };
};

const readZoneIdentifier = (resolvedExe) => {
  try {
    const raw = fs.readFileSync(`${resolvedExe}:Zone.Identifier`, 'utf8');
    return String(raw || '');
  } catch {
    return '';
  }
};

const runCommandCapture = (command, args, options = {}) => new Promise((resolve) => {
  let stdout = '';
  let stderr = '';
  let done = false;

  const finish = (result) => {
    if (done) return;
    done = true;
    resolve(result);
  };

  let child = null;
  try {
    child = spawn(command, Array.isArray(args) ? args : [], {
      windowsHide: true,
      ...options,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    finish({ ok: false, code: null, stdout: '', stderr: error?.message || String(error) });
    return;
  }

  if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
  if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('error', (error) => finish({ ok: false, code: null, stdout, stderr: (error?.message || String(error)) }));
  child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
});

const findFirstOnPath = async (fileName) => {
  const raw = typeof fileName === 'string' ? fileName.trim() : '';
  if (!raw) return null;
  const result = await runCommandCapture('where.exe', [raw]);
  if (!result.ok) return null;
  const first = String(result.stdout || '')
    .split(/\r?\n/g)
    .map((v) => v.trim())
    .filter(Boolean)[0];
  if (!first) return null;
  const resolved = path.resolve(first);
  if (!fs.existsSync(resolved)) return null;
  return resolved;
};

const findFileInRoots = async (fileNames, searchRoots) => {
  const names = (Array.isArray(fileNames) ? fileNames : [fileNames])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  if (names.length === 0) return null;
  const nameSet = new Set(names.map((n) => n.toLowerCase()));

  const roots = (Array.isArray(searchRoots) ? searchRoots : [searchRoots])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .map((p) => path.resolve(p));

  const ignoreDirNames = new Set([
    '.git',
    '.svn',
    'node_modules',
    'Steamworks Shared',
    'CommonRedist',
    '__MACOSX',
    '$Recycle.Bin'
  ]);

  const maxDepth = 5;
  const maxVisitedDirs = 4000;

  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const st = await fs.promises.stat(root);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    const queue = [{ dir: root, depth: 0 }];
    let visited = 0;

    while (queue.length > 0 && visited < maxVisitedDirs) {
      const current = queue.shift();
      visited += 1;

      let entries = [];
      try {
        entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of entries) {
        const full = path.join(current.dir, ent.name);
        if (ent.isDirectory()) {
          if (current.depth >= maxDepth) continue;
          if (ignoreDirNames.has(ent.name)) continue;
          queue.push({ dir: full, depth: current.depth + 1 });
          continue;
        }
        if (!ent.isFile()) continue;
        if (!nameSet.has(String(ent.name).toLowerCase())) continue;
        try {
          if (fs.existsSync(full)) return full;
        } catch {}
      }
    }
  }

  return null;
};

const findToolExecutable = async (fileNames, rootPaths) => {
  const names = (Array.isArray(fileNames) ? fileNames : [fileNames])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);

  const isAsarVirtualPath = (p) => {
    const s = String(p || '');
    return /app\.asar[\\/]/i.test(s) && !/app\.asar\.unpacked[\\/]/i.test(s);
  };

  const resourcesBase = (() => {
    try {
      return process.resourcesPath ? path.resolve(process.resourcesPath) : '';
    } catch {
      return '';
    }
  })();

  const resourcesExtends = resourcesBase ? path.join(resourcesBase, 'extends') : '';
  const resourcesUnpackedExtends = resourcesBase ? path.join(resourcesBase, 'app.asar.unpacked', 'extends') : '';
  const userDataExtends = path.join(app.getPath('userData'), 'extends');
  const cwdExtends = path.join(process.cwd(), 'extends');
  const dirExtends = path.join(__dirname, 'extends');

  const extendsBases = (app.isPackaged
    ? [resourcesExtends, resourcesUnpackedExtends, userDataExtends, cwdExtends, dirExtends]
    : [dirExtends, cwdExtends, resourcesExtends, resourcesUnpackedExtends, userDataExtends]
  )
    .filter(Boolean)
    .filter((p) => !isAsarVirtualPath(p));

  const candidateDirs = [];
  for (const base of extendsBases) {
    try {
      if (!fs.existsSync(base)) continue;
      const st = fs.statSync(base);
      if (!st.isDirectory()) continue;
      candidateDirs.push(base);
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const sub = path.join(base, ent.name);
        if (isAsarVirtualPath(sub)) continue;
        candidateDirs.push(sub);
      }
    } catch {}
  }

  for (const dir of candidateDirs) {
    for (const n of names) {
      try {
        const full = path.join(dir, n);
        if (isAsarVirtualPath(full)) continue;
        if (fs.existsSync(full)) return full;
      } catch {}
    }
  }

  for (const n of names) {
    const found = await findFirstOnPath(n);
    if (found) return found;
  }

  const specialRoots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LocalAppData,
    process.env.AppData
  ].filter(Boolean);

  return await findFileInRoots(names, [...(Array.isArray(rootPaths) ? rootPaths : [rootPaths]).filter(Boolean), ...specialRoots]);
};

const spawnDetachedChecked = async (command, args, options = {}) => {
  return await new Promise((resolve) => {
    let child = null;
    let settled = false;

    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      if (child) {
        try {
          child.removeAllListeners('error');
          child.removeAllListeners('spawn');
          child.unref();
        } catch {}
      }
      resolve({ ok, error: error ? String(error) : '' });
    };

    try {
      child = spawn(command, Array.isArray(args) ? args : [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        ...options
      });
    } catch (error) {
      finish(false, error?.message || String(error));
      return;
    }

    child.once('error', (error) => finish(false, error?.message || String(error)));
    child.once('spawn', () => finish(true, ''));

    setTimeout(() => finish(true, ''), 400);
  });
};

const toPowerShellSingleQuoted = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;

let runHistoryInsertStmt = null;
let runHistoryCountStmt = null;
let runHistoryDeleteByGameIdStmt = null;

const tryLogRunHistory = (meta) => {
  try {
    if (!db) return;

    const gameIdRaw = meta?.gameId ?? meta?.id ?? meta?.game_id ?? null;
    const gameId = Number.isFinite(Number(gameIdRaw)) ? Number(gameIdRaw) : null;
    const gameName = meta?.gameName ?? meta?.game_name ?? null;
    const exePath = meta?.exePath ?? meta?.exe_path ?? '';
    const method = meta?.method ?? null;
    const needsUserConfirm = meta?.needsUserConfirm ? 1 : 0;

    if (!exePath || typeof exePath !== 'string') return;

    if (!runHistoryInsertStmt) {
      runHistoryInsertStmt = db.prepare(`
        INSERT INTO run_history (game_id, game_name, exe_path, method, needs_user_confirm, launched_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
    }
    if (!runHistoryCountStmt) {
      runHistoryCountStmt = db.prepare('SELECT COUNT(1) AS c FROM run_history');
    }
    if (!runHistoryDeleteByGameIdStmt) {
      runHistoryDeleteByGameIdStmt = db.prepare('DELETE FROM run_history WHERE game_id = ?');
    }

    const now = Date.now();
    db.transaction(() => {
      if (gameId !== null) {
        if (method === 'show-item-in-folder') {
          db.prepare('DELETE FROM run_history WHERE game_id = ? AND method = ?').run(gameId, 'show-item-in-folder');
        } else {
          db.prepare(`
            DELETE FROM run_history
            WHERE game_id = ?
              AND (method IS NULL OR method <> ?)
          `).run(gameId, 'show-item-in-folder');
        }
      }

      runHistoryInsertStmt.run(
        gameId,
        gameName ? String(gameName) : null,
        String(exePath),
        method ? String(method) : null,
        needsUserConfirm,
        now
      );

      const count = runHistoryCountStmt.get()?.c || 0;
      const keep = 500;
      const threshold = 800;
      if (count > threshold) {
        const over = count - keep;
        if (over > 0) {
          db.prepare(`
            DELETE FROM run_history
            WHERE id IN (
              SELECT id FROM run_history
              ORDER BY launched_at ASC, id ASC
              LIMIT ?
            )
          `).run(over);
        }
      }
    })();
  } catch {}
};

ipcMain.handle('launch-executable', async (event, exePath, rootPaths, gameMeta) => {
  try {
    const resolved = resolveLaunchTargetExecutable(exePath, rootPaths);
    if (!resolved.success) return resolved;

    const { resolvedExe, exeDir } = resolved;
    const hasMotw = /\[ZoneTransfer\]/i.test(readZoneIdentifier(resolvedExe));

    if (hasMotw) {
      const err = await shell.openPath(resolvedExe);
      if (typeof err === 'string' && err.trim()) {
        try {
          shell.showItemInFolder(resolvedExe);
        } catch {}
        return { success: false, error: '该程序会触发 SmartScreen，请在资源管理器中“更多信息 → 仍要运行”后再启动', details: err.trim() };
      }
      tryLogRunHistory({
        ...gameMeta,
        exePath: resolvedExe,
        method: 'shell.openPath',
        needsUserConfirm: true
      });
      return { success: true, method: 'shell.openPath', needsUserConfirm: true };
    }

    const err = await shell.openPath(resolvedExe);
    if (typeof err === 'string' && err.trim()) {
      try {
        shell.showItemInFolder(resolvedExe);
      } catch {}
      return { success: false, error: '启动失败', details: err.trim() };
    }
    tryLogRunHistory({
      ...gameMeta,
      exePath: resolvedExe,
      method: 'shell.openPath',
      needsUserConfirm: false
    });
    return { success: true, method: 'shell.openPath' };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('launch-executable-admin', async (event, exePath, rootPaths, gameMeta) => {
  try {
    const resolved = resolveLaunchTargetExecutable(exePath, rootPaths);
    if (!resolved.success) return resolved;
    const { resolvedExe, exeDir } = resolved;

    const hasMotw = /\[ZoneTransfer\]/i.test(readZoneIdentifier(resolvedExe));
    if (hasMotw) {
      try {
        fs.unlinkSync(`${resolvedExe}:Zone.Identifier`);
      } catch (error) {
        try {
          shell.showItemInFolder(resolvedExe);
        } catch {}
        return {
          success: false,
          error: '该程序被 SmartScreen 拦截，无法直接以管理员启动；请先在资源管理器中对该文件选择“仍要运行/解除锁定”后再试',
          details: error?.message || String(error)
        };
      }
    }

    const psCommand = [
      '$ErrorActionPreference = "Stop"',
      `Start-Process -FilePath ${toPowerShellSingleQuoted(resolvedExe)} -WorkingDirectory ${toPowerShellSingleQuoted(exeDir)} -Verb RunAs | Out-Null`,
      'exit 0'
    ].join('; ');

    const result = await runCommandCapture('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], {
      cwd: exeDir,
      detached: false
    });

    if (result.ok) {
      tryLogRunHistory({
        ...gameMeta,
        exePath: resolvedExe,
        method: 'powershell-runas',
        needsUserConfirm: true
      });
      return { success: true, method: 'powershell-runas', needsUserConfirm: true };
    }

    const msg = String(result.stderr || result.stdout || '').trim();
    return {
      success: false,
      error: msg || '以管理员身份启动失败（可能已取消 UAC）'
    };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('launch-executable-locale-emulator', async (event, exePath, rootPaths, gameMeta) => {
  try {
    const resolved = resolveLaunchTargetExecutable(exePath, rootPaths);
    if (!resolved.success) return resolved;
    const { resolvedExe } = resolved;

    const leproc = await findToolExecutable(['LEProc.exe', 'LEProc'], resolved.roots);
    if (!leproc) {
      return { success: false, error: '未找到 LEProc.exe，请确认已安装 Locale Emulator，或放到 extends/Locale_Emulator 目录' };
    }

    const leDir = path.dirname(leproc);
    // Locale Emulator 需要 -run 参数
    const spawned = await spawnDetachedChecked(leproc, ['-run', resolvedExe], { cwd: leDir, windowsHide: false });
    if (!spawned.ok) {
      return { success: false, error: '启动失败：' + (spawned.error || '无法启动 LEProc.exe') };
    }
    tryLogRunHistory({
      ...gameMeta,
      exePath: resolvedExe,
      method: 'leproc',
      needsUserConfirm: false
    });
    return { success: true, method: 'leproc' };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('launch-executable-locale-remulator', async (event, exePath, rootPaths, gameMeta) => {
  try {
    const resolved = resolveLaunchTargetExecutable(exePath, rootPaths);
    if (!resolved.success) return resolved;
    const { resolvedExe } = resolved;

    const lrproc = await findToolExecutable(['LRProc.exe', 'LRProc'], resolved.roots);
    if (!lrproc) {
      return { success: false, error: '未找到 LRProc.exe，请确认已安装 Locale Remulator x64，或放到 extends/Locale_Remulator 目录' };
    }

    const lrDir = path.dirname(lrproc);
    const configPath = path.join(lrDir, 'LRConfig.xml');
    let guid = '';
    try {
      if (fs.existsSync(configPath)) {
        const xml = String(await fs.promises.readFile(configPath, 'utf8') || '');
        const m = xml.match(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/);
        guid = m?.[0] ? String(m[0]) : '';
      }
    } catch {}

    if (!guid) {
      return { success: false, error: '未找到 Locale Remulator 配置（LRConfig.xml 或 GUID），请先在 LREditor 中创建配置' };
    }

    // Locale Remulator 参数：GUID + exe路径，不隐藏窗口
    const spawned = await spawnDetachedChecked(lrproc, [guid, resolvedExe], { cwd: lrDir, windowsHide: false });
    if (!spawned.ok) {
      return { success: false, error: '启动失败：' + (spawned.error || '无法启动 LRProc.exe') };
    }
    tryLogRunHistory({
      ...gameMeta,
      exePath: resolvedExe,
      method: 'lrproc',
      needsUserConfirm: false
    });
    return { success: true, method: 'lrproc', guid };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('get-game-cover', async (event, gameId) => {
  const game = db.prepare('SELECT cover_path FROM games WHERE id = ?').get(gameId);
  return game?.cover_path || null;
});

ipcMain.handle('capture-screen-cover', async (event, gameId) => {
  const game = db.prepare('SELECT name, cover_path FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: '游戏不存在' };
  }
  if (mainWindow) {
    mainWindow.minimize();
  }
  const overlay = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Capture</title>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            cursor: crosshair;
            background: rgba(0, 0, 0, 0.2);
            user-select: none;
          }
          #selection {
            position: fixed;
            border: 2px solid #3b82f6;
            background: rgba(59, 130, 246, 0.3);
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <script>
          const { ipcRenderer } = require('electron');
          let isSelecting = false;
          let startX = 0;
          let startY = 0;
          let selection;
          function onMouseDown(e) {
            if (e.button !== 0) return;
            isSelecting = true;
            startX = e.clientX;
            startY = e.clientY;
            if (!selection) {
              selection = document.createElement('div');
              selection.id = 'selection';
              document.body.appendChild(selection);
            }
            selection.style.left = startX + 'px';
            selection.style.top = startY + 'px';
            selection.style.width = '0px';
            selection.style.height = '0px';
          }
          function onMouseMove(e) {
            if (!isSelecting || !selection) return;
            const currentX = e.clientX;
            const currentY = e.clientY;
            const x = Math.min(startX, currentX);
            const y = Math.min(startY, currentY);
            const w = Math.abs(currentX - startX);
            const h = Math.abs(currentY - startY);
            selection.style.left = x + 'px';
            selection.style.top = y + 'px';
            selection.style.width = w + 'px';
            selection.style.height = h + 'px';
          }
          function sendResult(payload) {
            ipcRenderer.send('capture-screen-cover-result', payload);
          }
          function onMouseUp(e) {
            if (!isSelecting) return;
            isSelecting = false;
            if (!selection) {
              sendResult({ success: false, error: '未选择区域' });
              return;
            }
            const rect = selection.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) {
              sendResult({ success: false, error: '选区太小' });
              return;
            }
            sendResult({
              success: true,
              rect: {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
              },
              windowSize: {
                width: window.innerWidth,
                height: window.innerHeight
              }
            });
          }
          function onKeyDown(e) {
            if (e.key === 'Escape') {
              sendResult({ success: false, error: 'cancelled' });
            }
          }
          window.addEventListener('mousedown', onMouseDown);
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
          window.addEventListener('keydown', onKeyDown);
        </script>
      </body>
    </html>
  `;
  overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return await new Promise((resolve) => {
    const handler = async (eventResult, payload) => {
      if (!payload || !payload.success) {
        if (!overlay.isDestroyed()) {
          overlay.close();
        }
        if (mainWindow) {
          mainWindow.restore();
        }
        resolve({ success: false, error: payload ? payload.error || 'unknown' : 'unknown' });
        return;
      }
      const rect = payload.rect;
      const windowSize = payload.windowSize || { width: rect ? rect.width : 0, height: rect ? rect.height : 0 };
      if (!rect || rect.width <= 0 || rect.height <= 0 || !windowSize.width || !windowSize.height) {
        if (!overlay.isDestroyed()) {
          overlay.close();
        }
        if (mainWindow) {
          mainWindow.restore();
        }
        resolve({ success: false, error: '无效的选区' });
        return;
      }
      try {
        if (!overlay.isDestroyed()) {
          overlay.hide();
        }
        await new Promise(r => setTimeout(r, 100));
        const captureWidth = Math.round(windowSize.width);
        const captureHeight = Math.round(windowSize.height);
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: captureWidth, height: captureHeight }
        });
        if (!sources || !sources.length) {
          if (!overlay.isDestroyed()) {
            overlay.close();
          }
          if (mainWindow) {
            mainWindow.restore();
          }
          resolve({ success: false, error: '无法获取屏幕源' });
          return;
        }
        const source = sources[0];
        const imageSize = source.thumbnail.getSize();
        const scaleX = imageSize.width / windowSize.width;
        const scaleY = imageSize.height / windowSize.height;
        const safeRect = {
          x: Math.max(0, Math.round(rect.x * scaleX)),
          y: Math.max(0, Math.round(rect.y * scaleY)),
          width: Math.round(rect.width * scaleX),
          height: Math.round(rect.height * scaleY)
        };
        if (safeRect.x + safeRect.width > imageSize.width) {
          safeRect.width = imageSize.width - safeRect.x;
        }
        if (safeRect.y + safeRect.height > imageSize.height) {
          safeRect.height = imageSize.height - safeRect.y;
        }
        if (safeRect.width <= 0 || safeRect.height <= 0) {
          if (!overlay.isDestroyed()) {
            overlay.close();
          }
          if (mainWindow) {
            mainWindow.restore();
          }
          resolve({ success: false, error: '无效的选区' });
          return;
        }
        const image = source.thumbnail.crop(safeRect);
        const buffer = image.toPNG();
        const tempDir = path.join(app.getPath('userData'), 'captures');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const tempPath = path.join(tempDir, Date.now().toString() + '.png');
        fs.writeFileSync(tempPath, buffer);
        const coversDir = getCoversDir();
        if (!fs.existsSync(coversDir)) {
          fs.mkdirSync(coversDir, { recursive: true });
        }
        const sanitizedName = game.name.replace(/[<>:"/\\|?*]/g, '_');
        const newFileName = `${gameId}_${sanitizedName}.png`;
        const newCoverPath = path.join(coversDir, newFileName);
        safeUnlinkCover(game.cover_path, gameId);
        safeUnlinkCover(newCoverPath, gameId);
        fs.copyFileSync(tempPath, newCoverPath);
        const stmt = db.prepare('UPDATE games SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        stmt.run(newCoverPath, gameId);
        if (!overlay.isDestroyed()) {
          overlay.close();
        }
        if (mainWindow) {
          mainWindow.restore();
        }
        resolve({ success: true });
      } catch (e) {
        if (!overlay.isDestroyed()) {
          overlay.close();
        }
        if (mainWindow) {
          mainWindow.restore();
        }
        resolve({ success: false, error: e.message || String(e) });
      }
    };
    ipcMain.once('capture-screen-cover-result', handler);
  });
});

// ==========================================
// 移动端/局域网 HTTP API 服务与配套支持
// ==========================================
let apiServer = null;
let apiServerState = { running: false, error: '', host: '', port: 0, startedAt: 0 };

const apiSettingKeys = {
  enabled: 'apiEnabled',
  host: 'apiHost',
  port: 'apiPort',
  token: 'apiToken',
  exposeFullPath: 'apiExposeFullPath',
  allowRemoteLaunch: 'apiAllowRemoteLaunch',
  allowUpload: 'apiAllowUpload',
  uploadTargetDir: 'apiUploadTargetDir',
  uploadMaxSize: 'apiUploadMaxSize'
};

const readApiSetting = (key, defaultValue = '') => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row?.value === null || row?.value === undefined) return defaultValue;
    return String(row.value);
  } catch {
    return defaultValue;
  }
};

const writeApiSetting = (key, value) => {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(key, String(value ?? ''), String(value ?? ''));
};

const toBoolSetting = (value, defaultValue = false) => {
  if (value === null || value === undefined || value === '') return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
};

const createApiToken = () => crypto.randomBytes(32).toString('hex');

const ensureApiSettings = () => {
  if (!readApiSetting(apiSettingKeys.enabled, '')) writeApiSetting(apiSettingKeys.enabled, 'true');
  if (!readApiSetting(apiSettingKeys.host, '')) writeApiSetting(apiSettingKeys.host, '0.0.0.0');
  if (!readApiSetting(apiSettingKeys.port, '')) writeApiSetting(apiSettingKeys.port, '37689');
  if (!readApiSetting(apiSettingKeys.exposeFullPath, '')) writeApiSetting(apiSettingKeys.exposeFullPath, 'true');
  if (!readApiSetting(apiSettingKeys.allowRemoteLaunch, '')) writeApiSetting(apiSettingKeys.allowRemoteLaunch, 'true');
  if (!readApiSetting(apiSettingKeys.token, '')) writeApiSetting(apiSettingKeys.token, createApiToken());
};

// 上传根目录（父目录）：**纯计算，绝不创建任何目录**
// 文件最终落 <上传根目录>/<文件名含扩展名>/<文件名>
// 只有真正申请票据时才建目录 —— 功能没开启时磁盘上不该出现任何多余文件夹
const getUploadRootFromDb = () => {
  const custom = readApiSetting(apiSettingKeys.uploadTargetDir, '');
  if (custom) return custom;
  // 默认跟随最近添加的根目录（移动端弹窗里也会让用户显式选择）
  try {
    const first = db.prepare('SELECT path FROM root_paths ORDER BY created_at DESC LIMIT 1').get();
    if (first?.path) return first.path;
  } catch {}
  // 兜底：用户数据目录（不落在游戏盘上）
  return path.join(app.getPath('userData'), 'uploads');
};

const getUploadMaxSizeFromDb = () => {
  const parsed = Number.parseInt(readApiSetting(apiSettingKeys.uploadMaxSize, String(10 * 1024 * 1024 * 1024)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 1024 * 1024 * 1024; // 默认 10GB
};

const getApiSettingsFromDb = () => {
  ensureApiSettings();
  const port = Number.parseInt(readApiSetting(apiSettingKeys.port, '37689'), 10);
  const host = readApiSetting(apiSettingKeys.host, '0.0.0.0') === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0';
  return {
    enabled: toBoolSetting(readApiSetting(apiSettingKeys.enabled, 'true'), true),
    host,
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : 37689,
    token: readApiSetting(apiSettingKeys.token, ''),
    exposeFullPath: toBoolSetting(readApiSetting(apiSettingKeys.exposeFullPath, 'true'), true),
    allowRemoteLaunch: toBoolSetting(readApiSetting(apiSettingKeys.allowRemoteLaunch, 'true'), true),
    allowUpload: toBoolSetting(readApiSetting(apiSettingKeys.allowUpload, 'false'), false),
    uploadRootDir: getUploadRootFromDb(),
    uploadMaxSize: getUploadMaxSizeFromDb()
  };
};

const getLanAddresses = () => {
  try {
    const interfaces = os.networkInterfaces();
    const list = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!Array.isArray(addrs)) continue;
      for (const item of addrs) {
        if (!item || item.family !== 'IPv4' || item.internal) continue;
        const ip = item.address;
        const isVirtualOrTun = /tunnel|tun|tap|vethernet|virtual|docker|wsl|loopback|tailscale|zerotier/i.test(name) ||
          ip.startsWith('198.18.') ||
          ip.startsWith('169.254.') ||
          ip.startsWith('192.168.56.');

        let priority = 10;
        if (ip.startsWith('192.168.') && !isVirtualOrTun) priority = 100;
        else if (ip.startsWith('10.') && !isVirtualOrTun) priority = 90;
        else if (ip.startsWith('172.') && !isVirtualOrTun) priority = 80;
        else if (isVirtualOrTun) priority = 1;

        list.push({ name, ip, priority });
      }
    }
    return list.sort((a, b) => b.priority - a.priority).map((item) => item.ip);
  } catch {
    return [];
  }
};

const sendApiJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
};

const sendApiError = (res, statusCode, message) => {
  sendApiJson(res, statusCode, { success: false, data: null, error: message });
};

const resolveCoverFilePath = (gameId, rawCoverPath, gameFolderPath = null) => {
  const coverDirs = Array.from(new Set([
    getCoversDir(),
    path.join(app.getPath('userData'), 'covers'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'gamemanage', 'covers'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'gamemanage', 'covers') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'gamemanage', 'covers') : '',
    path.join(__dirname, 'electron-data', 'covers'),
    path.join(process.cwd(), 'electron-data', 'covers'),
    path.join(__dirname, 'covers'),
    path.join(process.cwd(), 'covers')
  ])).filter(Boolean);

  // 1. 如果提供了 rawCoverPath，且在磁盘上存在
  if (rawCoverPath && typeof rawCoverPath === 'string') {
    let clean = rawCoverPath.trim();
    if (clean.startsWith('file:///')) {
      clean = clean.slice(8).split('?')[0];
      clean = decodeURIComponent(clean);
    } else if (clean.startsWith('file://')) {
      clean = clean.slice(7).split('?')[0];
      clean = decodeURIComponent(clean);
    } else {
      clean = clean.split('?')[0];
    }

    if (clean && fs.existsSync(clean)) return clean;
    try {
      const norm = path.normalize(clean);
      if (norm && fs.existsSync(norm)) return norm;
    } catch {}

    const baseName = path.basename(clean);
    for (const dir of coverDirs) {
      if (!dir) continue;
      try {
        const joined = path.join(dir, baseName);
        if (fs.existsSync(joined)) return joined;
      } catch {}
    }
  }

  // 2. 仅在 covers 目录中精准匹配该游戏 ID 的专属封面文件 (${gameId}_* 或 ${gameId}.*)
  if (gameId) {
    for (const dir of coverDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        const matched = files.find((f) => f.startsWith(`${gameId}_`) || f.startsWith(`${gameId}.`));
        if (matched) {
          return path.join(dir, matched);
        }
      } catch {}
    }
  }

  // 3. 在游戏本体文件夹中查找常见封面 (仅当 gameFolderPath 是真实存在的目录时)
  if (gameFolderPath && typeof gameFolderPath === 'string' && fs.existsSync(gameFolderPath)) {
    try {
      const stat = fs.statSync(gameFolderPath);
      if (stat.isDirectory()) {
        const commonCoverNames = [
          'cover.jpg', 'cover.png', 'cover.webp', 'cover.jpeg',
          'folder.jpg', 'folder.png', 'poster.jpg', 'poster.png',
          'banner.jpg', 'banner.png', 'thumb.jpg', 'thumb.png',
          'front.jpg', 'front.png'
        ];
        for (const cName of commonCoverNames) {
          const p = path.join(gameFolderPath, cName);
          if (fs.existsSync(p)) return p;
        }
        // 兜底扫描游戏根目录下第一张 .jpg / .png / .webp
        const entries = fs.readdirSync(gameFolderPath, { withFileTypes: true });
        const imgEntry = entries.find((e) => !e.isDirectory() && /\.(jpe?g|png|webp)$/i.test(e.name));
        if (imgEntry) {
          return path.join(gameFolderPath, imgEntry.name);
        }
      }
    } catch {}
  }

  return null;
};

const sanitizeApiGame = (game, { exposeFullPath = false, baseUrl = '' } = {}) => {
  const tags = Array.isArray(game.tags) ? game.tags : [];
  const coverFilePath = resolveCoverFilePath(game.id, game.cover_path, game.path);
  const hasCover = !!coverFilePath;
  const version = game.updated_at ? new Date(game.updated_at).getTime() : (game.imported_at ? new Date(game.imported_at).getTime() : '');
  const result = {
    id: game.id,
    name: game.name,
    alias: game.alias || '',
    pinned: !!game.pinned,
    importedAt: game.imported_at || null,
    createdAt: game.created_at || null,
    updatedAt: game.updated_at || null,
    isManual: !!game.is_manual,
    tags,
    rootPathIds: Array.isArray(game.root_path_ids) ? game.root_path_ids : [],
    hasCover,
    coverUrl: hasCover ? `${baseUrl}/api/covers/${game.id}?thumb=1${version ? `&v=${version}` : ''}` : null
  };
  if (exposeFullPath) {
    result.path = game.path || '';
    result.paths = Array.isArray(game.paths) ? game.paths : [];
  }
  return result;
};

const getApiBaseUrl = (req, settings) => {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers.host || `127.0.0.1:${settings.port}`);
  return `${proto}://${host}`;
};

const requireApiAuth = (req, settings) => {
  const token = String(settings.token || '');
  if (!token) return false;
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() === token;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    return url.searchParams.get('token') === token;
  } catch {
    return false;
  }
};

const queryApiGames = ({ page = 1, pageSize = 60, query = '', tag = '', rootPathId = null, sort = 'imported_at', order = 'desc', all = false } = {}) => {
  const isAll = all === true || all === 'true' || all === '1' || pageSize === 'all' || pageSize === '0';
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const safePageSize = isAll ? 100000 : Math.max(1, Math.min(500, Number.parseInt(String(pageSize), 10) || 60));
  const offset = isAll ? 0 : (safePage - 1) * safePageSize;
  const rootPathKey = typeof rootPathId === 'string' ? rootPathId.trim().toLowerCase() : '';
  const isOthers = rootPathKey === 'others';
  const parsedRootPathId = isOthers ? Number.NaN : Number.parseInt(String(rootPathId ?? ''), 10);
  const normalizedRootPathId = Number.isFinite(parsedRootPathId) ? parsedRootPathId : null;
  const orderByClause = buildGameOrderByClause(sort, order);

  let whereClauses = [];
  let params = [];

  if (String(query || '').trim()) {
    const searchPattern = `%${String(query).trim()}%`;
    whereClauses.push(`(g.name LIKE ? OR g.path LIKE ? OR g.alias LIKE ? OR EXISTS (SELECT 1 FROM game_tags gt2 JOIN tags t2 ON gt2.tag_id = t2.id WHERE gt2.game_id = g.id AND t2.name LIKE ?))`);
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  if (String(tag || '').trim()) {
    whereClauses.push(`EXISTS (SELECT 1 FROM game_tags gt3 JOIN tags t3 ON gt3.tag_id = t3.id WHERE gt3.game_id = g.id AND t3.name = ?)`);
    params.push(String(tag).trim());
  }

  if (isOthers) {
    whereClauses.push(`g.is_manual = 1`);
  } else if (normalizedRootPathId) {
    whereClauses.push(`(g.root_path_id = ? OR EXISTS (SELECT 1 FROM game_paths gp WHERE gp.game_id = g.id AND gp.root_path_id = ?))`);
    params.push(normalizedRootPathId, normalizedRootPathId);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(DISTINCT g.id) as count FROM games g ${whereSql}`).get(...params).count;

  const rows = isAll
    ? db.prepare(`
        SELECT g.*, GROUP_CONCAT(t.name) as tags
        FROM games g
        LEFT JOIN game_tags gt ON g.id = gt.game_id
        LEFT JOIN tags t ON gt.tag_id = t.id
        ${whereSql}
        GROUP BY g.id
        ${orderByClause}
      `).all(...params)
    : db.prepare(`
        SELECT g.*, GROUP_CONCAT(t.name) as tags
        FROM games g
        LEFT JOIN game_tags gt ON g.id = gt.game_id
        LEFT JOIN tags t ON gt.tag_id = t.id
        ${whereSql}
        GROUP BY g.id
        ${orderByClause}
        LIMIT ? OFFSET ?
      `).all(...params, safePageSize, offset);

  return { games: processGames(rows), total, page: safePage, pageSize: isAll ? total : safePageSize };
};

const getApiStats = () => {
  const gameCount = db.prepare('SELECT COUNT(1) AS c FROM games').get()?.c || 0;
  const rootPathCount = db.prepare('SELECT COUNT(1) AS c FROM root_paths').get()?.c || 0;
  const tagCount = db.prepare('SELECT COUNT(1) AS c FROM tags').get()?.c || 0;
  const missingCoverCount = db.prepare(`
    SELECT COUNT(1) AS c FROM games
    WHERE cover_path IS NULL OR TRIM(cover_path) = ''
  `).get()?.c || 0;
  const untaggedCount = db.prepare(`
    SELECT COUNT(1) AS c
    FROM games g
    WHERE NOT EXISTS (SELECT 1 FROM game_tags gt WHERE gt.game_id = g.id)
  `).get()?.c || 0;
  const pinnedCount = db.prepare('SELECT COUNT(1) AS c FROM games WHERE pinned = 1').get()?.c || 0;
  const runHistoryCount = db.prepare('SELECT COUNT(1) AS c FROM run_history').get()?.c || 0;
  const tagDistribution = db.prepare(`
    SELECT t.id, t.name, t.color, COUNT(gt.game_id) AS count
    FROM tags t
    LEFT JOIN game_tags gt ON t.id = gt.tag_id
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC
  `).all();
  const rootDistribution = db.prepare(`
    SELECT rp.id, rp.path, COUNT(DISTINCT g.id) AS count
    FROM root_paths rp
    LEFT JOIN games g ON g.root_path_id = rp.id
    GROUP BY rp.id
    ORDER BY count DESC, rp.created_at DESC
  `).all();

  return {
    gameCount,
    rootPathCount,
    tagCount,
    missingCoverCount,
    coveredCount: Math.max(0, gameCount - missingCoverCount),
    untaggedCount,
    pinnedCount,
    runHistoryCount,
    tagDistribution,
    rootDistribution
  };
};

const getGameFilesInternal = async (gameId, maxDepth = 8, maxResults = 2000) => {
  const game = db.prepare('SELECT id, name, path FROM games WHERE id = ?').get(gameId);
  if (!game || !game.path || !fs.existsSync(game.path)) {
    return { success: false, error: '游戏文件夹或文件不存在', files: [] };
  }
  const root = path.resolve(game.path);
  let rootStat;
  try {
    rootStat = await fs.promises.stat(root);
  } catch (err) {
    return { success: false, error: '无法读取文件状态: ' + (err?.message || String(err)), files: [] };
  }

  // 若游戏路径本身为单文件（如 .zip / .7z / .rar / .iso / .exe 等）
  if (!rootStat.isDirectory()) {
    const fileName = path.basename(root);
    return {
      success: true,
      gameName: game.name,
      rootPath: root,
      isSingleFile: true,
      files: [
        {
          name: fileName,
          path: fileName,
          isDir: false,
          size: rootStat.size || 0,
          mtime: rootStat.mtimeMs || null
        }
      ]
    };
  }

  const results = [];

  const scanDir = async (dir, currentDepth) => {
    if (currentDepth > maxDepth || results.length >= maxResults) return;
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (['.git', 'node_modules', '$RECYCLE.BIN'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
      const isDir = entry.isDirectory();
      let size = 0;
      let mtime = null;
      try {
        const st = await fs.promises.stat(fullPath);
        size = st.size || 0;
        mtime = st.mtimeMs || null;
      } catch {}
      results.push({
        name: entry.name,
        path: relPath,
        isDir,
        size,
        mtime
      });
      if (isDir) {
        await scanDir(fullPath, currentDepth + 1);
      }
    }
  };

  await scanDir(root, 1);
  return { success: true, gameName: game.name, rootPath: root, isSingleFile: false, files: results };
};

const EXCLUDE_EXE_PATTERNS = [
  /unins\w*\.exe$/i,
  /uninstall\w*\.exe$/i,
  /crash\w*\.exe$/i,
  /handler\w*\.exe$/i,
  /unitycrashhandler\w*\.exe$/i,
  /vcredist\w*\.exe$/i,
  /dxsetup\.exe$/i,
  /dotNetFx\w*\.exe$/i,
  /setup\.exe$/i,
  /oalinst\.exe$/i,
  /update\w*\.exe$/i,
  /patch\w*\.exe$/i
];

const scoreExecutable = (fileName, gameName = '', gameAlias = '') => {
  const lower = fileName.toLowerCase();
  for (const pat of EXCLUDE_EXE_PATTERNS) {
    if (pat.test(lower)) return -100;
  }
  let score = 10;
  const lowerGameName = (gameName || '').toLowerCase().trim();
  const lowerAlias = (gameAlias || '').toLowerCase().trim();

  if (lowerGameName && (lower.includes(lowerGameName) || lowerGameName.includes(lower.replace(/\.exe$/, '')))) {
    score += 50;
  }
  if (lowerAlias && (lower.includes(lowerAlias) || lowerAlias.includes(lower.replace(/\.exe$/, '')))) {
    score += 40;
  }
  if (['game.exe', 'start.exe', 'launch.exe', 'launcher.exe', 'main.exe', 'play.exe'].includes(lower)) {
    score += 30;
  }
  if (lower.includes('config') || lower.includes('setting')) {
    score -= 10;
  }
  return score;
};

const launchGameInternal = async (gameId, requestedExe = null) => {
  const game = db.prepare('SELECT id, name, alias, path FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: '游戏不存在' };
  }
  if (!game.path || !fs.existsSync(game.path)) {
    return { success: false, error: '游戏路径不存在' };
  }

  let targetExe = null;
  // 1. 用户指定
  if (requestedExe) {
    const fullExe = path.isAbsolute(requestedExe) ? requestedExe : path.join(game.path, requestedExe);
    if (fs.existsSync(fullExe)) {
      targetExe = fullExe;
    }
  }

  // 2. 优先调取历史成功运行过的 exe
  if (!targetExe) {
    const history = db.prepare('SELECT exe_path FROM run_history WHERE game_id = ? ORDER BY launched_at DESC LIMIT 1').get(gameId);
    if (history?.exe_path && fs.existsSync(history.exe_path)) {
      targetExe = history.exe_path;
    }
  }

  // 3. 扫描游戏目录并进行智能加权匹配（排除卸载程序、运行库安装程序）
  if (!targetExe) {
    try {
      const entries = await fs.promises.readdir(game.path, { withFileTypes: true });
      const exeEntries = entries.filter((e) => !e.isDirectory() && e.name.toLowerCase().endsWith('.exe'));
      if (exeEntries.length > 0) {
        const scored = exeEntries
          .map((e) => ({
            name: e.name,
            score: scoreExecutable(e.name, game.name, game.alias)
          }))
          .sort((a, b) => b.score - a.score);

        const best = scored[0];
        if (best && best.score > -50) {
          targetExe = path.join(game.path, best.name);
        }
      }
    } catch {}
  }

  // 4. 兜底打开文件夹
  if (!targetExe) {
    shell.openPath(game.path);
    return { success: true, method: 'openFolder', message: '未找到可执行文件，已打开游戏所在文件夹' };
  }

  const err = await shell.openPath(targetExe);
  if (typeof err === 'string' && err.trim()) {
    return { success: false, error: '启动失败: ' + err.trim() };
  }

  tryLogRunHistory({
    gameId: game.id,
    gameName: game.name,
    exePath: targetExe,
    method: 'shell.openPath',
    needsUserConfirm: false
  });

  return { success: true, launchedExe: path.basename(targetExe), gameName: game.name };
};

const readRequestBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 25 * 1024 * 1024) {
      req.destroy();
      reject(new Error('Payload too large'));
    }
  });
  req.on('end', () => {
    if (!body || !body.trim()) return resolve({});
    try {
      resolve(JSON.parse(body));
    } catch {
      resolve({});
    }
  });
  req.on('error', reject);
});

// --- 下载票据与大文件 Range 断点续传支持 ---
const downloadTickets = new Map();
const packagingJobs = new Map(); // key: `${gameId}:${requestedFile}` -> job

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of downloadTickets.entries()) {
    if (val.expiresAt <= now) {
      if (val.isTempArchive && val.filePath) {
        safeUnlinkArchive(val.filePath);
      }
      downloadTickets.delete(key);
    }
  }
  // 顺便做一次过期临时打包缓存安全清理 (超过 12 小时的缓存自动清理)
  cleanArchiveCache(12 * 60 * 60 * 1000);
  // 上传票据过期清理 + 24h 无主 .part 扫描（挂同一循环，5 分钟一次）
  try { uploader.cleanupExpired(); } catch (err) {
    console.warn('[uploader] 清理循环异常:', err?.message || err);
  }
}, 5 * 60 * 1000).unref();

const createArchiveWithTar = (sourceDir, targetZipPath) => new Promise((resolve, reject) => {
  const dir = path.dirname(targetZipPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 使用 Windows 10/11 原生 C 语言底层 bsdtar，速度提升 10 倍以上且支持 4GB+ 大文件 Zip64
  const tarProc = spawn('tar.exe', ['--options', 'zip:compression=store', '-a', '-cf', targetZipPath, '-C', sourceDir, '.']);

  let stderr = '';
  tarProc.stderr?.on('data', (d) => { stderr += d.toString(); });

  tarProc.on('close', (code) => {
    if (code === 0 && fs.existsSync(targetZipPath)) {
      resolve();
    } else {
      safeUnlinkArchive(targetZipPath);
      reject(new Error(stderr || `tar 压缩失败，退出码: ${code}`));
    }
  });

  tarProc.on('error', (err) => {
    safeUnlinkArchive(targetZipPath);
    reject(err);
  });
});

const runCommandAsync = (cmd, options = {}) => new Promise((resolve, reject) => {
  const { exec } = require('child_process');
  exec(cmd, options, (err, stdout, stderr) => {
    if (err) reject(err);
    else resolve({ stdout, stderr });
  });
});

const serveFileWithRange = (req, res, filePath, customFilename = null, customContentType = null, cleanupCallback = null) => {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    if (cleanupCallback) try { cleanupCallback(); } catch {}
    sendApiError(res, 404, '文件不存在或无法读取: ' + (err?.message || String(err)));
    return;
  }
  const totalSize = stat.size;
  const filename = customFilename || path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  let contentType = customContentType || 'application/octet-stream';
  if (!customContentType) {
    if (ext === '.zip') contentType = 'application/zip';
    else if (ext === '.rar') contentType = 'application/x-rar-compressed';
    else if (ext === '.7z') contentType = 'application/x-7z-compressed';
    else if (ext === '.tar' || ext === '.gz') contentType = 'application/x-tar';
    else if (ext === '.iso') contentType = 'application/x-iso9660-image';
    else if (['.mp4', '.mkv', '.webm'].includes(ext)) contentType = 'video/' + ext.slice(1);
    else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) contentType = 'image/' + (ext === '.jpg' ? 'jpeg' : ext.slice(1));
  }

  const encodedFilename = encodeURIComponent(filename);
  const etag = `"${stat.mtimeMs.toString(36)}-${totalSize.toString(36)}"`;

  // HEAD 请求支持 (用于探活与获取文件大小)
  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': totalSize,
      'Accept-Ranges': 'bytes',
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
    });
    res.end();
    return;
  }

  const range = req.headers.range;
  if (!range) {
    // 完整文件返回 200
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': totalSize,
      'Accept-Ranges': 'bytes',
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
    });
    const stream = fs.createReadStream(filePath);
    let cleaned = false;
    const doCleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { stream.destroy(); } catch {}
      if (cleanupCallback) try { cleanupCallback(); } catch {}
    };
    req.on('close', doCleanup);
    stream.on('error', (err) => {
      doCleanup();
      if (!res.headersSent) sendApiError(res, 500, '读取文件流失败');
      else res.end();
    });
    stream.on('end', doCleanup);
    stream.pipe(res);
    return;
  }

  // 处理 HTTP Range: bytes=start-end
  const matches = range.match(/bytes=(\d*)-(\d*)/);
  if (!matches) {
    res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
    res.end();
    if (cleanupCallback) try { cleanupCallback(); } catch {}
    return;
  }

  let start = matches[1] ? parseInt(matches[1], 10) : NaN;
  let end = matches[2] ? parseInt(matches[2], 10) : NaN;

  if (isNaN(start)) {
    // bytes=-500 (后 500 字节)
    if (isNaN(end) || end <= 0) {
      res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
      res.end();
      if (cleanupCallback) try { cleanupCallback(); } catch {}
      return;
    }
    start = Math.max(0, totalSize - end);
    end = totalSize - 1;
  } else if (isNaN(end) || end >= totalSize) {
    end = totalSize - 1;
  }

  if (start >= totalSize || start > end || start < 0) {
    res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
    res.end();
    if (cleanupCallback) try { cleanupCallback(); } catch {}
    return;
  }

  const chunkSize = end - start + 1;
  res.writeHead(206, {
    'Content-Type': contentType,
    'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
  });

  const stream = fs.createReadStream(filePath, { start, end });
  let cleaned = false;
  const doCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { stream.destroy(); } catch {}
    if (cleanupCallback) try { cleanupCallback(); } catch {}
  };
  req.on('close', doCleanup);
  stream.on('error', (err) => {
    doCleanup();
    if (!res.headersSent) sendApiError(res, 500, '读取文件分片流失败');
    else res.end();
  });
  stream.on('end', doCleanup);
  stream.pipe(res);
};

const handleApiRequest = async (req, res) => {
  const settings = getApiSettingsFromDb();
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, Range, Content-Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition, ETag');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (url.pathname === '/' || url.pathname === '/api/health') {
      sendApiJson(res, 200, {
        success: true,
        data: {
          app: 'myGal',
          version: app.getVersion(),
          apiVersion: 2,
          authenticated: requireApiAuth(req, settings),
          allowRemoteLaunch: !!settings.allowRemoteLaunch,
          allowUpload: !!settings.allowUpload,
          exposeFullPath: !!settings.exposeFullPath
        },
        error: null
      });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      sendApiError(res, 404, 'Not found');
      return;
    }

    // --- /api/downloads/:ticket (基于短时票据的免 Token 安全下载，支持断点续传) ---
    const ticketDownloadMatch = url.pathname.match(/^\/api\/downloads\/([a-zA-Z0-9_-]+)$/);
    if (ticketDownloadMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const ticketId = ticketDownloadMatch[1];
      const ticketData = downloadTickets.get(ticketId);
      if (!ticketData || ticketData.expiresAt <= Date.now()) {
        downloadTickets.delete(ticketId);
        sendApiError(res, 403, '下载票据已失效或不存在，请重新在客户端申请下载');
        return;
      }
      serveFileWithRange(req, res, ticketData.filePath, ticketData.filename);
      return;
    }

    if (!requireApiAuth(req, settings)) {
      sendApiError(res, 401, 'Unauthorized');
      return;
    }

    const exposeFullPath = !!settings.exposeFullPath;
    const baseUrl = getApiBaseUrl(req, settings);

    // ========== 移动端上传：票据 + 分块事务 + 进度 + 取载 ==========
    // POST /api/uploads/tickets —— 申请上传票据（allowUpload 关闭时全拒绝）
    if (url.pathname === '/api/uploads/tickets' && req.method === 'POST') {
      if (!settings.allowUpload) {
        sendApiError(res, 403, 'PC 端未开启上传功能');
        return;
      }
      const body = await readRequestBody(req);
      // 支持选择根目录：rootPathId 对应 root_paths 表，文件落 <该根目录>/<文件名>/<文件名>
      let uploadSettings = settings;
      if (body.rootPathId !== undefined && body.rootPathId !== null && String(body.rootPathId) !== '') {
        const parsedRootId = Number.parseInt(String(body.rootPathId), 10);
        if (!Number.isFinite(parsedRootId)) {
          sendApiError(res, 400, 'rootPathId 不合法');
          return;
        }
        const rootRow = db.prepare('SELECT * FROM root_paths WHERE id = ?').get(parsedRootId);
        if (!rootRow?.path || !fs.existsSync(rootRow.path)) {
          sendApiError(res, 404, '根目录不存在或不可用');
          return;
        }
        // 同名文件夹由 uploader 在建票据时创建（取消/失败会回收空壳）
        uploadSettings = { ...settings, uploadRootDir: rootRow.path };
      }
      const result = uploader.createTicket({
        fileName: body.fileName,
        fileSize: Number(body.fileSize),
        resumeTicket: body.resumeTicket ? String(body.resumeTicket) : ''
      }, uploadSettings);
      if (result.error) {
        sendApiError(res, result.status || 400, result.error);
        return;
      }
      // 只回传文件夹名（不暴露完整 PC 路径），移动端用来提示"已保存到 <根目录>/<folderName>/"
      const { targetDir: _privateDir, ...ticketInfo } = result;
      sendApiJson(res, 200, {
        success: true,
        data: { ...ticketInfo, folderName: _privateDir ? path.basename(_privateDir) : '' },
        error: null
      });
      return;
    }

    // POST /api/uploads/:ticket/complete —— 主动收尾（幂等）
    // 客户端在「字节已收满但没拿到 status:completed 确认」时调用，服务端执行 rename 并回权威状态。
    // 这样「完成」的判定只认服务端，避免出现客户端显示已完成、PC 端却留着 .part 的假成功。
    const uploadCompleteMatch = url.pathname.match(/^\/api\/uploads\/([a-zA-Z0-9_-]+)\/complete$/);
    if (uploadCompleteMatch && req.method === 'POST') {
      if (!settings.allowUpload) {
        sendApiError(res, 403, 'PC 端未开启上传功能');
        return;
      }
      const result = await uploader.completeTicket(uploadCompleteMatch[1]);
      sendApiJson(res, result.status, result.body);
      return;
    }

    const uploadTicketMatch = url.pathname.match(/^\/api\/uploads\/([a-zA-Z0-9_-]+)$/);
    if (uploadTicketMatch) {
      const ticketId = uploadTicketMatch[1];
      if (!settings.allowUpload) {
        sendApiError(res, 403, 'PC 端未开启上传功能');
        return;
      }
      if (req.method === 'PUT') {
        // 分块事务上传：二进制流式写盘，绝不走 readRequestBody
        uploader.handleChunkUpload(req, res, ticketId, sendApiJson, sendApiError);
        return;
      }
      if (req.method === 'GET') {
        const result = uploader.getTicketStatus(ticketId);
        sendApiJson(res, result.status, result.body);
        return;
      }
      if (req.method === 'DELETE') {
        const result = uploader.cancelTicket(ticketId);
        sendApiJson(res, result.status, result.body);
        return;
      }
      sendApiError(res, 405, 'Method not allowed');
      return;
    }
    // ================================================================

    // --- GET /api/stats ---
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      sendApiJson(res, 200, { success: true, data: getApiStats(), error: null });
      return;
    }

    // --- /api/tags ---
    if (url.pathname === '/api/tags') {
      if (req.method === 'GET') {
        const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
        sendApiJson(res, 200, { success: true, data: tags, error: null });
        return;
      }
      if (req.method === 'POST') {
        const body = await readRequestBody(req);
        const name = String(body.name || '').trim();
        const color = String(body.color || '#6366f1').trim();
        if (!name) {
          sendApiError(res, 400, 'Tag name is required');
          return;
        }
        const stmt = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)');
        const result = stmt.run(name, color);
        sendApiJson(res, 201, { success: true, data: { id: result.lastInsertRowid, name, color }, error: null });
        return;
      }
    }

    const tagIdMatch = url.pathname.match(/^\/api\/tags\/(\d+)$/);
    if (tagIdMatch) {
      const tagId = Number.parseInt(tagIdMatch[1], 10);
      if (req.method === 'PUT') {
        const body = await readRequestBody(req);
        const name = String(body.name || '').trim();
        const color = String(body.color || '#6366f1').trim();
        if (!name) {
          sendApiError(res, 400, 'Tag name is required');
          return;
        }
        const stmt = db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?');
        stmt.run(name, color, tagId);
        sendApiJson(res, 200, { success: true, data: { id: tagId, name, color }, error: null });
        return;
      }
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
        db.prepare('DELETE FROM game_tags WHERE tag_id = ?').run(tagId);
        sendApiJson(res, 200, { success: true, error: null });
        return;
      }
    }

    // --- GET /api/root-paths ---
    if (url.pathname === '/api/root-paths' && req.method === 'GET') {
      const rootPaths = db.prepare('SELECT * FROM root_paths ORDER BY created_at DESC').all();
      const items = rootPaths.map((item) => {
        const count = db.prepare(`
          SELECT COUNT(DISTINCT g.id) AS count
          FROM games g
          WHERE g.root_path_id = ?
            OR EXISTS (SELECT 1 FROM game_paths gp WHERE gp.game_id = g.id AND gp.root_path_id = ?)
        `).get(item.id, item.id)?.count || 0;

        const dirName = path.basename(String(item.path || '')) || item.path;
        return {
          id: item.id,
          name: dirName,
          path: exposeFullPath ? item.path : dirName,
          fullPath: item.path,
          gameCount: count
        };
      });

      const othersCount = db.prepare('SELECT COUNT(1) AS count FROM games WHERE is_manual = 1').get()?.count || 0;
      if (othersCount > 0) {
        items.push({
          id: 'others',
          name: '其它 / 手动添加',
          path: '其它 / 手动添加',
          gameCount: othersCount,
          isManual: true
        });
      }

      sendApiJson(res, 200, { success: true, data: items, error: null });
      return;
    }

    // --- GET /api/history ---
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const total = db.prepare('SELECT COUNT(1) AS c FROM run_history').get()?.c || 0;
      const items = db.prepare(`
        SELECT id, game_id, game_name, exe_path, method, needs_user_confirm, launched_at
        FROM run_history
        ORDER BY launched_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset).map((item) => ({
        id: item.id,
        gameId: item.game_id,
        gameName: item.game_name,
        exePath: exposeFullPath ? item.exe_path : path.basename(String(item.exe_path || '')),
        method: item.method,
        needsUserConfirm: !!item.needs_user_confirm,
        launchedAt: item.launched_at
      }));
      sendApiJson(res, 200, { success: true, data: { items, total, limit, offset }, error: null });
      return;
    }

    // --- POST /api/library/refresh ---
    // 移动端刷新入口：先让 PC 端重新扫描游戏库根目录（收录新增、清理已消失），
    // 移动端随后再拉取最新列表。大库扫描可能耗时数秒，故与只读接口分开。
    // 并发去重：扫描进行中时后来的请求复用同一个 Promise，不重复扫描。
    if (url.pathname === '/api/library/refresh' && req.method === 'POST') {
      if (!libraryRefreshInFlight) {
        libraryRefreshInFlight = runImportGames(null).finally(() => {
          libraryRefreshInFlight = null;
        });
      }
      let result = null;
      try {
        result = await libraryRefreshInFlight;
      } catch (err) {
        console.warn('[library-refresh] 扫描失败:', err?.message || err);
      }
      if (result?.success) {
        sendApiJson(res, 200, {
          success: true,
          data: { imported: result.imported || 0, deleted: result.deleted || 0 },
          error: null
        });
      } else {
        sendApiError(res, 500, result?.error || 'PC 端扫描游戏库失败');
      }
      return;
    }

    // --- GET /api/games ---
    if (url.pathname === '/api/games' && req.method === 'GET') {
      const result = queryApiGames({
        page: url.searchParams.get('page') || '1',
        pageSize: url.searchParams.get('pageSize') || '60',
        query: url.searchParams.get('query') || '',
        tag: url.searchParams.get('tag') || '',
        rootPathId: url.searchParams.get('rootPathId') || null,
        sort: url.searchParams.get('sort') || 'imported_at',
        order: url.searchParams.get('order') || 'desc',
        all: url.searchParams.get('all') || ''
      });
      sendApiJson(res, 200, {
        success: true,
        data: {
          items: result.games.map((game) => sanitizeApiGame(game, { exposeFullPath, baseUrl })),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize
        },
        error: null
      });
      return;
    }

    // --- /api/games/:id/alias ---
    const aliasMatch = url.pathname.match(/^\/api\/games\/(\d+)\/alias$/);
    if (aliasMatch && req.method === 'POST') {
      const gameId = Number.parseInt(aliasMatch[1], 10);
      const body = await readRequestBody(req);
      const normalized = String(body.alias ?? '').trim();
      const value = normalized ? normalized : null;
      db.prepare('UPDATE games SET alias = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, gameId);
      sendApiJson(res, 200, { success: true, data: { id: gameId, alias: value }, error: null });
      return;
    }

    // --- /api/games/:id/pinned ---
    const pinnedMatch = url.pathname.match(/^\/api\/games\/(\d+)\/pinned$/);
    if (pinnedMatch && req.method === 'POST') {
      const gameId = Number.parseInt(pinnedMatch[1], 10);
      const body = await readRequestBody(req);
      const value = body.pinned ? 1 : 0;
      db.prepare('UPDATE games SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, gameId);
      sendApiJson(res, 200, { success: true, data: { id: gameId, pinned: !!value }, error: null });
      return;
    }

    // --- /api/games/:id/tags (POST to add tag) ---
    const gameTagsMatch = url.pathname.match(/^\/api\/games\/(\d+)\/tags$/);
    if (gameTagsMatch && req.method === 'POST') {
      const gameId = Number.parseInt(gameTagsMatch[1], 10);
      const body = await readRequestBody(req);
      let tagId = Number.parseInt(String(body.tagId ?? ''), 10);
      if (!Number.isFinite(tagId) && body.name) {
        tagId = ensureTagIdByName(String(body.name).trim());
      }
      if (Number.isFinite(tagId) && tagId > 0) {
        db.prepare('INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?, ?)').run(gameId, tagId);
        const tags = db.prepare(`
          SELECT t.* FROM tags t
          JOIN game_tags gt ON t.id = gt.tag_id
          WHERE gt.game_id = ?
        `).all(gameId);
        sendApiJson(res, 200, { success: true, data: { id: gameId, tags }, error: null });
        return;
      }
      sendApiError(res, 400, 'Invalid tagId or name');
      return;
    }

    // --- /api/games/:id/tags/:tagId (DELETE to remove tag) ---
    const removeGameTagMatch = url.pathname.match(/^\/api\/games\/(\d+)\/tags\/(\d+)$/);
    if (removeGameTagMatch && req.method === 'DELETE') {
      const gameId = Number.parseInt(removeGameTagMatch[1], 10);
      const tagId = Number.parseInt(removeGameTagMatch[2], 10);
      db.prepare('DELETE FROM game_tags WHERE game_id = ? AND tag_id = ?').run(gameId, tagId);
      const tags = db.prepare(`
        SELECT t.* FROM tags t
        JOIN game_tags gt ON t.id = gt.tag_id
        WHERE gt.game_id = ?
      `).all(gameId);
      sendApiJson(res, 200, { success: true, data: { id: gameId, tags }, error: null });
      return;
    }

    // --- /api/games/:id/scrape-cover ---
    const scrapeMatch = url.pathname.match(/^\/api\/games\/(\d+)\/scrape-cover$/);
    if (scrapeMatch && req.method === 'POST') {
      const gameId = Number.parseInt(scrapeMatch[1], 10);
      const scrapeResult = await scrapeGameCoverCore(gameId);
      if (scrapeResult.success) {
        sendApiJson(res, 200, { success: true, data: scrapeResult, error: null });
      } else {
        sendApiJson(res, 200, { success: false, data: scrapeResult, error: scrapeResult.error || '刮削封面失败' });
      }
      return;
    }

    // --- /api/games/:id/cover (POST to upload/update custom cover) ---
    const uploadCoverMatch = url.pathname.match(/^\/api\/games\/(\d+)\/cover$/);
    if (uploadCoverMatch && req.method === 'POST') {
      const gameId = Number.parseInt(uploadCoverMatch[1], 10);
      const game = db.prepare('SELECT id, name, cover_path FROM games WHERE id = ?').get(gameId);
      if (!game) {
        sendApiError(res, 404, '游戏不存在');
        return;
      }
      const body = await readRequestBody(req);
      if (!body.image) {
        sendApiError(res, 400, '缺少图片数据');
        return;
      }
      let base64Data = String(body.image);
      let ext = '.jpg';
      const dataUrlMatch = base64Data.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (dataUrlMatch) {
        const format = dataUrlMatch[1].toLowerCase();
        ext = format === 'png' ? '.png' : format === 'webp' ? '.webp' : format === 'gif' ? '.gif' : '.jpg';
        base64Data = dataUrlMatch[2];
      } else if (body.ext) {
        ext = body.ext.startsWith('.') ? body.ext : `.${body.ext}`;
      }
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        if (!buffer || buffer.length === 0) {
          sendApiError(res, 400, '图片数据解析失败');
          return;
        }
        const coversDir = getCoversDir();
        if (!fs.existsSync(coversDir)) {
          fs.mkdirSync(coversDir, { recursive: true });
        }
        safeUnlinkCover(game.cover_path, gameId);
        const sanitizedName = game.name.replace(/[<>:"/\\|?*]/g, '_');
        const newFileName = `${gameId}_${sanitizedName}_custom_${Date.now()}${ext}`;
        const newCoverPath = path.join(coversDir, newFileName);
        fs.writeFileSync(newCoverPath, buffer);

        db.prepare('UPDATE games SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newCoverPath, gameId);
        sendApiJson(res, 200, {
          success: true,
          data: {
            id: gameId,
            coverPath: newCoverPath,
            coverUrl: `${baseUrl}/api/covers/${gameId}?v=${Date.now()}`
          },
          error: null
        });
      } catch (uploadErr) {
        sendApiError(res, 500, '保存封面失败: ' + (uploadErr?.message || String(uploadErr)));
      }
      return;
    }

    // --- /api/games/:id/launch ---
    const launchMatch = url.pathname.match(/^\/api\/games\/(\d+)\/launch$/);
    if (launchMatch && req.method === 'POST') {
      if (!settings.allowRemoteLaunch) {
        sendApiError(res, 403, '远程启动功能已在 PC 端设置中禁用');
        return;
      }
      const gameId = Number.parseInt(launchMatch[1], 10);
      const body = await readRequestBody(req);
      const launchResult = await launchGameInternal(gameId, body.exePath);
      if (launchResult.success) {
        sendApiJson(res, 200, { success: true, data: launchResult, error: null });
      } else {
        sendApiError(res, 500, launchResult.error || '启动游戏失败');
      }
      return;
    }

    // --- /api/games/:id/files ---
    const filesMatch = url.pathname.match(/^\/api\/games\/(\d+)\/files$/);
    if (filesMatch && req.method === 'GET') {
      const gameId = Number.parseInt(filesMatch[1], 10);
      const filesResult = await getGameFilesInternal(gameId);
      if (filesResult.success) {
        sendApiJson(res, 200, { success: true, data: filesResult, error: null });
      } else {
        sendApiError(res, 404, filesResult.error || '获取游戏文件列表失败');
      }
      return;
    }

    // --- /api/games/:id/download-ticket (申请单文件短时下载票据) ---
    const ticketCreateMatch = url.pathname.match(/^\/api\/games\/(\d+)\/download-ticket$/);
    if (ticketCreateMatch && req.method === 'POST') {
      const gameId = Number.parseInt(ticketCreateMatch[1], 10);
      const game = db.prepare('SELECT id, name, path FROM games WHERE id = ?').get(gameId);
      if (!game || !game.path || !fs.existsSync(game.path)) {
        sendApiError(res, 404, '游戏不存在或未找到文件路径');
        return;
      }
      const body = await readRequestBody(req);
      const requestedFile = String(body.file || url.searchParams.get('file') || '').trim();
      const rootPath = path.resolve(game.path);
      let rootStat;
      try {
        rootStat = fs.statSync(rootPath);
      } catch (err) {
        sendApiError(res, 500, '读取游戏路径信息失败: ' + (err?.message || String(err)));
        return;
      }

      let targetFilePath = rootPath;
      let filename = path.basename(rootPath);

      if (rootStat.isDirectory()) {
        if (!requestedFile || requestedFile === '.' || requestedFile === '/') {
          sendApiError(res, 400, '暂不支持直接为散装文件夹申请单文件票据，请选择具体文件或先打包');
          return;
        }
        targetFilePath = path.resolve(rootPath, requestedFile);
        const rel = path.relative(rootPath, targetFilePath);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(targetFilePath)) {
          sendApiError(res, 403, '文件不存在或超出安全访问范围');
          return;
        }
        filename = path.basename(targetFilePath);
      }

      const targetStat = fs.statSync(targetFilePath);
      if (targetStat.isDirectory()) {
        sendApiError(res, 400, '所选目标为文件夹，请选择单文件申请下载');
        return;
      }

      const ticketId = crypto.randomBytes(18).toString('hex');
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 小时有效期
      downloadTickets.set(ticketId, {
        gameId,
        filePath: targetFilePath,
        filename,
        size: targetStat.size,
        expiresAt
      });

      sendApiJson(res, 200, {
        success: true,
        data: {
          ticket: ticketId,
          filename,
          size: targetStat.size,
          expiresAt,
          downloadUrl: `${baseUrl}/api/downloads/${ticketId}`
        },
        error: null
      });
      return;
    }

    // --- /api/games/:id/prepare-archive (触发后台打包准备) ---
    const prepareArchiveMatch = url.pathname.match(/^\/api\/games\/(\d+)\/prepare-archive$/);
    if (prepareArchiveMatch && req.method === 'POST') {
      const gameId = Number.parseInt(prepareArchiveMatch[1], 10);
      const game = db.prepare('SELECT id, name, alias, path FROM games WHERE id = ?').get(gameId);
      if (!game || !game.path || !fs.existsSync(game.path)) {
        sendApiError(res, 404, '游戏不存在或未找到文件路径');
        return;
      }
      const rootPath = path.resolve(game.path);
      let rootStat;
      try { rootStat = fs.statSync(rootPath); } catch (err) {
        sendApiError(res, 500, '读取游戏路径失败: ' + (err?.message || String(err)));
        return;
      }

      const body = await readRequestBody(req);
      const requestedFile = String(body.file || url.searchParams.get('file') || '').trim();

      // 如果游戏本身是单文件（.zip/.7z/.rar 等）
      if (!rootStat.isDirectory()) {
        const filename = path.basename(rootPath);
        sendApiJson(res, 200, {
          success: true,
          status: 'ready',
          isDirect: true,
          filename,
          size: rootStat.size,
          downloadUrl: `${baseUrl}/api/games/${gameId}/download`
        });
        return;
      }

      // 如果是单文件子文件
      let targetPath = rootPath;
      let targetName = game.alias || game.name || 'game';
      if (requestedFile && requestedFile !== '.' && requestedFile !== '/') {
        targetPath = path.resolve(rootPath, requestedFile);
        const rel = path.relative(rootPath, targetPath);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(targetPath)) {
          sendApiError(res, 403, '文件不存在或超出安全访问范围');
          return;
        }
        targetName = path.basename(targetPath);
        const st = fs.statSync(targetPath);
        if (!st.isDirectory()) {
          sendApiJson(res, 200, {
            success: true,
            status: 'ready',
            isDirect: true,
            filename: targetName,
            size: st.size,
            downloadUrl: `${baseUrl}/api/games/${gameId}/download?file=${encodeURIComponent(requestedFile)}`
          });
          return;
        }
      }

      // 目标是散装文件夹：异步后台压缩打包
      const sanitizedName = targetName.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim() || 'game';
      const jobKey = `${gameId}:${requestedFile}`;
      const existingJob = packagingJobs.get(jobKey);

      if (existingJob) {
        if (existingJob.status === 'packaging') {
          sendApiJson(res, 200, {
            success: true,
            status: 'packaging',
            message: 'PC 端预压缩中...',
            filename: `${sanitizedName}.zip`,
            elapsedMs: Date.now() - existingJob.startedAt
          });
          return;
        }
        if (existingJob.status === 'ready' && fs.existsSync(existingJob.zipPath)) {
          sendApiJson(res, 200, {
            success: true,
            status: 'ready',
            filename: existingJob.filename,
            size: existingJob.zipSize,
            ticket: existingJob.ticket,
            downloadUrl: existingJob.downloadUrl
          });
          return;
        }
        packagingJobs.delete(jobKey);
      }

      const cacheDir = getArchiveCacheDir();
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const zipFileName = `mygal_archive_${gameId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.zip`;
      const zipPath = path.join(cacheDir, zipFileName);

      const job = {
        key: jobKey,
        gameId,
        requestedFile,
        status: 'packaging',
        startedAt: Date.now(),
        zipPath,
        filename: `${sanitizedName}.zip`,
        zipSize: 0,
        error: null,
        ticket: null,
        downloadUrl: ''
      };
      packagingJobs.set(jobKey, job);

      (async () => {
        try {
          await createArchiveWithTar(targetPath, zipPath);
          const st = fs.statSync(zipPath);
          job.zipSize = st.size;

          const ticketId = crypto.randomBytes(18).toString('hex');
          downloadTickets.set(ticketId, {
            gameId,
            filePath: zipPath,
            filename: `${sanitizedName}.zip`,
            size: st.size,
            isTempArchive: true,
            expiresAt: Date.now() + 2 * 60 * 60 * 1000
          });

          job.ticket = ticketId;
          job.downloadUrl = `${baseUrl}/api/downloads/${ticketId}`;
          job.status = 'ready';
        } catch (err) {
          job.status = 'error';
          job.error = err?.message || String(err);
          safeUnlinkArchive(zipPath);
        }
      })();

      sendApiJson(res, 200, {
        success: true,
        status: 'packaging',
        message: 'PC 端预压缩中，请稍候...',
        filename: `${sanitizedName}.zip`,
        elapsedMs: 0
      });
      return;
    }

    // --- /api/games/:id/archive-status (查询后台打包状态) ---
    const archiveStatusMatch = url.pathname.match(/^\/api\/games\/(\d+)\/archive-status$/);
    if (archiveStatusMatch && req.method === 'GET') {
      const gameId = Number.parseInt(archiveStatusMatch[1], 10);
      const requestedFile = String(url.searchParams.get('file') || '').trim();
      const jobKey = `${gameId}:${requestedFile}`;
      const job = packagingJobs.get(jobKey);

      if (!job) {
        sendApiJson(res, 200, { success: true, status: 'idle' });
        return;
      }

      if (job.status === 'packaging') {
        sendApiJson(res, 200, {
          success: true,
          status: 'packaging',
          message: 'PC 端预压缩中...',
          filename: job.filename,
          elapsedMs: Date.now() - job.startedAt
        });
        return;
      }

      if (job.status === 'ready') {
        if (!fs.existsSync(job.zipPath)) {
          packagingJobs.delete(jobKey);
          sendApiJson(res, 200, { success: true, status: 'idle' });
          return;
        }
        sendApiJson(res, 200, {
          success: true,
          status: 'ready',
          filename: job.filename,
          size: job.zipSize,
          ticket: job.ticket,
          downloadUrl: job.downloadUrl
        });
        return;
      }

      sendApiJson(res, 200, {
        success: false,
        status: 'error',
        error: job.error || '打包失败'
      });
      return;
    }

    // --- /api/games/:id/download (支持 Range 断点续传与 HEAD 请求) ---
    const downloadMatch = url.pathname.match(/^\/api\/games\/(\d+)\/download$/);
    if (downloadMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const gameId = Number.parseInt(downloadMatch[1], 10);
      const game = db.prepare('SELECT id, name, path FROM games WHERE id = ?').get(gameId);
      if (!game || !game.path || !fs.existsSync(game.path)) {
        sendApiError(res, 404, '游戏不存在或未找到文件路径');
        return;
      }
      const rootPath = path.resolve(game.path);
      let rootStat;
      try {
        rootStat = fs.statSync(rootPath);
      } catch (err) {
        sendApiError(res, 500, '读取游戏路径信息失败: ' + (err?.message || String(err)));
        return;
      }

      const requestedFile = String(url.searchParams.get('file') || '').trim();

      // 情况 1：游戏路径本身就是单文件（压缩包 .zip/.7z/.rar/.iso 或可执行程序等）
      if (!rootStat.isDirectory()) {
        const filename = path.basename(rootPath);
        serveFileWithRange(req, res, rootPath, filename);
        return;
      }

      // 情况 2：游戏路径为文件夹
      // 2.1 用户请求整个游戏（file 为空、'.'、'/' 或未传） -> 异步打包整个游戏文件夹！
      if (!requestedFile || requestedFile === '.' || requestedFile === '/' || requestedFile === '*') {
        const folderName = (game.alias || game.name || path.basename(rootPath) || 'game').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
        const cacheDir = getArchiveCacheDir();
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        const tempZip = path.join(cacheDir, `mygal_archive_${gameId}_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`);
        // 1 小时后自动安全销毁临时压缩包，避免下载中被过早清除，亦不会永久遗留
        setTimeout(() => safeUnlinkArchive(tempZip), 60 * 60 * 1000).unref();
        try {
          // 使用原生 bsdtar，速度提升 10 倍以上，彻底避免阻塞 Electron 主线程与超时
          await createArchiveWithTar(rootPath, tempZip);
          if (fs.existsSync(tempZip)) {
            serveFileWithRange(req, res, tempZip, `${folderName}.zip`, 'application/zip');
            return;
          } else {
            throw new Error('生成的临时压缩文件不存在');
          }
        } catch (zipErr) {
          cleanup();
          sendApiError(res, 500, '打包下载游戏文件夹失败: ' + (zipErr?.message || String(zipErr)));
          return;
        }
      }

      // 2.2 用户请求文件夹内的某个具体子文件或子目录
      const targetFilePath = path.resolve(rootPath, requestedFile);
      const rel = path.relative(rootPath, targetFilePath);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(targetFilePath)) {
        sendApiError(res, 403, '文件不存在或超出安全访问范围');
        return;
      }
      const st = fs.statSync(targetFilePath);
      if (st.isDirectory()) {
        const folderName = (path.basename(targetFilePath) || game.name || 'archive').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
        const cacheDir = getArchiveCacheDir();
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        const tempZip = path.join(cacheDir, `mygal_archive_${gameId}_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`);
        const cleanup = () => {
          safeUnlinkArchive(tempZip);
        };
        try {
          await createArchiveWithTar(targetFilePath, tempZip);
          if (fs.existsSync(tempZip)) {
            serveFileWithRange(req, res, tempZip, `${folderName}.zip`, 'application/zip');
            return;
          } else {
            throw new Error('生成的临时压缩文件不存在');
          }
        } catch (zipErr) {
          cleanup();
          sendApiError(res, 500, '打包下载子文件夹失败: ' + (zipErr?.message || String(zipErr)));
          return;
        }
      }

      const filename = path.basename(targetFilePath);
      serveFileWithRange(req, res, targetFilePath, filename);
      return;
    }

    // --- /api/games/:id (GET) ---
    const gameMatch = url.pathname.match(/^\/api\/games\/(\d+)$/);
    if (gameMatch && req.method === 'GET') {
      const gameId = Number.parseInt(gameMatch[1], 10);
      const row = db.prepare(`
        SELECT g.*, GROUP_CONCAT(t.name) as tags
        FROM games g
        LEFT JOIN game_tags gt ON g.id = gt.game_id
        LEFT JOIN tags t ON gt.tag_id = t.id
        WHERE g.id = ?
        GROUP BY g.id
      `).get(gameId);
      if (!row) {
        sendApiError(res, 404, 'Game not found');
        return;
      }
      const game = processGames([row])[0];
      const tagsList = db.prepare(`
        SELECT t.* FROM tags t
        JOIN game_tags gt ON t.id = gt.tag_id
        WHERE gt.game_id = ?
      `).all(gameId);
      const sanitized = sanitizeApiGame(game, { exposeFullPath, baseUrl });
      sanitized.detailedTags = tagsList;
      sendApiJson(res, 200, { success: true, data: sanitized, error: null });
      return;
    }

    // --- /api/covers/:gameId ---
    const coverMatch = url.pathname.match(/^\/api\/covers\/(\d+)$/);
    if (coverMatch && req.method === 'GET') {
      const gameId = Number.parseInt(coverMatch[1], 10);
      const game = db.prepare('SELECT id, name, alias, path, cover_path FROM games WHERE id = ?').get(gameId);
      const resolvedCoverPath = resolveCoverFilePath(gameId, game?.cover_path, game?.path);
      if (!resolvedCoverPath || !fs.existsSync(resolvedCoverPath)) {
        sendApiError(res, 404, 'Cover not found');
        return;
      }

      const wantThumb = url.searchParams.has('thumb') || url.searchParams.has('w');
      if (wantThumb) {
        try {
          const stream = sharp(resolvedCoverPath)
            .resize(360, 540, { fit: 'cover', withoutEnlargement: true })
            .webp({ quality: 75 });
          res.writeHead(200, {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'X-Content-Type-Options': 'nosniff'
          });
          stream.on('error', () => {
            if (!res.headersSent) sendApiError(res, 500, 'Failed to process cover');
            else res.end();
          }).pipe(res);
          return;
        } catch {}
      }

      const ext = path.extname(resolvedCoverPath).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(resolvedCoverPath).on('error', () => {
        if (!res.headersSent) sendApiError(res, 500, 'Failed to read cover');
        else res.end();
      }).pipe(res);
      return;
    }

    sendApiError(res, 404, 'Not found');
  } catch (error) {
    sendApiError(res, 500, error?.message || String(error));
  }
};

// 关闭 HTTP 服务。
// 坑：server.close() 的回调要等**所有已建立的连接**都关闭才触发，而它本身不会去关它们。
// 移动端 App 会保持 keep-alive 长连接，空闲连接最长要挂到 keepAliveTimeout(120s) 才被回收，
// 于是 await stopApiServer() 长时间不 resolve → 设置页「保存并重启」按钮卡在「保存中…」。
// 所以这里必须：① 关掉监听后立刻断开空闲连接；② 给进行中的请求一个宽限窗口后强制断开；
// ③ 无论如何都兜底 resolve，绝不允许永久挂起。
const API_STOP_GRACE_MS = 2000; // 进行中请求（上传/刷新库）的自然收尾宽限

const stopApiServer = () => new Promise((resolve) => {
  const server = apiServer;
  if (!server) {
    apiServerState = { running: false, error: '', host: '', port: 0, startedAt: 0 };
    resolve();
    return;
  }
  apiServer = null;

  let settled = false;
  let graceTimer = null;
  let bailTimer = null;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (graceTimer) clearTimeout(graceTimer);
    if (bailTimer) clearTimeout(bailTimer);
    apiServerState = { running: false, error: '', host: '', port: 0, startedAt: 0 };
    resolve();
  };

  server.close(finish);
  try { server.closeIdleConnections?.(); } catch {}

  graceTimer = setTimeout(() => {
    try { server.closeAllConnections?.(); } catch {}
    // 再给 close 回调一点触发时间；仍没来就直接放行
    bailTimer = setTimeout(finish, 500);
  }, API_STOP_GRACE_MS);
});

const startApiServer = async () => {
  try {
    sanitizeMismatchedCovers();
  } catch {}

  const settings = getApiSettingsFromDb();

  // 上传服务初始化：状态文件统一放用户数据目录
  // （票据表是全局的，不属于任何游戏盘；这里只登记路径，**不创建目录**——真正申请票据时才建）
  uploader.setStateFile(path.join(app.getPath('userData'), 'uploads', UPLOAD_STATE_FILE));
  uploader.setCallbacks({
    onComplete: ({ fileName, filePath, fileSize, targetDir }) => {
      // 系统通知 + 点击打开所在目录
      try {
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
          const sizeGb = (fileSize / (1024 * 1024 * 1024)).toFixed(2);
          const n = new Notification({
            title: '游戏上传完成',
            body: `${fileName}（${sizeGb} GB）已上传完成，点击打开所在目录`
          });
          n.on('click', () => shell.showItemInFolder(filePath));
          n.show();
        }
      } catch {}
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-completed', { fileName, filePath, targetDir, fileSize });
      }
    },
    onAudit: (event, detail) => {
      console.log(`[uploader-audit] ${event}: ${detail}`);
    }
  });
  try {
    uploader.loadPersistedState();
    // 启动即清一轮：过期票据与僵死票据（用户删了 .part 的）立刻释放并发额度，
    // 不能等 5 分钟循环的首次执行——否则重启后头 5 分钟会一直误报「上传任务已满」。
    // cleanupExpired 内部已包含 sweepOrphanParts（24h 无主 .part 扫描）。
    uploader.cleanupExpired();
  } catch (err) {
    console.warn('[uploader] 启动恢复失败:', err?.message || err);
  }

  if (!settings.enabled) {
    await stopApiServer();
    return { success: true, status: getApiServerStatus() };
  }

  await stopApiServer();
  return new Promise((resolve) => {
    const server = http.createServer(handleApiRequest);
    server.headersTimeout = 120000; // 120 秒网络请求头超时
    server.requestTimeout = 180000; // 180 秒整体请求超时
    server.keepAliveTimeout = 120000;
    server.on('error', (error) => {
      apiServer = null;
      apiServerState = {
        running: false,
        error: error?.message || String(error),
        host: settings.host,
        port: settings.port,
        startedAt: 0
      };
      resolve({ success: false, error: apiServerState.error, status: getApiServerStatus() });
    });
    server.listen(settings.port, settings.host, () => {
      apiServer = server;
      apiServerState = {
        running: true,
        error: '',
        host: settings.host,
        port: settings.port,
        startedAt: Date.now()
      };
      resolve({ success: true, status: getApiServerStatus() });
    });
  });
};

const getApiServerStatus = () => {
  const settings = getApiSettingsFromDb();
  const localUrl = `http://127.0.0.1:${settings.port}`;
  const lanUrls = settings.host === '0.0.0.0'
    ? getLanAddresses().map((address) => `http://${address}:${settings.port}`)
    : [];
  return {
    ...apiServerState,
    enabled: settings.enabled,
    configuredHost: settings.host,
    configuredPort: settings.port,
    localUrl,
    lanUrls
  };
};

ipcMain.handle('get-api-settings', async () => {
  const settings = getApiSettingsFromDb();
  return {
    success: true,
    settings: {
      ...settings,
      lanUrls: getApiServerStatus().lanUrls,
      localUrl: `http://127.0.0.1:${settings.port}`
    },
    status: getApiServerStatus()
  };
});

ipcMain.handle('save-api-settings', async (event, nextSettings = {}) => {
  const current = getApiSettingsFromDb();
  const enabled = typeof nextSettings.enabled === 'boolean' ? nextSettings.enabled : current.enabled;
  const host = nextSettings.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
  const parsedPort = Number.parseInt(String(nextSettings.port ?? current.port), 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : current.port;
  const exposeFullPath = typeof nextSettings.exposeFullPath === 'boolean' ? nextSettings.exposeFullPath : current.exposeFullPath;
  const allowRemoteLaunch = typeof nextSettings.allowRemoteLaunch === 'boolean' ? nextSettings.allowRemoteLaunch : current.allowRemoteLaunch;
  const allowUpload = typeof nextSettings.allowUpload === 'boolean' ? nextSettings.allowUpload : current.allowUpload;
  // 上传根目录：只在**用户真的改过**时才落库
  // （历史 bug：设置页回传整个 settings 对象，把后端算出来的默认目录当成"用户显式配置"写死了）
  const storedUploadRoot = readApiSetting(apiSettingKeys.uploadTargetDir, '');
  const incomingUploadRoot = typeof nextSettings.uploadTargetDir === 'string' ? nextSettings.uploadTargetDir.trim() : '';
  const uploadRootChanged = !!incomingUploadRoot && incomingUploadRoot !== storedUploadRoot;
  const parsedMaxSize = Number.parseInt(String(nextSettings.uploadMaxSize ?? ''), 10);
  const uploadMaxSize = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : current.uploadMaxSize;

  writeApiSetting(apiSettingKeys.enabled, enabled ? 'true' : 'false');
  writeApiSetting(apiSettingKeys.host, host);
  writeApiSetting(apiSettingKeys.port, String(port));
  writeApiSetting(apiSettingKeys.exposeFullPath, exposeFullPath ? 'true' : 'false');
  writeApiSetting(apiSettingKeys.allowRemoteLaunch, allowRemoteLaunch ? 'true' : 'false');
  writeApiSetting(apiSettingKeys.allowUpload, allowUpload ? 'true' : 'false');
  if (uploadRootChanged) writeApiSetting(apiSettingKeys.uploadTargetDir, incomingUploadRoot);
  if (Number.isFinite(parsedMaxSize) && parsedMaxSize > 0) writeApiSetting(apiSettingKeys.uploadMaxSize, String(uploadMaxSize));
  if (!current.token) writeApiSetting(apiSettingKeys.token, createApiToken());

  // 只有「监听参数」变化才需要重启 HTTP 服务。
  // allowUpload / exposeFullPath / allowRemoteLaunch / 上传目录 / 大小上限 都是**每个请求实时从 DB 读**的
  // （见 handleApiRequest 开头的 getApiSettingsFromDb()），保存后下一次请求立即生效，重启纯属多余。
  // 少重启一次就少一次「关服务 → 断连接 → 重新监听」的窗口：既不会因为移动端连着而让设置页卡住，
  // 也不会把正在上传的连接掐断。仅当服务本该在跑却没跑起来时，借保存的机会把它拉起来。
  const needsRestart = enabled !== current.enabled
    || host !== current.host
    || port !== current.port
    || (!apiServerState.running && enabled);

  if (!needsRestart) {
    return {
      success: true,
      error: '',
      restarted: false,
      settings: getApiSettingsFromDb(),
      status: getApiServerStatus()
    };
  }

  const result = await startApiServer();
  return {
    success: result.success,
    error: result.error || '',
    restarted: true,
    settings: getApiSettingsFromDb(),
    status: getApiServerStatus()
  };
});

ipcMain.handle('restart-api-server', async () => {
  const result = await startApiServer();
  return {
    success: result.success,
    error: result.error || '',
    settings: getApiSettingsFromDb(),
    status: getApiServerStatus()
  };
});

ipcMain.handle('get-api-server-status', async () => {
  return getApiServerStatus();
});

ipcMain.handle('regenerate-api-token', async () => {
  const newToken = createApiToken();
  writeApiSetting(apiSettingKeys.token, newToken);
  return {
    success: true,
    token: newToken,
    settings: getApiSettingsFromDb(),
    status: getApiServerStatus()
  };
});

app.whenReady().then(() => {
  cleanArchiveCache(60 * 60 * 1000); // 启动时清理 1 小时以前的遗留临时打包文件
  initDatabase();
  startApiServer();
  createWindow();
  createTray();
  
  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  cleanArchiveCache(0); // 退出时安全清理全部临时打包缓存
  stopApiServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (tray && !isQuitting) return;
    app.quit();
  }
});

