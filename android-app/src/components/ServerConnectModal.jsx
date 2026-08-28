import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  QrCode,
  Globe,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Camera,
  History,
  Trash2,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { useServer } from '../contexts/ServerContext';

export default function ServerConnectModal({ isOpen, onClose }) {
  const {
    serverUrl,
    token,
    profiles,
    connected,
    checking,
    lastPing,
    error,
    testConnection,
    connectWithQrPayload,
    showToast
  } = useServer();

  const [activeTab, setActiveTab] = useState('scan'); // 'scan' | 'manual' | 'profiles'
  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [inputToken, setInputToken] = useState(token);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const scannerRef = useRef(null);

  useEffect(() => {
    setInputUrl(serverUrl);
    setInputToken(token);
  }, [serverUrl, token]);

  // QR Code Scanner Lifecycle
  useEffect(() => {
    if (!isOpen || activeTab !== 'scan') {
      stopScanner();
      return;
    }

    let isMounted = true;
    const startScanner = async () => {
      setScannerError(null);
      try {
        const qrId = 'mobile-qr-reader';
        const html5QrCode = new Html5Qrcode(qrId);
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          async (decodedText) => {
            if (!isMounted) return;
            stopScanner();
            const ok = await connectWithQrPayload(decodedText);
            if (ok) {
              onClose();
            }
          },
          (errorMessage) => {
            // Ignore scan errors (frame by frame)
          }
        );
        if (isMounted) setScannerActive(true);
      } catch (err) {
        if (isMounted) {
          setScannerError('无法启动相机：' + (err?.message || '请确保已授予相机权限'));
          setScannerActive(false);
        }
      }
    };

    const timer = setTimeout(startScanner, 300);
    return () => {
      isMounted = false;
      clearTimeout(timer);
      stopScanner();
    };
  }, [isOpen, activeTab]);

  const stopScanner = () => {
    if (scannerRef.current) {
      try {
        scannerRef.current.stop().then(() => {
          scannerRef.current?.clear();
          scannerRef.current = null;
        }).catch(() => {});
      } catch {}
    }
    setScannerActive(false);
  };

  const handleManualConnect = async (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) {
      showToast('请输入 PC 服务地址', 'error');
      return;
    }
    const res = await testConnection(inputUrl.trim(), inputToken.trim(), true);
    if (res.success) {
      showToast('连接成功！', 'success');
      onClose();
    } else {
      showToast('连接失败：' + res.error, 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-lg animate-fade-in">
      <div className="glass-modal rounded-[28px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">连接 PC 端 myGal</h3>
              <p className="text-[11px] text-gray-400">在电脑设置页查看二维码或地址</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="p-2 rounded-full bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 pb-2 flex gap-2 border-b border-white/5 bg-gray-950/40">
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'scan'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 bg-gray-900/60'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>扫码配对</span>
          </button>
          <button
            onClick={() => {
              stopScanner();
              setActiveTab('manual');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'manual'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 bg-gray-900/60'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>手动配置</span>
          </button>
          <button
            onClick={() => {
              stopScanner();
              setActiveTab('profiles');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'profiles'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 bg-gray-900/60'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>历史记录</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* --- Tab 1: QR Code Scanner --- */}
          {activeTab === 'scan' && (
            <div className="space-y-4">
              <div className="relative w-full aspect-square max-w-[280px] mx-auto rounded-2xl overflow-hidden bg-black/90 border border-white/10 flex items-center justify-center shadow-inner">
                <div id="mobile-qr-reader" className="w-full h-full" />
                {scannerError && (
                  <div className="absolute inset-0 p-4 bg-gray-900/95 flex flex-col items-center justify-center text-center space-y-2 text-xs">
                    <AlertCircle className="w-8 h-8 text-amber-400" />
                    <p className="text-gray-300">{scannerError}</p>
                    <button
                      onClick={() => setActiveTab('manual')}
                      className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium mt-2"
                    >
                      切换到手动输入
                    </button>
                  </div>
                )}
              </div>

              <div className="text-center text-xs text-gray-400 space-y-1">
                <p className="font-medium text-gray-200">打开电脑端 myGal → 设置 → 移动端数据 API</p>
                <p className="text-[11px] text-gray-500">
                  确保手机与电脑处于同一 WiFi 局域网下
                </p>
              </div>
            </div>
          )}

          {/* --- Tab 2: Manual Config --- */}
          {activeTab === 'manual' && (
            <form onSubmit={handleManualConnect} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  <span>PC 端服务地址 (URL)</span>
                </label>
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="http://192.168.1.100:37689 或穿透域名"
                  className="w-full bg-gray-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  局域网示例：http://192.168.x.x:37689 或外网 HTTPS 穿透地址
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                  <span>API 访问 Token</span>
                </label>
                <input
                  type="password"
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  placeholder="粘贴 PC 端设置页中的 Token"
                  className="w-full bg-gray-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={checking}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {checking ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>测试连接中...</span>
                  </>
                ) : (
                  <>
                    <span>测试并保存连接</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* --- Tab 3: Saved Profiles --- */}
          {activeTab === 'profiles' && (
            <div className="space-y-3">
              {profiles.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500">
                  暂无已保存的历史连接
                </div>
              ) : (
                profiles.map((p, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      testConnection(p.url, p.token, true);
                      onClose();
                    }}
                    className="glass-panel hover:bg-gray-850 p-3.5 rounded-2xl flex items-center justify-between cursor-pointer active-press border border-white/5"
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="font-bold text-xs text-white truncate">{p.name || 'myGal PC'}</div>
                      <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">{p.url}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 shrink-0">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Current Status Box */}
          <div className="p-3.5 rounded-2xl bg-gray-900/60 border border-white/5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-gray-300 font-medium">
                {connected ? `已连接 (${lastPing}ms)` : '当前未连接'}
              </span>
            </div>
            {connected && (
              <span className="text-[11px] text-emerald-400 font-mono font-semibold">ONLINE</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
