import React, { useState, useEffect } from 'react';

function SettingsModal({
  currentPaths,
  onSave,
  onRefreshAll,
  onRefreshRoot,
  onClose,
  onBackgroundChange,
  bulkScrapeLoading,
  bulkScrapeProgress,
  onStopBulkScrape
}) {
  const formatDateTime = (value) => {
    if (value === null || value === undefined) return '';
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      try {
        return new Date(num).toLocaleString();
      } catch {
        return '';
      }
    }
    const s = String(value).trim();
    if (!s) return '';
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return '';
    }
  };
  const [newPath, setNewPath] = useState('');
  const [newGamePath, setNewGamePath] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showRestoreDeleted, setShowRestoreDeleted] = useState(false);
  const [ignoredItems, setIgnoredItems] = useState([]);
  const [ignoredLoading, setIgnoredLoading] = useState(false);
  const [ignoredFilter, setIgnoredFilter] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingRootId, setRefreshingRootId] = useState(null);
  const projectBackgroundSettingKey = 'projectBackgroundPath';
  const [projectBackgroundPath, setProjectBackgroundPath] = useState('');

  // 3秒后自动清除状态消息
  useEffect(() => {
    if (status.message) {
      const timer = setTimeout(() => {
        setStatus({ type: '', message: '' });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const showStatus = (type, message) => {
    setStatus({ type, message });
  };

  const formatImportResult = (result) => {
    const imported = Number.isFinite(result?.imported) ? result.imported : 0;
    const deleted = Number.isFinite(result?.deleted) ? result.deleted : 0;
    if (imported === 0 && deleted === 0) return '刷新完成';
    return `刷新完成：新增 ${imported}，删除 ${deleted}`;
  };

  const handleRefreshAll = async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      const result = await onRefreshAll?.();
      if (result?.success) {
        showStatus('success', formatImportResult(result));
      } else {
        showStatus('error', '刷新失败：' + (result?.error || '未知错误'));
      }
    } catch (error) {
      showStatus('error', '刷新失败：' + (error?.message || String(error)));
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleRefreshRoot = async (rootPathId) => {
    if (refreshingRootId !== null) return;
    setRefreshingRootId(rootPathId);
    try {
      const result = await onRefreshRoot?.(rootPathId);
      if (result?.success) {
        showStatus('success', formatImportResult(result));
      } else {
        showStatus('error', '刷新失败：' + (result?.error || '未知错误'));
      }
    } catch (error) {
      showStatus('error', '刷新失败：' + (error?.message || String(error)));
    } finally {
      setRefreshingRootId(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const settings = await window.electronAPI.getSettings();
        setProjectBackgroundPath(settings?.[projectBackgroundSettingKey] ? String(settings[projectBackgroundSettingKey]) : '');
      } catch {}
    };
    load();
  }, []);

  const handleSelectProjectBackground = async () => {
    try {
      if (!window.electronAPI?.selectBackground || !window.electronAPI?.setProjectBackground) {
        showStatus('error', '当前环境不支持导入背景');
        return;
      }
      const result = await window.electronAPI.selectBackground();
      if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
        return;
      }
      const picked = result.filePaths[0];
      const applied = await window.electronAPI.setProjectBackground(picked);
      if (applied?.success) {
        const nextPath = applied?.path ? String(applied.path) : '';
        setProjectBackgroundPath(nextPath);
        onBackgroundChange?.(nextPath);
        showStatus('success', '背景已更新');
      } else {
        showStatus('error', '导入失败：' + (applied?.error || '未知错误'));
      }
    } catch (error) {
      showStatus('error', '导入失败：' + (error?.message || String(error)));
    }
  };

  const handleClearProjectBackground = async () => {
    try {
      if (window.electronAPI?.clearProjectBackground) {
        const ok = await window.electronAPI.clearProjectBackground();
        if (ok) {
          setProjectBackgroundPath('');
          onBackgroundChange?.('');
          showStatus('success', '背景已清除');
        } else {
          showStatus('error', '清除失败');
        }
        return;
      }
      if (window.electronAPI?.setProjectBackground) {
        const applied = await window.electronAPI.setProjectBackground(null);
        if (applied?.success) {
          setProjectBackgroundPath('');
          onBackgroundChange?.('');
          showStatus('success', '背景已清除');
        } else {
          showStatus('error', '清除失败：' + (applied?.error || '未知错误'));
        }
        return;
      }
      showStatus('error', '当前环境不支持清除背景');
    } catch (error) {
      showStatus('error', '清除失败：' + (error?.message || String(error)));
    }
  };

  const handleSelectFolder = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (selectedPath) {
      setNewPath(selectedPath);
    }
  };

  const handleSelectGameFolder = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (selectedPath) {
      setNewGamePath(selectedPath);
    }
  };

  const handleAddPath = async () => {
    if (!newPath) {
      showStatus('error', '请输入或选择一个目录路径');
      return;
    }

    // 检查路径是否已存在
    if (currentPaths.some(path => path.path === newPath)) {
      showStatus('error', '该根目录已存在');
      setNewPath('');
      return;
    }

    try {
      const result = await window.electronAPI.addRootPath(newPath);
      if (result.success) {
        const newRootId = Number.parseInt(String(result.id), 10);
        if (Number.isFinite(newRootId)) {
          try {
            const scopeKey = 'bulkScrapeScopeRootPathIds';
            const settings = await window.electronAPI.getSettings?.();
            const raw = settings?.[scopeKey];
            if (!(raw === null || raw === undefined || String(raw).trim() === '')) {
              const parsed = JSON.parse(String(raw));
              if (Array.isArray(parsed)) {
                const includeOthers = parsed.some((v) => String(v ?? '').trim().toLowerCase() === 'others');
                const normalized = [...new Set(parsed.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n)))];
                if (!normalized.includes(newRootId)) {
                  const nextIds = [...normalized, newRootId].sort((a, b) => a - b);
                  const nextScope = [...nextIds, ...(includeOthers ? ['others'] : [])];
                  await window.electronAPI.saveSetting(scopeKey, JSON.stringify(nextScope));
                }
              }
            }
          } catch {}
        }
        setNewPath('');
        showStatus('success', '根目录添加成功');
        onSave();
      } else {
        setNewPath('');
        showStatus('error', '添加根目录失败：' + (result.error || '未知错误'));
      }
    } catch (error) {
      setNewPath('');
      showStatus('error', '添加根目录失败：' + error.message);
    }
  };

  const handleAddGamePath = async () => {
    if (!newGamePath) {
      showStatus('error', '请输入或选择一个游戏目录路径');
      return;
    }

    try {
      const result = await window.electronAPI.addGameDirectory(newGamePath);
      if (result.success) {
        setNewGamePath('');
        showStatus('success', '游戏添加成功');
        onSave();
      } else {
        setNewGamePath('');
        showStatus('error', '添加游戏失败：' + (result.error || '未知错误'));
      }
    } catch (error) {
      setNewGamePath('');
      showStatus('error', '添加游戏失败：' + error.message);
    }
  };

  const handleDeletePath = async (rootPathId) => {
    const result = await window.electronAPI.deleteRootPath(rootPathId);
    if (result.success) {
      showStatus('success', '根目录已删除');
      onSave();
    } else {
      showStatus('error', '删除根目录失败');
    }
  };

  const handleResetData = async () => {
    if (resetLoading) return;
    setResetLoading(true);
    try {
      const result = await window.electronAPI.resetDatabase();
      if (result && result.success) {
        setNewPath('');
        setNewGamePath('');
        showStatus('success', '已删除全部游戏数据');
        onSave();
        setShowResetConfirm(false);
      } else {
        showStatus('error', '删除失败：' + (result?.error || '未知错误'));
      }
    } catch (error) {
      showStatus('error', '删除失败：' + error.message);
    } finally {
      setResetLoading(false);
    }
  };

  const loadIgnoredItems = async () => {
    if (!window.electronAPI?.getIgnoredGamePaths) {
      setIgnoredItems([]);
      return;
    }
    setIgnoredLoading(true);
    try {
      const result = await window.electronAPI.getIgnoredGamePaths();
      if (result?.success) {
        setIgnoredItems(Array.isArray(result?.items) ? result.items : []);
      } else {
        showStatus('error', '读取失败：' + (result?.error || '未知错误'));
        setIgnoredItems([]);
      }
    } catch (error) {
      showStatus('error', '读取失败：' + (error?.message || String(error)));
      setIgnoredItems([]);
    } finally {
      setIgnoredLoading(false);
    }
  };

  const handleRestoreIgnored = async (paths) => {
    if (restoreLoading) return;
    if (!window.electronAPI?.restoreIgnoredGamePaths) {
      showStatus('error', '当前环境不支持恢复');
      return;
    }
    setRestoreLoading(true);
    try {
      const result = await window.electronAPI.restoreIgnoredGamePaths(paths);
      if (result?.success) {
        const restored = Number.isFinite(result?.restored) ? result.restored : 0;
        showStatus('success', restored > 0 ? `已恢复 ${restored} 条` : '已恢复');
        await loadIgnoredItems();
      } else {
        showStatus('error', '恢复失败：' + (result?.error || '未知错误'));
      }
    } catch (error) {
      showStatus('error', '恢复失败：' + (error?.message || String(error)));
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleRestoreAllIgnored = async () => {
    if (restoreLoading) return;
    if (!window.electronAPI?.clearIgnoredGamePaths) {
      showStatus('error', '当前环境不支持恢复');
      return;
    }
    setRestoreLoading(true);
    try {
      const result = await window.electronAPI.clearIgnoredGamePaths();
      if (result?.success) {
        const restored = Number.isFinite(result?.restored) ? result.restored : 0;
        showStatus('success', restored > 0 ? `已恢复 ${restored} 条` : '已恢复');
        await loadIgnoredItems();
      } else {
        showStatus('error', '恢复失败：' + (result?.error || '未知错误'));
      }
    } catch (error) {
      showStatus('error', '恢复失败：' + (error?.message || String(error)));
    } finally {
      setRestoreLoading(false);
    }
  };

  useEffect(() => {
    if (!showRestoreDeleted) return;
    setIgnoredFilter('');
    loadIgnoredItems();
  }, [showRestoreDeleted]);

  const normalizedFilter = String(ignoredFilter || '').trim().toLowerCase();
  const filteredIgnoredItems = normalizedFilter
    ? ignoredItems.filter((item) => String(item?.path || '').toLowerCase().includes(normalizedFilter))
    : ignoredItems;

  return (
    <div className="modal-overlay fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300">
      <div className="modal-content bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl w-full max-w-lg mx-4 border border-gray-800 shadow-2xl shadow-indigo-900/20 transform transition-all duration-300 hover:shadow-3xl">
        <div className="p-6 border-b border-gray-800/80 bg-gradient-to-r from-gray-800/50 to-gray-900/50 rounded-t-2xl relative">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">设置</h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => setShowRestoreDeleted(true)}
                  className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-850 hover:bg-gray-800 border border-gray-800/80 hover:border-gray-700/80 transition-all duration-300"
                  title="恢复被删游戏"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v6h6M3 13a9 9 0 109-9 9 9 0 00-6.36 2.64L3 7" />
                  </svg>
                </button>
                <div className="pointer-events-none absolute right-0 top-full mt-2 w-[220px] rounded-xl border border-gray-700/80 bg-gray-900/95 px-3 py-2 text-xs text-gray-200 opacity-0 shadow-2xl transition-opacity duration-200 group-hover:opacity-100">
                  恢复被删游戏
                </div>
              </div>
              <div className="relative group">
                <button
                  type="button"
                  className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-850 hover:bg-gray-800 border border-gray-800/80 hover:border-gray-700/80 transition-all duration-300"
                  title="信息"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-.987 2.575-2.4 2.9-.947.217-1.6 1.033-1.6 2V17m.01 0h-.01M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </button>
                <div className="pointer-events-none absolute right-0 top-full mt-2 w-[320px] rounded-xl border border-gray-700/80 bg-gray-900/95 px-3 py-2 text-xs text-gray-200 opacity-0 shadow-2xl transition-opacity duration-200 group-hover:opacity-100">
                  开源项目 https://github.com/INK666/myGal
                </div>
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-lg shadow-red-600/30 hover:shadow-red-600/40 hover:brightness-110 transition-all duration-300 transform hover:-translate-y-0.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除全部游戏数据
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-850 hover:bg-gray-800 border border-gray-800/80 hover:border-gray-700/80 transition-all duration-300"
                title="关闭"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* 根目录列表 */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <label className="block text-sm font-medium text-gray-300">
                已添加的根目录 ({currentPaths.length})
              </label>
              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={refreshingAll || resetLoading}
                className="p-2.5 rounded-xl bg-gray-850 hover:bg-gray-800 border border-gray-800/80 hover:border-gray-700/80 text-gray-200 hover:text-white disabled:opacity-50 transition-all shadow-sm hover:shadow-md disabled:shadow-none"
                title="刷新全部游戏"
              >
                <svg className={`w-5 h-5 ${refreshingAll ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 10a8 8 0 00-14.9-3M4 14a8 8 0 0014.9 3" />
                </svg>
              </button>
            </div>

            {bulkScrapeLoading && bulkScrapeProgress?.total > 0 && (
              <div className="mb-3 flex items-center justify-between gap-3 p-3 bg-gray-900/40 border border-gray-800/80 rounded-xl">
                <div className="text-sm text-gray-200/90 font-medium whitespace-nowrap">
                  自动刮削中：{bulkScrapeProgress.current}/{bulkScrapeProgress.total}
                </div>
                <button
                  type="button"
                  onClick={onStopBulkScrape}
                  className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-100 transition-all"
                  title="停止"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="1.5" />
                  </svg>
                </button>
              </div>
            )}
            
            {currentPaths.length === 0 ? (
              <div className="p-4 bg-gray-850/80 backdrop-blur-sm rounded-xl border border-gray-800/80 text-center">
                <p className="text-gray-400 text-sm">暂无根目录，请添加游戏根目录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {currentPaths.map((rootPath) => (
                  <div 
                    key={rootPath.id} 
                    className="flex items-center justify-between p-4 bg-gray-850/80 backdrop-blur-sm rounded-xl border border-gray-800/80 hover:border-indigo-700/50 transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300 font-medium break-all text-sm">{rootPath.path}</p>
                      <p className="text-gray-500 text-xs mt-1">
                        添加时间: {formatDateTime(rootPath.created_at)}
                      </p>
                      <p className="text-gray-500 text-xs mt-1">
                        最后刷新: {formatDateTime(rootPath.last_refreshed_at) || '未刷新'}
                      </p>
                    </div>
                    <div className="ml-3 flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRefreshRoot(rootPath.id)}
                        disabled={refreshingAll || refreshingRootId !== null || resetLoading}
                        className="p-2 text-gray-300 hover:text-white hover:bg-gray-800/70 rounded-lg transition-all disabled:opacity-50"
                        title="刷新该根目录"
                      >
                        <svg
                          className={`w-5 h-5 ${refreshingRootId === rootPath.id ? 'animate-spin' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 10a8 8 0 00-14.9-3M4 14a8 8 0 0014.9 3" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeletePath(rootPath.id)}
                        disabled={refreshingAll || refreshingRootId !== null || resetLoading}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50"
                        title="删除根目录"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 添加新根目录 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              添加新根目录
            </label>
            <p className="text-xs text-gray-500 mb-3">
              该目录下的所有子文件夹将被识别为游戏
            </p>
            
            <div className="flex gap-3">
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="选择或输入目录路径"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/80 focus:border-transparent transition-all duration-300 shadow-lg hover:shadow-xl"
              />
              <button
                onClick={handleSelectFolder}
                className="bg-gray-800 hover:bg-gray-700 text-white font-medium py-2.5 px-4 rounded-xl flex items-center gap-2 transition-all duration-350 hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                选择
              </button>
              <button
                onClick={handleAddPath}
                disabled={!newPath}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium py-2.5 px-4 rounded-xl flex items-center gap-2 hover:shadow-lg hover:shadow-indigo-600/30 transition-all duration-350 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                添加
              </button>
            </div>
          </div>

          {/* 添加独立游戏目录 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              单独添加游戏
            </label>
            <p className="text-xs text-gray-500 mb-3">
              直接将所选文件夹添加为一个游戏（不扫描子目录）
            </p>
            
            <div className="flex gap-3">
              <input
                type="text"
                value={newGamePath}
                onChange={(e) => setNewGamePath(e.target.value)}
                placeholder="选择或输入游戏文件夹路径"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/80 focus:border-transparent transition-all duration-300 shadow-lg hover:shadow-xl"
              />
              <button
                onClick={handleSelectGameFolder}
                className="bg-gray-800 hover:bg-gray-700 text-white font-medium py-2.5 px-4 rounded-xl flex items-center gap-2 transition-all duration-350 hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                选择
              </button>
              <button
                onClick={handleAddGamePath}
                disabled={!newGamePath}
                className="bg-gradient-to-r from-emerald-600 to-green-600 text-white font-medium py-2.5 px-4 rounded-xl flex items-center gap-2 hover:shadow-lg hover:shadow-emerald-600/30 transition-all duration-350 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                添加
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="block text-sm font-medium text-gray-300">
                项目页面背景
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectProjectBackground}
                  disabled={resetLoading}
                  className="bg-gray-800 hover:bg-gray-700 text-white font-medium py-2 px-3 rounded-xl flex items-center gap-2 transition-all duration-350 hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  导入
                </button>
                <button
                  type="button"
                  onClick={handleClearProjectBackground}
                  disabled={resetLoading || !projectBackgroundPath}
                  className="bg-gradient-to-r from-red-600 to-pink-600 text-white font-medium py-2 px-3 rounded-xl transition-all duration-350 transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  清除
                </button>
              </div>
            </div>
            <div className="p-4 bg-gray-850/80 backdrop-blur-sm rounded-xl border border-gray-800/80">
              <div className="text-xs text-gray-400">
                {projectBackgroundPath ? `已设置：${String(projectBackgroundPath).split(/[\\/]/).pop()}` : '未设置'}
              </div>
              <div className="text-xs text-gray-500 mt-2">
                支持 jpg / png
              </div>
            </div>
          </div>
        </div>

      </div>

      {status.message && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 pointer-events-none z-[70]">
          <div
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
              status.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : 'bg-red-500/20 text-red-400 border border-red-500/50'
            }`}
          >
            {status.message}
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="p-3 bg-red-500/10 rounded-xl">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white">删除全部游戏数据？</h3>
            </div>
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
              此操作会清空所有游戏、路径、标签和封面等数据，恢复为初始状态，无法恢复。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2.5 rounded-xl transition-all"
                disabled={resetLoading}
              >
                取消
              </button>
              <button
                onClick={handleResetData}
                disabled={resetLoading}
                className="flex-1 bg-gradient-to-r from-red-600 to-pink-600 text-white font-medium py-2.5 rounded-xl hover:shadow-lg hover:shadow-red-600/30 transition-all transform active:scale-95 disabled:opacity-60"
              >
                {resetLoading ? '正在删除...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestoreDeleted && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 text-indigo-300">
                <div className="p-3 bg-indigo-500/10 rounded-xl">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v6h6M3 13a9 9 0 109-9 9 9 0 00-6.36 2.64L3 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">恢复被删游戏</h3>
                  <div className="text-xs text-gray-400 mt-1">恢复后需点击“刷新/导入”才会重新入库</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRestoreDeleted(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-850 hover:bg-gray-800 border border-gray-800/80 hover:border-gray-700/80 transition-all duration-300"
                title="关闭"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                value={ignoredFilter}
                onChange={(e) => setIgnoredFilter(e.target.value)}
                placeholder="搜索路径"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/80 focus:border-transparent transition-all duration-300"
              />
              <button
                type="button"
                onClick={handleRestoreAllIgnored}
                disabled={restoreLoading || ignoredLoading || ignoredItems.length === 0}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium py-2.5 px-4 rounded-xl hover:shadow-lg hover:shadow-indigo-600/30 transition-all duration-350 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                全部恢复
              </button>
            </div>

            <div className="p-4 bg-gray-850/80 backdrop-blur-sm rounded-xl border border-gray-800/80 max-h-[50vh] overflow-y-auto">
              {ignoredLoading ? (
                <div className="text-sm text-gray-400">正在加载...</div>
              ) : filteredIgnoredItems.length === 0 ? (
                <div className="text-sm text-gray-400">
                  {ignoredItems.length === 0 ? '暂无被删除记录' : '没有匹配的路径'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredIgnoredItems.map((item) => (
                    <div
                      key={item.path}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-900/50 border border-gray-800/80 hover:border-indigo-700/40 transition-all"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-200 font-mono break-all">{item.path}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestoreIgnored([item.path])}
                        disabled={restoreLoading}
                        className="shrink-0 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 hover:text-white border border-gray-700/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-gray-500">
                删除游戏不会删本地文件，只是加入忽略列表
              </div>
              <button
                type="button"
                onClick={() => setShowRestoreDeleted(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsModal;
