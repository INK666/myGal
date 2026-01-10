const { app, BrowserWindow, dialog, ipcMain, shell, protocol, screen, desktopCapturer, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const isDev = process.argv.includes('--dev') || !app.isPackaged;

if (isDev) {
  app.setPath('userData', path.join(__dirname, 'electron-data'));
  app.setPath('cache', path.join(__dirname, 'electron-data', 'Cache'));
}

let mainWindow;
let db;

const getCoversDir = () => path.join(app.getPath('userData'), 'covers');
const getBackgroundsDir = () => path.join(app.getPath('userData'), 'backgrounds');

const isPathUnderDirectory = (filePath, dirPath) => {
  try {
    const normalizedFile = path.normalize(filePath);
    const normalizedDir = path.normalize(dirPath);
    const relative = path.relative(normalizedDir, normalizedFile);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
};

const safeUnlinkCover = (coverPath) => {
  if (!coverPath) return;
  if (typeof coverPath !== 'string') return;
  if (!path.isAbsolute(coverPath)) return;

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

const normalizeGameTitle = (rawName) => {
  let name = String(rawName || '').trim();
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
    const dotIndex =
      dotAscii === -1 ? dotFull : dotFull === -1 ? dotAscii : Math.min(dotAscii, dotFull);
    if (dotIndex > 0 && dotIndex < name.length - 1) {
      const tail = name.slice(dotIndex + 1);
      if (!/\s/.test(tail)) {
        name = name.slice(0, dotIndex).trim();
      }
    }

    if (name === before) break;
  }

  name = name
    .replace(/[\[\(（【].*?[\]\)）】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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
  const match = String(title || '').match(/((?:RJ|VJ|BJ|RE)\d{6,8})/i);
  const workno = match?.[1] ? match[1].toUpperCase() : '';
  if (!workno) return null;

  const apiUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${encodeURIComponent(workno)}&locale=zh_cn`;
  const res = await fetchWithTimeout(apiUrl, {
    headers: {
      'User-Agent': 'GameManage/1.0',
      Accept: 'application/json'
    }
  }, 15000);
  if (!res.ok) return null;
  const json = await res.json();

  const pickObject = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    if (typeof value === 'object') return value;
    return null;
  };

  const candidate =
    pickObject(json) ||
    pickObject(json?.[workno]) ||
    pickObject(json?.product) ||
    pickObject(json?.work) ||
    null;

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
    if (typeof direct === 'string' && direct.startsWith('http')) return direct;
    if (direct && typeof direct === 'object') {
      const nested = direct?.url || direct?.large || direct?.common || direct?.medium || direct?.small || null;
      if (typeof nested === 'string' && nested.startsWith('http')) return nested;
    }
    return null;
  };

  const urlOut = pickUrl(candidate);
  if (!urlOut) return null;
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
      color: '#1a1a2e',
      symbolColor: '#ffffff'
    },
    backgroundColor: '#1a1a2e'
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // 注释掉自动打开开发者工具的代码
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  `);
  
  // 数据迁移：将旧的单个根目录设置迁移到root_paths表
  try {
    const columns = db.prepare('PRAGMA table_info(games)').all();
    const hasRootPathId = columns.some(col => col.name === 'root_path_id');
    const hasIsManual = columns.some(col => col.name === 'is_manual');
    const hasAlias = columns.some(col => col.name === 'alias');
    const hasPinned = columns.some(col => col.name === 'pinned');
    
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
    db.exec('UPDATE games SET is_manual = 0 WHERE is_manual IS NULL;');
    db.exec('UPDATE games SET pinned = 0 WHERE pinned IS NULL;');
    
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
}

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
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

        const deleteRoot = db.prepare('DELETE FROM root_paths WHERE id = ?');
        deleteRoot.run(rootPathId);

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
      INSERT INTO games (name, path, root_path_id, is_manual)
      VALUES (?, ?, NULL, 1)
    `);
    
    const insertGamePathStmt = db.prepare(`
      INSERT OR IGNORE INTO game_paths (game_id, path, root_path_id)
      VALUES (?, ?, NULL)
    `);
    
    const existingByName = findManualGameByNameStmt.get(name);
    if (existingByName) {
      insertGamePathStmt.run(existingByName.id, gamePath);
      return { success: true, id: existingByName.id };
    }
    
    const result = insertGameStmt.run(name, gamePath);
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

ipcMain.handle('import-games', async (event, rootPathId = null) => {
  let rootPaths = [];
  
  if (rootPathId) {
    // 从特定根目录导入
    const stmt = db.prepare('SELECT id, path FROM root_paths WHERE id = ?');
    const rootPath = stmt.get(rootPathId);
    if (!rootPath || !fs.existsSync(rootPath.path)) {
      return { success: false, error: '目录不存在' };
    }
    rootPaths = [rootPath];
  } else {
    // 从所有根目录导入
    const stmt = db.prepare('SELECT id, path FROM root_paths');
    rootPaths = stmt.all().filter(rp => fs.existsSync(rp.path));
    
    if (rootPaths.length === 0) {
      return { success: false, error: '没有有效的根目录' };
    }
  }
  
  const insertGameStmt = db.prepare(`
    INSERT INTO games (name, path, root_path_id, is_manual)
    VALUES (?, ?, ?, 0)
  `);
  
  const insertGamePathStmt = db.prepare(`
    INSERT OR IGNORE INTO game_paths (game_id, path, root_path_id)
    VALUES (?, ?, ?)
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
  
  let totalImported = 0;
  
  // 从每个根目录导入游戏
  for (const rootPath of rootPaths) {
    const entries = fs.readdirSync(rootPath.path, { withFileTypes: true });
    
    const gameItems = entries
      .filter(entry => {
        if (entry.isDirectory()) {
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
    
    gameItems.forEach(name => {
      const gamePath = path.join(rootPath.path, name);
      if (isIgnoredPathStmt.get(gamePath)) {
        return;
      }
      const existing = findGameByPathStmt.get(gamePath, gamePath);
      
      if (existing) {
        updateGameNameStmt.run(name, existing.id);
        insertGamePathStmt.run(existing.id, gamePath, rootPath.id);
      } else {
        const existingByName = findScannedGameByNameStmt.get(name);
        if (existingByName) {
          insertGamePathStmt.run(existingByName.id, gamePath, rootPath.id);
        } else {
          const result = insertGameStmt.run(name, gamePath, rootPath.id);
          insertGamePathStmt.run(result.lastInsertRowid, gamePath, rootPath.id);
        }
        totalImported++;
      }
    });
  }
  
  const allGames = db.prepare('SELECT id, path, root_path_id FROM games').all();
  let totalDeleted = 0;

  const validRootPaths = db.prepare('SELECT id, path FROM root_paths').all()
    .filter(rp => fs.existsSync(rp.path));

  const hasValidRoot = (rootPathId) => {
    if (rootPathId === null || rootPathId === undefined) {
      return true;
    }
    return validRootPaths.some(rp => rp.id === rootPathId);
  };

  allGames.forEach(game => {
    const paths = db.prepare('SELECT id, path, root_path_id, created_at FROM game_paths WHERE game_id = ?').all(game.id);
    const pathList = paths.length > 0 ? paths : [{ id: null, path: game.path, root_path_id: game.root_path_id, created_at: null }];

    const validPaths = pathList.filter(p => {
      if (!p.path || !fs.existsSync(p.path)) {
        return false;
      }
      return hasValidRoot(p.root_path_id);
    });

    if (validPaths.length === 0) {
      const row = db.prepare('SELECT cover_path FROM games WHERE id = ?').get(game.id);
      safeUnlinkCover(row?.cover_path);
      db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
      totalDeleted++;
      return;
    }

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
    db.prepare('UPDATE games SET path = ?, root_path_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(primary.path, primary.root_path_id, game.id);
  });

  return { success: true, imported: totalImported, deleted: totalDeleted };
});

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
        DELETE FROM sqlite_sequence WHERE name IN ('games','tags','root_paths','game_paths');
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
    
    return {
      ...game,
      cover_path: game.cover_path ? `file:///${game.cover_path.replace(/\\/g, '/')}?t=${Date.now()}` : null,
      tags: game.tags ? game.tags.split(',') : [],
      paths: Array.from(pathSet),
      root_path_ids: Array.from(rootPathIdSet).filter(Number.isFinite).sort((a, b) => a - b)
    };
  });
};

ipcMain.handle('get-games', async (event, { page = 1, pageSize = 20 } = {}) => {
  const offset = (page - 1) * pageSize;
  
  const total = db.prepare('SELECT COUNT(*) as count FROM games').get().count;
  
  const games = db.prepare(`
    SELECT g.*, GROUP_CONCAT(t.name) as tags
    FROM games g
    LEFT JOIN game_tags gt ON g.id = gt.game_id
    LEFT JOIN tags t ON gt.tag_id = t.id
    GROUP BY g.id
    ORDER BY g.pinned DESC, g.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset);
  
  return {
    games: processGames(games),
    total
  };
});

ipcMain.handle('search-games', async (event, query, { page = 1, pageSize = 20 } = {}) => {
  if (!query || !query.trim()) {
    return { games: [], total: 0 };
  }
  
  const offset = (page - 1) * pageSize;
  const searchPattern = `%${query}%`;
  
  const total = db.prepare(`
    SELECT COUNT(DISTINCT g.id) as count
    FROM games g
    LEFT JOIN game_tags gt ON g.id = gt.game_id
    LEFT JOIN tags t ON gt.tag_id = t.id
    WHERE g.name LIKE ? OR g.path LIKE ? OR t.name LIKE ?
  `).get(searchPattern, searchPattern, searchPattern).count;
  
  const games = db.prepare(`
    SELECT g.*, GROUP_CONCAT(t.name) as tags
    FROM games g
    LEFT JOIN game_tags gt ON g.id = gt.game_id
    LEFT JOIN tags t ON gt.tag_id = t.id
    WHERE g.name LIKE ? OR g.path LIKE ? OR t.name LIKE ?
    GROUP BY g.id
    ORDER BY g.pinned DESC, g.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(searchPattern, searchPattern, searchPattern, pageSize, offset);
  
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
  
  safeUnlinkCover(game.cover_path);
  
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

ipcMain.handle('scrape-game-cover', async (event, gameId) => {
  const game = db.prepare('SELECT id, name, alias, path, cover_path FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: '游戏不存在' };
  }

  const rawPathName = game.path ? path.basename(game.path) : '';
  const candidates = [
    normalizeGameTitle(game.name),
    normalizeGameTitle(game.alias),
    normalizeGameTitle(rawPathName),
    String(game.name || '').trim(),
    String(game.alias || '').trim(),
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

    for (const query of candidates) {
      tried.length = 0;
      for (const p of providerFns) {
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

    safeUnlinkCover(game.cover_path);

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
});

ipcMain.handle('delete-game', async (event, gameId) => {
  try {
    const game = db.prepare('SELECT id, cover_path, path FROM games WHERE id = ?').get(gameId);
    if (!game) return false;

    const extraPaths = db.prepare('SELECT path FROM game_paths WHERE game_id = ?').all(gameId);
    const pathSet = new Set([
      game.path,
      ...extraPaths.map((r) => r?.path).filter(Boolean)
    ]);

    const insertIgnoredPathStmt = db.prepare(
      'INSERT OR IGNORE INTO ignored_game_paths (path) VALUES (?)'
    );

    const tx = db.transaction(() => {
      for (const p of pathSet) {
        if (p) insertIgnoredPathStmt.run(p);
      }
      db.prepare('DELETE FROM game_tags WHERE game_id = ?').run(gameId);
      db.prepare('DELETE FROM game_paths WHERE game_id = ?').run(gameId);
      db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
    });
    tx();

    safeUnlinkCover(game.cover_path);
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

ipcMain.handle('get-games-by-tag', async (event, tagName, { page = 1, pageSize = 20 } = {}) => {
  const offset = (page - 1) * pageSize;
  
  const total = db.prepare(`
    SELECT COUNT(DISTINCT g.id) as count
    FROM games g
    JOIN game_tags gt ON g.id = gt.game_id
    JOIN tags t ON gt.tag_id = t.id
    WHERE t.name = ?
  `).get(tagName).count;
  
  const games = db.prepare(`
    SELECT g.*, GROUP_CONCAT(t.name) as tags
    FROM games g
    JOIN game_tags gt ON g.id = gt.game_id
    JOIN tags t ON gt.tag_id = t.id
    WHERE t.name = ?
    GROUP BY g.id
    ORDER BY g.pinned DESC, g.updated_at DESC
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

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  const raw = typeof filePath === 'string' ? filePath.trim() : '';
  if (!raw) return false;
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) return false;
  shell.showItemInFolder(resolved);
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

ipcMain.handle('launch-executable', async (event, exePath, rootPaths) => {
  try {
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

    const exeDir = path.dirname(resolvedExe);
    const hasMotw = (() => {
      try {
        const raw = fs.readFileSync(`${resolvedExe}:Zone.Identifier`, 'utf8');
        return /\[ZoneTransfer\]/i.test(String(raw));
      } catch {
        return false;
      }
    })();

    if (hasMotw) {
      const err = await shell.openPath(resolvedExe);
      if (typeof err === 'string' && err.trim()) {
        try {
          shell.showItemInFolder(resolvedExe);
        } catch {}
        return { success: false, error: '该程序会触发 SmartScreen，请在资源管理器中“更多信息 → 仍要运行”后再启动', details: err.trim() };
      }
      return { success: true, method: 'shell.openPath', needsUserConfirm: true };
    }

    const child = spawn(resolvedExe, [], {
      cwd: exeDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    return { success: true, method: 'spawn' };
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
        safeUnlinkCover(game.cover_path);
        safeUnlinkCover(newCoverPath);
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

app.whenReady().then(() => {
  initDatabase();
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
