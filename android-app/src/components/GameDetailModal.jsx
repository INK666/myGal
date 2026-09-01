import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Pin,
  Sparkles,
  Download,
  FolderOpen,
  Plus,
  Trash2,
  Calendar,
  Layers,
  ImageOff,
  ImagePlus,
  Loader2,
  Pencil,
  Check,
  FileArchive
} from 'lucide-react';
import { api } from '../api/client';
import { useServer } from '../contexts/ServerContext';
import CoverImage from './CoverImage';
import { saveCoverBlob } from '../utils/cacheStorage';

export default function GameDetailModal({
  game,
  allTags = [],
  rootPaths = [],
  onClose,
  onUpdateGame,
  onOpenFileTransfer
}) {
  const { serverUrl, token, connected, showToast } = useServer();
  const [detail, setDetail] = useState(game);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [creatingTag, setCreatingTag] = useState(false);
  const [imageError, setImageError] = useState(false);
  const coverFileInputRef = useRef(null);

  const cleanServerUrl = (serverUrl || '').trim().replace(/\/+$/, '');
  const getCoverUrl = () => {
    if (!cleanServerUrl || detail.hasCover === false) return null;
    if (detail.coverUrl) {
      if (token && !detail.coverUrl.includes('token=')) {
        const sep = detail.coverUrl.includes('?') ? '&' : '?';
        return `${detail.coverUrl}${sep}token=${encodeURIComponent(token)}`;
      }
      return detail.coverUrl;
    }
    const version = detail.updatedAt ? new Date(detail.updatedAt).getTime() : '';
    const vParam = version ? `&v=${version}` : '';
    return `${cleanServerUrl}/api/covers/${detail.id}?token=${encodeURIComponent(token || '')}${vParam}`;
  };
  const coverUrl = getCoverUrl();

  useEffect(() => {
    setImageError(false);
    setDetail(game);
    setEditingAlias(false);
    setAliasInput(game.alias || '');
    // 联网时拉取最新详情
    if (connected) {
      api.getGameDetail(game.id)
        .then((res) => {
          if (res) {
            setDetail(res);
            setAliasInput(res.alias || '');
            onUpdateGame(res);
          }
        })
        .catch(() => {});
    }
  }, [game.id, connected]);

  // 修改游戏别名
  const handleSaveAlias = async () => {
    if (!connected) {
      showToast('当前处于离线模式，修改别名需先连接 PC 端', 'warning');
      return;
    }
    const cleanAlias = aliasInput.trim();
    setSavingAlias(true);
    try {
      await api.updateGameAlias(detail.id, cleanAlias);
      const updated = { ...detail, alias: cleanAlias || null };
      setDetail(updated);
      onUpdateGame(updated);
      setEditingAlias(false);
      showToast(cleanAlias ? '别名修改成功' : '已清除别名', 'success');
    } catch (err) {
      showToast('修改别名失败: ' + err.message, 'error');
    } finally {
      setSavingAlias(false);
    }
  };

  // 导入手机相册中的图片作为游戏封面
  const handleImportCoverFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!connected) {
      showToast('当前处于离线缓存模式，导入封面需先连接 PC 端', 'warning');
      return;
    }
    setUploadingCover(true);
    try {
      showToast('正在上传并设置封面...', 'info');
      const reader = new FileReader();
      const base64Promise = new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = (err) => reject(err);
      });
      reader.readAsDataURL(file);
      const dataUrl = await base64Promise;

      const res = await api.uploadGameCover(detail.id, dataUrl);
      if (res) {
        let freshDetail = null;
        try {
          freshDetail = await api.getGameDetail(detail.id);
        } catch {}

        const nowIso = new Date().toISOString();
        const updated = freshDetail || {
          ...detail,
          hasCover: true,
          cover_path: res.coverPath || detail.cover_path,
          updatedAt: nowIso,
          coverUrl: `${cleanServerUrl}/api/covers/${detail.id}?v=${Date.now()}`
        };

        setDetail(updated);
        onUpdateGame(updated);

        // 异步更新 IndexedDB 封面缓存
        if (serverUrl) {
          saveCoverBlob(serverUrl, detail.id, file, Date.now()).catch(() => {});
        }

        showToast('自定义封面导入成功！', 'success');
      } else {
        showToast('导入封面失败', 'error');
      }
    } catch (err) {
      showToast('导入封面出错: ' + (err?.message || String(err)), 'error');
    } finally {
      setUploadingCover(false);
      if (coverFileInputRef.current) coverFileInputRef.current.value = '';
    }
  };

  // 切换置顶
  const handleTogglePinned = async () => {
    if (!connected) {
      showToast('当前处于离线缓存模式，置顶操作需先连接 PC 端', 'warning');
      return;
    }
    try {
      const nextPinned = !detail.pinned;
      await api.updateGamePinned(detail.id, nextPinned);
      const updated = { ...detail, pinned: nextPinned };
      setDetail(updated);
      onUpdateGame(updated);
      showToast(nextPinned ? '已置顶' : '已取消置顶', 'success');
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error');
    }
  };

  // 添加标签
  const handleAddTag = async (tagIdOrName) => {
    if (!connected) {
      showToast('当前处于离线缓存模式，添加标签需先连接 PC 端', 'warning');
      return;
    }
    try {
      const res = await api.addTagToGame(detail.id, tagIdOrName);
      const newTagNames = res.tags.map((t) => t.name);
      const updated = { ...detail, tags: newTagNames, detailedTags: res.tags };
      setDetail(updated);
      onUpdateGame(updated);
      showToast('标签添加成功', 'success');
    } catch (err) {
      showToast('添加标签失败: ' + err.message, 'error');
    }
  };

  // 移除标签
  const handleRemoveTag = async (tag) => {
    if (!connected) {
      showToast('当前处于离线缓存模式，移除标签需先连接 PC 端', 'warning');
      return;
    }
    try {
      // Find tagId from allTags or tag object
      const matched = allTags.find((t) => t.name === tag || t.id === tag.id) || tag;
      if (!matched?.id) {
        showToast('找不到对应标签ID', 'error');
        return;
      }
      const res = await api.removeTagFromGame(detail.id, matched.id);
      const newTagNames = (res.tags || []).map((t) => t.name);
      const updated = { ...detail, tags: newTagNames, detailedTags: res.tags };
      setDetail(updated);
      onUpdateGame(updated);
      showToast('标签已移除', 'info');
    } catch (err) {
      showToast('移除标签失败: ' + err.message, 'error');
    }
  };

  // 刮削封面
  const handleScrapeCover = async () => {
    if (!connected) {
      showToast('当前处于离线缓存模式，刮削封面需先连接 PC 端', 'warning');
      return;
    }
    if (scraping) return;
    setScraping(true);
    try {
      const res = await api.scrapeCover(detail.id);
      if (res?.success) {
        // 刮削成功后，立即拉取服务端最新的完整详情（包含新 coverUrl、updatedAt 与厂商标签）
        let freshDetail = null;
        try {
          freshDetail = await api.getGameDetail(detail.id);
        } catch {}

        const nowIso = new Date().toISOString();
        const updated = freshDetail || {
          ...detail,
          hasCover: true,
          cover_path: res.coverPath,
          updatedAt: nowIso,
          coverUrl: `${cleanServerUrl}/api/covers/${detail.id}?v=${Date.now()}`,
          tags: res.vendorTags && res.vendorTags.length > 0
            ? Array.from(new Set([...(detail.tags || []), ...res.vendorTags]))
            : detail.tags
        };

        setDetail(updated);
        onUpdateGame(updated);
        showToast(`封面刮削成功！(来源: ${res.provider})`, 'success');
      } else {
        showToast('刮削失败：' + (res?.error || '未匹配到封面'), 'error');
      }
    } catch (err) {
      showToast('刮削出错: ' + err.message, 'error');
    } finally {
      setScraping(false);
    }
  };

  // 格式化时间
  const formatTime = (ts) => {
    if (!ts) return '未知';
    try {
      const d = new Date(Number(ts) || ts);
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return String(ts);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md animate-fade-in">
      {/* Click outside backdrop */}
      <div className="flex-1" onClick={onClose} />

      {/* Bottom Sheet Modal Body */}
      <div className="glass-modal rounded-t-[32px] w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border-t border-white/10 animate-slide-up pb-safe">
        {/* Header Drag Handle & Close */}
        <div className="px-5 pt-3 pb-2 flex items-center justify-between border-b border-white/5">
          <div className="w-12 h-1.5 rounded-full bg-white/20 mx-auto" />
          <button
            onClick={onClose}
            className="absolute right-4 top-4 p-2 rounded-full bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {/* Main Top Banner: Cover + Core Info */}
          <div className="flex gap-4 items-start">
            {/* Cover 2:3 */}
            <div className="w-28 h-42 rounded-2xl bg-gray-900 overflow-hidden shrink-0 border border-white/10 shadow-xl relative flex items-center justify-center">
              <CoverImage
                src={coverUrl}
                serverUrl={serverUrl}
                gameId={detail.id}
                alt={detail.name}
                fallbackIconSize="w-8 h-8"
                fallbackTitle={detail.name}
              />
            </div>

            {/* Title & Core Info Area */}
            <div className="flex-1 min-w-0 space-y-2">
              {editingAlias ? (
                <div className="space-y-1.5 animate-fade-in">
                  <div className="text-[11px] text-indigo-400 font-medium flex items-center justify-between">
                    <span>编辑别名 / 译名</span>
                    <span className="text-[10px] text-gray-500">留空保存为清除</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={aliasInput}
                      onChange={(e) => setAliasInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveAlias();
                        else if (e.key === 'Escape') setEditingAlias(false);
                      }}
                      placeholder="输入别名或译名..."
                      className="flex-1 bg-gray-900 border border-indigo-500/50 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                    />
                    <button
                      onClick={handleSaveAlias}
                      disabled={savingAlias}
                      title="保存别名"
                      className="p-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shrink-0 active-press transition-colors disabled:opacity-50"
                    >
                      {savingAlias ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => setEditingAlias(false)}
                      disabled={savingAlias}
                      title="取消"
                      className="p-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white shrink-0 active-press transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-500 truncate font-mono">
                    原名: {detail.name}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="text-[11px] text-gray-500 font-medium">
                      {detail.alias ? '游戏别名 / 译名' : '游戏名称'}
                    </span>
                    <button
                      onClick={() => {
                        setAliasInput(detail.alias || '');
                        setEditingAlias(true);
                      }}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md hover:bg-indigo-500/10 transition-colors"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      <span>{detail.alias ? '修改别名' : '设置别名'}</span>
                    </button>
                  </div>
                  <h2 className="text-base font-bold text-white leading-snug break-words">
                    {detail.alias || detail.name}
                  </h2>
                  {detail.alias && (
                    <div className="text-[11px] text-gray-400 truncate mt-0.5 font-mono">
                      原名: {detail.name}
                    </div>
                  )}
                </div>
              )}

              {/* Pinned & Imported Info */}
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  onClick={handleTogglePinned}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    detail.pinned
                      ? 'bg-amber-500 text-black shadow-md shadow-amber-500/30'
                      : 'bg-gray-850 hover:bg-gray-800 text-gray-300 border border-white/5'
                  }`}
                >
                  <Pin className={`w-3 h-3 ${detail.pinned ? 'fill-black' : ''}`} />
                  <span>{detail.pinned ? '已置顶' : '置顶'}</span>
                </button>

                <div className="text-[11px] text-gray-500 flex items-center gap-1 font-mono">
                  <Calendar className="w-3 h-3" />
                  <span>{formatTime(detail.importedAt || detail.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Action Grid */}
          <div className="grid grid-cols-3 gap-2.5">
            {/* 隐藏的图片文件上传 input */}
            <input
              type="file"
              ref={coverFileInputRef}
              onChange={handleImportCoverFile}
              accept="image/*"
              className="hidden"
            />

            {/* Scrape Cover */}
            <button
              onClick={handleScrapeCover}
              disabled={scraping}
              className="glass-panel p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center active-press hover:bg-purple-950/40 hover:border-purple-500/40 transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center shadow-inner">
                <Sparkles className={`w-4 h-4 ${scraping ? 'animate-spin text-purple-300' : ''}`} />
              </div>
              <span className="text-xs font-bold text-white">
                {scraping ? '刮削中...' : '重新刮削'}
              </span>
              <span className="text-[10px] text-gray-400">云端匹配封面</span>
            </button>

            {/* Import Custom Cover from Phone */}
            <button
              onClick={() => {
                if (!connected) {
                  showToast('当前处于离线缓存模式，导入封面需先连接 PC 端', 'warning');
                  return;
                }
                coverFileInputRef.current?.click();
              }}
              disabled={uploadingCover}
              className="glass-panel p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center active-press hover:bg-indigo-950/40 hover:border-indigo-500/40 transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center shadow-inner">
                {uploadingCover ? (
                  <Loader2 className="w-4 h-4 text-indigo-300 animate-spin" />
                ) : (
                  <ImagePlus className="w-4 h-4 text-indigo-400" />
                )}
              </div>
              <span className="text-xs font-bold text-white">
                {uploadingCover ? '上传中...' : '导入封面'}
              </span>
              <span className="text-[10px] text-gray-400">选择手机图片</span>
            </button>

            {/* Data & Saves / File Transfer */}
            {(() => {
              const isArchive = /\.(zip|rar|7z|tar|gz|iso|bin|7zip)$/i.test(detail?.path || '');
              return (
                <button
                  onClick={() => {
                    if (!connected) {
                      showToast('当前处于离线缓存模式，下载游戏文件需先连接 PC 端', 'warning');
                      return;
                    }
                    onOpenFileTransfer(detail);
                  }}
                  className="glass-panel p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center active-press hover:bg-emerald-950/40 hover:border-emerald-500/40 transition-all"
                >
                  <div className="w-9 h-9 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center shadow-inner">
                    <Download className="w-4 h-4 text-emerald-400" />
                  </div>
                  <span className="text-xs font-bold text-white">
                    {isArchive ? '下载游戏文件' : '数据/游戏下载'}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {isArchive ? '支持压缩包' : '下载/存档导出'}
                  </span>
                </button>
              );
            })()}
          </div>

          {/* Tags Section */}
          <div className="glass-panel p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-gray-200">游戏标签 ({detail.tags?.length || 0})</span>
              </div>
              <button
                onClick={() => setShowTagSelector(!showTagSelector)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加标签</span>
              </button>
            </div>

            {/* Current Game Tags */}
            <div className="flex flex-wrap gap-1.5">
              {detail.tags && detail.tags.length > 0 ? (
                detail.tags.map((tagName, idx) => {
                  const tagMeta = allTags.find((t) => t.name === tagName);
                  return (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium bg-gray-900 border border-white/10 text-gray-200"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: tagMeta?.color || '#6366f1' }}
                      />
                      <span>{tagName}</span>
                      <button
                        onClick={() => handleRemoveTag(tagMeta || tagName)}
                        className="p-0.5 hover:text-red-400 text-gray-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })
              ) : (
                <span className="text-xs text-gray-500">暂无标签，点击上方“添加标签”为游戏分类</span>
              )}
            </div>

            {/* Add Tag Drawer */}
            {showTagSelector && (
              <div className="pt-3 border-t border-white/5 space-y-3">
                <div className="text-xs text-gray-400 font-medium">从已有标签中选择：</div>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {allTags
                    .filter((t) => !detail.tags?.includes(t.name))
                    .map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleAddTag(t.id)}
                        className="px-2.5 py-1 rounded-xl text-xs bg-gray-850 hover:bg-indigo-900/40 text-gray-300 hover:text-indigo-200 border border-white/5 flex items-center gap-1.5 transition-all"
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color || '#6366f1' }} />
                        <span>{t.name}</span>
                      </button>
                    ))}
                </div>

                {/* Create New Tag */}
                <div className="flex gap-2 items-center pt-2">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="新建标签名称..."
                    className="flex-1 bg-gray-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="w-8 h-8 rounded-xl bg-transparent border-0 cursor-pointer p-0"
                    title="选择标签颜色"
                  />
                  <button
                    onClick={async () => {
                      if (!newTagName.trim()) return;
                      await handleAddTag(newTagName.trim());
                      setNewTagName('');
                    }}
                    disabled={!newTagName.trim()}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40"
                  >
                    创建并添加
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Directory / File Path Info */}
          {detail.path && (() => {
            const isArchive = /\.(zip|rar|7z|tar|gz|iso|bin|7zip)$/i.test(detail.path || '');
            const ext = isArchive ? (detail.path.split('.').pop() || '').toUpperCase() : '';
            return (
              <div className="glass-panel p-3.5 rounded-2xl flex items-center gap-3 text-xs text-gray-400">
                {isArchive ? (
                  <FileArchive className="w-4 h-4 text-blue-400 shrink-0" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-gray-500 shrink-0" />
                )}
                <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-300">
                  {detail.path}
                </div>
                {isArchive && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-mono font-semibold shrink-0">
                    {ext}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
