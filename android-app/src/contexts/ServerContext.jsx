import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { deleteServerCache, clearAllCache } from '../utils/cacheStorage';

const ServerContext = createContext(null);

const STORAGE_KEYS = {
  SERVER_URL: 'mygal_server_url',
  TOKEN: 'mygal_server_token',
  PROFILES: 'mygal_server_profiles'
};

export function ServerProvider({ children }) {
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(STORAGE_KEYS.SERVER_URL) || 'http://192.168.1.100:37689');
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

  // 刷新当前连接
  const testConnection = useCallback(async (targetUrl = serverUrl, targetToken = token, saveOnSuccess = true) => {
    setChecking(true);
    setError(null);
    const start = performance.now();
    try {
      api.setCredentials(targetUrl, targetToken);
      const res = await api.checkHealth();
      const latency = Math.round(performance.now() - start);

      if (res?.success) {
        setConnected(true);
        setServerInfo(res.data);
        setLastPing(latency);
        setError(null);

        if (saveOnSuccess) {
          setServerUrl(targetUrl);
          setToken(targetToken);
          localStorage.setItem(STORAGE_KEYS.SERVER_URL, targetUrl);
          localStorage.setItem(STORAGE_KEYS.TOKEN, targetToken);

          // 更新配置列表
          setProfiles((prev) => {
            const cleanUrl = targetUrl.trim().replace(/\/+$/, '');
            const filtered = prev.filter((p) => p.url !== cleanUrl);
            const next = [
              { url: cleanUrl, token: targetToken, name: res.data?.app || 'myGal PC', lastConnected: Date.now() },
              ...filtered
            ].slice(0, 10);
            localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(next));
            return next;
          });
        }
        return { success: true, latency, data: res.data };
      } else {
        throw new Error(res?.error || '连接响应异常');
      }
    } catch (err) {
      setConnected(false);
      setServerInfo(null);
      setError(err.message || '无法连接到 PC 端服务');
      return { success: false, error: err.message };
    } finally {
      setChecking(false);
    }
  }, [serverUrl, token]);

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
    setProfiles((prev) => {
      const next = prev.filter((p) => p.url !== cleanUrl);
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(next));
      return next;
    });
    // 同步彻底删除该服务器在 IndexedDB 中的全部离线游戏数据与封面图片
    deleteServerCache(cleanUrl);
    showToast('已删除连接记录并清空其离线缓存', 'info');
  }, [showToast]);

  const clearProfiles = useCallback(() => {
    setProfiles([]);
    localStorage.removeItem(STORAGE_KEYS.PROFILES);
    // 清空本地全部 IndexedDB 缓存
    clearAllCache();
    showToast('已清空全部历史记录与离线缓存', 'info');
  }, [showToast]);

  // 初始加载自动尝试连接一次
  useEffect(() => {
    if (serverUrl && token) {
      testConnection(serverUrl, token, false);
    }
  }, []);

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
          setServerUrl(url);
          setToken(tk);
          api.setCredentials(url, tk);
          testConnection(url, tk, true);
        },
        testConnection,
        connectWithQrPayload,
        removeProfile,
        clearProfiles
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
