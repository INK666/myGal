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
  SlidersHorizontal,
  ChevronRight,
  Palette
} from 'lucide-react';
import { useServer } from '../contexts/ServerContext';

export default function Navbar({
  onOpenConnect,
  onOpenStats,
  onOpenTags,
  onOpenWallpaper,
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
  sortField,
  sortOrder,
  onSortChange,
  onRefreshList,
  loading
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

  return (
    <header className="sticky top-0 z-40 bg-gray-950/85 backdrop-blur-xl border-b border-white/5 pt-safe">
      {/* Top Brand & Action Bar */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        {/* Brand & Connection Badge */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gray-900 overflow-hidden shrink-0 shadow-lg shadow-indigo-600/20 border border-white/10 flex items-center justify-center">
            <img src="/icon.png" alt="myGal" className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-base tracking-tight text-white">myGal</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono font-medium">
                Mobile
              </span>
            </div>
            <button
              onClick={onOpenConnect}
              className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-200 transition-colors"
              title="点击打开 PC 连接匹配窗口"
            >
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="truncate max-w-[130px] font-mono">
                {checking
                  ? (displayHost ? `${displayHost}...` : '连接中...')
                  : connected
                  ? displayHost
                  : displayHost
                  ? `${displayHost} (离线)`
                  : '未连接'}
              </span>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenWallpaper}
            className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="个性化壁纸"
          >
            <Palette className="w-4 h-4 text-pink-400" />
          </button>
          <button
            onClick={onRefreshList}
            disabled={loading}
            className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all disabled:opacity-50"
            title="刷新游戏库"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
          <button
            onClick={onOpenTags}
            className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="标签管理"
          >
            <Tags className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenStats}
            className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-900/60 hover:bg-gray-800 border border-white/5 active-press transition-all"
            title="统计概览"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search & Layout Control Bar */}
      <div className="px-4 pb-2.5 flex items-center gap-2">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索游戏名、别名、路径..."
            className="w-full bg-gray-900/90 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-gray-900/90 border border-white/10 rounded-xl p-0.5">
          <button
            onClick={() => onViewModeChange('grid2')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grid2' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
            title="双列画廊"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange('grid3')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grid3' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
            title="三列紧凑"
          >
            <Grid3X3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'list' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
            title="详细列表"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Category Type Switcher (目录分类 vs 标签分类) */}
      <div className="px-4 pb-1.5 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1 bg-gray-900/70 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => onCategoryTypeChange('folder')}
            className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              categoryType === 'folder'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>目录分类</span>
            {rootPaths.length > 0 && (
              <span className="text-[10px] opacity-75 font-mono">({rootPaths.length})</span>
            )}
          </button>
          <button
            onClick={() => onCategoryTypeChange('tag')}
            className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              categoryType === 'tag'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Tags className="w-3.5 h-3.5" />
            <span>标签分类</span>
            {tags.length > 0 && (
              <span className="text-[10px] opacity-75 font-mono">({tags.length})</span>
            )}
          </button>
        </div>

        {/* Active Filter Clear Helper */}
        {(activeTag || activeRootPathId !== null) && (
          <button
            onClick={() => {
              onSelectTag('');
              onSelectRootPath(null);
            }}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium bg-indigo-500/10 px-2 py-1 rounded-lg"
          >
            <span>重置筛选</span>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Horizontal Chips Filter Bar */}
      <div className="px-4 pb-2.5 overflow-x-auto flex items-center gap-1.5 no-scrollbar">
        {categoryType === 'folder' ? (
          /* --- 目录分类 Chips --- */
          <>
            <button
              onClick={() => onSelectRootPath(null)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                activeRootPathId === null
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
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
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-gray-900/80 hover:bg-gray-850 text-gray-300 border border-white/5'
                  }`}
                >
                  <Folder className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-amber-400'}`} />
                  <span className="max-w-[150px] truncate">{rp.name}</span>
                  {typeof rp.gameCount === 'number' && (
                    <span className="text-[10px] font-mono opacity-70 bg-black/30 px-1.5 py-0.2 rounded-full">
                      {rp.gameCount}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        ) : (
          /* --- 标签分类 Chips --- */
          <>
            <button
              onClick={() => onSelectTag('')}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                !activeTag
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
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
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-gray-900/80 hover:bg-gray-850 text-gray-300 border border-white/5'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: t.color || '#6366f1' }}
                  />
                  <span>{t.name}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </header>
  );
}
