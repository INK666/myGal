import React from 'react';

function Header({ searchQuery, setSearchQuery, onOpenSettings, rootPaths, hasBackground, sticky = false }) {
  return (
    <header
      className={`${sticky ? 'sticky top-0 z-40' : ''} backdrop-blur-md border-b ${
        hasBackground
          ? 'bg-black/20 border-white/10'
          : 'bg-gray-950/55 border-gray-800/80'
      }`}
      style={{ WebkitAppRegion: 'drag' }}
    >
      <div
        className="w-full"
        style={{
          paddingLeft: 'env(titlebar-area-x, 0px)',
          paddingRight: 'calc(100vw - (env(titlebar-area-x, 0px) + env(titlebar-area-width, 100vw)))'
        }}
      >
        <div className="w-full max-w-[2000px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="grid grid-cols-[1fr_minmax(0,760px)_1fr] items-center gap-4">
            <div className="flex items-center justify-start">
              <button
                type="button"
                onClick={async () => {
                  const url = 'https://github.com/INK666/myGal';
                  if (window.electronAPI?.openExternal) {
                    await window.electronAPI.openExternal(url);
                    return;
                  }
                  window.open(url, '_blank', 'noreferrer');
                }}
                className={`-ml-2 text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
                  hasBackground
                    ? 'bg-black/25 hover:bg-black/35 text-gray-100 border border-white/10'
                    : 'bg-gray-900/70 hover:bg-gray-900 text-gray-200 border border-gray-700/80'
                }`}
                style={{ WebkitAppRegion: 'no-drag' }}
                title="打开 GitHub"
              >
                myGal
              </button>
            </div>
            <div className="w-full">
              <div className="relative group">
                <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 transition-colors duration-300 group-focus-within:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="搜索游戏名称、路径或标签..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full rounded-lg py-2.5 pl-12 pr-4 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/70 focus:border-transparent transition-colors ${
                    hasBackground ? 'bg-black/25 border border-white/10' : 'bg-gray-900/70 border border-gray-700/80'
                  }`}
                  style={{ WebkitAppRegion: 'no-drag' }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white p-1 rounded-full transition-colors duration-200"
                    style={{ WebkitAppRegion: 'no-drag' }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end -mr-1 sm:-mr-2 lg:-mr-3">
              <button
                onClick={onOpenSettings}
                className={`group relative overflow-hidden text-white font-medium py-2.5 px-3 rounded-lg inline-flex items-center gap-2 transition-colors ${
                  hasBackground
                    ? 'bg-black/25 hover:bg-black/35 border border-white/10'
                    : 'bg-gray-900/70 hover:bg-gray-900 border border-gray-700/80'
                }`}
                style={{ WebkitAppRegion: 'no-drag' }}
                title="设置"
              >
                <svg className="w-5 h-5 transition-colors duration-300 group-hover:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden md:inline">设置</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
