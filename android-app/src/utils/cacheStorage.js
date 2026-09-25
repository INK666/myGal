/**
 * myGal Mobile - IndexedDB 本地离线缓存引擎
 * 负责游戏列表、分类元数据及封面图片 Blob 的持久化存储与清理
 */

const DB_NAME = 'myGal_offline_cache';
const DB_VERSION = 1;

let dbPromise = null;

function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // 1. 存储服务器级别的数据缓存 (游戏列表、标签、目录、统计)
      if (!db.objectStoreNames.contains('servers')) {
        db.createObjectStore('servers', { keyPath: 'serverUrl' });
      }
      // 2. 存储封面二进制图片缓存
      if (!db.objectStoreNames.contains('covers')) {
        const coverStore = db.createObjectStore('covers', { keyPath: 'key' });
        coverStore.createIndex('serverUrl', 'serverUrl', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error || new Error('Failed to open IndexedDB'));
    };
  });
  return dbPromise;
}

export const normalizeServerKey = (url) => {
  if (!url) return '';
  return String(url).trim().replace(/\/+$/, '').toLowerCase();
};

/**
 * 获取全局统一的游戏库存储标识 (优先基于 Token，确保同一 PC 无论是局域网 IP 还是穿透域名均共享同一份缓存)
 */
export const getLibraryStorageKey = (serverUrl, token = '') => {
  const norm = normalizeServerKey(serverUrl);
  // 1. 如果传入了非空 token，优先以 token 作为全局唯一游戏库命名空间
  if (token && typeof token === 'string' && token.trim().length >= 8) {
    return 'lib_' + token.trim().toLowerCase();
  }
  // 2. 尝试从 localStorage 中反查 token
  if (typeof localStorage !== 'undefined') {
    try {
      const activeToken = localStorage.getItem('mygal_server_token');
      const activeUrl = normalizeServerKey(localStorage.getItem('mygal_server_url'));
      if (activeToken && activeToken.trim().length >= 8 && activeUrl === norm) {
        return 'lib_' + activeToken.trim().toLowerCase();
      }
      const rawProfiles = localStorage.getItem('mygal_server_profiles');
      if (rawProfiles) {
        const profiles = JSON.parse(rawProfiles);
        if (Array.isArray(profiles)) {
          const matched = profiles.find((p) => {
            const pUrl = normalizeServerKey(p.url);
            const pPri = normalizeServerKey(p.primaryUrl);
            const pBak = normalizeServerKey(p.backupUrl);
            const pUrls = Array.isArray(p.urls) ? p.urls.map(normalizeServerKey) : [];
            return pUrl === norm || pPri === norm || pBak === norm || pUrls.includes(norm);
          });
          if (matched?.token && matched.token.trim().length >= 8) {
            return 'lib_' + matched.token.trim().toLowerCase();
          }
        }
      }
    } catch {}
  }
  return norm;
};

/**
 * 保存指定服务器的游戏列表与元数据 (自动使用统一 Library 命名空间)
 */
export async function saveServerCache(serverUrl, data = {}, token = '') {
  const libKey = getLibraryStorageKey(serverUrl, token);
  const rawKey = normalizeServerKey(serverUrl);
  if (!libKey && !rawKey) return;
  const targetKey = libKey || rawKey;

  try {
    const db = await getDb();
    const tx = db.transaction('servers', 'readwrite');
    const store = tx.objectStore('servers');

    // 优先读取以 targetKey 存储的数据；若不存在且 targetKey !== rawKey，尝试继承原有 rawKey 的数据
    let existing = await new Promise((res) => {
      const req = store.get(targetKey);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });

    if (!existing && targetKey !== rawKey) {
      existing = await new Promise((res) => {
        const req = store.get(rawKey);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
    }

    // 安全防空覆写合并保护：若传入空数组，绝不抹除已有缓存数据
    const safeGames = ('games' in data && Array.isArray(data.games) && data.games.length > 0)
      ? data.games
      : (existing?.games || []);

    const safeTags = ('tags' in data && Array.isArray(data.tags) && data.tags.length > 0)
      ? data.tags
      : (existing?.tags || []);

    const safeRootPaths = ('rootPaths' in data && Array.isArray(data.rootPaths) && data.rootPaths.length > 0)
      ? data.rootPaths
      : (existing?.rootPaths || []);

    const payload = {
      serverUrl: targetKey,
      realServerUrl: rawKey,
      games: safeGames,
      total: ('total' in data && Number(data.total) > 0) ? Number(data.total) : (safeGames.length || existing?.total || 0),
      tags: safeTags,
      rootPaths: safeRootPaths,
      stats: ('stats' in data && data.stats) ? data.stats : (existing?.stats || null),
      updatedAt: Date.now()
    };

    store.put(payload);
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.warn('Failed to save server cache:', err);
  }
}

/**
 * 获取指定服务器的离线缓存 (自动支持局域网与内网穿透地址共享)
 */
export async function getServerCache(serverUrl, token = '') {
  const libKey = getLibraryStorageKey(serverUrl, token);
  const rawKey = normalizeServerKey(serverUrl);
  if (!libKey && !rawKey) return null;

  try {
    const db = await getDb();
    const tx = db.transaction('servers', 'readonly');
    const store = tx.objectStore('servers');

    // 1. 尝试以 libKey 获取
    let res = await new Promise((resolve) => {
      const req = store.get(libKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });

    // 2. 若未找到且 libKey !== rawKey，回退查找 rawKey（旧版数据无缝兼容）
    if (!res && libKey !== rawKey) {
      res = await new Promise((resolve) => {
        const req = store.get(rawKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }

    return res;
  } catch {
    return null;
  }
}

/**
 * 局部更新指定服务器离线缓存中的单款游戏信息 (如修改别名、标签、置顶状态等)
 */
export async function updateGameInServerCache(serverUrl, updatedGame, token = '') {
  const libKey = getLibraryStorageKey(serverUrl, token);
  const rawKey = normalizeServerKey(serverUrl);
  if ((!libKey && !rawKey) || !updatedGame?.id) return;
  const targetKey = libKey || rawKey;

  try {
    const db = await getDb();
    const tx = db.transaction('servers', 'readwrite');
    const store = tx.objectStore('servers');

    let existing = await new Promise((res) => {
      const req = store.get(targetKey);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });

    if (!existing && targetKey !== rawKey) {
      existing = await new Promise((res) => {
        const req = store.get(rawKey);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
    }

    if (existing && Array.isArray(existing.games)) {
      const index = existing.games.findIndex((g) => g.id === updatedGame.id);
      if (index !== -1) {
        existing.games[index] = { ...existing.games[index], ...updatedGame };
      } else {
        existing.games.unshift(updatedGame);
        existing.total = Math.max(existing.total || 0, existing.games.length);
      }
      existing.updatedAt = Date.now();
      existing.serverUrl = targetKey;
      store.put(existing);
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    }
  } catch (err) {
    console.warn('Failed to update game in server cache:', err);
  }
}

/**
 * 局部更新指定服务器离线缓存中的单款游戏 (支持 (serverUrl, gameId, partial, token) 或 (serverUrl, updatedGame, token))
 */
export async function updateGameInCache(serverUrl, gameIdOrGame, partialOrToken = {}, token = '') {
  if (typeof gameIdOrGame === 'object' && gameIdOrGame !== null) {
    return updateGameInServerCache(serverUrl, gameIdOrGame, typeof partialOrToken === 'string' ? partialOrToken : token);
  }
  const id = Number(gameIdOrGame);
  const partial = typeof partialOrToken === 'object' && partialOrToken !== null ? partialOrToken : {};
  return updateGameInServerCache(serverUrl, { id, ...partial }, token);
}

/**
 * 将高分辨率大图在手机本地快速压缩为轻量缩略图 (WebP, 最大宽高 360x540, 质量 0.72)
 * 将原本 2MB~5MB 的大图压缩为 15KB~30KB，节省 99% 的 IndexedDB 占用并消除内存暴涨
 */
export async function compressImageBlob(blob, maxWidth = 360, maxHeight = 540, quality = 0.72) {
  if (!blob || !(blob instanceof Blob)) return blob;
  if (blob.size < 40 * 1024 && (blob.type === 'image/webp' || blob.type === 'image/jpeg')) {
    return blob;
  }
  if (typeof document === 'undefined') return blob;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) {
        resolve(blob);
        return;
      }

      const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
      const targetWidth = Math.max(1, Math.round(width * ratio));
      const targetHeight = Math.max(1, Math.round(height * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        resolve(blob);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (compressedBlob) => {
          if (compressedBlob && compressedBlob.size > 0 && compressedBlob.size < blob.size) {
            resolve(compressedBlob);
          } else {
            resolve(blob);
          }
        },
        'image/webp',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.src = url;
  });
}

/**
 * 保存单张封面 Blob (自动经过 WebP 移动端轻量化压缩，统一使用 Library 命名空间)
 */
export async function saveCoverBlob(serverUrl, gameId, blob, version = null, token = '') {
  const sKey = getLibraryStorageKey(serverUrl, token);
  if (!sKey || !gameId || !blob) return;

  const key = `${sKey}::${gameId}`;
  try {
    const optimizedBlob = await compressImageBlob(blob);
    const db = await getDb();
    const tx = db.transaction('covers', 'readwrite');
    const store = tx.objectStore('covers');
    store.put({
      key,
      serverUrl: sKey,
      gameId: Number(gameId) || gameId,
      blob: optimizedBlob,
      version: version ? String(version) : null,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.warn('Failed to save cover blob to IndexedDB:', err);
  }
}

/**
 * 获取单张封面 Blob 及元数据 (含版本信息，自动跨局域网与穿透网络共享复用)
 */
export async function getCoverBlobWithMeta(serverUrl, gameId, token = '') {
  const libKey = getLibraryStorageKey(serverUrl, token);
  const rawKey = normalizeServerKey(serverUrl);
  if (!libKey && !rawKey) return null;

  try {
    const db = await getDb();
    const tx = db.transaction('covers', 'readonly');
    const store = tx.objectStore('covers');

    // 1. 优先在统一 Library 命名空间下查找
    let res = await new Promise((resolve) => {
      const req = store.get(`${libKey}::${gameId}`);
      req.onsuccess = () => resolve(req.result?.blob ? req.result : null);
      req.onerror = () => resolve(null);
    });

    // 2. 回退查找旧版 rawKey 命名空间 (兼容历史已缓存封面)
    if (!res && libKey !== rawKey) {
      res = await new Promise((resolve) => {
        const req = store.get(`${rawKey}::${gameId}`);
        req.onsuccess = () => resolve(req.result?.blob ? req.result : null);
        req.onerror = () => resolve(null);
      });
    }

    return res;
  } catch {
    return null;
  }
}

/**
 * 获取单张封面 Blob
 */
export async function getCoverBlob(serverUrl, gameId, token = '') {
  const meta = await getCoverBlobWithMeta(serverUrl, gameId, token);
  return meta?.blob || null;
}

/**
 * 删除单张封面 Blob
 */
export async function deleteCoverBlob(serverUrl, gameId, token = '') {
  const libKey = getLibraryStorageKey(serverUrl, token);
  const rawKey = normalizeServerKey(serverUrl);
  if (!libKey && !rawKey) return;

  try {
    const db = await getDb();
    const tx = db.transaction('covers', 'readwrite');
    const store = tx.objectStore('covers');
    store.delete(`${libKey}::${gameId}`);
    if (libKey !== rawKey) {
      store.delete(`${rawKey}::${gameId}`);
    }
    await new Promise((res) => {
      tx.oncomplete = res;
      tx.onerror = res;
    });
  } catch (err) {
    console.warn('Failed to delete cover blob from IndexedDB:', err);
  }
}

/**
 * 删除某个服务器的所有缓存（包括游戏数据、元数据与所有封面图片）
 */
export async function deleteServerCache(serverUrl, token = '') {
  const libKey = getLibraryStorageKey(serverUrl, token);
  const rawKey = normalizeServerKey(serverUrl);
  if (!libKey && !rawKey) return;

  const keysToDelete = Array.from(new Set([libKey, rawKey].filter(Boolean)));

  try {
    const db = await getDb();

    // 1. 删除 servers 记录
    const tx1 = db.transaction('servers', 'readwrite');
    const store1 = tx1.objectStore('servers');
    for (const k of keysToDelete) {
      store1.delete(k);
    }
    await new Promise((res, rej) => {
      tx1.oncomplete = res;
      tx1.onerror = () => rej(tx1.error);
    });

    // 2. 批量删除 covers 记录
    const tx2 = db.transaction('covers', 'readwrite');
    const store2 = tx2.objectStore('covers');
    const index = store2.index('serverUrl');

    for (const k of keysToDelete) {
      const req = index.openCursor(IDBKeyRange.only(k));
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }
    await new Promise((res, rej) => {
      tx2.oncomplete = res;
      tx2.onerror = () => rej(tx2.error);
    });
    console.log(`[Cache] All cached data and covers for ${serverUrl} deleted successfully.`);
  } catch (err) {
    console.warn(`Failed to delete server cache for ${serverUrl}:`, err);
  }
}

/**
 * 清空所有服务器的所有本地缓存
 */
export async function clearAllCache() {
  try {
    const db = await getDb();
    const tx1 = db.transaction('servers', 'readwrite');
    tx1.objectStore('servers').clear();

    const tx2 = db.transaction('covers', 'readwrite');
    tx2.objectStore('covers').clear();

    await Promise.all([
      new Promise((res, rej) => {
        tx1.oncomplete = res;
        tx1.onerror = () => rej(tx1.error);
      }),
      new Promise((res, rej) => {
        tx2.oncomplete = res;
        tx2.onerror = () => rej(tx2.error);
      })
    ]);
    console.log('[Cache] All local cache cleared.');
  } catch (err) {
    console.warn('Failed to clear all cache:', err);
  }
}

/**
 * 批量并发全量预热封面图片缓存（带并发控制与进度回调，默认无上限全量预热，统一保存到 Library 命名空间）
 * @param {string} serverUrl 服务器地址
 * @param {Array} games 游戏对象列表
 * @param {string} [token] 认证 token
 * @param {Function} [onProgress] 进度回调 (0 ~ 100)
 * @param {number} [limit=0] 预热上限数量 (0 表示不限制，全量预热)
 */
export async function preloadCovers(serverUrl, games, token = '', onProgress = null, limit = 0) {
  const cleanServerUrl = normalizeServerKey(serverUrl);
  if (!cleanServerUrl || !Array.isArray(games) || games.length === 0) {
    onProgress?.(100);
    return;
  }

  const rawServerUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
  const filtered = games.filter((g) => g && g.hasCover);
  const gamesWithCover = limit > 0 ? filtered.slice(0, limit) : filtered;
  const total = gamesWithCover.length;

  if (total === 0) {
    onProgress?.(100);
    return;
  }

  const concurrency = 6;
  let cursor = 0;
  let finishedCount = 0;

  const worker = async () => {
    while (cursor < total) {
      const idx = cursor++;
      if (idx >= total) break;
      const g = gamesWithCover[idx];

      try {
        const version = g.updatedAt ? new Date(g.updatedAt).getTime() : '';
        const vParam = version ? `&v=${version}` : '';
        const coverUrl = g.coverUrl
          ? (token && !g.coverUrl.includes('token=')
              ? `${g.coverUrl}${g.coverUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
              : g.coverUrl)
          : `${rawServerUrl}/api/covers/${g.id}?thumb=1&token=${encodeURIComponent(token || '')}${vParam}`;

        const existing = await getCoverBlobWithMeta(cleanServerUrl, g.id, token);
        const versionStr = version ? String(version) : '';

        // 若本地不存在或版本过旧，则请求 20KB 轻量化缩略图并缓存
        if (!existing || (versionStr && existing.version !== versionStr)) {
          const resp = await fetch(coverUrl, { mode: 'cors' });
          if (resp.ok) {
            const blob = await resp.blob();
            if (blob && blob.size > 0) {
              await saveCoverBlob(cleanServerUrl, g.id, blob, versionStr, token);
            }
          }
        }
      } catch {
        // 单张预热失败不中断整体进度
      } finally {
        finishedCount++;
        const percent = Math.round((finishedCount / total) * 100);
        onProgress?.(percent);
      }
    }
  };

  const pool = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(pool);
  onProgress?.(100);
}
