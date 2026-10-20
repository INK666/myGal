import React, { useState, useEffect, useRef } from 'react';
import { ImageOff } from 'lucide-react';
import { getCoverBlobWithMeta, saveCoverBlob, deleteCoverBlob } from '../utils/cacheStorage';

// 内存 Blob URL 缓存 (LRU 上限。大库快速滚动时若窗口过小，屏外封面会被反复
// revoke/createObjectURL 造成解码抖动；100 张 × ~20KB 仅约 2MB，代价可忽略)
const MAX_BLOB_CACHE_SIZE = 100;
const blobCache = new Map();

function getBlobCache(key) {
  if (!blobCache.has(key)) return null;
  const val = blobCache.get(key);
  blobCache.delete(key);
  blobCache.set(key, val);
  return val;
}

function setBlobCache(key, objectUrl) {
  if (blobCache.has(key)) {
    blobCache.delete(key);
  } else if (blobCache.size >= MAX_BLOB_CACHE_SIZE) {
    const oldestKey = blobCache.keys().next().value;
    const oldUrl = blobCache.get(oldestKey);
    try {
      if (typeof oldUrl === 'string' && oldUrl.startsWith('blob:')) {
        URL.revokeObjectURL(oldUrl);
      }
    } catch {}
    blobCache.delete(oldestKey);
  }
  blobCache.set(key, objectUrl);
}

export function clearBlobCache() {
  blobCache.forEach((objectUrl) => {
    try {
      if (typeof objectUrl === 'string' && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {}
  });
  blobCache.clear();
}

export default function CoverImage({
  src,
  serverUrl = '',
  gameId = null,
  alt = '',
  className = 'w-full h-full object-cover',
  fallbackIconSize = 'w-6 h-6',
  fallbackTitle = ''
}) {
  const [imageSrc, setImageSrc] = useState(() => {
    if (!src) return null;
    const cached = getBlobCache(src);
    if (cached) return cached;
    // 不直接把网络 URL 顶进 <img>：<img> 一旦挂上 http 地址浏览器就会立刻发请求，
    // 离线时就是 N 个注定挂起的废请求。先空着（只显示加载占位），
    // 等 IndexedDB 查询结果再决定用缓存还是走网络（缓存优先，网络兜底）。
    return null;
  });
  const [hasError, setHasError] = useState(!src);
  const [loading, setLoading] = useState(Boolean(src) && !getBlobCache(src));
  const retryWithFetchRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;
    retryWithFetchRef.current = false;

    if (!src) {
      setImageSrc(null);
      setHasError(true);
      setLoading(false);
      if (serverUrl && gameId) {
        deleteCoverBlob(serverUrl, gameId).catch(() => {});
      }
      return;
    }

    // 1. 检查内存缓存 (精确匹配带版本号的完整 URL)
    const memCached = getBlobCache(src);
    if (memCached) {
      setImageSrc(memCached);
      setHasError(false);
      setLoading(false);
      return;
    }

    // 提取当前 URL 里的版本参数 ?v=...
    let currentVersion = '';
    try {
      const urlObj = new URL(src, 'http://localhost');
      currentVersion = urlObj.searchParams.get('v') || '';
    } catch {}

    // 2. 检查 IndexedDB 离线缓存
    const checkIndexedDb = async () => {
      if (serverUrl && gameId) {
        try {
          const cached = await getCoverBlobWithMeta(serverUrl, gameId);
          if (cached?.blob && !isCancelled) {
            const objectUrl = URL.createObjectURL(cached.blob);
            setBlobCache(src, objectUrl);
            setImageSrc(objectUrl);
            setHasError(false);
            setLoading(false);
            // 版本不一致（服务端有新版）：先展示旧缓存，再后台静默刷新（stale-while-revalidate）。
            // 在线则换为新图；离线/失败则保留旧图 —— 不再弃用缓存直接裂开。
            if (currentVersion && cached.version && cached.version !== currentVersion) {
              retryWithFetchRef.current = true;
              fetchAndCacheBlob(src);
            }
            return true;
          }
        } catch {}
      }
      return false;
    };

    checkIndexedDb().then((foundInIdb) => {
      if (foundInIdb || isCancelled) return;
      setImageSrc(src);
      setHasError(false);
      setLoading(true);
    });

    return () => {
      isCancelled = true;
    };
  }, [src, serverUrl, gameId]);

  // 从网络获取并存入 IndexedDB
  const fetchAndCacheBlob = async (url) => {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob && blob.size > 0) {
          let v = '';
          try {
            const u = new URL(url, 'http://localhost');
            v = u.searchParams.get('v') || '';
          } catch {}
          const objectUrl = URL.createObjectURL(blob);
          setBlobCache(url, objectUrl);
          if (serverUrl && gameId) {
            saveCoverBlob(serverUrl, gameId, blob, v);
          }
          setImageSrc(objectUrl);
          setHasError(false);
          setLoading(false);
          return true;
        }
      } else if (resp.status === 404) {
        if (serverUrl && gameId) {
          deleteCoverBlob(serverUrl, gameId).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('CoverImage fetch & cache failed:', err);
    }
    return false;
  };

  const handleImgError = async () => {
    // 发生图片加载失败，尝试 fetch 兜底
    if (!retryWithFetchRef.current && src) {
      retryWithFetchRef.current = true;
      const success = await fetchAndCacheBlob(src);
      if (success) return;
    }
    setHasError(true);
    setLoading(false);
  };

  const handleImgLoad = () => {
    setLoading(false);
    setHasError(false);
    // 当图片首次成功通过 <img> 加载后，异步在后台拉取 blob 存入 IndexedDB 供离线使用
    if (src && !imageSrc?.startsWith?.('blob:') && serverUrl && gameId) {
      let v = '';
      try {
        const u = new URL(src, 'http://localhost');
        v = u.searchParams.get('v') || '';
      } catch {}
      getCoverBlobWithMeta(serverUrl, gameId).then((existing) => {
        if (!existing || (v && existing.version !== v)) {
          fetch(src, { mode: 'cors' })
            .then((r) => (r.ok ? r.blob() : null))
            .then((blob) => {
              if (blob && blob.size > 0) {
                saveCoverBlob(serverUrl, gameId, blob, v);
              }
            })
            .catch(() => {});
        }
      });
    }
  };

  if ((!src && !imageSrc) || hasError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-gray-900/80">
        <ImageOff className={`${fallbackIconSize} text-gray-600 mb-1`} />
        {fallbackTitle && (
          <span className="text-[10px] text-gray-500 line-clamp-2 leading-tight">
            {fallbackTitle}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-gray-900">
      {imageSrc && (
        <img
          key={imageSrc}
          src={imageSrc}
          alt={alt}
          onLoad={handleImgLoad}
          onError={handleImgError}
          className={`${className} ${loading ? 'opacity-0' : 'opacity-100 transition-opacity duration-300'}`}
          loading="lazy"
          decoding="async"
        />
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 animate-pulse">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-500/40 border-t-indigo-400 animate-spin" />
        </div>
      )}
    </div>
  );
}
