/**
 * myGal Mobile - 轻量移动端自主刮削引擎
 * 针对 Galgame 优化的零配置、纯前端刮削器
 * 支持 VNDB Kana v2、月幕 (Ymgal)、Bangumi (番组计划)、DLsite (番号)
 * 算法与 PC 端严格保持一致，100% 运行在手机本地，无公网直接提示
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { compressImageBlob } from './cacheStorage';

// 本地存储键
const SETTINGS_STORAGE_KEY = 'mygal_mobile_scrape_settings';

// 默认刮削策略配置
export const DEFAULT_SCRAPE_SETTINGS = {
  enabledProviders: {
    vndb: true,
    ymgal: true,
    bangumi: true,
    dlsite: true
  },
  maxConcurrent: 1, // 并发数 (1 ~ 3)
  intervalMs: 800   // 请求间隔时间 (ms)
};

/**
 * 获取当前移动端刮削策略配置
 */
export function getScrapeSettings() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SCRAPE_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCRAPE_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      enabledProviders: {
        ...DEFAULT_SCRAPE_SETTINGS.enabledProviders,
        ...(parsed.enabledProviders || {})
      },
      maxConcurrent: Math.min(3, Math.max(1, Number(parsed.maxConcurrent) || 1)),
      intervalMs: Math.min(5000, Math.max(300, Number(parsed.intervalMs) || 800))
    };
  } catch {
    return { ...DEFAULT_SCRAPE_SETTINGS };
  }
}

/**
 * 保存移动端刮削策略配置
 */
export function saveScrapeSettings(settings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[mobileScraper] Failed to save settings:', err);
  }
}

// ==========================================
// 1. 标题清洗与规范化算法 (与 PC 端算法保持完全一致)
// ==========================================

const KNOWN_SUFFIXES = [
  '.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst',
  '.zip', '.rar', '.7z', '.iso', '.cab',
  '.gz', '.bz2', '.xz', '.zst',
  '.exe', '.msi', '.bin', '.dmg', '.pkg',
  '.nsp', '.xci', '.cia', '.wbfs', '.rvz', '.cso', '.chd'
];

/**
 * 规范化游戏标题 (过滤常见压缩后缀、版本号、解压密码标记与特殊符号)
 */
export function normalizeGameTitle(rawName) {
  let name = '';
  try {
    name = String(rawName ?? '').trim();
  } catch {
    name = '';
  }
  if (!name) return '';

  name = name.replace(/^[._-]+/, '').trim();

  while (true) {
    const before = name;
    const lower = name.toLowerCase();

    for (const suffix of KNOWN_SUFFIXES) {
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

  // 清除各种方括号、圆括号、书名号等括号内修饰内容 [汉化组] (v1.0)
  name = name
    .replace(/[\[\(（【［].*?[\]\)）】］]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 截断解压密码等脏文字
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
}

/**
 * 从文件路径获取文件名 (替代 node:path.basename)
 */
function getPathBasename(p) {
  if (!p || typeof p !== 'string') return '';
  const clean = p.trim().replace(/[\\/]+$/, '');
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return lastSlash !== -1 ? clean.slice(lastSlash + 1) : clean;
}

/**
 * 为指定游戏生成多级候选搜索词序列 (与 PC 端算法一致)
 */
export function generateCandidates(game) {
  const rawPath = typeof game.path === 'string' ? game.path.trim() : '';
  const rawPathName = rawPath ? getPathBasename(rawPath) : '';
  const rawName = String(game.name ?? '').trim();
  const rawAlias = String(game.alias ?? '').trim();

  const normalizedName = normalizeGameTitle(rawName);
  const normalizedAlias = normalizeGameTitle(rawAlias);
  const normalizedPathName = normalizeGameTitle(rawPathName);

  const candidates = [
    ...(rawAlias ? [normalizedAlias, rawAlias] : []),
    normalizedName,
    rawName,
    normalizedPathName,
    rawPathName
  ]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === idx);

  return candidates;
}

// ==========================================
// 2. 移动端网络通信封装 (支持 Capacitor 原生栈无 CORS 限制)
// ==========================================

async function mobileFetch(url, options = {}, timeoutMs = 12000) {
  const isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.();

  if (isNative) {
    try {
      const capRes = await CapacitorHttp.request({
        url,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'GameManage/1.0',
          ...(options.headers || {})
        },
        data: options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      });
      return {
        ok: capRes.status >= 200 && capRes.status < 300,
        status: capRes.status,
        json: async () => (typeof capRes.data === 'string' ? JSON.parse(capRes.data) : capRes.data),
        text: async () => (typeof capRes.data === 'string' ? capRes.data : JSON.stringify(capRes.data))
      };
    } catch (e) {
      console.warn('[mobileScraper] CapacitorHttp request failed, fallback to fetch:', e);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'GameManage/1.0',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 下载目标封面图片并返回 Blob (自动支持原生与 Web 环境)
 */
async function downloadImageBlob(url, timeoutMs = 15000) {
  const isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.();

  if (isNative) {
    try {
      const capRes = await CapacitorHttp.get({
        url,
        responseType: 'blob',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      });
      if (capRes.data) {
        const base64Str = String(capRes.data);
        const byteCharacters = atob(base64Str);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const mime = capRes.headers?.['content-type'] || 'image/jpeg';
        return new Blob([byteArray], { type: mime });
      }
    } catch (e) {
      console.warn('[mobileScraper] CapacitorHttp image download failed, trying fetch:', e);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'image/*' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// 3. 四大核心刮削源实现 (与 PC 端接口及逻辑对齐)
// ==========================================

// --- A. VNDB Kana v2 ---
async function tryVndbV2(title) {
  try {
    const res = await mobileFetch('https://api.vndb.org/kana/vn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filters: ['search', '=', title],
        fields: 'title,image.url,developers.name',
        results: 5
      })
    }, 6000);

    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];
    const first = results.find((r) => r?.image?.url) || null;
    const url = first?.image?.url;
    if (!url) return null;

    const devs = Array.isArray(first?.developers) ? first.developers : [];
    const vendors = devs.map((d) => (typeof d === 'string' ? d : d?.name)).filter(Boolean);

    return { provider: 'VNDBv2', url, vendors };
  } catch {
    return null;
  }
}

// --- B. 月幕 (Ymgal) 免配内置凭证源 ---
let ymgalTokenCache = { token: null, expiresAt: 0 };

async function getYmgalToken() {
  const now = Date.now();
  if (ymgalTokenCache.token && ymgalTokenCache.expiresAt > now) {
    return ymgalTokenCache.token;
  }

  const tokenUrl = 'https://www.ymgal.games/oauth/token?grant_type=client_credentials&client_id=ymgal&client_secret=luna0327&scope=public';
  const res = await mobileFetch(tokenUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json;charset=utf-8'
    }
  }, 10000);

  if (!res.ok) return null;
  const json = await res.json();
  const token = json?.access_token;
  const expiresIn = Number(json?.expires_in || 3600);
  if (!token) return null;

  ymgalTokenCache = {
    token,
    expiresAt: now + Math.max(0, (expiresIn * 1000) - 60000)
  };
  return token;
}

async function tryYmgal(title) {
  try {
    const token = await getYmgalToken();
    if (!token) return null;

    const searchUrl = `https://www.ymgal.games/open/archive/search-game?mode=accurate&keyword=${encodeURIComponent(title)}&similarity=70`;
    const res = await mobileFetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        version: '1',
        Accept: 'application/json;charset=utf-8'
      }
    }, 12000);

    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data;

    const pickImg = (val) => {
      if (!val) return null;
      if (Array.isArray(val)) {
        const item = val.find((v) => v?.mainImg || v?.main_img || v?.main_image);
        return item?.mainImg || item?.main_img || item?.main_image || null;
      }
      if (typeof val === 'object') {
        return val?.mainImg || val?.main_img || val?.main_image || null;
      }
      return null;
    };

    const url = pickImg(data?.game) || pickImg(data?.games) || pickImg(data?.list) || pickImg(data) || null;
    if (!url) return null;

    return { provider: 'Ymgal', url };
  } catch {
    return null;
  }
}

// --- C. Bangumi (番组计划) ---
async function tryBangumi(title) {
  try {
    const searchUrl = `https://api.bgm.tv/search/subject/${encodeURIComponent(title)}?type=4&responseGroup=small&max_results=5`;
    const res = await mobileFetch(searchUrl, {
      headers: {
        Accept: 'application/json'
      }
    }, 12000);

    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json?.list) ? json.list : [];
    const picked = list.find((i) => i?.images?.large || i?.images?.common || i?.images?.medium || i?.images?.small);
    const img = picked?.images;
    const url = img?.large || img?.common || img?.medium || img?.small || null;
    if (!url) return null;

    return { provider: 'Bangumi', url };
  } catch {
    return null;
  }
}

// --- D. DLsite (RJ/VJ/BJ 番号精准抓取) ---
async function tryDlsite(query) {
  const match = String(query || '').match(/((?:RJ|VJ|BJ|RE)\d{6,8})/i);
  if (!match || !match[1]) return null;

  const workno = match[1].toUpperCase();
  const locales = ['ja_jp', 'zh_cn', 'en_us'];
  const sections = ['maniax', 'girls-pro', 'home', 'pro'];

  const pickUrl = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const direct =
      obj.work_image || obj.work_image_url || obj.main_image || obj.main_image_url ||
      obj.image_main || obj.image_main_url || obj.image || obj.image_url ||
      obj?.images?.main || obj?.images?.cover || obj?.images?.thumb || obj.work_image_main;
    if (typeof direct === 'string') {
      if (direct.startsWith('http')) return direct;
      if (direct.startsWith('//')) return `https:${direct}`;
    }
    return null;
  };

  for (const section of sections) {
    for (const locale of locales) {
      try {
        const apiUrl = `https://www.dlsite.com/${section}/api/=/product.json?workno=${encodeURIComponent(workno)}&locale=${encodeURIComponent(locale)}`;
        const res = await mobileFetch(apiUrl, { headers: { Accept: 'application/json' } }, 8000);
        if (!res.ok) continue;

        const json = await res.json();
        const cand = json?.[workno] || json?.product || json?.work || (Array.isArray(json) ? json[0] : json);
        const url = pickUrl(cand);
        if (url) {
          const maker = cand?.maker_name || cand?.circle_name || cand?.brand_name || null;
          return {
            provider: 'DLsite',
            url,
            vendors: maker ? [maker] : []
          };
        }
      } catch {}
    }
  }

  return null;
}

// ==========================================
// 4. 移动端综合刮削调度入口
// ==========================================

/**
 * 在手机本地执行单款游戏的封面与元数据刮削
 * @param {object} game 游戏详情对象 (包含 name, alias, path)
 * @param {object} [customSettings] 可选自定义配置
 * @returns {Promise<{ success: boolean, provider?: string, imageUrl?: string, blob?: Blob, vendors?: string[], query?: string, error?: string }>}
 */
export async function scrapeGameCoverLocally(game, customSettings = null) {
  // 1. 无公网环境即时阻断
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('NO_NETWORK');
  }

  if (!game) {
    return { success: false, error: '游戏不存在' };
  }

  const settings = customSettings || getScrapeSettings();
  const enabled = settings.enabledProviders || DEFAULT_SCRAPE_SETTINGS.enabledProviders;

  const candidates = generateCandidates(game);
  if (candidates.length === 0) {
    return { success: false, error: '未能生成有效检索词' };
  }

  // 组装启用的数据源：国内极速源 (月幕 Ymgal、Bangumi) 前置，VNDB (境外) 后置防超时阻塞
  const providers = [];
  if (enabled.ymgal) providers.push({ name: 'Ymgal', fn: tryYmgal });
  if (enabled.bangumi) providers.push({ name: 'Bangumi', fn: tryBangumi });
  if (enabled.vndb) providers.push({ name: 'VNDBv2', fn: tryVndbV2 });
  if (enabled.dlsite) providers.push({ name: 'DLsite', fn: tryDlsite });

  if (providers.length === 0) {
    return { success: false, error: '未启用任何刮削数据源，请在设置中开启' };
  }

  let found = null;

  // 优先处理：若标题中包含 DLsite 番号且启用了 DLsite
  if (enabled.dlsite) {
    const hasWorkNo = candidates.some((t) => /((?:RJ|VJ|BJ|RE)\d{6,8})/i.test(String(t || '')));
    if (hasWorkNo) {
      for (const query of candidates) {
        if (/((?:RJ|VJ|BJ|RE)\d{6,8})/i.test(String(query || ''))) {
          try {
            const res = await tryDlsite(query);
            if (res?.url) {
              found = { ...res, query };
              break;
            }
          } catch {}
        }
      }
    }
  }

  // 常规多源搜索
  if (!found?.url) {
    for (const query of candidates) {
      for (const p of providers) {
        if (p.name === 'DLsite' && found) continue;
        try {
          const res = await p.fn(query);
          if (res?.url) {
            found = { ...res, query };
            break;
          }
        } catch {}
      }
      if (found?.url) break;
    }
  }

  if (!found?.url) {
    return { success: false, error: '各大刮削源均未检索到匹配封面' };
  }

  // 下载图片并经 Canvas 压缩为移动端极小 WebP
  try {
    const rawBlob = await downloadImageBlob(found.url);
    const compressedBlob = await compressImageBlob(rawBlob, 600, 900, 0.85);

    return {
      success: true,
      provider: found.provider,
      imageUrl: found.url,
      blob: compressedBlob,
      vendors: found.vendors || [],
      query: found.query
    };
  } catch (err) {
    return {
      success: false,
      error: `封面图片下载失败: ${err?.message || '网络异常'}`
    };
  }
}
