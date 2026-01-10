import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import GameGrid from './components/GameGrid';
import SettingsModal from './components/SettingsModal';
import GameDetailModal from './components/GameDetailModal';
import Pagination from './components/Pagination';

// Mock data for browser compatibility
const mockGames = [
  { id: 1, name: '赛博朋克 2077', path: 'D:/Games/Cyberpunk 2077', cover_path: null, tags: ['开放世界', 'RPG', '科幻'], pinned: 0 },
  { id: 2, name: '艾尔登法环', path: 'D:/Games/Elden Ring', cover_path: null, tags: ['动作', 'RPG', '开放世界'], pinned: 0 },
  { id: 3, name: '星穹铁道', path: 'D:/Games/Star Rail', cover_path: null, tags: ['RPG', '二次元', '回合制'], pinned: 0 },
  { id: 4, name: '原神', path: 'D:/Games/Genshin Impact', cover_path: null, tags: ['开放世界', 'RPG', '二次元'], pinned: 0 },
  { id: 5, name: '黑神话：悟空', path: 'D:/Games/Black Myth Wukong', cover_path: null, tags: ['动作', 'RPG', '武侠'], pinned: 0 },
  { id: 6, name: '博德之门 3', path: 'D:/Games/Baldurs Gate 3', cover_path: null, tags: ['RPG', '回合制', '奇幻'], pinned: 0 },
];

const mockTags = [
  { id: 1, name: '开放世界', color: '#3b82f6' },
  { id: 2, name: 'RPG', color: '#10b981' },
  { id: 3, name: '动作', color: '#ef4444' },
  { id: 4, name: '科幻', color: '#8b5cf6' },
  { id: 5, name: '二次元', color: '#ec4899' },
  { id: 6, name: '回合制', color: '#f59e0b' },
  { id: 7, name: '武侠', color: '#d97706' },
  { id: 8, name: '奇幻', color: '#06b6d4' },
];

// Mock electronAPI for browser
if (!window.electronAPI) {
  window.electronAPI = {
    getSettings: async () => ({
      rootPath: 'D:/Games',
      bulkScrapeIntervalMs: localStorage.getItem('bulkScrapeIntervalMs') || '1200',
      bulkScrapeMaxConcurrent: localStorage.getItem('bulkScrapeMaxConcurrent') || '1',
      bulkScrapeScopeRootPathIds: localStorage.getItem('bulkScrapeScopeRootPathIds') || '',
      projectBackgroundPath: localStorage.getItem('projectBackgroundPath') || ''
    }),
    getRootPaths: async () => [{ id: 1, path: 'D:/Games', created_at: new Date().toISOString() }],
    addRootPath: async () => ({ success: true, id: 2 }),
    deleteRootPath: async () => ({ success: true }),
    saveSetting: async (key, value) => localStorage.setItem(key, value),
    importGames: async () => ({ success: true, imported: mockGames.length, deleted: 0 }),
    getGames: async () => ({ games: mockGames, total: mockGames.length }),
    searchGames: async (query) => {
      const results = mockGames.filter(game => 
        game.name.toLowerCase().includes(query.toLowerCase()) ||
        game.path.toLowerCase().includes(query.toLowerCase()) ||
        game.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
      );
      return { games: results, total: results.length };
    },
    getAllTags: async () => mockTags,
    getGamesByTag: async (tagName) => {
      const results = mockGames.filter(game => game.tags.includes(tagName));
      return { games: results, total: results.length };
    },
    selectDirectory: async () => 'D:/Games',
    selectCover: async () => ({ canceled: true, filePaths: [] }),
    selectBackground: async () => ({ canceled: true, filePaths: [] }),
    setProjectBackground: async (sourcePath) => {
      localStorage.setItem('projectBackgroundPath', sourcePath ? String(sourcePath) : '');
      return { success: true, path: sourcePath ? String(sourcePath) : '' };
    },
    clearProjectBackground: async () => {
      localStorage.setItem('projectBackgroundPath', '');
      return true;
    },
    updateGameCover: async () => true,
    updateGamePinned: async () => true,
    scrapeGameCover: async () => ({ success: false, error: 'browser mock' }),
    deleteGame: async () => true,
    getTags: async () => mockTags,
    createTag: async () => ({}),
    updateTag: async () => true,
    deleteTag: async () => true,
    addTagToGame: async () => true,
    removeTagFromGame: async () => true,
    getGameTags: async () => [],
    openFolder: async () => true,
    openExternal: async (url) => {
      window.open(url, '_blank', 'noreferrer');
      return { success: true };
    },
    getAppVersion: async () => ({ success: true, version: 'dev' }),
    scanExecutables: async () => ({ success: true, items: [] }),
    launchExecutable: async () => ({ success: false, error: 'browser mock' }),
    captureScreenCover: async () => ({ success: false, error: 'browser mock' }),
    getIgnoredGamePaths: async () => ({ success: true, items: [] }),
    restoreIgnoredGamePaths: async () => ({ success: true, restored: 0 }),
    clearIgnoredGamePaths: async () => ({ success: true, restored: 0 })
  };
}

function App() {
  const bulkScrapeScopeSettingKey = 'bulkScrapeScopeRootPathIds';
  const projectBackgroundSettingKey = 'projectBackgroundPath';

  const [rootPaths, setRootPaths] = useState([]);
  const [games, setGames] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [tags, setTags] = useState([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(true);
  const [showBulkScrapeScope, setShowBulkScrapeScope] = useState(false);
  const [bulkScrapeScopeRootPathIds, setBulkScrapeScopeRootPathIds] = useState(null);
  const [projectBackgroundPath, setProjectBackgroundPath] = useState('');
  const [projectBackgroundNonce, setProjectBackgroundNonce] = useState(0);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalGames, setTotalGames] = useState(0);
  const [bulkScrapeLoading, setBulkScrapeLoading] = useState(false);
  const [bulkScrapeProgress, setBulkScrapeProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState({ type: '', message: '' });
  const [appVersion, setAppVersion] = useState('');
  const bulkScrapeRunIdRef = useRef(0);
  const bulkScrapeCancelRef = useRef(false);
  const tagFilterPopoverRef = useRef(null);

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
    loadRootPaths();
    loadTags();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const api = window.electronAPI;
        if (!api?.getAppVersion) return;
        const result = await api.getAppVersion();
        if (result && typeof result === 'object') {
          if (result.success && result.version) {
            setAppVersion(String(result.version));
          }
          return;
        }
        if (typeof result === 'string') {
          setAppVersion(result);
        }
      } catch {}
    };
    load();
  }, []);

  useEffect(() => {
    if (!tagFilterOpen) return;

    const handleMouseDown = (event) => {
      const el = tagFilterPopoverRef.current;
      if (!el) return;
      if (el.contains(event.target)) return;
      setTagFilterOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setTagFilterOpen(false);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tagFilterOpen]);

  useEffect(() => {
    setCurrentPage(1); // 重置到第一页
  }, [searchQuery, selectedTag]);

  useEffect(() => {
    if (searchQuery.trim()) {
      searchGames();
    } else if (selectedTag) {
      loadGamesByTag();
    } else {
      loadGames();
    }
  }, [searchQuery, selectedTag, currentPage]);

  const loadRootPaths = async () => {
    const paths = await window.electronAPI.getRootPaths();
    setRootPaths(paths);
    if (paths.length > 0) {
      setIsFirstRun(false);
    }
    try {
      const settings = await window.electronAPI.getSettings?.();
      const bgPath = settings?.[projectBackgroundSettingKey] ? String(settings[projectBackgroundSettingKey]) : '';
      setProjectBackgroundPath(bgPath);
      setProjectBackgroundNonce(bgPath ? Date.now() : 0);
      const raw = settings?.[bulkScrapeScopeSettingKey];
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        setBulkScrapeScopeRootPathIds(null);
      } else {
        const parsed = JSON.parse(String(raw));
        if (Array.isArray(parsed)) {
          const normalized = [...new Set(parsed.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n)))];
          const currentRootIds = paths.map((rp) => rp.id);
          const currentRootIdSet = new Set(currentRootIds);
          const filtered = normalized.filter((id) => currentRootIdSet.has(id)).sort((a, b) => a - b);
          if (filtered.length !== normalized.length) {
            try {
              await window.electronAPI.saveSetting(bulkScrapeScopeSettingKey, JSON.stringify(filtered));
            } catch {}
          }
          setBulkScrapeScopeRootPathIds(filtered);
        } else {
          setBulkScrapeScopeRootPathIds(null);
        }
      }
    } catch {
      setBulkScrapeScopeRootPathIds(null);
      setProjectBackgroundPath('');
      setProjectBackgroundNonce(0);
    }
    return paths;
  };

  const toFileUrlForCss = (rawPath) => {
    if (!rawPath) return '';
    const s = String(rawPath);
    if (s.startsWith('file://')) return s;
    const normalized = s.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) {
      return `file:///${normalized}`;
    }
    if (normalized.startsWith('/')) {
      return `file://${normalized}`;
    }
    return normalized;
  };

  const projectBackgroundUrl = projectBackgroundPath
    ? `${toFileUrlForCss(projectBackgroundPath)}?t=${projectBackgroundNonce || 0}`
    : '';
  const hasProjectBackground = !!projectBackgroundPath;
  const selectedTagInfo = selectedTag ? tags.find((tag) => tag.name === selectedTag) : null;

  const loadTags = async () => {
    const allTags = await window.electronAPI.getAllTags();
    setTags(allTags);
  };

  const loadGames = async () => {
    setLoading(true);
    const { games: allGames, total } = await window.electronAPI.getGames({ page: currentPage, pageSize });
    setGames(allGames);
    setTotalGames(total);
    setLoading(false);
  };

  const searchGames = async () => {
    setLoading(true);
    const { games: results, total } = await window.electronAPI.searchGames(searchQuery, { page: currentPage, pageSize });
    setGames(results);
    setTotalGames(total);
    setLoading(false);
  };

  const loadGamesByTag = async () => {
    setLoading(true);
    const { games: results, total } = await window.electronAPI.getGamesByTag(selectedTag, { page: currentPage, pageSize });
    setGames(results);
    setTotalGames(total);
    setLoading(false);
  };

  const handleImport = async (pathsOverride) => {
    setLoading(true);
    try {
      const paths = Array.isArray(pathsOverride) ? pathsOverride : rootPaths;

      if (paths.length === 0) {
        setSearchQuery('');
        setSelectedTag('');
        setCurrentPage(1);
        await loadGames();
        return { success: true, imported: 0, deleted: 0 };
      }

      const result = await window.electronAPI.importGames();
      if (result?.success) {
        setSearchQuery('');
        setSelectedTag('');
        setCurrentPage(1);
        await loadGames();
      }
      return result;
    } catch (error) {
      showStatus('error', '刷新失败：' + (error?.message || String(error)));
      return { success: false, error: error?.message || String(error) };
    } finally {
      setLoading(false);
    }
  };

  const handleImportRootPath = async (rootPathId) => {
    try {
      const result = await window.electronAPI.importGames(rootPathId);
      if (result?.success) {
        await handleGameUpdate();
      }
      return result;
    } catch (error) {
      showStatus('error', '刷新失败：' + (error?.message || String(error)));
      return { success: false, error: error?.message || String(error) };
    }
  };

  const handleSettingsSave = async () => {
    setShowSettings(false);
    setSelectedTag('');
    setSearchQuery('');
    setCurrentPage(1);
    const paths = await loadRootPaths();
    if (paths.length > 0) {
      await handleImport(paths);
    } else {
      await loadGames();
    }
    await loadTags();
  };

  const handleGameClick = (game) => {
    setSelectedGame(game);
  };

  const handleGameUpdate = async () => {
    if (searchQuery.trim()) {
      await searchGames();
    } else if (selectedTag) {
      await loadGamesByTag();
    } else {
      await loadGames();
    }
    await loadTags();
    
    if (selectedGame) {
      const { games: updatedGames } = await window.electronAPI.getGames({ page: 1, pageSize: 1000 });
      const updated = updatedGames.find(g => g.id === selectedGame.id);
      if (updated) {
        setSelectedGame(updated);
      }
    }
  };

  const handleTogglePinned = async (game) => {
    if (!window.electronAPI || !window.electronAPI.updateGamePinned) return;
    try {
      await window.electronAPI.updateGamePinned(game.id, !game.pinned);
      await handleGameUpdate();
    } catch (error) {
      showStatus('error', '置顶失败：' + (error?.message || String(error)));
    }
  };

  const fetchAllGames = async () => {
    const pageSize = 200;
    let page = 1;
    let total = 0;
    const allGames = [];

    while (true) {
      const result = await window.electronAPI.getGames({ page, pageSize });
      const list = Array.isArray(result?.games) ? result.games : [];
      total = typeof result?.total === 'number' ? result.total : total;
      allGames.push(...list);
      if (total > 0 && allGames.length >= total) break;
      if (list.length === 0) break;
      page += 1;
    }

    return allGames;
  };

  const handleBulkScrape = async () => {
    if (bulkScrapeLoading || loading) return;
    if (!window.electronAPI || !window.electronAPI.scrapeGameCover) return;

    const runId = bulkScrapeRunIdRef.current + 1;
    bulkScrapeRunIdRef.current = runId;
    bulkScrapeCancelRef.current = false;

    setStatus({ type: '', message: '' });
    setBulkScrapeLoading(true);
    setBulkScrapeProgress({ current: 0, total: 0 });

    try {
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const sleepCancellable = async (ms) => {
        let remaining = ms;
        while (remaining > 0) {
          if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return false;
          const chunk = Math.min(remaining, 150);
          await sleep(chunk);
          remaining -= chunk;
        }
        return !(bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current);
      };
      const settings = await window.electronAPI.getSettings?.();
      const parsedIntervalMs = Number.parseInt(String(settings?.bulkScrapeIntervalMs || '').trim(), 10);
      const intervalMs = Number.isFinite(parsedIntervalMs) && parsedIntervalMs >= 0 ? parsedIntervalMs : 1200;
      const parsedMaxConcurrent = Number.parseInt(String(settings?.bulkScrapeMaxConcurrent || '').trim(), 10);
      const maxConcurrent = Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent >= 1 ? parsedMaxConcurrent : 1;

      const allGames = await fetchAllGames();
      if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
      const effectiveScopeIds = Array.isArray(bulkScrapeScopeRootPathIds)
        ? bulkScrapeScopeRootPathIds
        : rootPaths.map((rp) => rp.id);
      const enabledRootIdSet = new Set(effectiveScopeIds);
      const hasEnabledRoots = enabledRootIdSet.size > 0;

      const targets = allGames
        .filter((g) => !g.cover_path)
        .filter((g) => {
          const ids = Array.isArray(g?.root_path_ids)
            ? g.root_path_ids
            : (g?.root_path_id === null || g?.root_path_id === undefined ? [] : [g.root_path_id]);
          if (ids.length === 0) return true;
          if (!hasEnabledRoots) return false;
          return ids.some((id) => enabledRootIdSet.has(id));
        });

      if (targets.length === 0) {
        showStatus('success', '没有需要刮削封面的游戏');
        return;
      }

      if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
      setBulkScrapeProgress({ current: 0, total: targets.length });

      let failedCount = 0;
      let completedCount = 0;
      let nextStartAt = Date.now();
      const inFlight = new Set();

      const startOne = (gameId) => {
        const task = (async () => {
          try {
            const result = await window.electronAPI.scrapeGameCover(gameId);
            if (!result || !result.success) failedCount += 1;
          } catch {
            failedCount += 1;
          }
        })()
          .finally(() => {
            completedCount += 1;
            if (bulkScrapeRunIdRef.current === runId && !bulkScrapeCancelRef.current) {
              setBulkScrapeProgress({ current: completedCount, total: targets.length });
            }
            inFlight.delete(task);
          });
        inFlight.add(task);
      };

      let idx = 0;
      while (idx < targets.length || inFlight.size > 0) {
        if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
        while (idx < targets.length && inFlight.size < maxConcurrent) {
          if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
          const waitMs = Math.max(0, nextStartAt - Date.now());
          if (waitMs > 0) {
            const ok = await sleepCancellable(waitMs);
            if (!ok) return;
          }
          startOne(targets[idx].id);
          idx += 1;
          nextStartAt = Date.now() + intervalMs;
        }
        if (inFlight.size > 0) {
          if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
          await Promise.race(inFlight);
        }
      }

      if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
      await handleGameUpdate();
      if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
      showStatus(
        failedCount > 0 ? 'error' : 'success',
        failedCount > 0 ? `批量刮削完成，失败 ${failedCount} 个` : '批量刮削完成'
      );
    } finally {
      if (bulkScrapeRunIdRef.current === runId) {
        setBulkScrapeLoading(false);
      }
    }
  };

  const handleStopBulkScrape = () => {
    if (!bulkScrapeLoading) return;
    bulkScrapeCancelRef.current = true;
    setBulkScrapeLoading(false);
    showStatus('success', '已停止批量刮削');
  };

  const totalPages = Math.ceil(totalGames / pageSize);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const BulkScrapeScopeModal = () => {
    const effectiveScopeIds = Array.isArray(bulkScrapeScopeRootPathIds)
      ? bulkScrapeScopeRootPathIds
      : rootPaths.map((rp) => rp.id);
    const [draftIds, setDraftIds] = useState(effectiveScopeIds);
    const [scrapeSourceExpanded, setScrapeSourceExpanded] = useState(true);
    const [scrapeEnabled, setScrapeEnabled] = useState({
      VNDBv2: true,
      Ymgal: true,
      Bangumi: true,
      Steam: false,
      SteamGridDB: false,
      IGDB: false,
      VNDB: false,
      DLsite: false
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      const currentRootIds = rootPaths.map((rp) => rp.id);
      const currentRootIdSet = new Set(currentRootIds);
      if (Array.isArray(bulkScrapeScopeRootPathIds)) {
        setDraftIds(bulkScrapeScopeRootPathIds.filter((id) => currentRootIdSet.has(id)));
      } else {
        setDraftIds(currentRootIds);
      }
    }, [rootPaths, bulkScrapeScopeRootPathIds]);

    const toEnabled = (raw, defaultValue = true) => {
      if (raw === null || raw === undefined || raw === '') return defaultValue;
      const v = String(raw).trim().toLowerCase();
      if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
      if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
      return defaultValue;
    };

    useEffect(() => {
      const load = async () => {
        try {
          const settings = await window.electronAPI.getSettings?.();
          setScrapeEnabled({
            VNDBv2: toEnabled(settings?.scrapeEnableVNDBv2, true),
            Ymgal: toEnabled(settings?.scrapeEnableYmgal, true),
            Bangumi: toEnabled(settings?.scrapeEnableBangumi, true),
            Steam: toEnabled(settings?.scrapeEnableSteam, false),
            SteamGridDB: toEnabled(settings?.scrapeEnableSteamGridDB, false),
            IGDB: toEnabled(settings?.scrapeEnableIGDB, false),
            VNDB: toEnabled(settings?.scrapeEnableVNDB, false),
            DLsite: toEnabled(settings?.scrapeEnableDLsite, false)
          });
        } catch {}
      };
      load();
    }, []);

    const toggle = (id) => {
      setDraftIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const handleSave = async () => {
      if (saving) return;
      setSaving(true);
      try {
        const normalized = [...new Set(draftIds.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n)))];
        normalized.sort((a, b) => a - b);
        await window.electronAPI.saveSetting(bulkScrapeScopeSettingKey, JSON.stringify(normalized));
        await window.electronAPI.saveSetting('scrapeEnableSteamGridDB', scrapeEnabled.SteamGridDB ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableIGDB', scrapeEnabled.IGDB ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableVNDBv2', scrapeEnabled.VNDBv2 ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableYmgal', scrapeEnabled.Ymgal ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableVNDB', scrapeEnabled.VNDB ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableSteam', scrapeEnabled.Steam ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableBangumi', scrapeEnabled.Bangumi ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableDLsite', scrapeEnabled.DLsite ? '1' : '0');
        setBulkScrapeScopeRootPathIds(normalized);
        setShowBulkScrapeScope(false);
      } catch (error) {
        showStatus('error', '保存失败：' + (error?.message || String(error)));
      } finally {
        setSaving(false);
      }
    };

    return (
      <div
        className="modal-overlay fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setShowBulkScrapeScope(false);
        }}
      >
        <div className="modal-content bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl w-full max-w-lg mx-4 border border-gray-800 shadow-2xl shadow-indigo-900/20 transform transition-all duration-300 hover:shadow-3xl flex flex-col max-h-[70vh] overflow-hidden">
          <div className="p-6 border-b border-gray-800/80 bg-gradient-to-r from-gray-800/50 to-gray-900/50 rounded-t-2xl relative">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">配置刮削范围</h2>
              <button
                onClick={() => setShowBulkScrapeScope(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-white bg-gray-850 hover:bg-gray-800 border border-gray-800/80 hover:border-gray-700/80 transition-all duration-300"
                title="关闭"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            <div className="space-y-2">
              {rootPaths.map((rp) => {
                const checked = draftIds.includes(rp.id);
                return (
                  <button
                    key={rp.id}
                    onClick={() => toggle(rp.id)}
                    className={`w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl border transition-all duration-300 ${
                      checked
                        ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                        : 'bg-gray-850 border-gray-800/80 text-gray-200 hover:bg-gray-800 hover:border-gray-700/80'
                    }`}
                  >
                    <span className="text-sm font-medium truncate">{rp.path}</span>
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        checked ? 'bg-indigo-600 border-indigo-500' : 'bg-transparent border-gray-600'
                      }`}
                    >
                      {checked && (
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
              {rootPaths.length === 0 && (
                <div className="text-sm text-gray-400 bg-gray-900/40 border border-gray-800/80 rounded-xl p-4">
                  当前没有根目录
                </div>
              )}
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-medium text-gray-300 whitespace-nowrap">刮削源开关</div>
                  <div className="text-xs text-gray-500 truncate">过多刮削源会影响速度</div>
                </div>
                <button
                  type="button"
                  onClick={() => setScrapeSourceExpanded(v => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-400 hover:text-gray-200 bg-gray-850/60 hover:bg-gray-800/80 border border-gray-800/80 hover:border-gray-700/80 transition-all"
                  aria-expanded={scrapeSourceExpanded}
                >
                  {scrapeSourceExpanded ? '收起' : '展开'}
                  <svg
                    className={`w-4 h-4 transition-transform ${scrapeSourceExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {scrapeSourceExpanded && (
                <div className="space-y-2">
                  {[
                    { key: 'VNDBv2', label: 'VNDB Kana v2' },
                    { key: 'Ymgal', label: '月幕Galgame' },
                    { key: 'Bangumi', label: 'Bangumi' },
                    { key: 'Steam', label: 'steam（裸连容易超时）' },
                    { key: 'SteamGridDB', label: 'SteamGridDB（需要 Key）' },
                    { key: 'IGDB', label: 'IGDB（需要 Client ID/Secret）' },
                    { key: 'VNDB', label: 'VNDB（需要 Token）' },
                    { key: 'DLsite', label: 'DLsite（RJ/VJ 号）' }
                  ].map(item => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-3 p-3 bg-gray-850/60 rounded-xl border border-gray-800/80"
                    >
                      <div className="text-sm text-gray-300">{item.label}</div>
                      <button
                        type="button"
                        onClick={() =>
                          setScrapeEnabled(prev => ({ ...prev, [item.key]: !prev[item.key] }))
                        }
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          scrapeEnabled[item.key] ? 'bg-emerald-600' : 'bg-gray-700'
                        }`}
                        aria-pressed={scrapeEnabled[item.key]}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                            scrapeEnabled[item.key] ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-6 border-t border-gray-800/80 bg-gray-900/30">
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBulkScrapeScope(false)}
                className="px-4 py-2 rounded-xl bg-gray-850 hover:bg-gray-800 border border-gray-800/80 hover:border-gray-700/80 text-gray-200 hover:text-white transition-all"
                disabled={saving}
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="btn-primary bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-medium py-2 px-5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-sm hover:shadow-md disabled:shadow-none"
                disabled={saving}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen relative">
      {projectBackgroundUrl ? (
        <div
          className="fixed inset-0 z-[-2] bg-center bg-cover bg-no-repeat"
          style={{ backgroundImage: `url("${projectBackgroundUrl}")` }}
        />
      ) : null}
      <div
        className={`fixed inset-0 z-[-1] bg-gradient-to-br ${
          projectBackgroundUrl
            ? 'from-gray-950/70 via-gray-900/60 to-indigo-950/70'
            : 'from-gray-950 via-gray-900 to-indigo-950'
        }`}
      />
      <Header
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenSettings={() => setShowSettings(true)}
        rootPaths={rootPaths}
        hasBackground={hasProjectBackground}
        sticky={!showSettings && !selectedGame}
      />
      
      <main className="container mx-auto px-6 py-8">
        <>
          {status.message && (
            <div
              className={`fixed bottom-6 right-6 z-[60] px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
                status.type === 'success'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                  : 'bg-red-500/20 text-red-400 border border-red-500/50'
              }`}
            >
              {status.message}
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
              <div className="flex items-center gap-4 shrink-0">
                <h1 className="text-2xl font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">我的游戏</h1>
                <span className="text-gray-400 bg-gray-800 px-3 py-1 rounded-full text-sm">({totalGames} 个游戏)</span>
              </div>
              {tags.length > 0 && (
                <div ref={tagFilterPopoverRef} className="relative min-w-0">
                  <div className="flex items-center gap-2 py-1 min-w-0">
                  <button
                    onClick={() => {
                      setSelectedTag('');
                      setSearchQuery('');
                      setTagFilterOpen(false);
                    }}
                    className={`tag px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-350 hover:scale-105 shrink-0 ${
                      selectedTag || searchQuery
                        ? 'bg-gray-850 text-gray-300 hover:bg-gray-800 hover:text-white border border-gray-800/80'
                        : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-600/30 hover:shadow-xl hover:shadow-indigo-600/40'
                    }`}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    onClick={() => setTagFilterOpen((prev) => !prev)}
                    className={`tag inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-350 hover:scale-105 max-w-[240px] ${
                      selectedTag && !searchQuery
                        ? 'text-white shadow-lg shadow-current/40 hover:shadow-xl'
                        : 'bg-gray-850 text-gray-300 hover:bg-gray-800 hover:text-white border border-gray-800/80 hover:border-gray-700/80'
                    }`}
                    style={{
                      backgroundColor: selectedTag && !searchQuery ? selectedTagInfo?.color : undefined,
                      border: selectedTag && !searchQuery && selectedTagInfo?.color ? `1px solid ${selectedTagInfo.color}` : undefined
                    }}
                    aria-expanded={tagFilterOpen ? 'true' : 'false'}
                    aria-label="展开标签筛选"
                  >
                    <span className="truncate">{selectedTag && !searchQuery ? selectedTag : '标签'}</span>
                    <svg className={`w-4 h-4 transition-transform ${tagFilterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  </div>

                  {tagFilterOpen && (
                    <div className="absolute left-0 top-full mt-2 z-50 w-[min(720px,calc(100vw-3rem))] rounded-2xl bg-gray-900/55 backdrop-blur-md border border-gray-800/70 shadow-2xl shadow-black/30 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="text-sm font-medium text-gray-200">标签</div>
                        <button
                          type="button"
                          onClick={() => setTagFilterOpen(false)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 transition-colors"
                          aria-label="收起标签筛选"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div className="max-h-[50vh] overflow-auto pr-1">
                        <div className="flex flex-wrap gap-2">
                          {tags.map(tag => (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                setSelectedTag(tag.name);
                                setSearchQuery('');
                                setTagFilterOpen(false);
                              }}
                              className={`tag px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-350 hover:scale-105 whitespace-nowrap ${
                                selectedTag === tag.name && !searchQuery
                                  ? 'text-white shadow-lg shadow-current/40 hover:shadow-xl'
                                  : 'bg-gray-850 text-gray-300 hover:bg-gray-800 hover:text-white border border-gray-800/80 hover:border-gray-700/80'
                              }`}
                              style={{
                                backgroundColor: selectedTag === tag.name && !searchQuery ? tag.color : undefined,
                                border: selectedTag === tag.name && !searchQuery ? `1px solid ${tag.color}` : undefined
                              }}
                            >
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              {bulkScrapeLoading && bulkScrapeProgress.total > 0 && (
                <div className="flex items-center gap-3">
                  <div className="text-xs text-gray-200 font-medium whitespace-nowrap">
                    {bulkScrapeProgress.current}/{bulkScrapeProgress.total}
                  </div>
                  <button
                    type="button"
                    onClick={handleStopBulkScrape}
                    className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-100 transition-all"
                    title="停止"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="1.5" />
                    </svg>
                  </button>
                  <div className="w-40 h-2 bg-gray-800/80 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-600 to-purple-600"
                      style={{
                        width: `${Math.min(100, Math.round((bulkScrapeProgress.current / bulkScrapeProgress.total) * 100))}%`
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-stretch rounded-xl overflow-hidden bg-gradient-to-r from-fuchsia-600 to-pink-600 shadow-sm hover:shadow-md hover:shadow-fuchsia-600/20 transition-all duration-300 hover:-translate-y-0.5">
                <button
                  onClick={handleBulkScrape}
                  disabled={loading || bulkScrapeLoading}
                  className="flex items-center justify-center gap-2 px-6 py-2.5 text-white font-medium hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-r border-white/20"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v16h16V4H4zm4 4h8M8 12h8M8 16h6" />
                  </svg>
                  {bulkScrapeLoading ? '正在刮削...' : '批量刮削封面'}
                </button>
                <button
                  onClick={() => setShowBulkScrapeScope(true)}
                  disabled={loading || bulkScrapeLoading}
                  className="flex items-center justify-center px-3 text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="配置刮削范围"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          
          <GameGrid
            games={games}
            loading={loading}
            onGameClick={handleGameClick}
            tags={tags}
            onTogglePinned={handleTogglePinned}
          />

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </>
      </main>

      {showSettings && (
        <SettingsModal
          currentPaths={rootPaths}
          onSave={handleSettingsSave}
          onRefreshAll={() => handleImport()}
          onRefreshRoot={handleImportRootPath}
          onBackgroundChange={(nextPath) => {
            setProjectBackgroundPath(nextPath);
            setProjectBackgroundNonce(nextPath ? Date.now() : 0);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          allTags={tags}
          onClose={() => setSelectedGame(null)}
          onUpdate={handleGameUpdate}
        />
      )}

      {showBulkScrapeScope && <BulkScrapeScopeModal />}

      {appVersion ? (
        <div
          className={`fixed bottom-3 right-4 z-[40] text-xs pointer-events-none select-none ${
            hasProjectBackground ? 'text-gray-100/70' : 'text-gray-300/70'
          }`}
        >
          v{appVersion}
        </div>
      ) : null}
    </div>
  );
}

export default App;
