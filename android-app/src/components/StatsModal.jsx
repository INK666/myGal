import React, { useState, useEffect } from 'react';
import { X, BarChart3, Gamepad2, Layers, Image, Pin, History, FolderTree } from 'lucide-react';
import { api } from '../api/client';

export default function StatsModal({ isOpen, onClose }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('stats'); // 'stats' | 'history'
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    Promise.all([
      api.getStats().catch(() => null),
      api.getHistory(30, 0).catch(() => ({ items: [] }))
    ]).then(([statsRes, historyRes]) => {
      setStats(statsRes);
      setHistory(historyRes?.items || []);
    }).finally(() => {
      setLoading(false);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(Number(ts) || ts);
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(ts);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="glass-modal rounded-[28px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">游戏库统计 & 历史</h3>
              <p className="text-[11px] text-gray-400">PC 游戏库数据概览</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="px-5 pt-3 pb-2 flex gap-2 border-b border-white/5 bg-gray-950/40">
          <button
            onClick={() => setActiveTab('stats')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'stats'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 bg-gray-900/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>统计概览</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 bg-gray-900/60'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>运行历史 ({history.length})</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-gray-400">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span>正在获取统计数据...</span>
            </div>
          ) : activeTab === 'stats' && stats ? (
            <div className="space-y-4">
              {/* Stat 2x2 Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="glass-panel p-3.5 rounded-2xl">
                  <div className="flex items-center gap-2 text-indigo-400 mb-1 text-xs">
                    <Gamepad2 className="w-4 h-4" />
                    <span>游戏总数</span>
                  </div>
                  <div className="text-2xl font-extrabold text-white">{stats.gameCount}</div>
                </div>

                <div className="glass-panel p-3.5 rounded-2xl">
                  <div className="flex items-center gap-2 text-purple-400 mb-1 text-xs">
                    <Layers className="w-4 h-4" />
                    <span>标签总数</span>
                  </div>
                  <div className="text-2xl font-extrabold text-white">{stats.tagCount}</div>
                </div>

                <div className="glass-panel p-3.5 rounded-2xl">
                  <div className="flex items-center gap-2 text-emerald-400 mb-1 text-xs">
                    <Image className="w-4 h-4" />
                    <span>已有封面</span>
                  </div>
                  <div className="text-2xl font-extrabold text-white">{stats.coveredCount}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">缺封面: {stats.missingCoverCount}</div>
                </div>

                <div className="glass-panel p-3.5 rounded-2xl">
                  <div className="flex items-center gap-2 text-amber-400 mb-1 text-xs">
                    <Pin className="w-4 h-4" />
                    <span>已置顶</span>
                  </div>
                  <div className="text-2xl font-extrabold text-white">{stats.pinnedCount}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">未打标签: {stats.untaggedCount}</div>
                </div>
              </div>

              {/* Tag Distribution */}
              {stats.tagDistribution && stats.tagDistribution.length > 0 && (
                <div className="glass-panel p-4 rounded-2xl space-y-3">
                  <div className="text-xs font-bold text-gray-200">标签游戏分布</div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {stats.tagDistribution.map((td) => {
                      const pct = stats.gameCount ? Math.round((td.count / stats.gameCount) * 100) : 0;
                      return (
                        <div key={td.id} className="space-y-1">
                          <div className="flex justify-between text-xs text-gray-300">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: td.color || '#6366f1' }} />
                              <span>{td.name}</span>
                            </span>
                            <span className="font-mono text-gray-400">{td.count} ({pct}%)</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-900 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${Math.min(100, Math.max(5, pct))}%`, backgroundColor: td.color || '#6366f1' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'history' ? (
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500">
                  暂无运行记录
                </div>
              ) : (
                history.map((h) => (
                  <div
                    key={h.id}
                    className="glass-panel p-3 rounded-2xl flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-white truncate">{h.gameName || '未知游戏'}</div>
                      <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">{h.exePath}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-indigo-300 font-mono">{formatTime(h.launchedAt)}</div>
                      <div className="text-[9px] text-gray-500">{h.method || '启动'}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
