import React, { useState, useEffect, useRef } from 'react';
import { ImageOff } from 'lucide-react';
import { getCoverBlob, saveCoverBlob } from '../utils/cacheStorage';

// 内存 Blob URL 缓存，避免重复请求与内存泄漏
const blobCache = new Map();

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
    if (blobCache.has(src)) return blobCache.get(src);
    return src;
  });
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(!src || !blobCache.has(src));
  const retryWithFetchRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;
    retryWithFetchRef.current = false;

    if (!src && !gameId) {
      setImageSrc(null);
      setHasError(true);
      setLoading(false);
      return;
    }

    // 1. 检查内存缓存
    if (src && blobCache.has(src)) {
      setImageSrc(blobCache.get(src));
      setHasError(false);
      setLoading(false);
      return;
    }

    // 2. 检查 IndexedDB 离线缓存
    const checkIndexedDb = async () => {
      if (serverUrl && gameId) {
        try {
          const cachedBlob = await getCoverBlob(serverUrl, gameId);
          if (cachedBlob && !isCancelled) {
            const objectUrl = URL.createObjectURL(cachedBlob);
            if (src) blobCache.set(src, objectUrl);
            setImageSrc(objectUrl);
            setHasError(false);
            setLoading(false);
            return true;
          }
        } catch {}
      }
      return false;
    };

    checkIndexedDb().then((foundInIdb) => {
      if (foundInIdb || isCancelled) return;
      if (src) {
        setImageSrc(src);
        setHasError(false);
        setLoading(true);
      } else {
        setHasError(true);
        setLoading(false);
      }
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
          const objectUrl = URL.createObjectURL(blob);
          blobCache.set(url, objectUrl);
          if (serverUrl && gameId) {
            saveCoverBlob(serverUrl, gameId, blob);
          }
          setImageSrc(objectUrl);
          setHasError(false);
          setLoading(false);
          return true;
        }
      }
    } catch (err) {
      console.warn('CoverImage fetch & cache failed:', err);
    }
    return false;
  };

  const handleImgError = async () => {
    // 发生图片加载失败（可能因网络断开、跨域或 WebView 拦截），尝试 fetch 兜底
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
    if (src && !imageSrc.startsWith('blob:') && serverUrl && gameId) {
      getCoverBlob(serverUrl, gameId).then((existing) => {
        if (!existing) {
          fetch(src, { mode: 'cors' })
            .then((r) => (r.ok ? r.blob() : null))
            .then((blob) => {
              if (blob && blob.size > 0) {
                saveCoverBlob(serverUrl, gameId, blob);
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
      <img
        key={imageSrc}
        src={imageSrc}
        alt={alt}
        onLoad={handleImgLoad}
        onError={handleImgError}
        className={`${className} ${loading ? 'opacity-0' : 'opacity-100 transition-opacity duration-300'}`}
        loading="lazy"
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 animate-pulse">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-500/40 border-t-indigo-400 animate-spin" />
        </div>
      )}
    </div>
  );
}
