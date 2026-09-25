import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  QrCode,
  WifiOff,
  RefreshCw,
  Plus,
  ArrowUpDown,
  Gamepad2,
  AlertCircle,
  ChevronDown,
  Folder,
  X
} from 'lucide-react';
import { api } from './api/client';
import { ServerProvider, useServer } from './contexts/ServerContext';
import Navbar from './components/Navbar';
import GameCard from './components/GameCard';
import GameDetailModal from './components/GameDetailModal';
import ServerConnectModal from './components/ServerConnectModal';
import TagManagerModal from './components/TagManagerModal';
import StatsModal from './components/StatsModal';
import FileTransferModal from './components/FileTransferModal';
import WallpaperModal, { PRESET_WALLPAPERS } from './components/WallpaperModal';
import BulkScrapeModal from './components/BulkScrapeModal';
import {
  getServerCache,
  saveServerCache,
  updateGameInServerCache,
  preloadCovers
} from './utils/cacheStorage';
import {
  pushPendingChangesToPc,
  applyPendingChangesToGames,
  getPendingChangeCount
} from './utils/syncQueue';

function MainApp() {
  const {
    serverUrl,
    token,
    connected,
    checking,
    testConnection,
    showToast,
    updateProfileGameCount
  } = useServer();

  // 壁纸与个性化配置
  const [wallpaperConfig, setWallpaperConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('mygal_wallpaper_config');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { presetId: 'none', customImage: null, blur: 8, opacity: 0.65 };
  });
  const [wallpaperOpen, setWallpaperOpen] = useState(false);

  const handleUpdateWallpaper = (partial) => {
    setWallpaperConfig((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem('mygal_wallpaper_config', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // 状态管理
  const [games, setGames] = useState([]);
  const [tags, setTags] = useState([]);
  const [rootPaths, setRootPaths] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // 离线缓存与全量同步进度状态 (0 ~ 100，null 时隐藏进度条)
  const [cacheProgress, setCacheProgress] = useState(null);
  const [isOfflineCache, setIsOfflineCache] = useState(false);
  const [cachedTime, setCachedTime] = useState(null);
  const [cachedTotal, setCachedTotal] = useState(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(() =>
    serverUrl ? getPendingChangeCount(serverUrl) : 0
  );
  const syncInProgressRef = useRef(false);
  const loadGamesRef = useRef(null);
  const cachedGamesRef = useRef([]);
  const prevConnectedRef = useRef(false);
  const bottomSentinelRef = useRef(null);

  // 监听待同步离线修改队列变化
  useEffect(() => {
    setPendingSyncCount(serverUrl ? getPendingChangeCount(serverUrl) : 0);
    const handleQueueChange = () => {
      setPendingSyncCount(serverUrl ? getPendingChangeCount(serverUrl) : 0);
    };
    window.addEventListener('mygal:pending-changes-updated', handleQueueChange);
    return () => {
      window.removeEventListener('mygal:pending-changes-updated', handleQueueChange);
    };
  }, [serverUrl]);

  // 视图与检索配置
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [categoryType, setCategoryType] = useState('folder'); // 'folder' | 'tag'
  const [activeTag, setActiveTag] = useState('');
  const [activeRootPathId, setActiveRootPathId] = useState(null);
  const [sortField, setSortField] = useState('imported_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('mygal_view_mode') || 'grid2');

  // 弹窗状态
  const [connectOpen, setConnectOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [bulkScrapeOpen, setBulkScrapeOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [fileTransferGame, setFileTransferGame] = useState(null);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 记录视图模式
  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('mygal_view_mode', mode);
  };

  // 内存中高效过滤与排序完整缓存数据 (纯本地执行，零网络延迟)
  const filterOfflineGames = useCallback(
    (allCachedGames) => {
      if (!Array.isArray(allCachedGames)) return [];
      let filtered = [...allCachedGames];

      // 关键词过滤
      if (debouncedQuery) {
        const q = debouncedQuery.toLowerCase();
        filtered = filtered.filter(
          (g) =>
            (g.name && g.name.toLowerCase().includes(q)) ||
            (g.alias && g.alias.toLowerCase().includes(q)) ||
            (g.path && g.path.toLowerCase().includes(q))
        );
      }

      // 标签过滤
      if (activeTag) {
        filtered = filtered.filter((g) => Array.isArray(g.tags) && g.tags.includes(activeTag));
      }

      // 目录过滤 (兼容多路径、root_path_id 与 manual)
      if (activeRootPathId !== null) {
        filtered = filtered.filter(
          (g) =>
            (Array.isArray(g.rootPathIds) && g.rootPathIds.includes(activeRootPathId)) ||
            g.root_path_id === activeRootPathId ||
            g.rootPathId === activeRootPathId ||
            (activeRootPathId === 'others' && (g.isManual || g.is_manual))
        );
      }

      // 排序（置顶项始终排在最前面）
      filtered.sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) {
          return a.pinned ? -1 : 1;
        }
        if (sortField === 'imported_at') {
          const tA = Number(a.importedAt || a.imported_at) || 0;
          const tB = Number(b.importedAt || b.imported_at) || 0;
          return sortOrder === 'asc' ? tA - tB : tB - tA;
        } else {
          const nA = String(a.alias || a.name || '');
          const nB = String(b.alias || b.name || '');
          return sortOrder === 'asc' ? nA.localeCompare(nB) : nB.localeCompare(nA);
        }
      });

      return filtered;
    },
    [debouncedQuery, activeTag, activeRootPathId, sortField, sortOrder]
  );

  // 加载元数据 (带自愈提取与防丢失保护)
  const loadMetadata = useCallback(async () => {
    if (!serverUrl) {
      setTags([]);
      setRootPaths([]);
      cachedGamesRef.current = [];
      return;
    }

    const cache = await getServerCache(serverUrl);
    let resolvedTags = Array.isArray(cache?.tags) ? cache.tags : [];
    let resolvedPaths = Array.isArray(cache?.rootPaths) ? cache.rootPaths : [];
    const cachedGames = Array.isArray(cache?.games) ? cache.games : [];

    // 标签自愈提取机制：若缓存中的标签列表为空，从已有游戏列表中动态反推提取，保证离线不丢标签
    if (resolvedTags.length === 0 && cachedGames.length > 0) {
      const tagSet = new Set();
      for (const g of cachedGames) {
        if (Array.isArray(g.tags)) {
          for (const t of g.tags) {
            const name = typeof t === 'string' ? t.trim() : t?.name?.trim();
            if (name) tagSet.add(name);
          }
        }
      }
      if (tagSet.size > 0) {
        resolvedTags = Array.from(tagSet)
          .sort()
          .map((name) => ({ id: name, name, color: '#6366f1' }));
      }
    }

    setTags(resolvedTags);
    setRootPaths(resolvedPaths);

    if (cachedGames.length > 0) {
      cachedGamesRef.current = cachedGames;
      setCachedTotal(cachedGames.length);
      if (cache?.updatedAt) {
        setCachedTime(new Date(cache.updatedAt).toLocaleString('zh-CN'));
      }
    }
  }, [serverUrl]);

  // 本地优先加载游戏列表 (统一走前端内存分页，彻底杜绝断网翻页报错)
  const loadGames = useCallback(
    async (targetPage = 1, isAppend = false) => {
      const PAGE_SIZE = 40;

      if (!serverUrl) {
        setGames([]);
        setTotal(0);
        setHasMore(false);
        return;
      }

      if (isAppend) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        let allItems = cachedGamesRef.current;
        if (!Array.isArray(allItems) || allItems.length === 0) {
          const cache = await getServerCache(serverUrl);
          if (cache && Array.isArray(cache.games) && cache.games.length > 0) {
            allItems = cache.games;
            cachedGamesRef.current = cache.games;
          } else {
            allItems = [];
          }
        }

        // 叠加应用本地待推送修改（避免网络延迟导致短暂闪回旧数据）
        const safeItems = applyPendingChangesToGames(allItems, serverUrl);
        const allFiltered = filterOfflineGames(safeItems);
        const startIndex = (targetPage - 1) * PAGE_SIZE;
        const pageSlice = allFiltered.slice(startIndex, startIndex + PAGE_SIZE);

        if (isAppend) {
          setGames((prev) => [...prev, ...pageSlice]);
        } else {
          setGames(pageSlice);
        }

        setTotal(allFiltered.length);
        setPage(targetPage);
        setHasMore(targetPage * PAGE_SIZE < allFiltered.length);
        setCachedTotal(allItems.length);
        setIsOfflineCache(!connected);
      } catch (err) {
        console.warn('Failed to load local games:', err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [serverUrl, connected, filterOfflineGames]
  );

  loadGamesRef.current = loadGames;

  // 后台全量同步离线缓存与全库封面预热
  const syncOfflineCache = useCallback(
    async (isManual = false) => {
      if (!connected || !serverUrl || syncInProgressRef.current) return;
      syncInProgressRef.current = true;
      setCacheProgress(2);

      try {
        // 1. 优先推送离线期间在移动端积累的修改到 PC 端 (严格保证先推后拉)
        await pushPendingChangesToPc(serverUrl, api, isManual ? showToast : null);

        // 2. 并行拉取 PC 端最新元数据与完整游戏列表
        const [tagList, pathList, allGamesRes] = await Promise.all([
          api.getTags().catch(() => null),
          api.getRootPaths().catch(() => null),
          api.getAllGames().catch((err) => {
            console.warn('getAllGames failed during sync:', err);
            return null;
          })
        ]);

        const safeTags = Array.isArray(tagList) && tagList.length > 0 ? tagList : null;
        const safePaths = Array.isArray(pathList) && pathList.length > 0 ? pathList : null;

        if (allGamesRes?.items && Array.isArray(allGamesRes.items)) {
          const allItems = applyPendingChangesToGames(allGamesRes.items, serverUrl);
          const realTotal = typeof allGamesRes.total === 'number' ? allGamesRes.total : allItems.length;

          // 保存完整游戏列表与分类元数据到 IndexedDB (带安全防覆写保护)
          await saveServerCache(serverUrl, {
            games: allItems,
            total: realTotal,
            ...(safeTags ? { tags: safeTags } : {}),
            ...(safePaths ? { rootPaths: safePaths } : {})
          });

          cachedGamesRef.current = allItems;
          if (safeTags) setTags(safeTags);
          if (safePaths) setRootPaths(safePaths);
          setCachedTotal(allItems.length);
          setCachedTime(new Date().toLocaleString('zh-CN'));
          updateProfileGameCount?.(serverUrl, realTotal);

          // 静默刷新本地视图
          loadGamesRef.current?.(1, false);

          if (isManual) {
            showToast(`已从 PC 同步最新数据 (共 ${allItems.length} 款游戏)`, 'success', 2000);
          }

          // 全量并发预热所有游戏封面 (轻量化 20KB WebP)
          setCacheProgress(5);
          await preloadCovers(
            serverUrl,
            allItems,
            token,
            (coverPct) => {
              setCacheProgress(Math.min(99, Math.round(5 + coverPct * 0.94)));
            }
          );
        } else if (safeTags || safePaths) {
          await saveServerCache(serverUrl, {
            ...(safeTags ? { tags: safeTags } : {}),
            ...(safePaths ? { rootPaths: safePaths } : {})
          });
          if (safeTags) setTags(safeTags);
          if (safePaths) setRootPaths(safePaths);
        }

        setCacheProgress(100);
        setTimeout(() => {
          setCacheProgress(null);
        }, 500);
      } catch (err) {
        console.warn('Sync offline cache error:', err);
        setCacheProgress(null);
        if (isManual) {
          showToast('从 PC 同步失败: ' + err.message, 'error');
        }
      } finally {
        syncInProgressRef.current = false;
      }
    },
    [connected, serverUrl, token, showToast, updateProfileGameCount]
  );

  // 感知时机 ①：连接建立的瞬间（首次连上 PC 或断线重连恢复），自动触发后台静默同步
  useEffect(() => {
    if (!prevConnectedRef.current && connected) {
      syncOfflineCache(false);
    }
    prevConnectedRef.current = connected;
  }, [connected, syncOfflineCache]);

  // 依赖变化触发本地过滤刷新 (不再依赖网络状态，纯本地毫秒级过滤)
  useEffect(() => {
    if (!serverUrl) {
      setGames([]);
      setTags([]);
      setRootPaths([]);
      setTotal(0);
      setIsOfflineCache(false);
      setCachedTime(null);
      return;
    }
    loadMetadata();
    loadGames(1, false);
  }, [
    serverUrl,
    debouncedQuery,
    activeTag,
    activeRootPathId,
    sortField,
    sortOrder,
    loadMetadata,
    loadGames
  ]);

  // 底部无限滚动自动触底加载 (距底 300px 自动无感预加载下一页)
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadGames(page + 1, true);
        }
      },
      { rootMargin: '300px' }
    );
    const el = bottomSentinelRef.current;
    if (el) observer.observe(el);
    return () => {
      if (el) observer.unobserve(el);
    };
  }, [hasMore, loadingMore, page, loadGames]);

  // 更新局部游戏状态并同步到 IndexedDB 缓存
  const handleUpdateGame = (updatedGame) => {
    // 1. 同步更新内存中的全量列表缓存
    if (Array.isArray(cachedGamesRef.current)) {
      cachedGamesRef.current = cachedGamesRef.current.map((g) =>
        g.id === updatedGame.id ? { ...g, ...updatedGame } : g
      );
    }
    // 2. 更新当前渲染列表
    setGames((prev) => {
      const next = prev.map((g) => (g.id === updatedGame.id ? { ...g, ...updatedGame } : g));
      if ('pinned' in updatedGame) {
        return [...next].sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) {
            return a.pinned ? -1 : 1;
          }
          return 0;
        });
      }
      return next;
    });
    if (selectedGame?.id === updatedGame.id) {
      setSelectedGame((prev) => ({ ...prev, ...updatedGame }));
    }
    if (serverUrl) {
      updateGameInServerCache(serverUrl, updatedGame);
    }
  };

  // 排序切换
  const handleSortToggle = () => {
    if (sortField === 'imported_at') {
      if (sortOrder === 'desc') setSortOrder('asc');
      else {
        setSortField('name');
        setSortOrder('asc');
      }
    } else {
      setSortField('imported_at');
      setSortOrder('desc');
    }
  };

  // 当前所选根目录名称
  const activeRootPathName = rootPaths.find((p) => p.id === activeRootPathId)?.name;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col selection:bg-indigo-500 selection:text-white relative">
      {/* --- Dynamic Background Wallpaper Layer --- */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {wallpaperConfig.presetId === 'custom' && wallpaperConfig.customImage ? (
          <div
            className="absolute inset-0 bg-cover bg-center transition-all duration-500 scale-105"
            style={{
              backgroundImage: `url(${wallpaperConfig.customImage})`,
              filter: `blur(${wallpaperConfig.blur}px)`
            }}
          />
        ) : wallpaperConfig.presetId !== 'none' ? (
          <div
            className="absolute inset-0 transition-all duration-500 scale-105"
            style={{
              ...(PRESET_WALLPAPERS.find((p) => p.id === wallpaperConfig.presetId)?.style || {}),
              filter: `blur(${wallpaperConfig.blur}px)`
            }}
          />
        ) : null}
        {/* Dark overlay mask */}
        <div
          className="absolute inset-0 transition-colors duration-500"
          style={{
            backgroundColor:
              wallpaperConfig.presetId === 'none'
                ? '#030712'
                : `rgba(3, 7, 18, ${wallpaperConfig.opacity})`
          }}
        />
      </div>

      {/* Top Navbar */}
      <Navbar
        onOpenConnect={() => setConnectOpen(true)}
        onOpenStats={() => setStatsOpen(true)}
        onOpenTags={() => setTagsOpen(true)}
        onOpenWallpaper={() => setWallpaperOpen(true)}
        onOpenBulkScrape={() => setBulkScrapeOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        categoryType={categoryType}
        onCategoryTypeChange={setCategoryType}
        activeTag={activeTag}
        onSelectTag={(t) => {
          setActiveTag(t);
          setPage(1);
        }}
        tags={tags}
        activeRootPathId={activeRootPathId}
        onSelectRootPath={(id) => {
          setActiveRootPathId(id);
          setPage(1);
        }}
        rootPaths={rootPaths}
        onRefreshList={async () => {
          if (serverUrl) {
            const pingRes = await testConnection(serverUrl, token, false, true);
            if (pingRes?.success) {
              showToast('正在从 PC 端同步数据...', 'info', 1500);
              await syncOfflineCache(true);
            } else {
              showToast('未连通 PC 端，已刷新本地离线数据', 'warning', 2500);
              await loadMetadata();
              loadGames(1, false);
            }
          } else {
            await loadMetadata();
            loadGames(1, false);
          }
        }}
        loading={loading}
        cacheProgress={cacheProgress}
        pendingSyncCount={pendingSyncCount}
      />

      {/* Main Content Area */}
      <main className="flex-1 px-3.5 py-2.5 max-w-4xl mx-auto w-full pb-16 relative z-10">
        {/* 未连接且无任何离线缓存时显示配对引导 */}
        {!connected && !isOfflineCache && games.length === 0 ? (
          <div className="my-10 glass-panel rounded-3xl p-7 text-center space-y-4 border border-white/10 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 text-indigo-400 mx-auto flex items-center justify-center shadow-inner">
              <WifiOff className="w-7 h-7" />
            </div>
            <div className="space-y-1.5 max-w-sm mx-auto">
              <h2 className="text-lg font-bold text-white">尚未连接 PC 端 myGal</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                在同一 WiFi 局域网下，打开电脑端 myGal 设置页扫描二维码即可配对
              </p>
            </div>
            <button
              onClick={() => setConnectOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 active-press transition-all flex items-center gap-2 mx-auto"
            >
              <QrCode className="w-4 h-4" />
              <span>扫码连接电脑</span>
            </button>
          </div>
        ) : (
          <>
            {/* 离线缓存提示胶囊条 (精简紧凑) */}
            {isOfflineCache && (
              <div className="mb-2.5 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 flex items-center justify-between gap-2 shadow-sm">
                <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                  <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="font-bold">离线模式</span>
                  <span className="text-gray-400 truncate text-[10px]">
                    (已缓存 {cachedTotal || total} 款游戏{cachedTime ? ` · ${cachedTime}` : ''})
                  </span>
                </div>
                <button
                  onClick={() => setConnectOpen(true)}
                  className="text-[10px] px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-medium shrink-0 active-press transition-all"
                >
                  连接
                </button>
              </div>
            )}

            {/* List Header Filter Status & Sort Bar */}
            <div className="flex items-center justify-between text-xs text-gray-400 mb-2.5 px-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span>共</span>
                <span className="font-bold text-white font-mono">{total}</span>
                <span>款</span>
                {activeRootPathName && (
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-medium flex items-center gap-1">
                    <Folder className="w-2.5 h-2.5" />
                    <span>{activeRootPathName}</span>
                  </span>
                )}
                {activeTag && (
                  <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-medium">
                    #{activeTag}
                  </span>
                )}
              </div>

              <button
                onClick={handleSortToggle}
                className="flex items-center gap-1 hover:text-white transition-colors bg-gray-900/60 px-2 py-1 rounded-lg border border-white/5 text-[11px] shrink-0"
              >
                <ArrowUpDown className="w-3 h-3 text-indigo-400" />
                <span>
                  {sortField === 'imported_at'
                    ? sortOrder === 'desc'
                      ? '导入时间 ↓'
                      : '导入时间 ↑'
                    : '名称 A-Z'}
                </span>
              </button>
            </div>

            {/* Game Card Grid/List */}
            {loading && games.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-xs text-gray-400">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <span>正在加载游戏列表...</span>
              </div>
            ) : games.length === 0 ? (
              <div className="py-20 text-center text-xs text-gray-500 space-y-2">
                <Gamepad2 className="w-10 h-10 mx-auto text-gray-700 mb-2" />
                <p>未找到匹配的游戏数据</p>
                {(searchQuery || activeTag || activeRootPathId !== null) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setActiveTag('');
                      setActiveRootPathId(null);
                    }}
                    className="text-indigo-400 underline"
                  >
                    清除所有筛选条件
                  </button>
                )}
              </div>
            ) : (
              <>
                <div
                  className={`grid gap-2.5 ${
                    viewMode === 'grid2'
                      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
                      : viewMode === 'grid3'
                      ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6'
                      : 'grid-cols-1'
                  }`}
                >
                  {games.map((g) => (
                    <GameCard
                      key={g.id}
                      game={g}
                      viewMode={viewMode}
                      onClick={(item) => setSelectedGame(item)}
                    />
                  ))}
                </div>

                {/* Load More Button & Infinite Scroll Sentinel */}
                {hasMore && (
                  <div className="pt-5 pb-3 text-center">
                    <button
                      onClick={() => loadGames(page + 1, true)}
                      disabled={loadingMore}
                      className="px-5 py-2 rounded-xl bg-gray-900/80 hover:bg-gray-850 text-xs font-semibold text-gray-300 hover:text-white border border-white/5 active-press transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {loadingMore ? (
                        <>
                          <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                          <span>加载中...</span>
                        </>
                      ) : (
                        <>
                          <span>加载更多</span>
                          <ChevronDown className="w-3 h-3 text-gray-500" />
                        </>
                      )}
                    </button>
                  </div>
                )}
                {hasMore && <div ref={bottomSentinelRef} className="h-4 w-full pointer-events-none" />}
              </>
            )}
          </>
        )}
      </main>

      {/* --- Modals --- */}
      {/* Game Detail Modal */}
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          allTags={tags}
          rootPaths={rootPaths}
          onClose={() => setSelectedGame(null)}
          onUpdateGame={handleUpdateGame}
          onOpenFileTransfer={(g) => {
            setSelectedGame(null);
            setFileTransferGame(g);
          }}
        />
      )}

      {/* File & Saves Transfer Modal */}
      {fileTransferGame && (
        <FileTransferModal
          game={fileTransferGame}
          isOpen={!!fileTransferGame}
          onClose={() => setFileTransferGame(null)}
        />
      )}

      {/* Server Connect Modal */}
      <ServerConnectModal
        isOpen={connectOpen}
        onClose={() => setConnectOpen(false)}
      />

      {/* Tag Manager Modal */}
      <TagManagerModal
        isOpen={tagsOpen}
        tags={tags}
        onClose={() => setTagsOpen(false)}
        onTagsUpdated={() => {
          loadMetadata();
          loadGames(page, false);
        }}
      />

      {/* Stats Modal */}
      <StatsModal
        isOpen={statsOpen}
        onClose={() => setStatsOpen(false)}
      />

      {/* Wallpaper Personalization Modal */}
      <WallpaperModal
        isOpen={wallpaperOpen}
        onClose={() => setWallpaperOpen(false)}
        wallpaperConfig={wallpaperConfig}
        onUpdateWallpaper={handleUpdateWallpaper}
        showToast={showToast}
      />

      {/* Bulk Scrape Modal */}
      <BulkScrapeModal
        isOpen={bulkScrapeOpen}
        onClose={() => setBulkScrapeOpen(false)}
        allGames={cachedGamesRef.current && cachedGamesRef.current.length > 0 ? cachedGamesRef.current : games}
        rootPaths={rootPaths}
        onBulkComplete={() => {
          loadMetadata();
          loadGames(1, false);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ServerProvider>
      <MainApp />
    </ServerProvider>
  );
}

