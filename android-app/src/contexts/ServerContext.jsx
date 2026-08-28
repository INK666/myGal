import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

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
      let url = '';
      let tk = '';

      if (rawText.startsWith('{')) {
        const parsed = JSON.parse(rawText);
        url = parsed.serverUrl || parsed.url || '';
        tk = parsed.token || '';
      } else if (rawText.startsWith('mygal://')) {
        const u = new URL(rawText);
        url = u.searchParams.get('url') || '';
        tk = u.searchParams.get('token') || '';
      } else if (/^https?:\/\//i.test(rawText)) {
        const u = new URL(rawText);
        tk = u.searchParams.get('token') || '';
        url = u.origin;
      }

      if (!url) {
        throw new Error('未识别到有效的 myGal 连接地址');
      }

      const result = await testConnection(url, tk, true);
      if (result.success) {
        showToast('配对成功！已连接到 PC 端 myGal', 'success');
        return true;
      } else {
        showToast('配对失败：' + result.error, 'error');
        return false;
      }
    } catch (err) {
      showToast('二维码解析失败：' + err.message, 'error');
      return false;
    }
  }, [testConnection, showToast]);

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
        connectWithQrPayload
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
