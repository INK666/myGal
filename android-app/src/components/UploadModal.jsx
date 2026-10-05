import React, { useState, useEffect } from 'react';
import {
  X,
  Upload,
  FolderTree,
  FileArchive,
  File as FileIcon,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Trash2,
  HardDrive,
  Info,
  Ban,
  RefreshCw
} from 'lucide-react';
import { api } from '../api/client';
import { useServer } from '../contexts/ServerContext';
import { uploadManager } from '../utils/uploadManager';

export default function UploadModal({ isOpen, onClose }) {
  const { showToast, connected } = useServer();
  const [rootPaths, setRootPaths] = useState([]);
  const [selectedRootId, setSelectedRootId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [picked, setPicked] = useState(null); // { uri, fileName, fileSize }
  const [picking, setPicking] = useState(false);
  const [loadingRoots, setLoadingRoots] = useState(false);
  const [uploadAllowed, setUploadAllowed] = useState(null); // null=未知, true/false
  const [checkingPerm, setCheckingPerm] = useState(false);

  // 订阅上传任务（带签名短路：原生每块 16MB 完成就 emit 一次，局域网下约每秒 3~5 次，
  // 无变化时跳过 setState，避免弹窗整体高频重渲染）
  useEffect(() => {
    if (!isOpen) return;
    let lastSig = null;
    return uploadManager.subscribe((list) => {
      const sig = JSON.stringify(
        list.map((t) => [t.id, t.status, t.progress, t.uploadedBytes, t.totalBytes, t.speed, t.statusMessage])
      );
      if (lastSig !== null && sig === lastSig) return;
      lastSig = sig;
      setTasks(list);
    });
  }, [isOpen]);

  // 打开时：探测 PC 端上传开关 + 拉根目录列表
  useEffect(() => {
    if (!isOpen) return;
    setPicked(null);
    loadRootPaths();
    checkUploadPermission();
  }, [isOpen, connected]);

  const checkUploadPermission = async () => {
    setCheckingPerm(true);
    try {
      const { allowUpload } = await api.getUploadAvailability();
      setUploadAllowed(allowUpload);
    } catch (err) {
      setUploadAllowed(null); // 探测失败（离线等），交给实际申请时报错
    } finally {
      setCheckingPerm(false);
    }
  };

  const loadRootPaths = async () => {
    setLoadingRoots(true);
    try {
      const data = await api.getRootPaths();
      const list = Array.isArray(data) ? data : [];
      setRootPaths(list);
      if (list.length > 0) {
        const saved = Number(localStorage.getItem('mygal_upload_root_id'));
        const savedValid = list.some((r) => r.id === saved);
        setSelectedRootId(savedValid ? saved : list[0].id);
      }
    } catch (err) {
      console.warn('[UploadModal] 获取根目录失败:', err);
      showToast('获取 PC 端根目录失败: ' + (err.message || ''), 'error');
    } finally {
      setLoadingRoots(false);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const handlePick = async () => {
    setPicking(true);
    try {
      const res = await uploadManager.pickFile();
      setPicked(res);
    } catch (err) {
      // 用户取消选择不算错误
      const msg = err?.message || String(err);
      if (!/未选择文件|cancel/i.test(msg)) {
        showToast(msg, 'error');
      }
    } finally {
      setPicking(false);
    }
  };

  const handleStart = async () => {
    if (!picked) return;
    if (!connected) {
      showToast('未连接 PC 端，请先在右上角连接', 'error');
      return;
    }
    const root = rootPaths.find((r) => r.id === selectedRootId);
    if (!root) {
      showToast('请先选择上传到的根目录', 'error');
      return;
    }
    try {
      localStorage.setItem('mygal_upload_root_id', String(selectedRootId));
      await uploadManager.startUpload({
        uri: picked.uri,
        fileName: picked.fileName,
        fileSize: picked.fileSize,
        rootPathId: selectedRootId,
        rootPathLabel: root.path || root.name
      });
      setPicked(null);
      showToast('已开始上传', 'success');
    } catch (err) {
      // startUpload 已把错误写进任务，这里只提示
      showToast(uploadManager.humanizeError(err), 'error');
    }
  };

  const statusMeta = (task) => {
    switch (task.status) {
      case 'PENDING':
        return { label: '准备中', cls: 'text-sky-400', icon: Loader2, spin: true };
      case 'UPLOADING':
        return { label: `上传中 ${task.progress || 0}%`, cls: 'text-indigo-400', icon: Loader2, spin: true };
      case 'COMPLETED':
        return { label: '已完成', cls: 'text-green-400', icon: CheckCircle2, spin: false };
      case 'PAUSED':
        return { label: '已暂停', cls: 'text-amber-400', icon: Pause, spin: false };
      case 'FAILED':
        return { label: '失败', cls: 'text-red-400', icon: AlertCircle, spin: false };
      case 'CANCELLED':
        return { label: '已取消', cls: 'text-gray-400', icon: Ban, spin: false };
      default:
        return { label: task.status, cls: 'text-gray-400', icon: Info, spin: false };
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="glass-modal rounded-[28px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-green-500/10 border border-green-500/20">
              <Upload className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">上传游戏到 PC</h3>
              <p className="text-[10px] text-gray-500">每次只能上传 1 个文件</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-4">
          {/* PC 端上传许可状态 */}
          {uploadAllowed === false && (
            <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-200/90 leading-relaxed">
                <span className="font-semibold text-amber-300">PC 端未开启上传许可</span>
                <br />
                请在 PC 端「设置 → 局域网 API」中开启「允许移动端上传」后重试。
                <button
                  onClick={checkUploadPermission}
                  className="ml-1 inline-flex items-center gap-1 text-amber-300 underline active-press"
                >
                  <RefreshCw className={`w-3 h-3 ${checkingPerm ? 'animate-spin' : ''}`} />
                  重新检测
                </button>
              </div>
            </div>
          )}

          {/* 1. 选择目标根目录 */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 mb-2">
              <FolderTree className="w-3.5 h-3.5" />
              上传到哪个根目录
            </label>
            {loadingRoots ? (
              <div className="flex items-center gap-2 text-[11px] text-gray-500 py-2">
                <Loader2 className="w-3 h-3 animate-spin" /> 正在获取 PC 端根目录...
              </div>
            ) : rootPaths.length === 0 ? (
              <div className="text-[11px] text-gray-500 py-2">
                PC 端还没有配置根目录，请先在 PC 端添加游戏根目录。
              </div>
            ) : (
              <div className="space-y-1.5">
                {rootPaths.map((rp) => {
                  const active = rp.id === selectedRootId;
                  return (
                    <button
                      key={rp.id}
                      onClick={() => setSelectedRootId(rp.id)}
                      className={`w-full text-left px-3 py-2 rounded-2xl border transition-all active-press flex items-start gap-2 ${
                        active
                          ? 'bg-indigo-500/15 border-indigo-500/40'
                          : 'bg-gray-900/60 border-white/5 hover:bg-gray-800/60'
                      }`}
                    >
                      <HardDrive className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${active ? 'text-indigo-400' : 'text-gray-500'}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`text-[11px] font-medium truncate ${active ? 'text-indigo-200' : 'text-gray-300'}`}>
                          {rp.name || rp.path}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">{rp.path}</div>
                      </div>
                      {active && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
                <p className="text-[10px] text-gray-600 pl-1 leading-relaxed">
                  PC 端会在该根目录下新建一个<span className="text-gray-400">同名文件夹</span>，文件存在里面（如
                  <span className="text-gray-400"> 游戏名.7z/游戏名.7z</span>），解压后即可直接入库
                </p>
              </div>
            )}
          </div>

          {/* 2. 选择文件 */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 mb-2">
              <FileArchive className="w-3.5 h-3.5" />
              选择文件
            </label>
            {picked ? (
              <div className="flex items-center gap-2 p-3 rounded-2xl bg-gray-900/60 border border-white/5">
                <FileIcon className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-white truncate">{picked.fileName}</div>
                  <div className="text-[10px] text-gray-500">{formatSize(picked.fileSize)}</div>
                </div>
                <button
                  onClick={() => setPicked(null)}
                  className="p-1 rounded-lg text-gray-500 hover:text-white active-press"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={handlePick}
                disabled={picking}
                className="w-full py-3 rounded-2xl bg-green-500/10 border border-green-500/25 text-green-300 text-xs font-medium flex items-center justify-center gap-2 active-press disabled:opacity-50"
              >
                {picking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {picking ? '正在打开选择器...' : '选择文件上传'}
              </button>
            )}
            <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
              · 一次只能上传 1 个文件，文件夹请先压缩后再上传
              <br />
              · 大文件支持断点续传，中途断网不用从头再来
            </p>
          </div>

          {/* 开始按钮 */}
          {picked && (
            <button
              onClick={handleStart}
              disabled={!connected || rootPaths.length === 0}
              className="w-full py-3 rounded-2xl bg-green-500 text-white text-xs font-semibold flex items-center justify-center gap-2 active-press disabled:opacity-40"
            >
              <Upload className="w-4 h-4" />
              开始上传（{formatSize(picked.fileSize)}）
            </button>
          )}

          {/* 3. 任务列表 */}
          {tasks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-medium text-gray-400">上传任务</label>
                {tasks.some((t) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.status)) && (
                  <button
                    onClick={() => {
                      tasks
                        .filter((t) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.status))
                        .forEach((t) => uploadManager.removeTask(t.id));
                    }}
                    className="text-[10px] text-gray-500 hover:text-white active-press"
                  >
                    清理已结束
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {tasks.map((task) => {
                  const meta = statusMeta(task);
                  const Icon = meta.icon;
                  const running = task.status === 'UPLOADING' || task.status === 'PENDING';
                  const canResume = task.status === 'PAUSED' || task.status === 'FAILED';
                  return (
                    <div key={task.id} className="p-3 rounded-2xl bg-gray-900/60 border border-white/5">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.cls} ${meta.spin ? 'animate-spin' : ''}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-white truncate">{task.finalName || task.fileName}</div>
                          <div className={`text-[10px] ${meta.cls}`}>{meta.label}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {canResume && (
                            <button
                              onClick={() => uploadManager.resumeUpload(task.id)}
                              className="p-1 rounded-lg text-gray-400 hover:text-white bg-gray-800/60 active-press"
                              title="继续上传（自动续传）"
                            >
                              <Play className="w-3 h-3" />
                            </button>
                          )}
                          {running && (
                            <button
                              onClick={() => uploadManager.cancelUpload(task.id)}
                              className="p-1 rounded-lg text-gray-400 hover:text-white bg-gray-800/60 active-press"
                              title="取消上传"
                            >
                              <Ban className="w-3 h-3" />
                            </button>
                          )}
                          {!running && (
                            <button
                              onClick={() => uploadManager.removeTask(task.id)}
                              className="p-1 rounded-lg text-gray-500 hover:text-red-400 bg-gray-800/60 active-press"
                              title="移除记录"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 进度条 */}
                      {(running || task.status === 'PAUSED') && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${task.status === 'PAUSED' ? 'bg-amber-500' : 'bg-indigo-500'}`}
                              style={{ width: `${task.progress || 0}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                            <span>
                              {formatSize(task.receivedBytes)} / {formatSize(task.fileSize)}
                            </span>
                            <span>
                              {task.rootPathLabel ? `→ ${task.rootPathLabel}` : ''}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* 错误/提示信息 */}
                      {task.statusMessage && task.status !== 'UPLOADING' && (
                        <div className={`mt-2 text-[10px] leading-relaxed ${task.status === 'FAILED' ? 'text-red-400' : task.status === 'COMPLETED' ? 'text-green-400' : 'text-amber-300/90'}`}>
                          {task.statusMessage}
                        </div>
                      )}
                      {task.status === 'COMPLETED' && (
                        <div className="mt-1 text-[10px] text-gray-500">
                          已保存到所选根目录的 {task.folderName || task.fileName} 文件夹
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
