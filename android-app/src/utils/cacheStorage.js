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
 * 保存指定服务器的游戏列表与元数据
 */
export async function saveServerCache(serverUrl, data = {}) {
  const key = normalizeServerKey(serverUrl);
  if (!key) return;

  try {
    const db = await getDb();
    const tx = db.transaction('servers', 'readwrite');
    const store = tx.objectStore('servers');

    // 保留现有元数据
    const existing = await new Promise((res) => {
      const req = store.get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });

    const payload = {
      serverUrl: key,
      games: 'games' in data ? (Array.isArray(data.games) ? data.games : []) : (existing?.games || []),
      total: 'total' in data ? Number(data.total) || 0 : ('games' in data && Array.isArray(data.games) ? data.games.length : (existing?.total || 0)),
      tags: 'tags' in data ? (Array.isArray(data.tags) ? data.tags : []) : (existing?.tags || []),
      rootPaths: 'rootPaths' in data ? (Array.isArray(data.rootPaths) ? data.rootPaths : []) : (existing?.rootPaths || []),
      stats: 'stats' in data ? data.stats : (existing?.stats || null),
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
 * 获取指定服务器的离线缓存
 */
export async function getServerCache(serverUrl) {
  const key = normalizeServerKey(serverUrl);
  if (!key) return null;

  try {
    const db = await getDb();
    const tx = db.transaction('servers', 'readonly');
    const store = tx.objectStore('servers');

    return await new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * 保存单张封面 Blob
 */
export async function saveCoverBlob(serverUrl, gameId, blob, version = null) {
  const sKey = normalizeServerKey(serverUrl);
  if (!sKey || !gameId || !blob) return;

  const key = `${sKey}::${gameId}`;
  try {
    const db = await getDb();
    const tx = db.transaction('covers', 'readwrite');
    const store = tx.objectStore('covers');
    store.put({
      key,
      serverUrl: sKey,
      gameId: Number(gameId) || gameId,
      blob,
      version: version ? String(version) : null,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.warn('Failed to save cover blob to IndexedDB:', err);
  }
}

/**
 * 获取单张封面 Blob 及元数据 (含版本信息)
 */
export async function getCoverBlobWithMeta(serverUrl, gameId) {
  const sKey = normalizeServerKey(serverUrl);
  if (!sKey || !gameId) return null;

  const key = `${sKey}::${gameId}`;
  try {
    const db = await getDb();
    const tx = db.transaction('covers', 'readonly');
    const store = tx.objectStore('covers');

    return await new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result?.blob) resolve(req.result);
        else resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * 获取单张封面 Blob
 */
export async function getCoverBlob(serverUrl, gameId) {
  const meta = await getCoverBlobWithMeta(serverUrl, gameId);
  return meta?.blob || null;
}

/**
 * 删除单张封面 Blob
 */
export async function deleteCoverBlob(serverUrl, gameId) {
  const sKey = normalizeServerKey(serverUrl);
  if (!sKey || !gameId) return;

  const key = `${sKey}::${gameId}`;
  try {
    const db = await getDb();
    const tx = db.transaction('covers', 'readwrite');
    const store = tx.objectStore('covers');
    store.delete(key);
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
export async function deleteServerCache(serverUrl) {
  const sKey = normalizeServerKey(serverUrl);
  if (!sKey) return;

  try {
    const db = await getDb();

    // 1. 删除 servers 记录
    const tx1 = db.transaction('servers', 'readwrite');
    tx1.objectStore('servers').delete(sKey);
    await new Promise((res, rej) => {
      tx1.oncomplete = res;
      tx1.onerror = () => rej(tx1.error);
    });

    // 2. 批量删除 covers 记录
    const tx2 = db.transaction('covers', 'readwrite');
    const store2 = tx2.objectStore('covers');
    const index = store2.index('serverUrl');
    const req = index.openCursor(IDBKeyRange.only(sKey));

    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
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
