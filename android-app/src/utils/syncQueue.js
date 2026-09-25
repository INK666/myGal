/**
 * myGal Mobile - 离线修改安全同步队列引擎
 * 负责记录离线状态下的置顶 (pinned) 与别名 (alias) 修改，并在重新连接到 PC 端时严格、精准地推送更新
 */

import { normalizeServerKey, getLibraryStorageKey } from './cacheStorage';

const PENDING_SYNC_EVENT = 'mygal:pending-changes-updated';

/**
 * 获取指定 PC 服务器的待同步存储 Key (支持多地址统一映射至同一 Library 命名空间)
 */
function getStorageKey(serverUrl, token = '') {
  const libKey = getLibraryStorageKey(serverUrl, token);
  return libKey ? `mygal_offline_changes_${libKey}` : null;
}

/**
 * 触发队列变动全局事件
 */
function notifyQueueUpdated(serverUrl) {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(PENDING_SYNC_EVENT, {
          detail: { serverUrl: normalizeServerKey(serverUrl) }
        })
      );
    } catch {}
  }
}

/**
 * 获取指定服务器的所有待同步离线修改项 (自动跨局域网与内网穿透地址共享)
 * @param {string} serverUrl
 * @param {string} [token]
 * @returns {Array<{id: string, serverUrl: string, libraryKey?: string, gameId: number, gameName: string, type: 'alias'|'pinned', value: any, timestamp: number}>}
 */
export function getPendingChanges(serverUrl, token = '') {
  const key = getStorageKey(serverUrl, token);
  if (!key || typeof localStorage === 'undefined') return [];

  try {
    let raw = localStorage.getItem(key);
    // 兼容历史按纯 URL 保存的旧键
    const rawUrlKey = `mygal_offline_changes_${normalizeServerKey(serverUrl)}`;
    if (!raw && key !== rawUrlKey) {
      raw = localStorage.getItem(rawUrlKey);
      if (raw) {
        try {
          localStorage.setItem(key, raw);
          localStorage.removeItem(rawUrlKey);
        } catch {}
      }
    }
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    return list.filter((item) => {
      const validId = typeof item?.gameId === 'number' && Number.isFinite(item.gameId) && item.gameId > 0;
      const validType = item?.type === 'alias' || item?.type === 'pinned';
      return validId && validType;
    });
  } catch (err) {
    console.warn('[SyncQueue] Failed to parse pending changes:', err);
    return [];
  }
}

/**
 * 保存指定服务器的待同步列表
 */
export function savePendingChanges(serverUrl, list, token = '') {
  const key = getStorageKey(serverUrl, token);
  if (!key || typeof localStorage === 'undefined') return;

  try {
    if (!list || list.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(list));
    }
    notifyQueueUpdated(serverUrl);
  } catch (err) {
    console.warn('[SyncQueue] Failed to save pending changes:', err);
  }
}

/**
 * 记录离线修改（置顶或别名）
 * 采用同游戏同属性覆盖策略，避免重复排队并确保推送最新值
 * @param {string} serverUrl 服务器地址
 * @param {{ gameId: number, gameName?: string, type: 'alias'|'pinned', value: any, token?: string }} param1
 */
export function enqueueOfflineChange(serverUrl, { gameId, gameName = '', type, value, token = '' }) {
  const norm = normalizeServerKey(serverUrl);
  const libKey = getLibraryStorageKey(serverUrl, token);
  const numId = Number(gameId);

  if (!norm || !Number.isFinite(numId) || numId <= 0) {
    console.error('[SyncQueue] Invalid enqueue parameters:', { serverUrl, gameId, type });
    return;
  }

  if (type !== 'alias' && type !== 'pinned') {
    console.error('[SyncQueue] Unsupported change type:', type);
    return;
  }

  // 严格规范化修改值：防止意外推入脏数据
  let normalizedValue;
  if (type === 'alias') {
    const s = typeof value === 'string' ? value.trim() : '';
    normalizedValue = s ? s : null;
  } else if (type === 'pinned') {
    normalizedValue = Boolean(value);
  }

  const currentList = getPendingChanges(serverUrl, token);
  // 查找是否已有针对同一款游戏相同属性的待同步修改
  const existingIdx = currentList.findIndex(
    (item) => item.gameId === numId && item.type === type
  );

  const now = Date.now();
  if (existingIdx !== -1) {
    // 覆盖现有项的数值与时间戳
    currentList[existingIdx] = {
      ...currentList[existingIdx],
      value: normalizedValue,
      gameName: gameName || currentList[existingIdx].gameName,
      libraryKey: libKey,
      timestamp: now
    };
  } else {
    // 新增待同步修改项
    currentList.push({
      id: `${type}_${numId}_${now}`,
      serverUrl: norm,
      libraryKey: libKey,
      gameId: numId,
      gameName: String(gameName || ''),
      type,
      value: normalizedValue,
      timestamp: now
    });
  }

  savePendingChanges(serverUrl, currentList, token);
  console.log(`[SyncQueue] Enqueued offline change for #${numId} (${gameName}): ${type} ->`, normalizedValue);
}

/**
 * 移除指定游戏指定属性的待同步记录（在线修改成功后调用，清除旧队列残留）
 */
export function removePendingChangeForField(serverUrl, gameId, type) {
  const norm = normalizeServerKey(serverUrl);
  const numId = Number(gameId);
  if (!norm || !Number.isFinite(numId)) return;

  const currentList = getPendingChanges(norm);
  const filtered = currentList.filter(
    (item) => !(item.gameId === numId && item.type === type)
  );

  if (filtered.length !== currentList.length) {
    savePendingChanges(norm, filtered);
  }
}

/**
 * 清除指定服务器的全部待同步队列（如删除服务器配置时）
 */
export function clearPendingChanges(serverUrl) {
  const norm = normalizeServerKey(serverUrl);
  if (!norm) return;
  savePendingChanges(norm, []);
}

/**
 * 获取指定服务器当前待同步修改的数量
 */
export function getPendingChangeCount(serverUrl) {
  return getPendingChanges(serverUrl).length;
}

/**
 * 获取单款游戏是否存在待推送的离线修改
 */
export function getPendingChangesForGame(serverUrl, gameId) {
  const numId = Number(gameId);
  if (!Number.isFinite(numId)) {
    return { hasPending: false, pendingAlias: undefined, pendingPinned: undefined };
  }
  const list = getPendingChanges(serverUrl);
  const aliasItem = list.find((it) => it.gameId === numId && it.type === 'alias');
  const pinnedItem = list.find((it) => it.gameId === numId && it.type === 'pinned');

  return {
    hasPending: Boolean(aliasItem || pinnedItem),
    hasPendingAlias: Boolean(aliasItem),
    pendingAlias: aliasItem ? aliasItem.value : undefined,
    hasPendingPinned: Boolean(pinnedItem),
    pendingPinned: pinnedItem ? pinnedItem.value : undefined
  };
}

/**
 * 将队列中的离线修改覆盖到游戏列表上，确保 UI 呈现即时最新状态（即便服务器尚未拉取）
 */
export function applyPendingChangesToGames(games, serverUrl) {
  if (!Array.isArray(games) || games.length === 0) return games;
  const pending = getPendingChanges(serverUrl);
  if (pending.length === 0) return games;

  const changeMap = new Map();
  for (const item of pending) {
    if (!changeMap.has(item.gameId)) {
      changeMap.set(item.gameId, {});
    }
    const target = changeMap.get(item.gameId);
    if (item.type === 'alias') {
      target.alias = item.value;
    } else if (item.type === 'pinned') {
      target.pinned = item.value;
    }
  }

  return games.map((game) => {
    const changes = changeMap.get(game.id);
    if (changes) {
      return { ...game, ...changes };
    }
    return game;
  });
}

// 同步并发互斥锁：避免网络闪断重连或连续操作导致重复并发推送
let isSyncingPending = false;

/**
 * 将指定服务器所有离线修改安全、精准地推送到 PC 端
 * ！！核心原则：严格仅调用对应属性的单点修改接口，绝不污染 PC 端其它数据
 * @param {string} serverUrl
 * @param {object} api api client 实例
 * @param {Function} [showToast] 可选的 Toast 提示回调
 * @returns {Promise<{ total: number, successCount: number, failedCount: number }>}
 */
export async function pushPendingChangesToPc(serverUrl, api, showToast = null) {
  const norm = normalizeServerKey(serverUrl);
  if (!norm || !api) {
    return { total: 0, successCount: 0, failedCount: 0 };
  }

  if (isSyncingPending) {
    console.log('[SyncQueue] Sync already in progress, skipping concurrent trigger.');
    return { total: 0, successCount: 0, failedCount: 0 };
  }

  const pendingList = getPendingChanges(serverUrl);
  if (pendingList.length === 0) {
    return { total: 0, successCount: 0, failedCount: 0 };
  }

  isSyncingPending = true;
  console.log(`[SyncQueue] Starting to push ${pendingList.length} offline changes to PC:`, pendingList);

  let successCount = 0;
  let failedCount = 0;
  const remaining = [];
  const appliedSummaries = [];

  try {
    const targetLibKey = getLibraryStorageKey(serverUrl);

    for (const item of pendingList) {
      // 1. 严格安全校验：必须与目标 PC 服务地址严格匹配 (或同属同一个 PC 游戏库)
      const itemLibKey = item.libraryKey || getLibraryStorageKey(item.serverUrl);
      const isSameLibrary = Boolean(itemLibKey && targetLibKey && itemLibKey === targetLibKey);

      if (!isSameLibrary && normalizeServerKey(item.serverUrl) !== norm) {
        remaining.push(item);
        continue;
      }

      const gameId = Number(item.gameId);
      if (!Number.isFinite(gameId) || gameId <= 0) {
        console.warn('[SyncQueue] Dropping corrupted item:', item);
        continue;
      }

      try {
        if (item.type === 'alias') {
          // 精确推送别名修改：POST /api/games/:id/alias
          const cleanAlias = typeof item.value === 'string' ? item.value.trim() : null;
          await api.updateGameAlias(gameId, cleanAlias);
          successCount++;
          appliedSummaries.push(`《${item.gameName || `#${gameId}`}》别名 -> ${cleanAlias ? `"${cleanAlias}"` : '清除'}`);
        } else if (item.type === 'pinned') {
          // 精确推送置顶修改：POST /api/games/:id/pinned
          const pinValue = Boolean(item.value);
          await api.updateGamePinned(gameId, pinValue);
          successCount++;
          appliedSummaries.push(`《${item.gameName || `#${gameId}`}》${pinValue ? '已置顶' : '取消置顶'}`);
        } else {
          console.warn('[SyncQueue] Skipping unsupported type:', item);
        }
      } catch (err) {
        console.error(`[SyncQueue] Failed to push change for game #${gameId}:`, err);
        failedCount++;
        // 失败项予以保留，以便下次重连时自动重试
        remaining.push(item);
      }
    }

    // 更新持久化待同步队列（成功推送的已被剔除）
    savePendingChanges(serverUrl, remaining);

    if (successCount > 0) {
      const summaryText = appliedSummaries.slice(0, 2).join(', ') + (appliedSummaries.length > 2 ? ` 等共${successCount}项` : '');
      const msg = `已自动将离线修改推送到 PC 端: ${summaryText}`;
      console.log('[SyncQueue] ' + msg);
      if (typeof showToast === 'function') {
        showToast(msg, 'success', 3500);
      }
    }

    if (failedCount > 0 && typeof showToast === 'function') {
      showToast(`${failedCount} 项离线修改暂未推送成功，将在网络恢复后重试`, 'warning');
    }

    return { total: pendingList.length, successCount, failedCount };
  } finally {
    isSyncingPending = false;
  }
}
