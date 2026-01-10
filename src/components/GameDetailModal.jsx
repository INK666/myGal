import React, { useState, useEffect, useRef } from 'react';

function GameDetailModal({ game, allTags, onClose, onUpdate }) {
  const [gameTags, setGameTags] = useState([]);
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [editingTag, setEditingTag] = useState(null);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [aliasValue, setAliasValue] = useState('');
  const [exeItems, setExeItems] = useState([]);
  const [exeLoading, setExeLoading] = useState(false);
  const [exeExpanded, setExeExpanded] = useState(false);
  const editTagInputRef = useRef(null);
  const exeRequestIdRef = useRef(0);

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

  useEffect(() => {
    loadGameTags();
  }, [game.id]);

  useEffect(() => {
    setAliasValue(game.alias ?? '');
  }, [game.id, game.alias]);

  useEffect(() => {
    setExeExpanded(false);
    setExeItems([]);
    setExeLoading(false);
  }, [game.id]);

  const loadGameTags = async () => {
    const tags = await window.electronAPI.getGameTags(game.id);
    setGameTags(tags);
  };

  const loadExecutables = async () => {
    const requestId = ++exeRequestIdRef.current;
    const paths = (game.paths && game.paths.length > 0)
      ? game.paths
      : (game.path ? [game.path] : []);

    if (!paths.length) {
      setExeItems([]);
      return;
    }
    if (!window.electronAPI?.scanExecutables) {
      setExeItems([]);
      return;
    }

    setExeLoading(true);
    try {
      const result = await window.electronAPI.scanExecutables(paths);
      if (requestId !== exeRequestIdRef.current) return;
      if (result && result.success && Array.isArray(result.items)) {
        setExeItems(result.items);
      } else {
        setExeItems([]);
      }
    } catch {
      if (requestId !== exeRequestIdRef.current) return;
      setExeItems([]);
    } finally {
      if (requestId !== exeRequestIdRef.current) return;
      setExeLoading(false);
    }
  };

  useEffect(() => {
    if (!exeExpanded) return;
    loadExecutables();
  }, [exeExpanded]);

  const handleLaunchExe = async (exePath) => {
    const paths = (game.paths && game.paths.length > 0)
      ? game.paths
      : (game.path ? [game.path] : []);

    if (!exePath) return;
    if (!window.electronAPI?.launchExecutable) {
      showStatus('error', '当前环境不支持运行');
      return;
    }

    try {
      const result = await window.electronAPI.launchExecutable(exePath, paths);
      if (result && result.success) {
        if (result.needsUserConfirm) {
          showStatus('success', '已请求启动，如弹出 SmartScreen 请点“更多信息 → 仍要运行”');
        } else {
          showStatus('success', '已启动');
        }
        return;
      }
      const detail = result?.details ? `（${result.details}）` : '';
      showStatus('error', '启动失败：' + (result?.error || '未知错误') + detail);
    } catch (error) {
      showStatus('error', '启动失败：' + (error?.message || String(error)));
    }
  };

  const handleRevealExeInFolder = async (exePath) => {
    if (!exePath) return;
    if (window.electronAPI?.showItemInFolder) {
      const ok = await window.electronAPI.showItemInFolder(exePath);
      if (ok) {
        showStatus('success', '已在资源管理器中定位，可右键使用系统工具');
        return;
      }
      showStatus('error', '定位失败：文件不存在或路径无效');
      return;
    }
    showStatus('error', '当前环境不支持在资源管理器定位');
  };

  const handleOpenFolder = async () => {
    const paths = (game.paths && game.paths.length > 0)
      ? game.paths
      : (game.path ? [game.path] : []);
    
    for (const p of paths) {
      await window.electronAPI.openFolder(p);
    }
  };

  const handleSelectCover = async () => {
    if (window.electronAPI && window.electronAPI.selectDirectory) {
      const result = await window.electronAPI.selectCover();
      if (result && !result.canceled && result.filePaths.length > 0) {
        await window.electronAPI.updateGameCover(game.id, result.filePaths[0]);
        showStatus('success', '封面已更新');
        onUpdate();
      }
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      if (e.target.files && e.target.files[0]) {
        const filePath = URL.createObjectURL(e.target.files[0]);
        await window.electronAPI.updateGameCover(game.id, filePath);
        showStatus('success', '封面已更新');
        onUpdate();
      }
    };
    input.click();
  };

  const handleRemoveCover = async () => {
    await window.electronAPI.updateGameCover(game.id, null);
    showStatus('success', '封面已移除');
    onUpdate();
  };

  const handleCaptureScreenCover = async () => {
    try {
      if (!window.electronAPI || !window.electronAPI.captureScreenCover) {
        showStatus('error', '当前环境不支持截图功能');
        return;
      }
      const result = await window.electronAPI.captureScreenCover(game.id);
      if (!result || !result.success) {
        if (result && result.error && result.error !== 'cancelled') {
          showStatus('error', '截图失败: ' + result.error);
        }
        return;
      }
      showStatus('success', '封面截图成功');
      onUpdate();
    } catch (error) {
      console.error('截图并设置封面失败:', error);
      showStatus('error', '截图失败: ' + error.message);
    }
  };

  const handleScrapeCover = async () => {
    if (scrapeLoading) return;
    if (!window.electronAPI || !window.electronAPI.scrapeGameCover) {
      showStatus('error', '当前环境不支持刮削功能');
      return;
    }
    setScrapeLoading(true);
    try {
      const result = await window.electronAPI.scrapeGameCover(game.id);
      if (result && result.success) {
        const vendorTags = Array.isArray(result?.vendorTags) ? result.vendorTags : [];
        const vendorText = vendorTags.length > 0 ? `，厂商：${vendorTags.join(' / ')}` : '';
        showStatus('success', `封面已刮削（${result.provider || '未知来源'}）${vendorText}`);
        onUpdate();
      } else {
        const query = result?.query || (Array.isArray(result?.queries) ? result.queries[0] : '');
        const tried = Array.isArray(result?.tried) ? result.tried.join(' / ') : '';
        const extra = [query ? `关键词：${query}` : '', tried ? `来源：${tried}` : ''].filter(Boolean).join('，');
        showStatus('error', '刮削失败：' + (result?.error || '未知错误') + (extra ? `（${extra}）` : ''));
      }
    } catch (error) {
      showStatus('error', '刮削失败：' + (error?.message || String(error)));
    } finally {
      setScrapeLoading(false);
    }
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;

    let tag = allTags.find(t => t.name.toLowerCase() === newTagName.toLowerCase());
    
    if (!tag) {
      const result = await window.electronAPI.createTag(newTagName, newTagColor);
      tag = { id: result.lastInsertRowid, name: newTagName, color: newTagColor };
    }

    await window.electronAPI.addTagToGame(game.id, tag.id);
    setNewTagName('');
    showStatus('success', '标签已添加');
    loadGameTags();
    onUpdate();
  };

  const handleRemoveTag = async (tagId) => {
    await window.electronAPI.removeTagFromGame(game.id, tagId);
    showStatus('success', '标签已移除');
    loadGameTags();
    onUpdate();
  };

  const handleAddExistingTag = async (tag) => {
    // 检查标签是否已经添加
    if (gameTags.some(gameTag => gameTag.id === tag.id)) {
      return;
    }

    // 调用IPC接口添加标签到游戏
    await window.electronAPI.addTagToGame(game.id, tag.id);
    // 更新标签列表
    loadGameTags();
    // 通知父组件更新
    showStatus('success', '标签已添加');
    onUpdate();
  };

  const handleDeleteGame = async () => {
    try {
      const ok = await window.electronAPI.deleteGame(game.id);
      if (!ok) {
        showStatus('error', '删除失败：游戏不存在或已删除');
        return;
      }
      setShowDeleteConfirm(false);
      onClose();
      onUpdate();
    } catch (error) {
      showStatus('error', '删除失败：' + (error?.message || String(error)));
    }
  };

  const handleSaveAlias = async () => {
    if (!window.electronAPI || !window.electronAPI.updateGameAlias) return;
    const normalized = aliasValue.trim();
    const current = String(game.alias ?? '').trim();
    if (normalized === current) return;
    await window.electronAPI.updateGameAlias(game.id, normalized);
    showStatus('success', '别名已更新');
    onUpdate();
  };

  const handleSaveTag = async (tag) => {
    if (editingTag) {
      await window.electronAPI.updateTag(editingTag.id, tag.name, tag.color);
      setEditingTag(null);
      showStatus('success', '标签已更新');
      loadGameTags();
      onUpdate();
    }
  };

  const handleDeleteTag = async (tagId) => {
    if (!window.electronAPI || !window.electronAPI.deleteTag) return;
    try {
      await window.electronAPI.deleteTag(tagId);
      if (editingTag?.id === tagId) {
        setEditingTag(null);
      }
      showStatus('success', '标签已删除');
      await loadGameTags();
      await onUpdate();
    } catch (error) {
      showStatus('error', '删除标签失败：' + (error?.message || String(error)));
    }
  };

  return (
    <div
      className="modal-overlay fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-0 transition-opacity duration-300"
      style={{ '-webkit-app-region': 'no-drag' }}
    >
      <div className="modal-content rounded-2xl w-full max-w-2xl min-h-[96vh] max-h-[98vh] overflow-hidden border border-white/10 shadow-2xl shadow-indigo-900/20 transform transition-all duration-300 hover:shadow-3xl relative">
        {/* 状态消息提示 */}
        {status.message && (
          <div className={`fixed top-8 left-1/2 transform -translate-x-1/2 z-[60] px-6 py-3 rounded-xl text-sm font-bold shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-4 ${
            status.type === 'success' 
              ? 'bg-emerald-500 text-white border border-emerald-400' 
              : 'bg-red-500 text-white border border-red-400'
          }`}>
            <div className="flex items-center gap-2">
              {status.type === 'success' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {status.message}
            </div>
          </div>
        )}

        {game.cover_path ? (
          <img
            src={game.cover_path}
            alt={game.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950/90 via-gray-900/70 to-gray-950/95" />

        {!game.cover_path && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <svg className="w-40 h-40 text-indigo-300/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 bg-black/60 hover:bg-black/80 text-white w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="relative z-10 flex flex-col min-h-[96vh] max-h-[98vh]">
          <div className="shrink-0 px-6 pt-6 pb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow-2xl">
              {game.name}
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-0 flex flex-col gap-6">

          <div>
            <input
              type="text"
              value={aliasValue}
              onChange={(e) => setAliasValue(e.target.value)}
              onBlur={handleSaveAlias}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveAlias();
                }
              }}
              placeholder=""
              className="w-full bg-black/5 border border-white/5 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/80 focus:border-transparent transition-all duration-300"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-400">标签</h3>
              <button
                onClick={() => setShowTagManager(!showTagManager)}
                className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors duration-300"
              >
                {showTagManager ? '收起' : '管理标签'}
              </button>
            </div>
            
            {showTagManager && (
              <div className="bg-gray-850/80 backdrop-blur-sm rounded-xl p-4 border border-gray-800/80 shadow-lg">
                <div className="flex flex-wrap gap-3 mb-3">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="新标签名称"
                    className="flex-1 bg-gray-900 border border-gray-800/80 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/80 focus:border-transparent transition-all duration-300"
                  />
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="w-12 h-12 rounded-lg border border-gray-800/80 cursor-pointer hover:scale-110 transition-transform duration-300"
                  />
                  <button
                    onClick={handleAddTag}
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm py-2.5 px-4 rounded-lg hover:shadow-lg hover:shadow-indigo-600/30 transition-all duration-350 transform hover:-translate-y-0.5 whitespace-nowrap"
                  >
                    添加
                  </button>
                </div>
                
                {/* 现有标签快捷选择 */}
                {allTags.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-400 mb-2">快捷选择现有标签</h4>
                    <div className="flex flex-wrap gap-2">
                      {allTags
                        .filter(tag => !gameTags.some(gameTag => gameTag.id === tag.id))
                        .map(tag => (
                          <div
                            key={tag.id}
                            className="group rounded-full text-xs font-medium text-white inline-flex items-center overflow-hidden hover:shadow-md transition-all duration-350 transform hover:scale-105"
                            style={{ backgroundColor: tag.color }}
                          >
                            <button
                              type="button"
                              onClick={() => handleAddExistingTag(tag)}
                              className="px-3 py-1.5 inline-flex items-center min-w-0"
                            >
                              <span className="truncate">{tag.name}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTag(tag.id)}
                              className="px-2 py-1.5 bg-black/15 hover:bg-black/30 inline-flex items-center justify-center transition-colors duration-200"
                              title="删除标签"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      {allTags.filter(tag => !gameTags.some(gameTag => gameTag.id === tag.id)).length === 0 && (
                        <p className="text-gray-500 text-xs">已添加所有标签</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2.5">
              {gameTags.map(tag => (
                <span
                  key={tag.id}
                  className="px-3 py-1.5 rounded-full text-sm font-medium text-white flex items-center gap-2 shadow-md hover:shadow-lg transition-all duration-350 transform hover:scale-105"
                  style={{ backgroundColor: tag.color }}
                >
                  {editingTag?.id === tag.id ? (
                    <input
                      ref={editTagInputRef}
                      type="text"
                      value={editingTag.name}
                      onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                      className="bg-white/20 rounded px-2 py-1 text-white text-sm w-28 focus:outline-none"
                      onBlur={() => handleSaveTag(tag)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSaveTag(tag)}
                      autoFocus
                    />
                  ) : (
                    <span
                      onClick={() => setEditingTag(tag)}
                      className="cursor-pointer"
                    >
                      {tag.name}
                    </span>
                  )}
                  <button
                    onClick={() => handleRemoveTag(tag.id)}
                    className="hover:text-red-200 transition-colors duration-300 p-1 hover:bg-white/10 rounded-full"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-6" />

          <div className="bg-gray-850/80 backdrop-blur-sm rounded-xl p-3 border border-gray-800/80">
            <h3 className="text-sm font-medium text-gray-400 mb-2">游戏路径</h3>
            <div className="space-y-1.5">
              {((game.paths && game.paths.length > 0)
                ? game.paths
                : (game.path ? [game.path] : [])
              ).map((p, index) => (
                <p
                  key={`${p}-${index}`}
                  className="text-sm text-gray-300 break-all font-mono bg-gray-900/50 px-2 py-1.5 rounded-lg"
                >
                  {p}
                </p>
              ))}
            </div>
          </div>

          {(game.path || (game.paths && game.paths.length > 0)) && (
            <div className="bg-gray-850/80 backdrop-blur-sm rounded-xl p-3 border border-gray-800/80">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium text-gray-400">可执行文件</h3>
                <div className="flex items-center gap-2">
                  {exeExpanded && (
                    <button
                      type="button"
                      onClick={loadExecutables}
                      disabled={exeLoading || !window.electronAPI?.scanExecutables}
                      className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {exeLoading ? '扫描中...' : '重新扫描'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExeExpanded((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-400 hover:text-gray-200 bg-gray-850/60 hover:bg-gray-800/80 border border-gray-800/80 hover:border-gray-700/80 transition-all"
                    aria-expanded={exeExpanded}
                  >
                    {exeExpanded ? '收起' : '展开'}
                    <svg
                      className={`w-4 h-4 transition-transform ${exeExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
              {exeExpanded ? (
                !window.electronAPI?.scanExecutables ? (
                  <p className="text-gray-500 text-sm">当前环境不支持扫描</p>
                ) : exeItems.length === 0 ? (
                  <p className="text-gray-500 text-sm">{exeLoading ? '正在扫描...' : '未找到 exe 文件'}</p>
                ) : (
                  <div className="space-y-2">
                    {exeItems.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleLaunchExe(item.path)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRevealExeInFolder(item.path);
                        }}
                        className="w-full text-left bg-gray-900/50 hover:bg-gray-900/70 border border-gray-800/80 rounded-lg px-3 py-2 transition-all duration-300"
                        title="点击运行"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm text-gray-200 truncate">{item.name}</div>
                            <div className="text-xs text-gray-500 break-all font-mono">{item.relativePath || item.path}</div>
                          </div>
                          <div className="shrink-0 text-xs text-indigo-300">运行</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              ) : null}
            </div>
          )}

          <div className="bg-black/30 backdrop-blur-md border border-white/10 rounded-2xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={handleOpenFolder}
                className="w-full h-12 bg-gradient-to-r from-emerald-500 to-green-500 text-white text-sm rounded-xl inline-flex items-center justify-center gap-2 transition-all duration-350 hover:shadow-lg hover:shadow-emerald-500/30 transform hover:-translate-y-0.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                打开文件夹
              </button>

              <button
                onClick={handleSelectCover}
                className="w-full h-12 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm rounded-xl inline-flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-indigo-600/30 transition-all duration-350 transform hover:-translate-y-0.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                选择封面
              </button>

              <button
                onClick={handleScrapeCover}
                disabled={scrapeLoading}
                className="w-full h-12 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white text-sm rounded-xl inline-flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-fuchsia-600/30 transition-all duration-350 transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
                title="根据游戏名称自动查找封面"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v16h16V4H4zm4 4h8M8 12h8M8 16h6" />
                </svg>
                {scrapeLoading ? '正在刮削...' : '刮削封面'}
              </button>

              <button
                onClick={handleCaptureScreenCover}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 text-white text-sm rounded-xl inline-flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-blue-600/30 transition-all duration-350 transform hover:-translate-y-0.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                封面截图
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              {game.cover_path ? (
                <button
                  onClick={handleRemoveCover}
                  className="w-full h-11 bg-white/10 hover:bg-white/15 text-white/90 text-sm rounded-xl inline-flex items-center justify-center gap-2 transition-all duration-300"
                  title="移除封面"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  移除封面
                </button>
              ) : null}

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className={`w-full ${game.cover_path ? 'h-11' : 'h-12 col-span-2'} bg-gradient-to-r from-red-600 to-pink-600 text-white text-sm rounded-xl inline-flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-red-600/30 transition-all duration-350 transform hover:-translate-y-0.5`}
                title="删除游戏"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除游戏
              </button>
            </div>
          </div>

        </div>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl transform animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 text-red-400 mb-4">
              <div className="p-3 bg-red-500/10 rounded-xl">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white">确认删除游戏？</h3>
            </div>
            
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
              您确定要删除 <span className="text-gray-200 font-semibold">"{game.name}"</span> 吗？
              此操作仅从库中移除，<span className="text-indigo-400">不会删除</span>您的原始游戏文件。
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2.5 rounded-xl transition-all"
              >
                取消
              </button>
              <button
                onClick={handleDeleteGame}
                className="flex-1 bg-gradient-to-r from-red-600 to-pink-600 text-white font-medium py-2.5 rounded-xl hover:shadow-lg hover:shadow-red-600/30 transition-all transform active:scale-95"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameDetailModal;
