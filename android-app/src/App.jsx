import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  QrCode,
  WifiOff,
  RefreshCw,
  Plus,
  ArrowUpDown,
  Gamepad2,
  AlertCircle,
  SlidersHorizontal,
  ChevronDown,
  Folder
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

function MainApp() {
  const { connected, checking, showToast } = useServer();

  // 状态管理
  const [games, setGames] = useState([]);
  const [tags, setTags] = useState([]);
  const [rootPaths, setRootPaths] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

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

  // 加载标签和目录列表
  const loadMetadata = useCallback(async () => {
    if (!connected) return;
    try {
      const [tagList, pathList] = await Promise.all([
        api.getTags().catch(() => []),
        api.getRootPaths().catch(() => [])
      ]);
      setTags(Array.isArray(tagList) ? tagList : []);
      setRootPaths(Array.isArray(pathList) ? pathList : []);
    } catch {}
  }, [connected]);

  // 加载游戏列表
  const loadGames = useCallback(async (targetPage = 1, isAppend = false) => {
    if (!connected) return;
    if (isAppend) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.getGames({
        page: targetPage,
        pageSize: 40,
        query: debouncedQuery,
        tag: activeTag,
        rootPathId: activeRootPathId,
        sort: sortField,
        order: sortOrder
      });

      if (res?.items) {
        if (isAppend) {
          setGames((prev) => [...prev, ...res.items]);
        } else {
          setGames(res.items);
        }
        setTotal(res.total || 0);
        setPage(targetPage);
        setHasMore(targetPage * 40 < res.total);
      }
    } catch (err) {
      showToast('加载游戏列表失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [connected, debouncedQuery, activeTag, activeRootPathId, sortField, sortOrder, showToast]);

  // 依赖变化触发重新加载
  useEffect(() => {
    if (connected) {
      loadMetadata();
      loadGames(1, false);
    } else {
      setGames([]);
      setTotal(0);
    }
  }, [connected, debouncedQuery, activeTag, activeRootPathId, sortField, sortOrder]);

  // 更新局部游戏状态
  const handleUpdateGame = (updatedGame) => {
    setGames((prev) =>
      prev.map((g) => (g.id === updatedGame.id ? { ...g, ...updatedGame } : g))
    );
    if (selectedGame?.id === updatedGame.id) {
      setSelectedGame((prev) => ({ ...prev, ...updatedGame }));
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
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        onOpenConnect={() => setConnectOpen(true)}
        onOpenStats={() => setStatsOpen(true)}
        onOpenTags={() => setTagsOpen(true)}
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
        sortField={sortField}
        sortOrder={sortOrder}
        onSortChange={setSortField}
        onRefreshList={() => {
          loadMetadata();
          loadGames(1, false);
        }}
        loading={loading}
      />

      {/* Main Content Area */}
      <main className="flex-1 px-4 py-3 max-w-4xl mx-auto w-full pb-16">
        {/* 未连接状态 Hero 提示 */}
        {!connected ? (
          <div className="my-12 glass-panel rounded-3xl p-8 text-center space-y-5 border border-white/10 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 text-indigo-400 mx-auto flex items-center justify-center shadow-inner">
              <WifiOff className="w-8 h-8" />
            </div>
            <div className="space-y-2 max-w-sm mx-auto">
              <h2 className="text-xl font-bold text-white">尚未连接 PC 端 myGal</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                在同一 WiFi 局域网下，打开电脑上的 myGal 设置页，点击下方按钮扫描二维码即可一秒完成配对！
              </p>
            </div>
            <button
              onClick={() => setConnectOpen(true)}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 active-press transition-all flex items-center gap-2 mx-auto"
            >
              <QrCode className="w-4 h-4" />
              <span>扫码连接电脑</span>
            </button>
          </div>
        ) : (
          <>
            {/* List Header Filter Status */}
            <div className="flex items-center justify-between text-xs text-gray-400 mb-3 px-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span>共</span>
                <span className="font-bold text-white font-mono">{total}</span>
                <span>款游戏</span>
                {activeRootPathName && (
                  <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 font-medium flex items-center gap-1">
                    <Folder className="w-3 h-3" />
                    <span>{activeRootPathName}</span>
                  </span>
                )}
                {activeTag && (
                  <span className="px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 font-medium">
                    #{activeTag}
                  </span>
                )}
              </div>

              <button
                onClick={handleSortToggle}
                className="flex items-center gap-1 hover:text-white transition-colors bg-gray-900/60 px-2.5 py-1 rounded-xl border border-white/5 shrink-0"
              >
                <ArrowUpDown className="w-3 h-3 text-indigo-400" />
                <span>{sortField === 'imported_at' ? (sortOrder === 'desc' ? '导入时间 ↓' : '导入时间 ↑') : '名称 A-Z'}</span>
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
                  className={`grid gap-3 ${
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

                {/* Load More Button */}
                {hasMore && (
                  <div className="pt-6 pb-4 text-center">
                    <button
                      onClick={() => loadGames(page + 1, true)}
                      disabled={loadingMore}
                      className="px-6 py-2.5 rounded-2xl bg-gray-900/80 hover:bg-gray-850 text-xs font-semibold text-gray-300 hover:text-white border border-white/5 active-press transition-all disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      {loadingMore ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                          <span>加载更多中...</span>
                        </>
                      ) : (
                        <>
                          <span>加载更多</span>
                          <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                        </>
                      )}
                    </button>
                  </div>
                )}
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
