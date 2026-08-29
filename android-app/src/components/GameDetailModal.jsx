import React, { useState, useEffect } from 'react';
import {
  X,
  Pin,
  Edit2,
  Check,
  Sparkles,
  Play,
  Download,
  FolderOpen,
  Plus,
  Trash2,
  Calendar,
  Layers,
  ImageOff,
  ExternalLink,
  Save
} from 'lucide-react';
import { api } from '../api/client';
import { useServer } from '../contexts/ServerContext';
import CoverImage from './CoverImage';

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
  const [aliasEditing, setAliasEditing] = useState(false);
  const [aliasValue, setAliasValue] = useState(game.alias || '');
  const [scraping, setScraping] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [creatingTag, setCreatingTag] = useState(false);
  const [imageError, setImageError] = useState(false);

  const cleanServerUrl = (serverUrl || '').trim().replace(/\/+$/, '');
  const coverUrl = cleanServerUrl
    ? `${cleanServerUrl}/api/covers/${detail.id}${token ? `?token=${encodeURIComponent(token)}` : ''}`
    : null;

  useEffect(() => {
    setImageError(false);
    setDetail(game);
    setAliasValue(game.alias || '');
    // 联网时拉取最新详情
    if (connected) {
      api.getGameDetail(game.id)
        .then((res) => {
          if (res) setDetail(res);
        })
        .catch(() => {});
    }
  }, [game.id, coverUrl, connected]);

  // 保存别名
  const handleSaveAlias = async () => {
    if (!connected) {
      showToast('当前处于离线缓存模式，修改别名需先连接 PC 端', 'warning');
      return;
    }
    try {
      await api.updateGameAlias(detail.id, aliasValue.trim());
      const updated = { ...detail, alias: aliasValue.trim() };
      setDetail(updated);
      onUpdateGame(updated);
      setAliasEditing(false);
      showToast('别名已更新', 'success');
    } catch (err) {
      showToast('更新别名失败: ' + err.message, 'error');
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
        const updated = {
          ...detail,
          hasCover: true,
          cover_path: res.coverPath,
          tags: res.vendorTags && res.vendorTags.length > 0 ? Array.from(new Set([...(detail.tags || []), ...res.vendorTags])) : detail.tags
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

  // 远程启动游戏
  const handleRemoteLaunch = async () => {
    if (!connected) {
      showToast('当前处于离线缓存模式，启动游戏需先连接 PC 端', 'warning');
      return;
    }
    if (launching) return;
    setLaunching(true);
    try {
      const res = await api.launchGame(detail.id);
      if (res?.success) {
        showToast(`已在电脑上启动: ${res.launchedExe || detail.name}`, 'success');
      } else {
        showToast('启动失败: ' + (res?.error || '未知原因'), 'error');
      }
    } catch (err) {
      showToast('远程启动失败: ' + err.message, 'error');
    } finally {
      setLaunching(false);
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
                fallbackTitle={detail.alias || detail.name}
              />
            </div>

            {/* Title & Alias Area */}
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <div className="text-[11px] text-gray-500 font-medium">游戏名称</div>
                <h2 className="text-base font-bold text-white leading-snug break-words">
                  {detail.name}
                </h2>
              </div>

              {/* Alias Edit */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                  <span>别名 (展示用)</span>
                  {!aliasEditing && (
                    <button
                      onClick={() => setAliasEditing(true)}
                      className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>修改</span>
                    </button>
                  )}
                </div>
                {aliasEditing ? (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={aliasValue}
                      onChange={(e) => setAliasValue(e.target.value)}
                      placeholder="设置别名/中文译名..."
                      className="flex-1 bg-gray-900 border border-indigo-500/50 rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveAlias}
                      className="p-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setAliasValue(detail.alias || '');
                        setAliasEditing(false);
                      }}
                      className="p-1.5 rounded-xl bg-gray-800 text-gray-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="text-sm font-semibold text-indigo-300 break-words">
                    {detail.alias || <span className="text-gray-600 font-normal italic">未设置别名</span>}
                  </div>
                )}
              </div>

              {/* Pinned & Imported Info */}
              <div className="flex items-center gap-2 pt-1">
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
            {/* Launch on PC */}
            <button
              onClick={handleRemoteLaunch}
              disabled={launching}
              className="glass-panel p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center active-press hover:bg-indigo-950/40 hover:border-indigo-500/40 transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center shadow-inner">
                <Play className={`w-4 h-4 fill-indigo-400 ${launching ? 'animate-bounce' : ''}`} />
              </div>
              <span className="text-xs font-bold text-white">电脑上启动</span>
              <span className="text-[10px] text-gray-400">远程调起游戏</span>
            </button>

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

            {/* Data & Saves Transfer */}
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
              <span className="text-xs font-bold text-white">数据/存档复制</span>
              <span className="text-[10px] text-gray-400">下载至手机</span>
            </button>
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

          {/* Directory Path Info (if available) */}
          {detail.path && (
            <div className="glass-panel p-3.5 rounded-2xl flex items-center gap-3 text-xs text-gray-400">
              <FolderOpen className="w-4 h-4 text-gray-500 shrink-0" />
              <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-300">
                {detail.path}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
