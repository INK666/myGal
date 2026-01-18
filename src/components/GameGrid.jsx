import React, { useRef } from 'react';

function GameGrid({ games, loading, onGameClick, onGameQuickLaunch, tags, onTogglePinned, viewMode = 'grid' }) {
  const rightClickStateRef = useRef({ gameId: null, at: 0 });

  const handleRightDoubleClick = (e, game) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof onGameQuickLaunch !== 'function') return;

    const now = Date.now();
    const last = rightClickStateRef.current;
    const same = String(last?.gameId ?? '') === String(game?.id ?? '');
    const within = Number.isFinite(last?.at) && now - last.at <= 450;

    if (same && within) {
      rightClickStateRef.current = { gameId: null, at: 0 };
      onGameQuickLaunch(game);
      return;
    }

    rightClickStateRef.current = { gameId: game?.id ?? null, at: now };
  };

  const formatDateTime = (value) => {
    if (value === null || value === undefined) return '';
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      try {
        return new Date(num).toLocaleString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {
        return '';
      }
    }
    const s = String(value).trim();
    if (!s) return '';
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '';
    try {
      return new Date(ts).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  if (loading) {
    if (viewMode === 'list') {
      return (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-1.5">
          {[...Array(10)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2 rounded-xl border border-white/5 bg-white/5 animate-pulse"
            >
              <div className="w-14 h-10 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-4 bg-gradient-to-r from-slate-700 to-slate-600 rounded-lg w-2/5" />
                <div className="h-3 bg-gradient-to-r from-slate-700 to-slate-600 rounded-lg w-1/2" />
              </div>
              <div className="w-10 h-9 rounded-xl bg-gradient-to-r from-slate-700 to-slate-600" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="bg-slate-800/40 rounded-xl overflow-hidden animate-pulse border border-white/5 shadow-lg">
            <div className="aspect-video bg-gradient-to-br from-slate-700 to-slate-800"></div>
            <div className="p-4 space-y-3">
              <div className="h-5 bg-gradient-to-r from-slate-700 to-slate-600 rounded-lg w-4/5 animate-pulse-slow"></div>
              <div className="flex flex-wrap gap-2">
                <div className="h-4 bg-gradient-to-r from-slate-700 to-slate-600 rounded-full w-12 animate-pulse-slow"></div>
                <div className="h-4 bg-gradient-to-r from-slate-700 to-slate-600 rounded-full w-16 animate-pulse-slow"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (games.length === 0) {
    return null;
  }

  if (viewMode === 'list') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-1.5">
        {games.map((game) => (
          <button
            key={game.id}
            type="button"
            onClick={() => onGameClick(game)}
            onContextMenu={(e) => handleRightDoubleClick(e, game)}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-200 transform-gpu hover:-translate-y-[1px] hover:shadow-md hover:shadow-black/20"
          >
            <div className="relative shrink-0 w-14 h-10 rounded-lg overflow-hidden border border-white/10 bg-black/25">
              {game.cover_path ? (
                <img
                  src={game.cover_path}
                  alt={game.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-700">
                  <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                  </svg>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-sm font-semibold text-white truncate" title={game.name}>
                  {game.name}
                </div>
                {game.alias && String(game.alias).trim() ? (
                  <div className="text-xs text-gray-400 truncate" title={game.alias}>
                    {String(game.alias)}
                  </div>
                ) : null}
              </div>
              {game.tags && game.tags.length > 0 ? (
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap overflow-hidden">
                  {game.tags.slice(0, 4).map((tag, index) => {
                    const tagObj = tags.find(t => t.name === tag);
                    return (
                      <span
                        key={index}
                        className="px-2 py-0.5 text-white/95 text-[11px] font-medium rounded-full"
                        style={{
                          backgroundColor: tagObj?.color ? `${tagObj.color}22` : 'rgba(255, 255, 255, 0.1)',
                          border: tagObj?.color ? `1px solid ${tagObj.color}45` : '1px solid rgba(255, 255, 255, 0.2)'
                        }}
                      >
                        {tag}
                      </span>
                    );
                  })}
                  {game.tags.length > 4 ? (
                    <span className="px-2 py-0.5 bg-white/5 border border-white/10 text-gray-300 text-[11px] font-medium rounded-full">
                      +{game.tags.length - 4}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {formatDateTime(game?.imported_at || game?.created_at) ? (
                <div
                  className="text-[11px] text-gray-400 whitespace-nowrap"
                  title={formatDateTime(game?.imported_at || game?.created_at)}
                >
                  {formatDateTime(game?.imported_at || game?.created_at)}
                </div>
              ) : null}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onTogglePinned) onTogglePinned(game);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-200 ${
                  game.pinned
                    ? 'bg-amber-500/90 text-white border-amber-300/60 shadow-lg shadow-amber-500/20'
                    : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10 hover:text-white'
                }`}
                title={game.pinned ? '取消置顶' : '置顶'}
                aria-label={game.pinned ? '取消置顶' : '置顶'}
              >
                <svg className="w-4 h-4" fill={game.pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3l6 6-3 3v6l-3-3H9l-3 3v-6L3 9l6-6 3 3h3l0-3z" />
                </svg>
              </button>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
      {games.map((game) => (
        <div
          key={game.id}
          onClick={() => onGameClick(game)}
          onContextMenu={(e) => handleRightDoubleClick(e, game)}
          className="game-card group relative rounded-xl overflow-hidden cursor-pointer border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/30 transition-all duration-200 transform-gpu hover:-translate-y-1 hover:shadow-xl hover:shadow-black/25 aspect-[3/4]"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onTogglePinned) onTogglePinned(game);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className={`absolute top-2 left-2 z-20 w-8 h-8 rounded-lg flex items-center justify-center border transition-all duration-200 ${
              game.pinned
                ? 'bg-amber-500/90 text-white border-amber-300/60 shadow-lg shadow-amber-500/20'
                : 'bg-black/40 text-white/60 border-white/10 hover:bg-black/60 hover:text-white'
            }`}
            title={game.pinned ? '取消置顶' : '置顶'}
          >
            <svg className="w-4 h-4" fill={game.pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3l6 6-3 3v6l-3-3H9l-3 3v-6L3 9l6-6 3 3h3l0-3z" />
            </svg>
          </button>
          <div className="absolute inset-0">
            {game.cover_path ? (
              <img
                src={game.cover_path}
                alt={game.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-700">
                <div className="text-center">
                  <div className="bg-white/5 backdrop-blur-md p-4 rounded-full mb-3 border border-white/5">
                    <svg className="w-12 h-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                    </svg>
                  </div>
                  <span className="text-gray-400 font-medium text-sm bg-white/5 px-3 py-1 rounded-full border border-white/5">无封面</span>
                </div>
              </div>
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />

          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col">
            {game.tags && game.tags.length > 0 ? (
              <div className="px-3 pb-2 flex justify-center items-start gap-2 flex-wrap overflow-hidden">
                {game.tags.slice(0, 2).map((tag, index) => {
                  const tagObj = tags.find(t => t.name === tag);
                  return (
                    <span
                      key={index}
                      className="px-2 py-0.5 text-white text-[11px] font-medium rounded-md"
                      style={{
                        backgroundColor: tagObj?.color ? `${tagObj.color}2A` : 'rgba(255, 255, 255, 0.1)',
                        border: tagObj?.color ? `1px solid ${tagObj.color}3D` : '1px solid rgba(255, 255, 255, 0.15)'
                      }}
                    >
                      {tag}
                    </span>
                  );
                })}
                {game.tags.length > 2 && (
                  <span className="px-2 py-0.5 bg-white/5 border border-white/10 text-gray-200 text-[11px] font-medium rounded-md">
                    +{game.tags.length - 2}
                  </span>
                )}
              </div>
            ) : null}

            <div className="px-3 py-3 bg-black/25 backdrop-blur-sm">
              <h3 className="text-white font-semibold text-sm truncate text-center leading-tight" title={game.name}>
                {game.name}
              </h3>
              {game.alias && String(game.alias).trim() ? (
                <p className="mt-1 text-gray-300 text-xs truncate text-center leading-tight" title={game.alias}>
                  {game.alias}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default GameGrid;
