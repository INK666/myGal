import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { deleteServerCache, clearAllCache } from '../utils/cacheStorage';
import { clearBlobCache } from '../components/CoverImage';
import { clearPendingChanges } from '../utils/syncQueue';

export const normalizeUrl = (urlStr) => {
  if (!urlStr) return '';
  let s = String(urlStr).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) {
    s = `http://${s}`;
  }
  try {
    const u = new URL(s);
    // 纯 IP 且没有显式指定端口，自动补充默认端口 37689
    if (!u.port && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(u.hostname)) {
      u.port = '37689';
      return u.origin;
    }
    return u.origin + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return s;
  }
};

export const isLanUrl = (urlStr) => {
  if (!urlStr) return false;
  try {
    const u = new URL(normalizeUrl(urlStr));
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.startsWith('192.168.')) return true;
    if (host.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
};

const ServerContext = createContext(null);

const STORAGE_KEYS = {
  SERVER_URL: 'mygal_server_url',
  TOKEN: 'mygal_server_token',
  PROFILES: 'mygal_server_profiles'
};

export function ServerProvider({ children }) {
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(STORAGE_KEYS.SERVER_URL) || '');
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEYS.TOKEN) || '');
  const [profiles, setProfiles] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROFILES) || '[]');
    } catch {
      return [];
    }
  });

  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serverInfo, setServerInfo] = useState(null);
  const [lastPing, setLastPing] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '', type: 'info' });

  const showToast = useCallback((message, type = 'info', duration = 3000) => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, duration);
  }, []);

  // 同步配置 ApiClient 底层容灾与备用地址
  useEffect(() => {
    const currentProfile = profiles.find(
      (p) =>
        (token && p.token === token) ||
        normalizeUrl(p.url) === normalizeUrl(serverUrl) ||
        normalizeUrl(p.primaryUrl) === normalizeUrl(serverUrl) ||
        normalizeUrl(p.backupUrl) === normalizeUrl(serverUrl)
    );

    const primary = currentProfile?.primaryUrl || serverUrl;
    const backup = currentProfile?.backupUrl || '';

    api.setFailoverConfig({
      primaryUrl: primary,
      backupUrl: backup,
      onFailover: (newActiveUrl) => {
        const clean = normalizeUrl(newActiveUrl);
        setServerUrl(clean);
        setConnected(true);
        localStorage.setItem(STORAGE_KEYS.SERVER_URL, clean);
        showToast(`主地址连接超时，已静默切换至备用地址 (${clean})`, 'info', 3000);
      }
    });
  }, [serverUrl, token, profiles, showToast]);

  // 保存连接成功的游戏库配置（自动支持多地址智能合并，同 Token 自动融合为同一游戏库）
  const saveConnectedProfile = useCallback((targetUrl, targetToken) => {
    const cleanUrl = normalizeUrl(targetUrl);
    setServerUrl(cleanUrl);
    setToken(targetToken);
    localStorage.setItem(STORAGE_KEYS.SERVER_URL, cleanUrl);
    localStorage.setItem(STORAGE_KEYS.TOKEN, targetToken);

    setProfiles((prev) => {
      // 1. 如果存在相同 Token 的游戏库，直接融合为该游戏库的多地址配置
      const existing = targetToken
        ? prev.find((p) => p.token === targetToken)
        : prev.find((p) => normalizeUrl(p.url) === cleanUrl);

      const filtered = prev.filter((p) => p !== existing);
      const isLan = isLanUrl(cleanUrl);

      let primaryUrl = existing?.primaryUrl || '';
      let backupUrl = existing?.backupUrl || '';

      if (isLan) {
        if (!primaryUrl) primaryUrl = cleanUrl;
      } else {
        if (!backupUrl) backupUrl = cleanUrl;
      }
      if (!primaryUrl && !backupUrl) {
        primaryUrl = cleanUrl;
      }

      const allUrls = Array.from(
        new Set([cleanUrl, primaryUrl, backupUrl, ...(existing?.urls || [])].filter(Boolean).map(normalizeUrl))
      );

      const updatedProfile = {
        id: existing?.id || `lib_${targetToken ? targetToken.slice(0, 16) : Date.now()}`,
        name: existing?.name || '',
        token: targetToken,
        url: cleanUrl,
        primaryUrl: primaryUrl || cleanUrl,
        backupUrl: backupUrl || '',
        urls: allUrls,
        gameCount: typeof existing?.gameCount === 'number' ? existing.gameCount : null,
        lastConnected: Date.now()
      };

      const next = [updatedProfile, ...filtered].slice(0, 10);
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(next));
      return next;
    });
  }, []);

  // 刷新当前连接（支持主地址失败时静默尝试备用地址，并支持回到家自动切回主地址）
  const testConnection = useCallback(
    async (
      targetUrl = serverUrl,
      targetToken = token,
      saveOnSuccess = true,
      silentFailover = true
    ) => {
      if (!targetUrl && !serverUrl) {
        setConnected(false);
        setServerInfo(null);
        setLastPing(null);
        return { success: false, error: '未配置服务地址' };
      }
      setChecking(true);
      setError(null);

      const matchedProfile = profiles.find(
        (p) =>
          (targetToken && p.token === targetToken) ||
          (p.token && p.token === token) ||
          normalizeUrl(p.url) === normalizeUrl(targetUrl) ||
          normalizeUrl(p.primaryUrl) === normalizeUrl(targetUrl) ||
          normalizeUrl(p.backupUrl) === normalizeUrl(targetUrl)
      );

      // 如果未指定特定 targetUrl 且开启静默容灾，优先尝试主地址（以便回到家后自动切回高速局域网）
      let cleanTargetUrl = normalizeUrl(targetUrl || serverUrl);
      if (
        silentFailover &&
        matchedProfile?.primaryUrl &&
        (!targetUrl || normalizeUrl(targetUrl) === normalizeUrl(serverUrl))
      ) {
        cleanTargetUrl = normalizeUrl(matchedProfile.primaryUrl);
      }

      const effectiveToken = targetToken || matchedProfile?.token || token;
      const start = performance.now();

      try {
        api.setCredentials(cleanTargetUrl, effectiveToken);
        const res = await api.checkHealth({ timeout: 2500 });
        const latency = Math.round(performance.now() - start);

        if (res?.success) {
          const wasDifferentUrl = normalizeUrl(serverUrl) !== cleanTargetUrl;
          setConnected(true);
          setServerInfo(res.data);
          setLastPing(latency);
          setError(null);

          if (saveOnSuccess) {
            saveConnectedProfile(cleanTargetUrl, effectiveToken);
          } else {
            setServerUrl(cleanTargetUrl);
            setToken(effectiveToken);
          }

          if (wasDifferentUrl && serverUrl) {
            showToast(`已自动连接至主地址 (${cleanTargetUrl})`, 'success', 2500);
          }
          return { success: true, latency, data: res.data };
        } else {
          throw new Error(res?.error || '连接响应异常');
        }
      } catch (err) {
        // 主地址连接失败且开启静默容灾：自动尝试备用地址连接同一个游戏库
        if (silentFailover && effectiveToken) {
          const candidates = [];
          if (matchedProfile) {
            const bUrl = normalizeUrl(matchedProfile.backupUrl);
            const pUrl = normalizeUrl(matchedProfile.primaryUrl);
            if (bUrl && bUrl !== cleanTargetUrl) candidates.push(bUrl);
            if (pUrl && pUrl !== cleanTargetUrl && !candidates.includes(pUrl)) candidates.push(pUrl);
            if (Array.isArray(matchedProfile.urls)) {
              for (const u of matchedProfile.urls) {
                const normU = normalizeUrl(u);
                if (normU && normU !== cleanTargetUrl && !candidates.includes(normU)) {
                  candidates.push(normU);
                }
              }
            }
          }

          for (const altUrl of candidates) {
            try {
              console.log(`[ServerContext] Target ${cleanTargetUrl} failed, silently trying backup: ${altUrl}...`);
              const altStart = performance.now();
              api.setCredentials(altUrl, effectiveToken);
              const altRes = await api.checkHealth({ timeout: 2500 });
              if (altRes?.success) {
                const altLatency = Math.round(performance.now() - altStart);
                setConnected(true);
                setServerInfo(altRes.data);
                setLastPing(altLatency);
                setError(null);

                if (saveOnSuccess) {
                  saveConnectedProfile(altUrl, effectiveToken);
                } else {
                  setServerUrl(altUrl);
                  setToken(effectiveToken);
                }
                showToast(`主地址连接超时，已静默切换至备用地址 (${altUrl})`, 'info', 3000);
                return { success: true, latency: altLatency, data: altRes.data, switchedTo: altUrl };
              }
            } catch {}
          }
        }

        setConnected(false);
        setServerInfo(null);
        setError(err.message || '无法连接到 PC 端服务');
        return { success: false, error: err.message };
      } finally {
        setChecking(false);
      }
    },
    [serverUrl, token, profiles, saveConnectedProfile, showToast]
  );

  // 从二维码内容解析并连接
  const connectWithQrPayload = useCallback(async (rawText) => {
    try {
      const candidateUrls = [];
      let tk = '';

      if (rawText.startsWith('{')) {
        const parsed = JSON.parse(rawText);
        tk = parsed.token || parsed.t || '';
        if (Array.isArray(parsed.urls) && parsed.urls.length > 0) {
          candidateUrls.push(...parsed.urls);
        }
        if (parsed.serverUrl && !candidateUrls.includes(parsed.serverUrl)) {
          candidateUrls.unshift(parsed.serverUrl);
        }
        if (parsed.url && !candidateUrls.includes(parsed.url)) {
          candidateUrls.push(parsed.url);
        }
        if (parsed.u && !candidateUrls.includes(parsed.u)) {
          candidateUrls.push(parsed.u);
        }
      } else if (rawText.startsWith('mygal://')) {
        const queryIndex = rawText.indexOf('?');
        const queryString = queryIndex !== -1 ? rawText.slice(queryIndex) : '';
        const searchParams = new URLSearchParams(queryString);
        const rawU = searchParams.get('u') || searchParams.get('url') || searchParams.get('urls') || '';
        tk = searchParams.get('t') || searchParams.get('token') || '';
        const port = searchParams.get('p') || searchParams.get('port') || '37689';

        const splitUrls = rawU.split(',').map((s) => s.trim()).filter(Boolean);
        for (const item of splitUrls) {
          if (!/^https?:\/\//i.test(item)) {
            candidateUrls.push(item.includes(':') ? `http://${item}` : `http://${item}:${port}`);
          } else {
            candidateUrls.push(item);
          }
        }
      } else if (/^https?:\/\//i.test(rawText)) {
        const u = new URL(rawText);
        tk = u.searchParams.get('token') || u.searchParams.get('t') || '';
        candidateUrls.push(u.origin);
      }

      const scoreCandidate = (urlStr) => {
        try {
          const u = new URL(urlStr);
          const host = u.hostname;
          if (host.startsWith('198.18.') || host.startsWith('169.254.') || host.startsWith('127.')) return 1;
          if (host.startsWith('192.168.')) return 100;
          if (host.startsWith('10.')) return 90;
          if (host.startsWith('172.')) return 80;
          return 50;
        } catch {
          return 10;
        }
      };

      const validCandidates = Array.from(new Set(candidateUrls.filter(Boolean))).sort(
        (a, b) => scoreCandidate(b) - scoreCandidate(a)
      );
      if (validCandidates.length === 0) {
        throw new Error('未识别到有效的 myGal 连接地址');
      }

      // 依次尝试所有候选 URL（优先尝试真实物理局域网 IP），哪个连通就用哪个
      let lastErr = '';
      for (const targetUrl of validCandidates) {
        const result = await testConnection(targetUrl, tk, true);
        if (result.success) {
          showToast(`配对成功！已连接到 PC 端 (${targetUrl})`, 'success');
          return true;
        } else {
          lastErr = result.error;
        }
      }

      showToast('配对失败：所有候选 IP 均未能连通 (' + lastErr + ')', 'error');
      return false;
    } catch (err) {
      showToast('二维码解析失败：' + err.message, 'error');
      return false;
    }
  }, [testConnection, showToast]);

  const removeProfile = useCallback((targetUrl) => {
    const cleanUrl = String(targetUrl || '').trim().replace(/\/+$/, '');
    let nextProfiles = [];
    setProfiles((prev) => {
      nextProfiles = prev.filter((p) => p.url !== cleanUrl);
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(nextProfiles));
      return nextProfiles;
    });

    // 同步彻底删除该服务器在 IndexedDB 中的全部离线游戏数据与封面图片及待同步队列
    deleteServerCache(cleanUrl);
    clearBlobCache();
    clearPendingChanges(cleanUrl);

    // 检查是否删除的是当前连接/活动的服务器
    const currentClean = String(serverUrl || '').trim().replace(/\/+$/, '');
    if (currentClean.toLowerCase() === cleanUrl.toLowerCase()) {
      if (nextProfiles.length > 0) {
        // 若还有其它已保存的 PC 端游戏库，切换至第一个
        const next = nextProfiles[0];
        setServerUrl(next.url);
        setToken(next.token || '');
        localStorage.setItem(STORAGE_KEYS.SERVER_URL, next.url);
        localStorage.setItem(STORAGE_KEYS.TOKEN, next.token || '');
        api.setCredentials(next.url, next.token || '');
        testConnection(next.url, next.token || '', true);
      } else {
        // 若已无任何游戏库，彻底重置当前连接状态
        setServerUrl('');
        setToken('');
        setConnected(false);
        setServerInfo(null);
        setLastPing(null);
        setError(null);
        localStorage.removeItem(STORAGE_KEYS.SERVER_URL);
        localStorage.removeItem(STORAGE_KEYS.TOKEN);
        api.setCredentials('', '');
      }
    }

    showToast('已删除该PC端游戏库并彻底清除其离线缓存', 'info');
  }, [serverUrl, testConnection, showToast]);

  const updateProfileGameCount = useCallback((targetUrl, count) => {
    const cleanUrl = String(targetUrl || '').trim().replace(/\/+$/, '');
    if (!cleanUrl) return;
    setProfiles((prev) => {
      const next = prev.map((p) => (p.url === cleanUrl ? { ...p, gameCount: count } : p));
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearProfiles = useCallback(() => {
    setProfiles([]);
    localStorage.removeItem(STORAGE_KEYS.PROFILES);
    setServerUrl('');
    setToken('');
    setConnected(false);
    setServerInfo(null);
    setLastPing(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEYS.SERVER_URL);
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    api.setCredentials('', '');
    // 清空本地全部 IndexedDB 缓存、内存 Blob 与待同步队列
    profiles.forEach((p) => p?.url && clearPendingChanges(p.url));
    if (serverUrl) clearPendingChanges(serverUrl);
    clearAllCache();
    clearBlobCache();
    showToast('已清空全部PC端游戏库与离线缓存', 'info');
  }, [showToast]);

  // 初始加载自动尝试连接一次
  useEffect(() => {
    if (serverUrl && token) {
      testConnection(serverUrl, token, false, true);
    }
  }, []);

  // 当网络恢复或应用切回前台时，自动探测连接（若回到家WiFi会自动静默切回高速主地址）
  useEffect(() => {
    const handleRecheck = () => {
      if (serverUrl && token) {
        testConnection(serverUrl, token, false, true);
      }
    };
    window.addEventListener('online', handleRecheck);
    window.addEventListener('focus', handleRecheck);
    return () => {
      window.removeEventListener('online', handleRecheck);
      window.removeEventListener('focus', handleRecheck);
    };
  }, [serverUrl, token, testConnection]);

  // 修改指定游戏库的备用 IP / 穿透域名
  const updateProfileBackupUrl = useCallback(
    (identifier, newBackupUrl) => {
      const cleanBackup = newBackupUrl ? normalizeUrl(newBackupUrl) : '';
      setProfiles((prev) => {
        const next = prev.map((p) => {
          const match =
            p.id === identifier ||
            p.token === identifier ||
            normalizeUrl(p.url) === normalizeUrl(identifier) ||
            normalizeUrl(p.primaryUrl) === normalizeUrl(identifier);
          if (!match) return p;

          const urls = Array.from(
            new Set([p.primaryUrl, cleanBackup, ...(p.urls || [])].filter(Boolean).map(normalizeUrl))
          );
          return {
            ...p,
            backupUrl: cleanBackup,
            urls
          };
        });
        localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(next));
        return next;
      });
      showToast(cleanBackup ? `已配置备用地址: ${cleanBackup}` : '已清除备用地址', 'success');
    },
    [showToast]
  );

  // 修改指定游戏库的主地址
  const updateProfilePrimaryUrl = useCallback(
    (identifier, newPrimaryUrl) => {
      const cleanPrimary = newPrimaryUrl ? normalizeUrl(newPrimaryUrl) : '';
      let isCurrent = false;
      let tokenToUse = '';

      setProfiles((prev) => {
        const next = prev.map((p) => {
          const match =
            p.id === identifier ||
            p.token === identifier ||
            normalizeUrl(p.url) === normalizeUrl(identifier) ||
            normalizeUrl(p.primaryUrl) === normalizeUrl(identifier);
          if (!match) return p;

          tokenToUse = p.token;
          if (
            normalizeUrl(serverUrl) === normalizeUrl(p.url) ||
            normalizeUrl(serverUrl) === normalizeUrl(p.primaryUrl)
          ) {
            isCurrent = true;
          }

          const urls = Array.from(
            new Set([cleanPrimary, p.backupUrl, ...(p.urls || [])].filter(Boolean).map(normalizeUrl))
          );
          return {
            ...p,
            primaryUrl: cleanPrimary,
            url: isCurrent ? cleanPrimary : p.url,
            urls
          };
        });
        localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(next));
        return next;
      });

      if (isCurrent && cleanPrimary) {
        setServerUrl(cleanPrimary);
        localStorage.setItem(STORAGE_KEYS.SERVER_URL, cleanPrimary);
        api.setCredentials(cleanPrimary, tokenToUse || token);
        testConnection(cleanPrimary, tokenToUse || token, true);
      }
      showToast(cleanPrimary ? `已更新主连接地址: ${cleanPrimary}` : '已清除主地址', 'success');
    },
    [serverUrl, token, testConnection, showToast]
  );

  // 在游戏库的主地址与备用地址之间一键切换
  const switchProfileActiveUrl = useCallback(
    async (identifier, targetUrl) => {
      const clean = normalizeUrl(targetUrl);
      const targetProfile = profiles.find(
        (p) =>
          p.id === identifier ||
          p.token === identifier ||
          normalizeUrl(p.url) === normalizeUrl(identifier) ||
          normalizeUrl(p.primaryUrl) === normalizeUrl(identifier)
      );
      if (!targetProfile) return { success: false, error: '未找到对应游戏库' };

      return await testConnection(clean, targetProfile.token, true, false);
    },
    [profiles, testConnection]
  );

  return (
    <ServerContext.Provider
      value={{
        serverUrl,
        token,
        profiles,
        connected,
        checking,
        serverInfo,
        lastPing,
        error,
        toast,
        showToast,
        setServerCredentials: (url, tk) => {
          const clean = normalizeUrl(url);
          setServerUrl(clean);
          setToken(tk);
          api.setCredentials(clean, tk);
          testConnection(clean, tk, true);
        },
        testConnection,
        connectWithQrPayload,
        removeProfile,
        clearProfiles,
        updateProfileGameCount,
        updateProfileBackupUrl,
        updateProfilePrimaryUrl,
        switchProfileActiveUrl
      }}
    >
      {children}
      {/* 全局 Toast */}
      {toast.show && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] pointer-events-none px-4 w-full max-w-sm">
          <div
            className={`px-4 py-3 rounded-2xl text-xs font-medium backdrop-blur-xl shadow-2xl flex items-center gap-2.5 animate-slide-up border ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/30'
                : toast.type === 'error'
                ? 'bg-red-950/90 text-red-300 border-red-500/30'
                : 'bg-indigo-950/90 text-indigo-300 border-indigo-500/30'
            }`}
          >
            <span className="shrink-0 text-sm">
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span className="flex-1 leading-snug">{toast.message}</span>
          </div>
        </div>
      )}
    </ServerContext.Provider>
  );
}

export function useServer() {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error('useServer must be used within a ServerProvider');
  }
  return context;
}
