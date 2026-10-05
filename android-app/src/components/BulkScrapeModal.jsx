import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  Play,
  Square,
  Sliders,
  Check,
  CheckSquare,
  Square as UncheckedSquare,
  Layers,
  Folder,
  Globe,
  WifiOff,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Info
} from 'lucide-react';
import {
  getScrapeSettings,
  saveScrapeSettings,
  scrapeGameCoverLocally,
  DEFAULT_SCRAPE_SETTINGS
} from '../utils/mobileScraper';
import { saveCoverBlob, updateGameInCache, getServerCache } from '../utils/cacheStorage';
import { enqueueOfflineChange, removePendingChangeForField } from '../utils/syncQueue';
import { api } from '../api/client';
import { useServer } from '../contexts/ServerContext';

export default function BulkScrapeModal({
  isOpen,
  onClose,
  allGames = [],
  rootPaths = [],
  onBulkComplete
}) {
  const { serverUrl, token, connected, showToast } = useServer();

  // 刮削策略配置状态
  const [settings, setSettings] = useState(() => getScrapeSettings());
  const [onlyMissingCover, setOnlyMissingCover] = useState(true);
  const [selectedRootPathId, setSelectedRootPathId] = useState('all'); // 'all' | rootPathId

  // 运行与进度状态
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, successCount: 0, failCount: 0 });
  const [currentTitle, setCurrentTitle] = useState('');
  const [logs, setLogs] = useState([]);

  const cancelRef = useRef(false);
  const runIdRef = useRef(0);

  // 完整游戏池 (优先加载全量缓存，而非仅当前页的 40 款)
  const [gamesPool, setGamesPool] = useState(allGames);

  useEffect(() => {
    if (isOpen) {
      setSettings(getScrapeSettings());
      setLogs([]);
      setProgress({ current: 0, total: 0, successCount: 0, failCount: 0 });
      setCurrentTitle('');

      const loadFullLibrary = async () => {
        if (serverUrl) {
          try {
            const cache = await getServerCache(serverUrl, token);
            if (cache?.games && Array.isArray(cache.games) && cache.games.length > 0) {
              setGamesPool(cache.games);
              return;
            }
          } catch {}
        }
        if (connected) {
          try {
            const res = await api.getAllGames();
            if (res?.items && Array.isArray(res.items) && res.items.length > 0) {
              setGamesPool(res.items);
              return;
            }
          } catch {}
        }
        setGamesPool(allGames);
      };

      loadFullLibrary();
    }
  }, [isOpen, serverUrl, token, connected, allGames]);

  if (!isOpen) return null;

  // 过滤目标游戏 (基于完整游戏池)
  const getTargetGames = () => {
    return gamesPool.filter((game) => {
      // 1. 封面条件
      if (onlyMissingCover && game.hasCover !== false && game.cover_path) {
        return false;
      }
      // 2. 根目录条件
      if (selectedRootPathId !== 'all') {
        const rId = Number(selectedRootPathId);
        if (Array.isArray(game.root_path_ids)) {
          if (!game.root_path_ids.includes(rId)) return false;
        } else if (Number(game.root_path_id) !== rId) {
          return false;
        }
      }
      return true;
    });
  };

  const targetGames = getTargetGames();

  // 切换单个源的启用状态
  const handleToggleProvider = (key) => {
    const nextProviders = {
      ...settings.enabledProviders,
      [key]: !settings.enabledProviders[key]
    };
    const nextSettings = { ...settings, enabledProviders: nextProviders };
    setSettings(nextSettings);
    saveScrapeSettings(nextSettings);
  };

  // 修改并发数
  const handleChangeConcurrent = (val) => {
    const num = Math.min(3, Math.max(1, Number(val) || 1));
    const nextSettings = { ...settings, maxConcurrent: num };
    setSettings(nextSettings);
    saveScrapeSettings(nextSettings);
  };

  // 修改间隔时间
  const handleChangeInterval = (val) => {
    const num = Math.min(3000, Math.max(300, Number(val) || 800));
    const nextSettings = { ...settings, intervalMs: num };
    setSettings(nextSettings);
    saveScrapeSettings(nextSettings);
  };

  // 停止批量刮削
  const handleStop = () => {
    cancelRef.current = true;
    setIsRunning(false);
    setCurrentTitle('已手动中止');
    showToast('批量刮削已中止', 'info');
  };

  // 开始批量刮削
  const handleStart = async () => {
    // 检查网络
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('当前无网络连接，无法进行刮削', 'warning');
      return;
    }

    if (targetGames.length === 0) {
      showToast('没有符合条件的待刮削游戏', 'info');
      return;
    }

    const enabledList = Object.entries(settings.enabledProviders).filter(([_, en]) => en);
    if (enabledList.length === 0) {
      showToast('请至少勾选一个刮削数据源', 'warning');
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    cancelRef.current = false;

    setIsRunning(true);
    setProgress({ current: 0, total: targetGames.length, successCount: 0, failCount: 0 });
    setLogs([]);

    const maxConcurrent = settings.maxConcurrent || 1;
    const intervalMs = settings.intervalMs || 800;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const sleepCancellable = async (ms) => {
      let rem = ms;
      while (rem > 0) {
        if (cancelRef.current || runIdRef.current !== runId) return false;
        const chunk = Math.min(rem, 100);
        await sleep(chunk);
        rem -= chunk;
      }
      return !cancelRef.current && runIdRef.current === runId;
    };

    let completed = 0;
    let success = 0;
    let failed = 0;
    let nextStartAt = Date.now();
    const inFlight = new Set();
    const totalCount = targetGames.length;

    const appendLog = (msg, type = 'info') => {
      setLogs((prev) => [{ id: Date.now() + Math.random(), msg, type }, ...prev.slice(0, 49)]);
    };

    const processOne = async (game) => {
      if (cancelRef.current || runIdRef.current !== runId) return;
      setCurrentTitle(`《${game.name}》`);

      try {
        const res = await scrapeGameCoverLocally(game, settings);
        if (cancelRef.current || runIdRef.current !== runId) return;

        if (res?.success && res.blob) {
          const nowIso = new Date().toISOString();
          const nowTs = Date.now();

          // 1. 本地 IndexedDB 写入封面
          if (serverUrl) {
            await saveCoverBlob(serverUrl, game.id, res.blob, nowTs, token);
            await updateGameInCache(serverUrl, game.id, { hasCover: true, updatedAt: nowIso }, token);
          }

          // 2. 双端数据同步处理
          if (connected) {
            try {
              const reader = new FileReader();
              const dataUrlPromise = new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
              });
              reader.readAsDataURL(res.blob);
              const dataUrl = await dataUrlPromise;
              await api.uploadGameCover(game.id, dataUrl);
              removePendingChangeForField(serverUrl, game.id, 'cover');
            } catch (upErr) {
              enqueueOfflineChange(serverUrl, {
                gameId: game.id,
                gameName: game.name,
                type: 'cover',
                value: true,
                token
              });
            }
          } else {
            enqueueOfflineChange(serverUrl, {
              gameId: game.id,
              gameName: game.name,
              type: 'cover',
              value: true,
              token
            });
          }

          success++;
          appendLog(`《${game.name}》刮削成功 [${res.provider}]`, 'success');
        } else {
          failed++;
          appendLog(`《${game.name}》未匹配到封面`, 'fail');
        }
      } catch (err) {
        if (cancelRef.current || runIdRef.current !== runId) return;
        failed++;
        if (err?.message === 'NO_NETWORK' || !navigator.onLine) {
          appendLog(`网络中断，已暂停`, 'error');
          cancelRef.current = true;
        } else {
          appendLog(`《${game.name}》刮削异常: ${err.message}`, 'fail');
        }
      } finally {
        completed++;
        if (runIdRef.current === runId && !cancelRef.current) {
          setProgress({
            current: completed,
            total: totalCount,
            successCount: success,
            failCount: failed
          });
        }
      }
    };

    let idx = 0;
    while (idx < targetGames.length || inFlight.size > 0) {
      if (cancelRef.current || runIdRef.current !== runId) break;

      while (idx < targetGames.length && inFlight.size < maxConcurrent) {
        const waitMs = Math.max(0, nextStartAt - Date.now());
        if (waitMs > 0) {
          const ok = await sleepCancellable(waitMs);
          if (!ok) break;
        }
        if (cancelRef.current || runIdRef.current !== runId) break;

        const currentGame = targetGames[idx];
        idx++;
        nextStartAt = Date.now() + intervalMs;

        const p = processOne(currentGame).finally(() => {
          inFlight.delete(p);
        });
        inFlight.add(p);
      }

      if (inFlight.size > 0) {
        await Promise.race(Array.from(inFlight));
      }
    }

    setIsRunning(false);
    setCurrentTitle('');
    if (!cancelRef.current && runIdRef.current === runId) {
      showToast(`批量刮削完成！成功: ${success} 款，跳过: ${failed} 款`, 'success', 3500);
      onBulkComplete?.();
    }
  };

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-lg max-h-[90vh] rounded-3xl border border-white/10 shadow-2xl flex flex-col overflow-hidden bg-gray-950/90">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
                移动端批量刮削
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
                  本地运行
                </span>
              </h3>
              <p className="text-xs text-gray-400">
                100% 手机端本地检索，支持离线持久化与在线静默同步
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (isRunning) handleStop();
              onClose();
            }}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 text-xs">
          {/* 1. 数据源选择 (4 大零配置源) */}
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between text-gray-300 font-bold">
              <span className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                刮削数据源选择 (零配置即用)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'vndb', label: 'VNDB Kana v2', desc: 'Galgame 权威库 / 原画封面' },
                { key: 'ymgal', label: '月幕 Galgame', desc: '国内高速 / 中文译名友好' },
                { key: 'bangumi', label: 'Bangumi (番组计划)', desc: 'ACG 二次元综合库' },
                { key: 'dlsite', label: 'DLsite (番号匹配)', desc: 'RJ/VJ 官方高清插画' }
              ].map((item) => {
                const checked = Boolean(settings.enabledProviders?.[item.key]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleToggleProvider(item.key)}
                    className={`p-2.5 rounded-xl border text-left flex items-start gap-2 transition-all ${
                      checked
                        ? 'bg-purple-900/25 border-purple-500/40 text-purple-200'
                        : 'bg-black/20 border-white/5 text-gray-400 hover:border-white/10'
                    } ${isRunning ? 'opacity-60 cursor-not-allowed' : 'active-press'}`}
                  >
                    <div className="mt-0.5">
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-purple-400" />
                      ) : (
                        <UncheckedSquare className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                    <div>
                      <div className="font-bold text-white text-[11px] leading-tight">{item.label}</div>
                      <div className="text-[10px] text-gray-400 leading-tight mt-0.5">{item.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. 刮削策略：并发数与间隔限制 */}
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5 space-y-3">
            <div className="flex items-center justify-between text-gray-300 font-bold">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                并发调度与频率控制
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* 并发数 */}
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">
                  最大并发数 ({settings.maxConcurrent} 线程)
                </label>
                <div className="flex gap-1.5">
                  {[1, 2, 3].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={isRunning}
                      onClick={() => handleChangeConcurrent(num)}
                      className={`flex-1 py-1.5 rounded-lg font-mono text-xs font-bold border transition-all ${
                        settings.maxConcurrent === num
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-black/20 text-gray-400 border-white/5 hover:text-white'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              {/* 请求间隔 */}
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">
                  请求间隔 ({settings.intervalMs} ms)
                </label>
                <div className="flex gap-1.5">
                  {[500, 800, 1500].map((ms) => (
                    <button
                      key={ms}
                      type="button"
                      disabled={isRunning}
                      onClick={() => handleChangeInterval(ms)}
                      className={`flex-1 py-1.5 rounded-lg font-mono text-xs font-bold border transition-all ${
                        settings.intervalMs === ms
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-black/20 text-gray-400 border-white/5 hover:text-white'
                      }`}
                    >
                      {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-gray-400">
              * 默认并发 1、间隔 800ms 可在确保高效的同时避免触发公共 API 的高频防爬限流。
            </p>
          </div>

          {/* 3. 刮削范围筛选 */}
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between text-gray-300 font-bold">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                批量刮削目标范围
              </span>
              <span className="text-[11px] font-mono text-indigo-400 font-normal">
                预计处理: {targetGames.length} 款
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setOnlyMissingCover(!onlyMissingCover)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-medium transition-all ${
                  onlyMissingCover
                    ? 'bg-purple-900/30 border-purple-500/40 text-purple-200'
                    : 'bg-black/20 border-white/5 text-gray-400'
                }`}
              >
                {onlyMissingCover ? (
                  <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
                ) : (
                  <UncheckedSquare className="w-3.5 h-3.5 text-gray-500" />
                )}
                仅缺封面游戏
              </button>

              {rootPaths.length > 0 && (
                <div className="flex items-center gap-1.5 bg-black/20 px-2.5 py-1 rounded-xl border border-white/5">
                  <Folder className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <select
                    disabled={isRunning}
                    value={selectedRootPathId}
                    onChange={(e) => setSelectedRootPathId(e.target.value)}
                    className="bg-transparent text-gray-300 text-[11px] focus:outline-none cursor-pointer pr-1"
                  >
                    <option value="all" className="bg-gray-900 text-white">
                      全部目录文件夹
                    </option>
                    {rootPaths.map((rp) => (
                      <option key={rp.id} value={rp.id} className="bg-gray-900 text-white">
                        {rp.name || rp.path}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* 4. 运行进度展示区域 */}
          {isRunning && (
            <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 space-y-2.5 animate-pulse-subtle">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5 text-xs">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  正在批量处理...
                </span>
                <span className="font-mono text-indigo-300 text-xs">
                  {progress.current} / {progress.total} ({percent}%)
                </span>
              </div>

              {/* 进度条 */}
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span className="truncate max-w-[240px] text-purple-200 font-mono">
                  当前: {currentTitle || '调度中...'}
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  <span className="text-emerald-400 font-mono">✓ {progress.successCount}</span>
                  <span className="text-gray-500 font-mono">✕ {progress.failCount}</span>
                </span>
              </div>
            </div>
          )}

          {/* 5. 实时操作日志 */}
          {logs.length > 0 && (
            <div className="p-3 rounded-2xl bg-black/40 border border-white/5 space-y-1 max-h-32 overflow-y-auto font-mono text-[10px]">
              {logs.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-1.5 truncate ${
                    item.type === 'success'
                      ? 'text-emerald-400'
                      : item.type === 'fail'
                      ? 'text-gray-400'
                      : item.type === 'error'
                      ? 'text-red-400'
                      : 'text-indigo-300'
                  }`}
                >
                  {item.type === 'success' ? (
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                  ) : item.type === 'error' ? (
                    <AlertCircle className="w-3 h-3 shrink-0" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
                  )}
                  <span className="truncate">{item.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/10 flex items-center justify-between gap-3 shrink-0 bg-gray-900/60">
          <div className="text-[11px] text-gray-400 flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>
              {connected
                ? '已连接电脑：成功后将即刻同步封面至电脑'
                : '离线模式：成功后排入队列，重连自动同步'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isRunning ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 font-bold active-press transition-all text-xs"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={targetGames.length === 0}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/25 active-press transition-all text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                开始刮削 ({targetGames.length})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
