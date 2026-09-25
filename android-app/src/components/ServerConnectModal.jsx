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
  Monitor,
  Trash2,
  ArrowRight,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Plus,
  Pencil,
  Check,
  Link2
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { useServer, isLanUrl, normalizeUrl } from '../contexts/ServerContext';
import { decodeQrFromImage } from '../utils/qrDecoder';
import { getServerCache } from '../utils/cacheStorage';
import { api } from '../api/client';

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
    updateProfileBackupUrl,
    updateProfilePrimaryUrl,
    switchProfileActiveUrl,
    showToast
  } = useServer();

  const [activeTab, setActiveTab] = useState(() => (profiles.length > 0 ? 'profiles' : 'scan')); // 'scan' | 'manual' | 'profiles'
  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [inputBackupUrl, setInputBackupUrl] = useState('');
  const [inputToken, setInputToken] = useState(token);
  const [showToken, setShowToken] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const [decodingFile, setDecodingFile] = useState(false);
  const [profileStats, setProfileStats] = useState({});
  const [editingBackupProfileId, setEditingBackupProfileId] = useState(null);
  const [backupInputVal, setBackupInputVal] = useState('');
  const [testingBackup, setTestingBackup] = useState(false);
  const [editingPrimaryProfileId, setEditingPrimaryProfileId] = useState(null);
  const [primaryInputVal, setPrimaryInputVal] = useState('');
  const [testingPrimary, setTestingPrimary] = useState(false);
  const scannerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      if (profiles.length > 0 && activeTab === 'scan') {
        setActiveTab('profiles');
      }
    }
  }, [isOpen, profiles.length]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'profiles') return;
    let isMounted = true;
    const loadStats = async () => {
      const statsMap = {};
      for (const p of profiles) {
        try {
          const cache = await getServerCache(p.url);
          if (cache) {
            statsMap[p.url] = typeof cache.total === 'number' ? cache.total : (cache.games?.length || 0);
          }
        } catch {}
      }
      if (isMounted) {
        setProfileStats(statsMap);
      }
    };
    loadStats();
    return () => {
      isMounted = false;
    };
  }, [isOpen, activeTab, profiles]);

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
    setDecodingFile(true);
    try {
      showToast('正在识别图片中二维码...', 'info');
      const decodedText = await decodeQrFromImage(file);
      showToast('已成功识别二维码，正在连接...', 'info');
      const ok = await connectWithQrPayload(decodedText);
      if (ok) {
        stopScanner();
        onClose();
      }
    } catch (err) {
      showToast(err?.message || '未能从所选图片中识别出有效二维码', 'error');
    } finally {
      setDecodingFile(false);
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
    const cleanPrimary = normalizeUrl(inputUrl.trim());
    const cleanToken = inputToken.trim();
    const res = await testConnection(cleanPrimary, cleanToken, true);
    if (res.success) {
      if (inputBackupUrl.trim()) {
        updateProfileBackupUrl(cleanToken || cleanPrimary, inputBackupUrl.trim());
      }
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
            <Monitor className="w-3.5 h-3.5" />
            <span>PC端游戏库</span>
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
                  disabled={decodingFile}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-900/80 hover:bg-gray-800 border border-white/10 text-gray-200 hover:text-white text-xs font-medium flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {decodingFile ? (
                    <>
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      <span>正在识别图片二维码...</span>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 text-indigo-400" />
                      <span>从手机相册 / 截图识别二维码</span>
                    </>
                  )}
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
                  <span>主连接地址 (局域网 IP 或常用地址)</span>
                </label>
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="http://192.168.1.100:37689"
                  className="w-full bg-gray-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  在家里通过 WiFi 直连时使用，响应极快、无需穿透流量
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>备用 / 内网穿透地址 (可选)</span>
                </label>
                <input
                  type="text"
                  value={inputBackupUrl}
                  onChange={(e) => setInputBackupUrl(e.target.value)}
                  placeholder="http://frp.mygal.com:12345 或备用 IP"
                  className="w-full bg-gray-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  当主地址无法连接（如离开家）时，系统将静默尝试此地址自动连接同一个游戏库
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
                  <span className="text-[11px] text-gray-400">已保存 {profiles.length} 个 PC端游戏库</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearProfiles();
                    }}
                    className="text-[11px] text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>清空全部游戏库与缓存</span>
                  </button>
                </div>
              )}
              {profiles.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500">
                  暂无已保存的 PC端游戏库
                </div>
              ) : (
                profiles.map((p, idx) => {
                  const normActive = normalizeUrl(serverUrl);
                  const isCurrent =
                    normActive === normalizeUrl(p.url) ||
                    normActive === normalizeUrl(p.primaryUrl) ||
                    normActive === normalizeUrl(p.backupUrl);

                  const count =
                    typeof profileStats[p.url] === 'number'
                      ? profileStats[p.url]
                      : typeof p.gameCount === 'number'
                      ? p.gameCount
                      : null;

                  const primary = p.primaryUrl || p.url;
                  const backup = p.backupUrl || '';
                  const isPrimaryActive = normActive === normalizeUrl(primary);
                  const isBackupActive = Boolean(backup && normActive === normalizeUrl(backup));
                  const isEditingBackup = editingBackupProfileId === (p.id || p.token || p.url);
                  const isEditingPrimary = editingPrimaryProfileId === (p.id || p.token || p.url);

                  return (
                    <div
                      key={p.id || idx}
                      className={`glass-panel p-3.5 rounded-2xl flex flex-col gap-2.5 border transition-all ${
                        isCurrent ? 'border-indigo-500/40 bg-indigo-950/20' : 'border-white/5'
                      }`}
                    >
                      {/* Library Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-white">
                            {count !== null ? `${count} 款游戏` : 'PC端游戏库'}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-medium font-mono">
                              当前使用中
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeProfile(p.url)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          title="删除此PC端游戏库及缓存"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Primary Address Row */}
                      <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-gray-900/80 border border-white/5 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-300 font-medium">
                              主地址 {isLanUrl(primary) ? '(局域网)' : ''}
                            </span>
                            {isPrimaryActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-gray-300 truncate">
                            {primary}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={isPrimaryActive && connected}
                            onClick={() => switchProfileActiveUrl(p.id, primary)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                              isPrimaryActive && connected
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
                            }`}
                          >
                            {isPrimaryActive && connected ? '连接中' : '连接/切换'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPrimaryProfileId(p.id || p.token || p.url);
                              setPrimaryInputVal(primary);
                            }}
                            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                            title="修改主地址"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Inline Primary Address Editor */}
                      {isEditingPrimary && (
                        <div className="p-2.5 rounded-xl bg-gray-950 border border-blue-500/40 space-y-2 animate-fade-in">
                          <div className="flex items-center justify-between text-[11px] font-medium text-blue-300">
                            <span>修改主地址 (局域网)</span>
                            <span className="text-[10px] text-gray-400">优先使用此地址直连</span>
                          </div>
                          <input
                            type="text"
                            autoFocus
                            value={primaryInputVal}
                            onChange={(e) => setPrimaryInputVal(e.target.value)}
                            placeholder="如: http://192.168.1.100:37689"
                            className="w-full bg-gray-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                          />
                          <div className="flex items-center justify-end gap-1.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() => setEditingPrimaryProfileId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] text-gray-400 hover:text-white bg-gray-850"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={testingPrimary}
                              onClick={async () => {
                                const clean = primaryInputVal.trim();
                                if (!clean) {
                                  showToast('主地址不能为空', 'error');
                                  return;
                                }
                                setTestingPrimary(true);
                                try {
                                  const normalized = normalizeUrl(clean);
                                  api.setCredentials(normalized, p.token);
                                  const checkRes = await api.checkHealth({ timeout: 2500 });
                                  if (checkRes?.success) {
                                    showToast('主地址连通成功！已更新保存', 'success');
                                  } else {
                                    showToast('主地址当前未连通，已更新保存（网络畅通时生效）', 'info');
                                  }
                                } catch {
                                  showToast('主地址当前未连通，已更新保存', 'info');
                                } finally {
                                  updateProfilePrimaryUrl(p.id, clean);
                                  setEditingPrimaryProfileId(null);
                                  setTestingPrimary(false);
                                }
                              }}
                              className="px-3 py-1 rounded-lg text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-1 disabled:opacity-50"
                            >
                              {testingPrimary ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3" />
                              )}
                              <span>{testingPrimary ? '测试连通中...' : '测试并保存'}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Backup Address Row */}
                      {backup ? (
                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-gray-900/80 border border-purple-500/20 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-medium">
                                备用地址 {isLanUrl(backup) ? '' : '(内网穿透)'}
                              </span>
                              {isBackupActive && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-gray-300 truncate">
                              {backup}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={isBackupActive && connected}
                              onClick={() => switchProfileActiveUrl(p.id, backup)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                                isBackupActive && connected
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
                              }`}
                            >
                              {isBackupActive && connected ? '连接中' : '连接/切换'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingBackupProfileId(p.id || p.token || p.url);
                                setBackupInputVal(backup);
                              }}
                              className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                              title="修改备用地址"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => updateProfileBackupUrl(p.id, '')}
                              className="p-1 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
                              title="移除备用地址"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : !isEditingBackup ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBackupProfileId(p.id || p.token || p.url);
                            setBackupInputVal('');
                          }}
                          className="w-full py-1.5 px-3 rounded-xl border border-dashed border-purple-500/30 hover:border-purple-500/60 bg-purple-950/10 hover:bg-purple-950/20 text-purple-300 hover:text-purple-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>添加备用 IP / 内网穿透域名</span>
                        </button>
                      ) : null}

                      {/* Inline Backup Address Editor */}
                      {isEditingBackup && (
                        <div className="p-2.5 rounded-xl bg-gray-950 border border-purple-500/40 space-y-2 animate-fade-in">
                          <div className="flex items-center justify-between text-[11px] font-medium text-purple-300">
                            <span>配置备用 IP / 穿透地址</span>
                            <span className="text-[10px] text-gray-400">主地址不通时将静默尝试</span>
                          </div>
                          <input
                            type="text"
                            autoFocus
                            value={backupInputVal}
                            onChange={(e) => setBackupInputVal(e.target.value)}
                            placeholder="如: http://frp.mygal.com:12345 或备用 IP"
                            className="w-full bg-gray-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                          />
                          <div className="flex items-center justify-end gap-1.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() => setEditingBackupProfileId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] text-gray-400 hover:text-white bg-gray-850"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={testingBackup}
                              onClick={async () => {
                                const clean = backupInputVal.trim();
                                if (!clean) {
                                  updateProfileBackupUrl(p.id, '');
                                  setEditingBackupProfileId(null);
                                  return;
                                }
                                setTestingBackup(true);
                                try {
                                  const normalized = normalizeUrl(clean);
                                  api.setCredentials(normalized, p.token);
                                  const checkRes = await api.checkHealth({ timeout: 2500 });
                                  if (checkRes?.success) {
                                    showToast('备用地址连通成功！已保存', 'success');
                                  } else {
                                    showToast('备用地址当前未能连通，但已保存（网络畅通时自动启用）', 'info');
                                  }
                                } catch {
                                  showToast('备用地址当前未能连通，但已保存', 'info');
                                } finally {
                                  updateProfileBackupUrl(p.id, clean);
                                  setEditingBackupProfileId(null);
                                  setTestingBackup(false);
                                }
                              }}
                              className="px-3 py-1 rounded-lg text-[11px] font-medium text-white bg-purple-600 hover:bg-purple-500 flex items-center gap-1 disabled:opacity-50"
                            >
                              {testingBackup ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3" />
                              )}
                              <span>{testingBackup ? '测试连通中...' : '测试并保存'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
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
