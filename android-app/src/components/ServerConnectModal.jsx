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
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon
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
    removeProfile,
    clearProfiles,
    showToast
  } = useServer();

  const [activeTab, setActiveTab] = useState('scan'); // 'scan' | 'manual' | 'profiles'
  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [inputToken, setInputToken] = useState(token);
  const [showToken, setShowToken] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const scannerRef = useRef(null);
  const fileInputRef = useRef(null);

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
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const edge = Math.max(180, Math.floor(minEdge * 0.75));
              return { width: edge, height: edge };
            },
            aspectRatio: 1.0
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

  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showToast('正在识别图片中二维码...', 'info');
      let qrScanner = scannerRef.current;
      if (!qrScanner) {
        qrScanner = new Html5Qrcode('mobile-qr-reader');
      }
      const decodedText = await qrScanner.scanFile(file, true);
      const ok = await connectWithQrPayload(decodedText);
      if (ok) {
        onClose();
      }
    } catch (err) {
      showToast('未能从所选图片中识别出有效二维码', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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

              <div className="flex flex-col items-center gap-2 pt-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleScanFile}
                  accept="image/*"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-900/80 hover:bg-gray-800 border border-white/10 text-gray-200 hover:text-white text-xs font-medium flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95"
                >
                  <ImageIcon className="w-4 h-4 text-indigo-400" />
                  <span>从手机相册 / 截图识别二维码</span>
                </button>
              </div>

              <div className="text-center text-xs text-gray-400 space-y-1">
                <p className="font-medium text-gray-200">电脑端已生成大方块易扫二维码（可点击放大）</p>
                <p className="text-[11px] text-gray-500">
                  若环境光线较暗或对焦困难，亦可拍照截图后直接在此选图
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
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={inputToken}
                    onChange={(e) => setInputToken(e.target.value)}
                    placeholder="粘贴 PC 端设置页中的 Token"
                    className="w-full bg-gray-900 border border-white/10 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-gray-400 hover:text-white transition-colors"
                    title={showToken ? "隐藏 Token" : "显示 Token"}
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
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
              {profiles.length > 0 && (
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[11px] text-gray-400">已保存 {profiles.length} 条记录</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearProfiles();
                    }}
                    className="text-[11px] text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>清空历史与缓存</span>
                  </button>
                </div>
              )}
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
                    className="glass-panel hover:bg-gray-850 p-3.5 rounded-2xl flex items-center justify-between cursor-pointer active-press border border-white/5 transition-all group"
                  >
                    <div className="min-w-0 flex-1 mr-2">
                      <div className="font-bold text-xs text-white truncate">{p.name || 'myGal PC'}</div>
                      <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">{p.url}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProfile(p.url);
                        }}
                        className="p-2 rounded-xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="删除此记录及缓存"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        <ArrowRight className="w-4 h-4" />
                      </div>
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
