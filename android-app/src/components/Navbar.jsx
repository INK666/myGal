import React from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  BarChart3,
  Tags,
  FolderTree,
  Folder,
  LayoutGrid,
  Grid3X3,
  List,
  Search,
  X,
  Palette,
  CloudUpload,
  Sparkles,
  Upload
} from 'lucide-react';
import { useServer } from '../contexts/ServerContext';

export default function Navbar({
  onOpenConnect,
  onOpenStats,
  onOpenTags,
  onOpenWallpaper,
  onOpenBulkScrape,
  onOpenUpload,
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  categoryType, // 'tag' | 'folder'
  onCategoryTypeChange,
  activeTag,
  onSelectTag,
  tags = [],
  activeRootPathId,
  onSelectRootPath,
  rootPaths = [],
  onRefreshList,
  loading,
  cacheProgress = null, // 0 ~ 100 缓存微进度条 (null 时隐藏)
  pendingSyncCount = 0
}) {
  const { connected, checking, serverUrl } = useServer();

  // 提取 IP / Host 地址用于左上角展示
  const displayHost = (() => {
    if (!serverUrl) return '';
    try {
      const u = new URL(serverUrl.startsWith('http') ? serverUrl : `http://${serverUrl}`);
      return u.hostname || u.host || serverUrl;
    } catch {
      return serverUrl.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0] || serverUrl;
    }
  })();

  const isSyncing = cacheProgress !== null && cacheProgress >= 0 && cacheProgress < 100;
  const showProgressBar = cacheProgress !== null && cacheProgress >= 0;

  return (
    <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur-xl border-b border-white/10 pt-safe relative">
      {/* 1. Top Brand & Action Bar (品牌与主要操作) */}
      <div className="px-3.5 pt-2.5 pb-2 flex items-center justify-between gap-2">
        {/* Brand & Connection Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gray-900 overflow-hidden shrink-0 shadow-md shadow-indigo-600/20 border border-white/10 flex items-center justify-center">
            <img src="/icon.png" alt="myGal" className="w-full h-full object-cover" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-extrabold text-sm tracking-tight text-white shrink-0">myGal</span>
            <button
              onClick={onOpenConnect}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-200 bg-gray-900/80 hover:bg-gray-800 px-2 py-0.5 rounded-md border border-white/5 transition-all truncate"
              title="点击打开 PC 连接匹配窗口"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'
                }`}
              />
              <span className="truncate max-w-[110px] font-mono text-[10px]">
                {checking
                  ? (displayHost ? `${displayHost}...` : '连接中...')
                  : connected
                  ? displayHost
                  : displayHost
                  ? `${displayHost} (离线)`
                  : '未连接'}
              </span>
            </button>
            {pendingSyncCount > 0 && (
              <div
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 font-medium"
                title={`${pendingSyncCount} 项离线修改待推送到 PC 端`}
              >
                <CloudUpload className="w-3 h-3 text-amber-400 animate-pulse shrink-0" />
                <span className="whitespace-nowrap">{pendingSyncCount} 待同步</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onOpenWallpaper}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="个性化壁纸"
          >
            <Palette className="w-3.5 h-3.5 text-pink-400" />
          </button>
          <button
            onClick={onRefreshList}
            disabled={loading || isSyncing}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all disabled:opacity-50"
            title="刷新游戏库并同步离线缓存"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading || isSyncing ? 'animate-spin text-indigo-400' : ''}`}
            />
          </button>
          <button
            onClick={onOpenTags}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="标签管理"
          >
            <Tags className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenStats}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="统计概览"
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenBulkScrape}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="移动端批量刮削与策略"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          </button>
          <button
            onClick={onOpenUpload}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="上传游戏到 PC"
          >
            <Upload className="w-3.5 h-3.5 text-green-400" />
          </button>
        </div>
      </div>

      {/* 2. Search & View Mode Switcher (搜索与视图切换) */}
      <div className="px-3.5 pb-2 flex items-center gap-2">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索游戏、别名、标签、目录..."
            className="w-full bg-gray-900/90 border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-gray-900/90 border border-white/10 rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => onViewModeChange('grid2')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'grid2' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
            title="双列画廊"
          >
            <LayoutGrid className="w-3 h-3" />
          </button>
          <button
            onClick={() => onViewModeChange('grid3')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'grid3' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
            title="三列紧凑"
          >
            <Grid3X3 className="w-3 h-3" />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'list' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
            title="详细列表"
          >
            <List className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 3. Unified Category & Filter Chips (单行融合分类切换与筛选 Chips) */}
      <div className="px-3.5 pb-2 overflow-x-auto flex items-center gap-1.5 no-scrollbar">
        {/* Category Switcher Pill (目录 / 标签切换) */}
        <div className="flex items-center bg-gray-900/90 p-0.5 rounded-lg border border-white/10 shrink-0">
          <button
            onClick={() => onCategoryTypeChange('folder')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              categoryType === 'folder'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <FolderTree className="w-3 h-3" />
            <span>目录</span>
            {rootPaths.length > 0 && (
              <span className="text-[9px] opacity-70 font-mono">({rootPaths.length})</span>
            )}
          </button>
          <button
            onClick={() => onCategoryTypeChange('tag')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              categoryType === 'tag'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Tags className="w-3 h-3" />
            <span>标签</span>
            {tags.length > 0 && (
              <span className="text-[9px] opacity-70 font-mono">({tags.length})</span>
            )}
          </button>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-3.5 bg-white/10 shrink-0 mx-0.5" />

        {/* Chips 按分类类型展示 */}
        {categoryType === 'folder' ? (
          <>
            <button
              onClick={() => onSelectRootPath(null)}
              className={`shrink-0 px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                activeRootPathId === null
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-900/80 hover:bg-gray-850 text-gray-400 border border-white/5'
              }`}
            >
              全部目录
            </button>
            {rootPaths.map((rp) => {
              const isSelected = activeRootPathId === rp.id;
              return (
                <button
                  key={rp.id}
                  onClick={() => onSelectRootPath(isSelected ? null : rp.id)}
                  className={`shrink-0 px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-900/80 hover:bg-gray-850 text-gray-300 border border-white/5'
                  }`}
                >
                  <Folder className={`w-3 h-3 ${isSelected ? 'text-white' : 'text-amber-400'}`} />
                  <span className="max-w-[120px] truncate">{rp.name}</span>
                  {typeof rp.gameCount === 'number' && (
                    <span className="text-[9px] font-mono opacity-70 bg-black/30 px-1 rounded">
                      {rp.gameCount}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        ) : (
          <>
            <button
              onClick={() => onSelectTag('')}
              className={`shrink-0 px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                !activeTag
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-900/80 hover:bg-gray-850 text-gray-400 border border-white/5'
              }`}
            >
              全部
            </button>
            {tags.map((t) => {
              const isSelected = activeTag === t.name;
              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTag(isSelected ? '' : t.name)}
                  className={`shrink-0 px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-900/80 hover:bg-gray-850 text-gray-300 border border-white/5'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: t.color || '#6366f1' }}
                  />
                  <span className="truncate max-w-[100px]">{t.name}</span>
                </button>
              );
            })}
          </>
        )}

        {/* 快捷重置按钮 */}
        {(activeTag || activeRootPathId !== null) && (
          <button
            onClick={() => {
              onSelectTag('');
              onSelectRootPath(null);
            }}
            className="shrink-0 text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 font-medium bg-indigo-500/10 px-1.5 py-0.5 rounded-md border border-indigo-500/20"
            title="重置当前分类筛选"
          >
            <span>重置</span>
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* 4. Cache Sync Micro Progress Bar (纯视觉无文字流光微进度条) */}
      {showProgressBar && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-900/50 overflow-hidden pointer-events-none">
          <div
            className={`h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(99,102,241,0.8)] ${
              cacheProgress >= 100 ? 'opacity-0 transition-opacity duration-500' : 'opacity-100'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, cacheProgress))}%` }}
          />
        </div>
      )}
    </header>
  );
}
