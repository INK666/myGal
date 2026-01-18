import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Header from './components/Header';
import GameGrid from './components/GameGrid';
import SettingsModal from './components/SettingsModal';
import GameDetailModal from './components/GameDetailModal';
import Pagination from './components/Pagination';

// Mock data for browser compatibility
const now = Date.now();
const mockGames = [
  { id: 1, name: '赛博朋克 2077', path: 'D:/Games/Cyberpunk 2077', cover_path: null, tags: ['开放世界', 'RPG', '科幻'], pinned: 0, imported_at: now - 6 * 3600 * 1000 },
  { id: 2, name: '艾尔登法环', path: 'D:/Games/Elden Ring', cover_path: null, tags: ['动作', 'RPG', '开放世界'], pinned: 0, imported_at: now - 5 * 3600 * 1000 },
  { id: 3, name: '星穹铁道', path: 'D:/Games/Star Rail', cover_path: null, tags: ['RPG', '二次元', '回合制'], pinned: 0, imported_at: now - 4 * 3600 * 1000 },
  { id: 4, name: '原神', path: 'D:/Games/Genshin Impact', cover_path: null, tags: ['开放世界', 'RPG', '二次元'], pinned: 0, imported_at: now - 3 * 3600 * 1000 },
  { id: 5, name: '黑神话：悟空', path: 'D:/Games/Black Myth Wukong', cover_path: null, tags: ['动作', 'RPG', '武侠'], pinned: 0, imported_at: now - 2 * 3600 * 1000 },
  { id: 6, name: '博德之门 3', path: 'D:/Games/Baldurs Gate 3', cover_path: null, tags: ['RPG', '回合制', '奇幻'], pinned: 0, imported_at: now - 1 * 3600 * 1000 },
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
  const sortGames = (list, sortOrder) => {
    const order = String(sortOrder || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
    const getImportedAt = (g) => (Number.isFinite(Number(g?.imported_at)) ? Number(g.imported_at) : 0);
    const getPinned = (g) => (Number.isFinite(Number(g?.pinned)) ? Number(g.pinned) : 0);
    const getId = (g) => (Number.isFinite(Number(g?.id)) ? Number(g.id) : 0);

    return [...list].sort((a, b) => {
      const pinnedDiff = getPinned(b) - getPinned(a);
      if (pinnedDiff !== 0) return pinnedDiff;

      const importedDiff = getImportedAt(a) - getImportedAt(b);
      if (importedDiff !== 0) return order === 'asc' ? importedDiff : -importedDiff;

      return getId(b) - getId(a);
    });
  };

  window.electronAPI = {
    getSettings: async () => ({
      rootPath: 'D:/Games',
      bulkScrapeIntervalMs: localStorage.getItem('bulkScrapeIntervalMs') || '800',
      bulkScrapeMaxConcurrent: localStorage.getItem('bulkScrapeMaxConcurrent') || '1',
      bulkScrapeScopeRootPathIds: localStorage.getItem('bulkScrapeScopeRootPathIds') || '',
      projectBackgroundPath: localStorage.getItem('projectBackgroundPath') || '',
      gameSortImportedAtOrder: localStorage.getItem('gameSortImportedAtOrder') || 'desc'
    }),
    getRootPaths: async () => [{ id: 1, path: 'D:/Games', created_at: new Date().toISOString() }],
    addRootPath: async () => ({ success: true, id: 2 }),
    deleteRootPath: async () => ({ success: true }),
    saveSetting: async (key, value) => localStorage.setItem(key, value),
    importGames: async () => ({ success: true, imported: mockGames.length, deleted: 0 }),
    getGames: async (params) => {
      const sorted = sortGames(mockGames, params?.sortOrder);
      return { games: sorted, total: sorted.length };
    },
    searchGames: async (query, params) => {
      const results = mockGames.filter(game => 
        game.name.toLowerCase().includes(query.toLowerCase()) ||
        game.path.toLowerCase().includes(query.toLowerCase()) ||
        game.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
      );
      const sorted = sortGames(results, params?.sortOrder);
      return { games: sorted, total: sorted.length };
    },
    getAllTags: async () => mockTags,
    getGamesByTag: async (tagName, params) => {
      const results = mockGames.filter(game => game.tags.includes(tagName));
      const sorted = sortGames(results, params?.sortOrder);
      return { games: sorted, total: sorted.length };
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
    launchExecutableAdmin: async () => ({ success: false, error: 'browser mock' }),
    launchExecutableLocaleRemulator: async () => ({ success: false, error: 'browser mock' }),
    launchExecutableLocaleEmulator: async () => ({ success: false, error: 'browser mock' }),
    getRunHistory: async () => ({ success: true, items: [], total: 0 }),
    clearRunHistory: async () => ({ success: true }),
    captureScreenCover: async () => ({ success: false, error: 'browser mock' }),
    getIgnoredGamePaths: async () => ({ success: true, items: [] }),
    restoreIgnoredGamePaths: async () => ({ success: true, restored: 0 }),
    clearIgnoredGamePaths: async () => ({ success: true, restored: 0 })
  };
}

function App() {
  const bulkScrapeScopeSettingKey = 'bulkScrapeScopeRootPathIds';
  const projectBackgroundSettingKey = 'projectBackgroundPath';
  const importedAtSortOrderSettingKey = 'gameSortImportedAtOrder';

  const [rootPaths, setRootPaths] = useState([]);
  const [games, setGames] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedRootPathId, setSelectedRootPathId] = useState(null);
  const [tags, setTags] = useState([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [rootFilterOpen, setRootFilterOpen] = useState(false);
  const [tagFilterPopoverStyle, setTagFilterPopoverStyle] = useState(null);
  const [rootFilterPopoverStyle, setRootFilterPopoverStyle] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(true);
  const [showBulkScrapeScope, setShowBulkScrapeScope] = useState(false);
  const [bulkScrapeScopeRootPathIds, setBulkScrapeScopeRootPathIds] = useState(null);
  const [projectBackgroundPath, setProjectBackgroundPath] = useState('');
  const [projectBackgroundNonce, setProjectBackgroundNonce] = useState(0);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(60);
  const [totalGames, setTotalGames] = useState(0);
  const [bulkScrapeLoading, setBulkScrapeLoading] = useState(false);
  const [bulkScrapeProgress, setBulkScrapeProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState({ type: '', message: '' });
  const [appVersion, setAppVersion] = useState('');
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [runHistoryItems, setRunHistoryItems] = useState([]);
  const [runHistoryTotal, setRunHistoryTotal] = useState(0);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [runHistoryOffset, setRunHistoryOffset] = useState(0);
  const [viewMode, setViewMode] = useState(() => {
    try {
      const raw = localStorage.getItem('gameViewMode');
      return raw === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [importedAtSortOrder, setImportedAtSortOrder] = useState('desc');
  const bulkScrapeRunIdRef = useRef(0);
  const bulkScrapeCancelRef = useRef(false);
  const tagFilterPopoverRef = useRef(null);
  const rootFilterPopoverRef = useRef(null);
  const bulkScrapeScopeButtonRef = useRef(null);
  const tagFilterButtonRef = useRef(null);
  const rootFilterButtonRef = useRef(null);

  const computeFilterPopoverStyle = (anchorEl) => {
    if (!anchorEl) return null;
    const anchorRect = anchorEl.getBoundingClientRect();
    const bulkRect = bulkScrapeScopeButtonRef.current?.getBoundingClientRect?.() || null;
    const viewportLeft = 12;
    const viewportRight = window.innerWidth - 12;
    const reservedRight = bulkRect?.left ? Math.max(viewportLeft, bulkRect.left - 12) : viewportRight;
    const rightLimit = Math.max(viewportLeft + 160, Math.min(viewportRight, reservedRight));
    const maxWidth = Math.min(720, rightLimit - viewportLeft);
    const left = Math.max(viewportLeft, Math.min(anchorRect.left, rightLimit - 220));
    const width = Math.max(220, Math.min(maxWidth, rightLimit - left));
    const top = anchorRect.bottom + 8;
    return { position: 'fixed', left, top, width };
  };

  const formatRootPathLabel = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const trimmed = raw.replace(/[\\/]+$/, '');
    const parts = trimmed.split(/[/\\]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : trimmed;
  };

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

  const toEnabled = (raw, defaultValue = false) => {
    if (raw === null || raw === undefined || raw === '') return defaultValue;
    const v = String(raw).trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
    return defaultValue;
  };

  const runHistoryLimit = 50;
  const setAndPersistViewMode = (next) => {
    setViewMode(next);
    try {
      localStorage.setItem('gameViewMode', next);
    } catch {}
  };

  const setAndPersistImportedAtSortOrder = (next) => {
    const normalized = next === 'asc' ? 'asc' : 'desc';
    setImportedAtSortOrder(normalized);
    setCurrentPage(1);
    try {
      window.electronAPI.saveSetting(importedAtSortOrderSettingKey, normalized);
    } catch {}
  };
  const loadRunHistory = async ({ offset = 0, append = false } = {}) => {
    try {
      const api = window.electronAPI;
      if (!api?.getRunHistory) return;
      setRunHistoryLoading(true);
      const result = await api.getRunHistory({ limit: runHistoryLimit, offset });
      if (result?.success) {
        const nextItems = Array.isArray(result.items) ? result.items : [];
        setRunHistoryItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
        setRunHistoryTotal(Number(result.total || 0));
        setRunHistoryOffset(offset);
      }
    } catch {
    } finally {
      setRunHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!showRunHistory) return;
    loadRunHistory({ offset: 0, append: false });
  }, [showRunHistory]);

  useEffect(() => {
    if (!showRunHistory) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setShowRunHistory(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showRunHistory]);

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

  useLayoutEffect(() => {
    if (!tagFilterOpen) return;

    setTagFilterPopoverStyle(computeFilterPopoverStyle(tagFilterButtonRef.current));

    const handleMouseDown = (event) => {
      const el = tagFilterPopoverRef.current;
      if (!el) return;
      if (el.contains(event.target)) return;
      setTagFilterOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setTagFilterOpen(false);
    };

    const handleResize = () => {
      setTagFilterPopoverStyle(computeFilterPopoverStyle(tagFilterButtonRef.current));
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [tagFilterOpen]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedTag, selectedRootPathId, importedAtSortOrder, viewMode]);

  useEffect(() => {
    if (searchQuery.trim()) {
      searchGames();
    } else if (selectedTag) {
      loadGamesByTag();
    } else {
      loadGames();
    }
  }, [searchQuery, selectedTag, selectedRootPathId, currentPage, importedAtSortOrder, viewMode, pageSize]);

  useLayoutEffect(() => {
    if (!rootFilterOpen) return;

    setRootFilterPopoverStyle(computeFilterPopoverStyle(rootFilterButtonRef.current));

    const handleMouseDown = (event) => {
      const el = rootFilterPopoverRef.current;
      if (!el) return;
      if (el.contains(event.target)) return;
      setRootFilterOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setRootFilterOpen(false);
    };

    const handleResize = () => {
      setRootFilterPopoverStyle(computeFilterPopoverStyle(rootFilterButtonRef.current));
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [rootFilterOpen]);

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
      const importedSortKey = String(settings?.[importedAtSortOrderSettingKey] ?? '').trim().toLowerCase();
      setImportedAtSortOrder(importedSortKey === 'asc' ? 'asc' : 'desc');
      const raw = settings?.[bulkScrapeScopeSettingKey];
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        setBulkScrapeScopeRootPathIds(null);
      } else {
        const parsed = JSON.parse(String(raw));
        if (Array.isArray(parsed)) {
          const includeOthers = parsed.some((v) => String(v ?? '').trim().toLowerCase() === 'others');
          const normalized = [...new Set(parsed.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n)))];
          const currentRootIds = paths.map((rp) => rp.id);
          const currentRootIdSet = new Set(currentRootIds);
          const filtered = normalized.filter((id) => currentRootIdSet.has(id)).sort((a, b) => a - b);
          const nextScope = [...filtered, ...(includeOthers ? ['others'] : [])];
          if (JSON.stringify(parsed) !== JSON.stringify(nextScope)) {
            try {
              await window.electronAPI.saveSetting(bulkScrapeScopeSettingKey, JSON.stringify(nextScope));
            } catch {}
          }
          setBulkScrapeScopeRootPathIds(nextScope);
        } else {
          setBulkScrapeScopeRootPathIds(null);
        }
      }
    } catch {
      setBulkScrapeScopeRootPathIds(null);
      setProjectBackgroundPath('');
      setProjectBackgroundNonce(0);
      setImportedAtSortOrder('desc');
    }
    return paths;
  };

  const reloadRootPathsOnly = async () => {
    const paths = await window.electronAPI.getRootPaths();
    setRootPaths(paths);
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
  const selectedRootPathInfo = typeof selectedRootPathId === 'number' && Number.isFinite(selectedRootPathId)
    ? rootPaths.find((rp) => rp.id === selectedRootPathId)
    : null;
  const effectivePageSize = pageSize;

  const loadTags = async () => {
    const allTags = await window.electronAPI.getAllTags();
    setTags(allTags);
  };

  const loadGames = async () => {
    setLoading(true);
    const { games: allGames, total } = await window.electronAPI.getGames({ page: currentPage, pageSize: effectivePageSize, rootPathId: selectedRootPathId, sortOrder: importedAtSortOrder });
    setGames(allGames);
    setTotalGames(total);
    setLoading(false);
  };

  const searchGames = async () => {
    setLoading(true);
    const { games: results, total } = await window.electronAPI.searchGames(searchQuery, { page: currentPage, pageSize: effectivePageSize, rootPathId: selectedRootPathId, sortOrder: importedAtSortOrder });
    setGames(results);
    setTotalGames(total);
    setLoading(false);
  };

  const loadGamesByTag = async () => {
    setLoading(true);
    const { games: results, total } = await window.electronAPI.getGamesByTag(selectedTag, { page: currentPage, pageSize: effectivePageSize, rootPathId: selectedRootPathId, sortOrder: importedAtSortOrder });
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
        setSelectedRootPathId(null);
        setCurrentPage(1);
        await loadGames();
        return { success: true, imported: 0, deleted: 0 };
      }

      const result = await window.electronAPI.importGames();
      if (result?.success) {
        await reloadRootPathsOnly();
        setSearchQuery('');
        setSelectedTag('');
        setSelectedRootPathId(null);
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
        await reloadRootPathsOnly();
        await handleGameUpdate();
      }
      return result;
    } catch (error) {
      showStatus('error', '刷新失败：' + (error?.message || String(error)));
      return { success: false, error: error?.message || String(error) };
    }
  };

  const maybeAutoScrapeImported = async (result) => {
    try {
      const settings = await window.electronAPI.getSettings?.();
      const auto = toEnabled(settings?.autoScrapeAfterRefresh, true);
      if (!auto) return;

      const importedGameIds = Array.isArray(result?.importedGameIds) ? result.importedGameIds : [];
      if (importedGameIds.length === 0) return;

      await handleBulkScrape({ gameIds: importedGameIds, ignoreLoading: true, ignoreScope: true });
    } catch {}
  };

  const handleRefreshAll = async () => {
    const result = await handleImport();
    if (result?.success) {
      maybeAutoScrapeImported(result);
    }
    return result;
  };

  const handleRefreshRoot = async (rootPathId) => {
    const result = await handleImportRootPath(rootPathId);
    if (result?.success) {
      maybeAutoScrapeImported(result);
    }
    return result;
  };

  const handleSettingsSave = async () => {
    setShowSettings(false);
    setSelectedTag('');
    setSearchQuery('');
    setSelectedRootPathId(null);
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

  const resolveLauncherByHistoryMethod = (api, method) => {
    const m = String(method || '').trim();
    if (m === 'powershell-runas') return api?.launchExecutableAdmin;
    if (m === 'leproc') return api?.launchExecutableLocaleEmulator;
    if (m === 'lrproc') return api?.launchExecutableLocaleRemulator;
    return api?.launchExecutable;
  };

  const launchFromHistoryItem = async (it) => {
    const api = window.electronAPI;
    if (!api) return { ok: false, error: '当前环境不支持运行' };

    const exePath = String(it?.exe_path || '').trim();
    if (!exePath) return { ok: false, error: '启动失败：无效路径' };

    const method = String(it?.method || '').trim();
    const launcher = resolveLauncherByHistoryMethod(api, method);
    if (typeof launcher !== 'function') return { ok: false, error: '当前环境不支持运行' };

    const result = await launcher(exePath, [], {
      gameId: it?.game_id ?? null,
      gameName: String(it?.game_name || '')
    });

    if (result?.success) {
      if (method === 'powershell-runas') {
        return { ok: true, status: { type: 'success', message: '已请求以管理员身份启动' } };
      }
      if (method === 'leproc') {
        return { ok: true, status: { type: 'success', message: '已通过 Locale Emulator 启动' } };
      }
      if (method === 'lrproc') {
        return { ok: true, status: { type: 'success', message: '已通过 Locale Remulator 启动' } };
      }
      if (result?.needsUserConfirm) {
        return { ok: true, status: { type: 'success', message: '已请求启动，如弹出 SmartScreen 请点“更多信息 → 仍要运行”' } };
      }
      return { ok: true, status: { type: 'success', message: '已启动' } };
    }

    return { ok: false, error: String(result?.error || '未知错误'), details: String(result?.details || '') };
  };

  const getLatestRunHistoryForGame = async (gameId) => {
    const api = window.electronAPI;
    if (!api?.getRunHistory) return null;

    const rawId = gameId ?? null;
    const targetId = rawId === null || rawId === undefined ? '' : String(rawId);
    if (!targetId) return null;

    const result = await api.getRunHistory({ limit: 200, offset: 0 });
    if (!result?.success || !Array.isArray(result.items)) return null;

    for (const it of result.items) {
      const itId = it?.game_id === null || it?.game_id === undefined ? '' : String(it.game_id);
      if (itId && itId === targetId) return it;
    }
    return null;
  };

  const pickAutoExecutable = (items) => {
    const list = Array.isArray(items) ? items : [];
    const normalized = list
      .map((it) => {
        const fullPath = typeof it?.path === 'string' ? it.path.trim() : '';
        if (!fullPath) return null;
        const relativePath = typeof it?.relativePath === 'string' ? it.relativePath.trim() : '';
        const relNorm = relativePath.replace(/\\/g, '/');
        const depth = relNorm ? relNorm.split('/').filter(Boolean).length : Number.POSITIVE_INFINITY;
        const name =
          typeof it?.name === 'string' && it.name.trim()
            ? it.name.trim()
            : fullPath.replace(/\\/g, '/').split('/').filter(Boolean).slice(-1)[0] || '';
        if (name.toLowerCase().includes('unitycrash')) return null;
        return { ...it, path: fullPath, relativePath, __depth: depth, __name: name };
      })
      .filter(Boolean);

    if (normalized.length === 0) return null;

    let minDepth = Number.POSITIVE_INFINITY;
    for (const it of normalized) {
      if (Number.isFinite(it.__depth) && it.__depth < minDepth) minDepth = it.__depth;
    }
    const shallow = normalized.filter((it) => it.__depth === minDepth);
    const pool = shallow.length > 0 ? shallow : normalized;

    let best = pool[0];
    let bestNameLen = String(best.__name || '').length;
    for (let i = 1; i < pool.length; i++) {
      const current = pool[i];
      const len = String(current.__name || '').length;
      if (len > bestNameLen) {
        best = current;
        bestNameLen = len;
      }
    }
    return best;
  };

  const handleGameQuickLaunch = async (game) => {
    try {
      const api = window.electronAPI;
      if (!api?.scanExecutables || !api?.launchExecutable) {
        showStatus('error', '当前环境不支持运行');
        return;
      }

      const history = await getLatestRunHistoryForGame(game?.id);
      if (history) {
        const res = await launchFromHistoryItem(history);
        if (res?.ok) {
          const st = res?.status;
          if (st?.type && st?.message) {
            showStatus(st.type, st.message);
          }
          await loadRunHistory({ offset: 0, append: false });
          return;
        }
      }

      const paths = (game?.paths && Array.isArray(game.paths) && game.paths.length > 0)
        ? game.paths
        : (game?.path ? [game.path] : []);

      if (!paths.length) {
        showStatus('error', '启动失败：未配置游戏路径');
        return;
      }

      const scan = await api.scanExecutables(paths);
      const items = Array.isArray(scan?.items) ? scan.items : [];
      if (!scan?.success || items.length === 0) {
        showStatus('error', '未找到 exe 文件');
        return;
      }

      const picked = pickAutoExecutable(items);
      const exePath = String(picked?.path || '').trim();
      if (!exePath) {
        showStatus('error', '未找到可执行文件');
        return;
      }

      const result = await api.launchExecutable(exePath, paths, {
        gameId: game?.id ?? null,
        gameName: String((game?.alias ?? '').trim() || game?.name || '')
      });

      if (result?.success) {
        if (result.needsUserConfirm) {
          showStatus('success', '已请求启动，如弹出 SmartScreen 请点“更多信息 → 仍要运行”');
        } else {
          showStatus('success', '已启动');
        }
        await loadRunHistory({ offset: 0, append: false });
        return;
      }

      const detail = result?.details ? `（${result.details}）` : '';
      showStatus('error', '启动失败：' + (result?.error || '未知错误') + detail);
    } catch (error) {
      showStatus('error', '启动失败：' + (error?.message || String(error)));
    }
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

  const handleBulkScrape = async ({ gameIds = null, ignoreLoading = false, ignoreScope = false } = {}) => {
    if (bulkScrapeLoading || (!ignoreLoading && loading)) return;
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
      const intervalMs = Number.isFinite(parsedIntervalMs) && parsedIntervalMs >= 0 ? parsedIntervalMs : 800;
      const parsedMaxConcurrent = Number.parseInt(String(settings?.bulkScrapeMaxConcurrent || '').trim(), 10);
      const maxConcurrent = Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent >= 1 ? parsedMaxConcurrent : 1;

      const idSet = Array.isArray(gameIds)
        ? new Set(gameIds.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n)))
        : null;

      const allGames = await fetchAllGames();
      if (bulkScrapeRunIdRef.current !== runId || bulkScrapeCancelRef.current) return;
      const defaultScopeIds = [...rootPaths.map((rp) => rp.id), 'others'];
      const effectiveScopeIds = Array.isArray(bulkScrapeScopeRootPathIds) ? bulkScrapeScopeRootPathIds : defaultScopeIds;
      const includeOthers = effectiveScopeIds.some((v) => String(v ?? '').trim().toLowerCase() === 'others');
      const enabledRootIds = effectiveScopeIds
        .map((v) => Number.parseInt(String(v), 10))
        .filter((n) => Number.isFinite(n));
      const enabledRootIdSet = new Set(enabledRootIds);
      const hasEnabledRoots = enabledRootIdSet.size > 0;

      const targets = allGames
        .filter((g) => !g.cover_path)
        .filter((g) => (idSet ? idSet.has(Number(g.id)) : true))
        .filter((g) => {
          if (ignoreScope) return true;
          const ids = Array.isArray(g?.root_path_ids)
            ? g.root_path_ids
            : (g?.root_path_id === null || g?.root_path_id === undefined ? [] : [g.root_path_id]);
          if (ids.length === 0) return includeOthers;
          if (!hasEnabledRoots) return false;
          return ids.some((id) => enabledRootIdSet.has(Number(id)));
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

  const totalPages = Math.ceil(totalGames / effectivePageSize);
  const showFloatingPagination =
    !showSettings && !selectedGame && !showRunHistory && !showBulkScrapeScope && totalPages > 1;

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (loading || bulkScrapeLoading) return;
      if (showSettings || selectedGame || showRunHistory || showBulkScrapeScope) return;
      if (totalPages <= 1) return;

      const el = document.activeElement;
      const tag = el?.tagName ? String(el.tagName).toLowerCase() : '';
      if (el?.isContentEditable) return;
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      event.preventDefault();
      if (tagFilterOpen) setTagFilterOpen(false);
      if (rootFilterOpen) setRootFilterOpen(false);

      if (event.key === 'ArrowLeft') {
        setCurrentPage((prev) => Math.max(1, prev - 1));
      } else {
        setCurrentPage((prev) => Math.min(totalPages, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bulkScrapeLoading, loading, rootFilterOpen, selectedGame, showBulkScrapeScope, showRunHistory, showSettings, tagFilterOpen, totalPages]);

  const BulkScrapeScopeModal = () => {
    const defaultScopeIds = [...rootPaths.map((rp) => rp.id), 'others'];
    const effectiveScopeIds = Array.isArray(bulkScrapeScopeRootPathIds) ? bulkScrapeScopeRootPathIds : defaultScopeIds;
    const [draftIds, setDraftIds] = useState(effectiveScopeIds);
    const [scrapeSourceExpanded, setScrapeSourceExpanded] = useState(false);
    const [credentialsExpanded, setCredentialsExpanded] = useState(false);
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
    const [autoScrapeAfterRefresh, setAutoScrapeAfterRefresh] = useState(true);
    const [steamGridDbKey, setSteamGridDbKey] = useState('');
    const [igdbClientId, setIgdbClientId] = useState('');
    const [igdbClientSecret, setIgdbClientSecret] = useState('');
    const [vndbToken, setVndbToken] = useState('');
    const [steamGridDbKeyVisible, setSteamGridDbKeyVisible] = useState(false);
    const [igdbClientIdVisible, setIgdbClientIdVisible] = useState(false);
    const [igdbClientSecretVisible, setIgdbClientSecretVisible] = useState(false);
    const [vndbTokenVisible, setVndbTokenVisible] = useState(false);
    const [bulkScrapeIntervalMs, setBulkScrapeIntervalMs] = useState('800');
    const [bulkScrapeMaxConcurrent, setBulkScrapeMaxConcurrent] = useState('1');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      const currentRootIds = rootPaths.map((rp) => rp.id);
      const currentRootIdSet = new Set(currentRootIds);
      if (Array.isArray(bulkScrapeScopeRootPathIds)) {
        const includeOthers = bulkScrapeScopeRootPathIds.some((v) => String(v ?? '').trim().toLowerCase() === 'others');
        const normalized = [...new Set(bulkScrapeScopeRootPathIds.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n)))];
        const filtered = normalized.filter((id) => currentRootIdSet.has(id)).sort((a, b) => a - b);
        setDraftIds([...filtered, ...(includeOthers ? ['others'] : [])]);
      } else {
        setDraftIds([...currentRootIds, 'others']);
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
          setAutoScrapeAfterRefresh(toEnabled(settings?.autoScrapeAfterRefresh, true));
          setSteamGridDbKey(settings?.steamgriddbApiKey || '');
          setIgdbClientId(settings?.igdbClientId || '');
          setIgdbClientSecret(settings?.igdbClientSecret || '');
          setVndbToken(settings?.vndbToken || '');
          setBulkScrapeIntervalMs(
            settings?.bulkScrapeIntervalMs !== undefined && settings?.bulkScrapeIntervalMs !== null && String(settings?.bulkScrapeIntervalMs).trim() !== ''
              ? String(settings.bulkScrapeIntervalMs)
              : '800'
          );
          setBulkScrapeMaxConcurrent(
            settings?.bulkScrapeMaxConcurrent !== undefined && settings?.bulkScrapeMaxConcurrent !== null && String(settings?.bulkScrapeMaxConcurrent).trim() !== ''
              ? String(settings.bulkScrapeMaxConcurrent)
              : '1'
          );
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
        const parsedIntervalMs = Number.parseInt(String(bulkScrapeIntervalMs || '').trim(), 10);
        const normalizedIntervalMs = Number.isFinite(parsedIntervalMs) && parsedIntervalMs >= 0 ? parsedIntervalMs : 800;
        const parsedMaxConcurrent = Number.parseInt(String(bulkScrapeMaxConcurrent || '').trim(), 10);
        const normalizedMaxConcurrent = Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent >= 1 ? parsedMaxConcurrent : 1;

        setBulkScrapeIntervalMs(String(normalizedIntervalMs));
        setBulkScrapeMaxConcurrent(String(normalizedMaxConcurrent));

        const includeOthers = draftIds.some((v) => String(v ?? '').trim().toLowerCase() === 'others');
        const normalized = [...new Set(draftIds.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n)))];
        normalized.sort((a, b) => a - b);
        const nextScope = [...normalized, ...(includeOthers ? ['others'] : [])];
        await window.electronAPI.saveSetting(bulkScrapeScopeSettingKey, JSON.stringify(nextScope));
        await window.electronAPI.saveSetting('autoScrapeAfterRefresh', autoScrapeAfterRefresh ? '1' : '0');
        await window.electronAPI.saveSetting('steamgriddbApiKey', String(steamGridDbKey || '').trim());
        await window.electronAPI.saveSetting('igdbClientId', String(igdbClientId || '').trim());
        await window.electronAPI.saveSetting('igdbClientSecret', String(igdbClientSecret || '').trim());
        await window.electronAPI.saveSetting('vndbToken', String(vndbToken || '').trim());
        await window.electronAPI.saveSetting('bulkScrapeIntervalMs', String(normalizedIntervalMs));
        await window.electronAPI.saveSetting('bulkScrapeMaxConcurrent', String(normalizedMaxConcurrent));
        await window.electronAPI.saveSetting('scrapeEnableSteamGridDB', scrapeEnabled.SteamGridDB ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableIGDB', scrapeEnabled.IGDB ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableVNDBv2', scrapeEnabled.VNDBv2 ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableYmgal', scrapeEnabled.Ymgal ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableVNDB', scrapeEnabled.VNDB ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableSteam', scrapeEnabled.Steam ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableBangumi', scrapeEnabled.Bangumi ? '1' : '0');
        await window.electronAPI.saveSetting('scrapeEnableDLsite', scrapeEnabled.DLsite ? '1' : '0');
        setBulkScrapeScopeRootPathIds(nextScope);
        setShowBulkScrapeScope(false);
        showStatus('success', '刮削配置已保存');
      } catch (error) {
        showStatus('error', '保存失败：' + (error?.message || String(error)));
      } finally {
        setSaving(false);
      }
    };

    return (
      <div
        className="modal-overlay fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
      >
        <div className="modal-content bg-slate-900 rounded-2xl w-full max-w-lg mx-4 border border-white/10 shadow-2xl shadow-black/50 transform transition-all duration-300 hover:shadow-3xl flex flex-col max-h-[70vh] overflow-hidden">
          <div className="p-6 border-b border-white/5 bg-white/5 rounded-t-2xl relative">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-white">刮削配置</h2>
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
            <div className="bg-gray-900/35 border border-gray-800/80 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-200">批量刮削范围</div>
                  <div className="text-xs text-gray-500 mt-1">选择参与批量刮削的根目录</div>
                </div>
              </div>

              <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
                {rootPaths.map((rp) => {
                  const checked = draftIds.includes(rp.id);
                  return (
                    <button
                      key={rp.id}
                      type="button"
                      onClick={() => toggle(rp.id)}
                      className={`w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                        checked
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-white/5 border-white/5 text-gray-300 hover:bg-white/10 hover:border-white/10'
                      }`}
                    >
                      <span className="text-sm font-medium truncate">{rp.path}</span>
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          checked ? 'bg-white/20 border-white/30' : 'bg-transparent border-white/10'
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

                {(() => {
                  const checked = draftIds.some((v) => String(v ?? '').trim().toLowerCase() === 'others');
                  return (
                    <button
                      key="others"
                      type="button"
                      onClick={() => toggle('others')}
                      className={`w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                        checked
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-white/5 border-white/5 text-gray-300 hover:bg-white/10 hover:border-white/10'
                      }`}
                    >
                      <span className="text-sm font-medium truncate">Others（单独加入）</span>
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          checked ? 'bg-white/20 border-white/30' : 'bg-transparent border-white/10'
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
                })()}

                {rootPaths.length === 0 && (
                  <div className="text-sm text-gray-400 bg-gray-900/40 border border-gray-800/80 rounded-xl p-4">
                    当前没有根目录
                  </div>
                )}
              </div>
            </div>

            <div className="bg-gray-900/35 border border-gray-800/80 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-200">刮削源</div>
                  <div className="text-xs text-gray-500 mt-1">启用越多，速度越慢；需要凭据的源可在下方配置</div>
                </div>
                <button
                  type="button"
                  onClick={() => setScrapeSourceExpanded((v) => !v)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white bg-gray-850/60 hover:bg-gray-800/80 border border-gray-800/80 hover:border-gray-700/80 transition-all cursor-pointer"
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

              {scrapeSourceExpanded ? (
                <div className="mt-3 space-y-2">
                  {[
                    { key: 'VNDBv2', label: 'VNDB Kana v2', desc: '' },
                    { key: 'Ymgal', label: '月幕Galgame', desc: '' },
                    { key: 'Bangumi', label: 'Bangumi', desc: '' },
                    { key: 'Steam', label: 'Steam', desc: '裸连容易超时' },
                    { key: 'SteamGridDB', label: 'SteamGridDB', desc: '需要 API Key' },
                    { key: 'IGDB', label: 'IGDB', desc: '需要 Client ID/Secret' },
                    { key: 'VNDB', label: 'VNDB', desc: '需要 Token' },
                    { key: 'DLsite', label: 'DLsite', desc: 'RJ/VJ 号' }
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setScrapeEnabled((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                      className="w-full flex items-center justify-between gap-3 p-3 bg-gray-850/60 rounded-xl border border-gray-800/80 hover:border-gray-700/80 hover:bg-gray-800/70 transition-all cursor-pointer text-left"
                      aria-pressed={scrapeEnabled[item.key]}
                    >
                      <div className="min-w-0 text-left">
                        <div className="text-sm text-gray-300">{item.label}</div>
                        {item.desc ? <div className="text-xs text-gray-500 mt-0.5 truncate">{item.desc}</div> : null}
                      </div>
                      <span
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          scrapeEnabled[item.key] ? 'bg-emerald-600' : 'bg-gray-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                            scrapeEnabled[item.key] ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="bg-gray-900/35 border border-gray-800/80 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-200">凭据</div>
                  <div className="text-xs text-gray-500 mt-1">Key/Token 仅本地保存；仅对启用的刮削源生效</div>
                </div>
                <button
                  type="button"
                  onClick={() => setCredentialsExpanded((v) => !v)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white bg-gray-850/60 hover:bg-gray-800/80 border border-gray-800/80 hover:border-gray-700/80 transition-all cursor-pointer"
                  aria-expanded={credentialsExpanded}
                >
                  {credentialsExpanded ? '收起' : '展开'}
                  <svg
                    className={`w-4 h-4 transition-transform ${credentialsExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {credentialsExpanded ? (
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs text-gray-400">SteamGridDB API Key</div>
                    <div className="relative">
                      <input
                        type={steamGridDbKeyVisible ? 'text' : 'password'}
                        value={steamGridDbKey}
                        onChange={(e) => setSteamGridDbKey(e.target.value)}
                        placeholder="可选：用于 SteamGridDB 刮削"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/80 focus:border-transparent transition-all duration-200"
                        style={{ WebkitAppRegion: 'no-drag' }}
                      />
                      <button
                        type="button"
                        onClick={() => setSteamGridDbKeyVisible((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors cursor-pointer"
                        title={steamGridDbKeyVisible ? '隐藏' : '显示'}
                        aria-label={steamGridDbKeyVisible ? '隐藏' : '显示'}
                        style={{ WebkitAppRegion: 'no-drag' }}
                      >
                        {steamGridDbKeyVisible ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10.478 10.49a3 3 0 104.03 4.03M9.88 5.09A9.96 9.96 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.965 9.965 0 01-4.13 5.368M6.228 6.228A9.965 9.965 0 002.458 12c1.274 4.057 5.064 7 9.542 7a9.96 9.96 0 003.21-.53"
                            />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400">IGDB Client ID</div>
                      <div className="relative">
                        <input
                          type={igdbClientIdVisible ? 'text' : 'password'}
                          value={igdbClientId}
                          onChange={(e) => setIgdbClientId(e.target.value)}
                          placeholder="可选：IGDB Client ID"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all duration-200"
                          style={{ WebkitAppRegion: 'no-drag' }}
                        />
                        <button
                          type="button"
                          onClick={() => setIgdbClientIdVisible((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors cursor-pointer"
                          title={igdbClientIdVisible ? '隐藏' : '显示'}
                          aria-label={igdbClientIdVisible ? '隐藏' : '显示'}
                          style={{ WebkitAppRegion: 'no-drag' }}
                        >
                          {igdbClientIdVisible ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10.478 10.49a3 3 0 104.03 4.03M9.88 5.09A9.96 9.96 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.965 9.965 0 01-4.13 5.368M6.228 6.228A9.965 9.965 0 002.458 12c1.274 4.057 5.064 7 9.542 7a9.96 9.96 0 003.21-.53"
                              />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400">IGDB Client Secret</div>
                      <div className="relative">
                        <input
                          type={igdbClientSecretVisible ? 'text' : 'password'}
                          value={igdbClientSecret}
                          onChange={(e) => setIgdbClientSecret(e.target.value)}
                          placeholder="可选：IGDB Client Secret"
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/80 focus:border-transparent transition-all duration-200"
                          style={{ WebkitAppRegion: 'no-drag' }}
                        />
                        <button
                          type="button"
                          onClick={() => setIgdbClientSecretVisible((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors cursor-pointer"
                          title={igdbClientSecretVisible ? '隐藏' : '显示'}
                          aria-label={igdbClientSecretVisible ? '隐藏' : '显示'}
                          style={{ WebkitAppRegion: 'no-drag' }}
                        >
                          {igdbClientSecretVisible ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10.478 10.49a3 3 0 104.03 4.03M9.88 5.09A9.96 9.96 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.965 9.965 0 01-4.13 5.368M6.228 6.228A9.965 9.965 0 002.458 12c1.274 4.057 5.064 7 9.542 7a9.96 9.96 0 003.21-.53"
                              />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-gray-400">VNDB Token</div>
                    <div className="relative">
                      <input
                        type={vndbTokenVisible ? 'text' : 'password'}
                        value={vndbToken}
                        onChange={(e) => setVndbToken(e.target.value)}
                        placeholder="可选：用于 VNDB 刮削"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/80 focus:border-transparent transition-all duration-200"
                        style={{ WebkitAppRegion: 'no-drag' }}
                      />
                      <button
                        type="button"
                        onClick={() => setVndbTokenVisible((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors cursor-pointer"
                        title={vndbTokenVisible ? '隐藏' : '显示'}
                        aria-label={vndbTokenVisible ? '隐藏' : '显示'}
                        style={{ WebkitAppRegion: 'no-drag' }}
                      >
                        {vndbTokenVisible ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10.478 10.49a3 3 0 104.03 4.03M9.88 5.09A9.96 9.96 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.965 9.965 0 01-4.13 5.368M6.228 6.228A9.965 9.965 0 002.458 12c1.274 4.057 5.064 7 9.542 7a9.96 9.96 0 003.21-.53"
                            />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="bg-gray-900/35 border border-gray-800/80 rounded-2xl p-4">
              <div className="text-sm font-medium text-gray-200">执行策略</div>
              <div className="text-xs text-gray-500 mt-1">影响刷新后自动刮削与批量刮削速度</div>

              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-3 p-4 bg-gray-850/60 rounded-xl border border-gray-800/80">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-300 whitespace-nowrap">刷新后自动刮削本次新增</div>
                    <div className="text-xs text-gray-500 mt-1 truncate">仅对新入库且缺失封面的游戏生效</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoScrapeAfterRefresh((v) => !v)}
                    className={`shrink-0 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      autoScrapeAfterRefresh
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                        : 'bg-gray-800 text-gray-300 border-gray-700/80 hover:bg-gray-700'
                    }`}
                  >
                    {autoScrapeAfterRefresh ? '已开启' : '已关闭'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="text-xs text-gray-400">批量刮削间隔（毫秒）</div>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={bulkScrapeIntervalMs}
                      onChange={(e) => setBulkScrapeIntervalMs(e.target.value)}
                      placeholder="例如 800"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/80 focus:border-transparent transition-all duration-200"
                      style={{ WebkitAppRegion: 'no-drag' }}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-gray-400">最大并发数</div>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={bulkScrapeMaxConcurrent}
                      onChange={(e) => setBulkScrapeMaxConcurrent(e.target.value)}
                      placeholder="例如 2"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/80 focus:border-transparent transition-all duration-200"
                      style={{ WebkitAppRegion: 'no-drag' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-gray-800/80 bg-gray-900/30">
            <div className="flex items-center justify-end gap-6">
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

  const RunHistoryModal = () => {
    const formatMethod = (m) => {
      const v = String(m || '').trim();
      if (!v) return '未知方式';
      if (v === 'shell.openPath') return '直接启动';
      if (v === 'powershell-runas') return '管理员启动';
      if (v === 'leproc') return 'Locale Emulator';
      if (v === 'lrproc') return 'Locale Remulator';
      return v;
    };

    const formatTime = (ts) => {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return '';
      try {
        return new Date(n).toLocaleString();
      } catch {
        return '';
      }
    };

    const relaunchFromHistory = async (it) => {
      try {
        const res = await launchFromHistoryItem(it);
        if (res?.ok) {
          const st = res?.status;
          if (st?.type && st?.message) {
            showStatus(st.type, st.message);
          }
          await loadRunHistory({ offset: 0, append: false });
          return;
        }
        const detail = res?.details ? `（${res.details}）` : '';
        showStatus('error', '启动失败：' + (res?.error || '未知错误') + detail);
      } catch (error) {
        showStatus('error', '启动失败：' + (error?.message || String(error)));
      }
    };

    return (
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setShowRunHistory(false);
        }}
      >
        <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl transform animate-in zoom-in-95 duration-200 overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col">
          <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-800/80">
            <div className="min-w-0">
              <div className="text-white font-semibold">运行历史</div>
              <div className="text-xs text-gray-400">共 {runHistoryTotal} 条</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm transition-all disabled:opacity-60"
                disabled={runHistoryLoading || runHistoryTotal === 0}
                onClick={async () => {
                  try {
                    const api = window.electronAPI;
                    if (!api?.clearRunHistory) return;
                    const res = await api.clearRunHistory();
                    if (res?.success) {
                      setRunHistoryItems([]);
                      setRunHistoryTotal(0);
                      setRunHistoryOffset(0);
                    }
                  } catch {}
                }}
              >
                清空
              </button>
              <button
                type="button"
                className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm transition-all"
                onClick={() => setShowRunHistory(false)}
              >
                关闭
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-5 py-4">
            {runHistoryItems.length === 0 ? (
              <div className="text-gray-400 text-sm py-10 text-center">
                {runHistoryLoading ? '加载中...' : '暂无记录'}
              </div>
            ) : (
              <div className="space-y-3">
                {runHistoryItems.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className="w-full text-left bg-gray-950/40 border border-gray-800/70 rounded-xl p-3 hover:bg-gray-900/55 hover:border-gray-700/70 transition-all"
                    onClick={() => relaunchFromHistory(it)}
                    title="点击按上次方式启动"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-gray-100 text-sm truncate">
                          {String(it.game_name || '未命名游戏')}
                        </div>
                        <div className="text-xs text-gray-500">{formatTime(it.launched_at)}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {it.needs_user_confirm ? (
                          <span className="text-xs px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/20">
                            需确认
                          </span>
                        ) : null}
                        <span className="text-xs px-2 py-1 rounded-lg bg-white/5 text-gray-300 border border-white/10">
                          {formatMethod(it.method)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-400 break-all font-mono">
                      {String(it.exe_path || '')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 px-5 py-4 border-t border-gray-800/80 flex items-center justify-between gap-3">
            <button
              type="button"
              className="text-sm text-indigo-300 hover:text-indigo-200 transition-colors disabled:opacity-60"
              disabled={runHistoryLoading}
              onClick={() => loadRunHistory({ offset: 0, append: false })}
            >
              刷新
            </button>
            <button
              type="button"
              className="text-sm text-gray-200 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-xl transition-all disabled:opacity-60"
              disabled={runHistoryLoading || runHistoryItems.length >= runHistoryTotal}
              onClick={() => loadRunHistory({ offset: runHistoryOffset + runHistoryLimit, append: true })}
            >
              {runHistoryItems.length >= runHistoryTotal ? '没有更多了' : '加载更多'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {projectBackgroundUrl ? (
        <div
          className="fixed inset-0 z-[-2] bg-center bg-cover bg-no-repeat"
          style={{ backgroundImage: `url("${projectBackgroundUrl}")` }}
        />
      ) : null}
      <div
        className={`fixed inset-0 z-[-1] ${
          projectBackgroundUrl
            ? 'bg-black/60'
            : 'bg-gradient-to-br from-gray-950 via-gray-950 to-gray-900'
        }`}
      />
      <div className="flex-none z-50">
        <Header
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onOpenSettings={() => setShowSettings(true)}
          rootPaths={rootPaths}
          hasBackground={hasProjectBackground}
        />
      </div>
      
      <div className="flex-1 overflow-y-auto relative scroll-smooth">
        <main className={`w-full max-w-[2000px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 ${showFloatingPagination ? 'pb-24' : 'pb-8'}`}>
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

          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-5 gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
              <div className="flex items-center gap-4 shrink-0">
                <h1 className="text-xl font-semibold text-white">我的游戏</h1>
                <span className="text-gray-300 bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg text-xs">{totalGames} 个游戏</span>
              </div>
              {(tags.length > 0 || rootPaths.length > 0) && (
                <div className="flex items-center gap-2 py-1 min-w-0 flex-wrap">
                  <button
                    onClick={() => {
                      setSelectedTag('');
                      setSelectedRootPathId(null);
                      setSearchQuery('');
                      setTagFilterOpen(false);
                      setRootFilterOpen(false);
                    }}
                    className={`tag px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                      selectedTag || searchQuery || selectedRootPathId
                        ? 'bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10'
                        : 'bg-white/40 text-white hover:bg-white/50 border border-white/40 shadow-sm'
                    }`}
                  >
                    全部
                  </button>

                  {tags.length > 0 && (
                    <div ref={tagFilterPopoverRef} className="relative min-w-0">
                      <button
                        type="button"
                        ref={tagFilterButtonRef}
                        onClick={() => {
                          const next = !tagFilterOpen;
                          if (next) {
                            setTagFilterPopoverStyle(computeFilterPopoverStyle(tagFilterButtonRef.current));
                            setRootFilterOpen(false);
                          }
                          setTagFilterOpen(next);
                        }}
                        className={`tag inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors max-w-[240px] ${
                          selectedTag && !searchQuery
                            ? 'text-white shadow-sm'
                            : 'bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10'
                        }`}
                        style={{
                          backgroundColor: selectedTag && !searchQuery ? (selectedTagInfo?.color ? `color-mix(in srgb, ${selectedTagInfo.color}, transparent 60%)` : undefined) : undefined,
                          border: selectedTag && !searchQuery && selectedTagInfo?.color ? `1px solid color-mix(in srgb, ${selectedTagInfo.color}, transparent 60%)` : undefined
                        }}
                        aria-expanded={tagFilterOpen ? 'true' : 'false'}
                        aria-label="展开标签筛选"
                      >
                        <span className="truncate">{selectedTag && !searchQuery ? selectedTag : '标签'}</span>
                        <svg className={`w-4 h-4 transition-transform ${tagFilterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {tagFilterOpen && (
                        <div style={tagFilterPopoverStyle || undefined} className="z-50 rounded-xl bg-gray-950/75 backdrop-blur-md border border-white/10 shadow-xl shadow-black/25 p-4">
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
                                  className={`tag px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                    selectedTag === tag.name && !searchQuery
                                      ? 'text-white shadow-sm'
                                      : 'bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10'
                                  }`}
                                  style={{
                                    backgroundColor: selectedTag === tag.name && !searchQuery ? `color-mix(in srgb, ${tag.color}, transparent 60%)` : undefined,
                                    border: selectedTag === tag.name && !searchQuery ? `1px solid color-mix(in srgb, ${tag.color}, transparent 60%)` : undefined
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

                  {rootPaths.length > 0 && (
                    <div ref={rootFilterPopoverRef} className="relative min-w-0">
                      <button
                        type="button"
                        ref={rootFilterButtonRef}
                        onClick={() => {
                          const next = !rootFilterOpen;
                          if (next) {
                            setRootFilterPopoverStyle(computeFilterPopoverStyle(rootFilterButtonRef.current));
                            setTagFilterOpen(false);
                          }
                          setRootFilterOpen(next);
                        }}
                        className={`tag inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors max-w-[240px] ${
                          selectedRootPathId
                            ? 'bg-emerald-600/40 text-white hover:bg-emerald-600/50 border border-emerald-600/40 shadow-sm'
                            : 'bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10'
                        }`}
                        aria-expanded={rootFilterOpen ? 'true' : 'false'}
                        aria-label="展开根目录筛选"
                      >
                        <span className="truncate">
                          {selectedRootPathId === 'others'
                            ? 'Others'
                            : (selectedRootPathInfo?.path ? formatRootPathLabel(selectedRootPathInfo.path) : '根目录')}
                        </span>
                        <svg className={`w-4 h-4 transition-transform ${rootFilterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {rootFilterOpen && (
                        <div style={rootFilterPopoverStyle || undefined} className="z-50 rounded-xl bg-gray-950/75 backdrop-blur-md border border-white/10 shadow-xl shadow-black/25 p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div className="text-sm font-medium text-gray-200">根目录</div>
                            <button
                              type="button"
                              onClick={() => setRootFilterOpen(false)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 transition-colors"
                              aria-label="收起根目录筛选"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>

                          <div className="max-h-[50vh] overflow-y-auto overflow-x-hidden pr-1">
                            <div className="flex flex-wrap gap-2 min-w-0">
                              {rootPaths.map((rp) => (
                                <button
                                  key={rp.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedRootPathId(rp.id);
                                    setRootFilterOpen(false);
                                  }}
                                  className={`tag px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors max-w-full truncate ${
                                    selectedRootPathId === rp.id
                                      ? 'bg-emerald-600/40 text-white hover:bg-emerald-600/50 border border-emerald-600/40 shadow-sm'
                                      : 'bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10'
                                  }`}
                                  title={rp.path}
                                >
                                  {formatRootPathLabel(rp.path)}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRootPathId('others');
                                  setRootFilterOpen(false);
                                }}
                                className={`tag px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors max-w-full truncate ${
                                  selectedRootPathId === 'others'
                                    ? 'bg-emerald-600/40 text-white hover:bg-emerald-600/50 border border-emerald-600/40 shadow-sm'
                                    : 'bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10'
                                }`}
                                title="单独加入的游戏"
                              >
                                Others
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              {bulkScrapeLoading && bulkScrapeProgress.total > 0 && (
                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-200/90 font-medium whitespace-nowrap">
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
                </div>
              )}
              <div className="flex items-stretch rounded-lg overflow-hidden bg-white/5 border border-white/10 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setAndPersistViewMode('grid')}
                  className={`px-3 py-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 ${
                    viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/10'
                  }`}
                  title="卡片视图"
                  aria-label="卡片视图"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 9a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3zm11-9a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V6zm0 9a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setAndPersistViewMode('list')}
                  className={`px-3 py-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 ${
                    viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/10'
                  }`}
                  title="列表视图"
                  aria-label="列表视图"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                </button>
              </div>
              <div className="flex items-stretch rounded-lg overflow-hidden bg-white/5 border border-white/10 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setAndPersistImportedAtSortOrder(importedAtSortOrder === 'desc' ? 'asc' : 'desc')}
                  className="px-3 py-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/70 text-gray-200 hover:bg-white/10"
                  title={importedAtSortOrder === 'desc' ? '按导入时间：倒序' : '按导入时间：正序'}
                  aria-label={importedAtSortOrder === 'desc' ? '按导入时间倒序排序' : '按导入时间正序排序'}
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${importedAtSortOrder === 'desc' ? '' : 'rotate-180'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              <div className="flex items-stretch rounded-lg overflow-hidden bg-indigo-500/30 hover:bg-indigo-500/40 border border-indigo-400/30 shadow-sm transition-colors">
                <button
                  onClick={handleBulkScrape}
                  disabled={loading || bulkScrapeLoading}
                  className="flex items-center justify-center gap-2 px-4 py-2 text-white font-medium hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-r border-white/15"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v16h16V4H4zm4 4h8M8 12h8M8 16h6" />
                  </svg>
                  {bulkScrapeLoading ? '正在刮削...' : '批量刮削封面'}
                </button>
                <button
                  onClick={() => setShowBulkScrapeScope(true)}
                  disabled={loading || bulkScrapeLoading}
                  ref={bulkScrapeScopeButtonRef}
                  className="flex items-center justify-center px-3 text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="刮削配置"
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
            onGameQuickLaunch={handleGameQuickLaunch}
            tags={tags}
            onTogglePinned={handleTogglePinned}
            viewMode={viewMode}
          />
        </>
      </main>
      </div>

      {showFloatingPagination ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45]">
          <Pagination
            floating
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      ) : null}

      {showSettings && (
        <SettingsModal
          currentPaths={rootPaths}
          onSave={handleSettingsSave}
          onRefreshAll={handleRefreshAll}
          onRefreshRoot={handleRefreshRoot}
          bulkScrapeLoading={bulkScrapeLoading}
          bulkScrapeProgress={bulkScrapeProgress}
          onStopBulkScrape={handleStopBulkScrape}
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
        <>
          <button
            type="button"
            className="fixed bottom-10 right-0 z-[60] h-7 w-14 rounded-l-full bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-sm text-white/90 transition-all duration-300 flex items-center justify-center shadow-lg shadow-black/20"
            onClick={() => setShowRunHistory(true)}
            title="查看运行历史"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <div
            className={`fixed bottom-3 right-4 z-[40] text-xs pointer-events-none select-none ${
              hasProjectBackground ? 'text-gray-100/70' : 'text-gray-300/70'
            }`}
          >
            v{appVersion}
          </div>
        </>
      ) : null}

      {showRunHistory && <RunHistoryModal />}
    </div>
  );
}

export default App;
