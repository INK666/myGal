import React from 'react';

function GameGrid({ games, loading, onGameClick, tags, onTogglePinned }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-xl overflow-hidden animate-pulse border border-gray-700 shadow-lg">
            <div className="aspect-video bg-gradient-to-br from-gray-700 to-gray-800"></div>
            <div className="p-4 space-y-3">
              <div className="h-5 bg-gradient-to-r from-gray-700 to-gray-600 rounded-lg w-4/5 animate-pulse-slow"></div>
              <div className="flex flex-wrap gap-2">
                <div className="h-4 bg-gradient-to-r from-gray-700 to-gray-600 rounded-full w-12 animate-pulse-slow"></div>
                <div className="h-4 bg-gradient-to-r from-gray-700 to-gray-600 rounded-full w-16 animate-pulse-slow"></div>
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {games.map((game) => (
        <div
          key={game.id}
          onClick={() => onGameClick(game)}
          className="game-card group relative rounded-xl overflow-hidden cursor-pointer border border-gray-800 hover:border-indigo-500/80 hover:shadow-2xl hover:shadow-indigo-900/40 transition-all duration-400 hover:-translate-y-3 transform-gpu aspect-[3/4]"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onTogglePinned) onTogglePinned(game);
            }}
            className={`absolute top-2 left-2 z-20 w-8 h-8 rounded-lg flex items-center justify-center border transition-all duration-200 ${
              game.pinned
                ? 'bg-amber-500/90 text-white border-amber-300/60 shadow-lg shadow-amber-500/20'
                : 'bg-black/35 text-white/85 border-white/15 hover:bg-black/55 hover:text-white'
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
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-900/95 via-purple-900/95 to-pink-900/95">
                <div className="text-center">
                  <div className="bg-white/10 backdrop-blur-md p-4 rounded-full mb-3">
                    <svg className="w-12 h-12 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                    </svg>
                  </div>
                  <span className="text-white font-medium text-sm bg-white/10 px-3 py-1 rounded-full">无封面</span>
                </div>
              </div>
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/15" />

          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col">
            {game.tags && game.tags.length > 0 ? (
              <div className="px-3 pb-2 flex justify-center items-start gap-2 flex-wrap overflow-hidden">
                {game.tags.slice(0, 3).map((tag, index) => {
                  const tagObj = tags.find(t => t.name === tag);
                  return (
                    <span
                      key={index}
                      className="px-2.5 py-1 text-white text-xs font-medium rounded-full"
                      style={{
                        backgroundColor: tagObj?.color ? `${tagObj.color}33` : 'rgba(99, 102, 241, 0.3)',
                        border: tagObj?.color ? `1px solid ${tagObj.color}50` : '1px solid rgba(99, 102, 241, 0.5)'
                      }}
                    >
                      {tag}
                    </span>
                  );
                })}
                {game.tags.length > 3 && (
                  <span className="px-2.5 py-1 bg-gray-800/60 border border-gray-700/70 text-gray-200 text-xs font-medium rounded-full">
                    +{game.tags.length - 3}
                  </span>
                )}
              </div>
            ) : null}

            <div className="px-3 py-3 bg-black/35 backdrop-blur-sm">
              <h3 className="text-white font-semibold text-base truncate text-center leading-tight" title={game.name}>
                {game.name}
              </h3>
              <div className="min-h-[14px] mt-1">
                {game.alias && String(game.alias).trim() ? (
                  <p className="text-gray-300 text-xs truncate text-center leading-tight" title={game.alias}>
                    {game.alias}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default GameGrid;
