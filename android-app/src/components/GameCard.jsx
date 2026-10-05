import React from 'react';
import { Pin } from 'lucide-react';
import { useServer } from '../contexts/ServerContext';
import CoverImage from './CoverImage';

function GameCard({ game, viewMode = 'grid2', onSelect }) {
  const { serverUrl, token } = useServer();

  const cleanServerUrl = (serverUrl || '').trim().replace(/\/+$/, '');
  const getCoverUrl = () => {
    if (!cleanServerUrl || game.hasCover === false) return null;
    if (game.coverUrl) {
      if (token && !game.coverUrl.includes('token=')) {
        const sep = game.coverUrl.includes('?') ? '&' : '?';
        return `${game.coverUrl}${sep}token=${encodeURIComponent(token)}`;
      }
      return game.coverUrl;
    }
    const version = game.updatedAt ? new Date(game.updatedAt).getTime() : '';
    const vParam = version ? `&v=${version}` : '';
    return `${cleanServerUrl}/api/covers/${game.id}?token=${encodeURIComponent(token || '')}${vParam}`;
  };
  const coverUrl = getCoverUrl();

  // --- 列表视图 (List Mode) ---
  if (viewMode === 'list') {
    return (
      <div
        onClick={() => onSelect(game)}
        className="cv-auto-list bg-slate-900/75 hover:bg-gray-850/80 active-press rounded-2xl p-3 flex items-center gap-3.5 cursor-pointer transition-colors border border-white/5 shadow-sm"
      >
        {/* Cover Thumbnail */}
        <div className="w-16 h-22 rounded-xl bg-gray-900 overflow-hidden shrink-0 relative border border-white/10 flex items-center justify-center">
          <CoverImage
            src={coverUrl}
            serverUrl={serverUrl}
            gameId={game.id}
            alt={game.name}
            fallbackIconSize="w-5 h-5"
            fallbackTitle=""
          />
          {game.pinned && (
            <div className="absolute top-1 left-1 bg-amber-500/90 text-black p-1 rounded-md shadow-md z-10">
              <Pin className="w-2.5 h-2.5 fill-black" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {game.pinned && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-medium">
                置顶
              </span>
            )}
            <h3 className="font-bold text-sm text-white truncate">
              {game.alias || game.name}
            </h3>
          </div>
          {game.alias && (
            <div className="text-[11px] text-gray-400 truncate mb-1">
              {game.name}
            </div>
          )}

          {/* Tags */}
          <div className="flex flex-wrap items-center gap-1 mt-1.5 overflow-hidden max-h-5">
            {game.tags && game.tags.length > 0 ? (
              game.tags.slice(0, 3).map((tag, idx) => (
                <span
                  key={idx}
                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-800 text-gray-300 border border-white/5"
                >
                  {tag}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-gray-600">未分类</span>
            )}
            {game.tags && game.tags.length > 3 && (
              <span className="text-[10px] text-gray-500">+{game.tags.length - 3}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- 三列紧凑画廊 (Grid 3 Mode) ---
  if (viewMode === 'grid3') {
    return (
      <div
        onClick={() => onSelect(game)}
        className="group relative flex flex-col rounded-2xl overflow-hidden cv-auto-grid3 bg-slate-900/75 active-press cursor-pointer border border-white/5"
      >
        {/* Cover 2:3 */}
        <div className="w-full aspect-[2/3] bg-gray-900 overflow-hidden relative flex items-center justify-center">
          <CoverImage
            src={coverUrl}
            serverUrl={serverUrl}
            gameId={game.id}
            alt={game.name}
            fallbackIconSize="w-6 h-6"
            fallbackTitle={game.alias || game.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />

          {game.pinned && (
            <div className="absolute top-1.5 left-1.5 bg-amber-500 text-black p-1 rounded-md shadow-md z-10">
              <Pin className="w-2.5 h-2.5 fill-black" />
            </div>
          )}
        </div>

        {/* Title */}
        <div className="p-1.5 bg-gray-950/85">
          <h4 className="text-[11px] font-semibold text-white truncate text-center">
            {game.alias || game.name}
          </h4>
        </div>
      </div>
    );
  }

  // --- 双列标准画廊 (Grid 2 Mode - 默认推荐) ---
  return (
    <div
      onClick={() => onSelect(game)}
      className="group relative flex flex-col rounded-2xl overflow-hidden cv-auto bg-slate-900/75 active-press cursor-pointer border border-white/5 shadow-md hover:border-indigo-500/30 transition-colors"
    >
      {/* Cover 2:3 Aspect */}
      <div className="w-full aspect-[2/3] bg-gray-900 overflow-hidden relative flex items-center justify-center">
        <CoverImage
          src={coverUrl}
          serverUrl={serverUrl}
          gameId={game.id}
          alt={game.name}
          fallbackIconSize="w-8 h-8"
          fallbackTitle={game.alias || game.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Overlay gradient for bottom legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-black/30 pointer-events-none" />

        {/* Pinned Pill Top Left */}
        {game.pinned && (
          <div className="absolute top-2 left-2 bg-gradient-to-r from-amber-500 to-amber-600 text-black font-extrabold text-[10px] px-2 py-0.5 rounded-lg shadow-lg flex items-center gap-1 z-10">
            <Pin className="w-3 h-3 fill-black" />
            <span>置顶</span>
          </div>
        )}

        {/* Tags Floating Over Cover Bottom */}
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1 z-10">
          {game.tags && game.tags.length > 0 ? (
            game.tags.slice(0, 2).map((tag, idx) => (
              <span
                key={idx}
                className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-black/70 text-gray-200 border border-white/10"
              >
                {tag}
              </span>
            ))
          ) : null}
          {game.tags && game.tags.length > 2 && (
            <span className="text-[9px] px-1 py-0.5 rounded-md bg-black/70 text-gray-400 border border-white/10">
              +{game.tags.length - 2}
            </span>
          )}
        </div>
      </div>

      {/* Card Footer Info */}
      <div className="p-2.5 bg-gray-950/90 flex flex-col justify-between">
        <h3 className="font-bold text-xs text-white truncate group-hover:text-indigo-300 transition-colors">
          {game.alias || game.name}
        </h3>
        {game.alias && (
          <p className="text-[10px] text-gray-500 truncate mt-0.5">
            {game.name}
          </p>
        )}
      </div>
    </div>
  );
}

// 只比较卡片实际用到的字段：列表同步/进度刷新导致的父组件重渲染不再波及无关卡片。
// onSelect 必须是稳定引用（App 传的是 setState 函数），否则 memo 失效。
function arePropsEqual(prev, next) {
  if (prev.viewMode !== next.viewMode) return false;
  if (prev.onSelect !== next.onSelect) return false;
  const a = prev.game;
  const b = next.game;
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.alias === b.alias &&
    a.pinned === b.pinned &&
    a.hasCover === b.hasCover &&
    a.coverUrl === b.coverUrl &&
    a.updatedAt === b.updatedAt &&
    a.tags === b.tags
  );
}

export default React.memo(GameCard, arePropsEqual);
