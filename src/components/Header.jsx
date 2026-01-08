import React from 'react';

function Header({ searchQuery, setSearchQuery, onOpenSettings, rootPaths, hasBackground }) {
  return (
    <header
      className={`backdrop-blur-md border-b shadow-xl shadow-indigo-900/20 ${
        hasBackground
          ? 'bg-gradient-to-r from-gray-950/35 via-gray-900/25 to-indigo-950/35 border-white/10'
          : 'bg-gradient-to-r from-gray-900/95 via-gray-900/90 to-indigo-950/90 border-gray-800/80'
      }`}
      style={{ '-webkit-app-region': 'drag' }}
    >
      <div className="container mx-auto px-6 py-5">
        <div className="grid grid-cols-[1fr_minmax(0,640px)_1fr] items-center pt-2 gap-4">
          <div />
          <div className="w-full">
            <div className="relative group">
              <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 transition-colors duration-300 group-focus-within:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="搜索游戏名称、路径或标签..."
                value={searchQuery}
                onChange={(e) => {
                  console.log('Input change:', e.target.value);
                  setSearchQuery(e.target.value);
                }}
                className={`w-full rounded-xl py-2.5 pl-12 pr-4 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/80 focus:border-transparent transition-all duration-300 shadow-lg hover:shadow-xl ${
                  hasBackground ? 'bg-black/25 border border-white/10' : 'bg-gray-800 border border-gray-700'
                }`}
                style={{ '-webkit-app-region': 'no-drag' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white p-1 rounded-full transition-colors duration-200"
                  style={{ '-webkit-app-region': 'no-drag' }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={onOpenSettings}
              className={`group relative overflow-hidden text-white font-medium py-3 px-6 rounded-2xl flex items-center gap-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:border-indigo-500/50 ${
                hasBackground
                  ? 'bg-black/20 hover:bg-black/30 border border-white/10'
                  : 'bg-gradient-to-r from-gray-850 to-gray-800 hover:from-gray-800 hover:to-gray-750 border border-gray-700/80'
              }`}
              style={{ '-webkit-app-region': 'no-drag' }}
            >
              <svg className="w-5 h-5 transition-colors duration-300 group-hover:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>设置</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
