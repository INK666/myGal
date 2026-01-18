import React, { useState } from 'react';

const Pagination = ({ currentPage, totalPages, onPageChange, floating = false }) => {
  const [jumpPage, setJumpPage] = useState('');

  if (totalPages <= 1) return null;

  const pages = [];
  const maxVisiblePages = 5;
  
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  const handleJump = (e) => {
    e.preventDefault();
    const pageNum = parseInt(jumpPage);
    if (pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum);
      setJumpPage('');
    }
  };

  return (
    <div className={`flex justify-center items-center gap-6 ${floating ? '' : 'mt-12 pb-12'}`}>
      <div className="flex items-center gap-2 bg-white/5 p-1 rounded-2xl border border-white/5 backdrop-blur-sm shadow-xl">
        {/* 首页 */}
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          title="首页"
          className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>

        {/* 上一页 */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          title="上一页"
          className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* 页码 */}
        <div className="flex items-center gap-2 mx-2">
          {startPage > 1 && (
            <>
              <button
                onClick={() => onPageChange(1)}
                className="w-10 h-10 rounded-xl text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 transition-all hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
              >
                1
              </button>
              {startPage > 2 && <span className="text-gray-500 px-1 font-bold">...</span>}
            </>
          )}

          {pages.map(page => (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`w-10 h-10 rounded-xl text-sm font-bold transition-all transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 ${
                currentPage === page
                  ? 'bg-white text-slate-900 shadow-lg shadow-white/10'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {page}
            </button>
          ))}

          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && <span className="text-gray-500 px-1 font-bold">...</span>}
              <button
                onClick={() => onPageChange(totalPages)}
                className="w-10 h-10 rounded-xl text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 transition-all hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
              >
                {totalPages}
              </button>
            </>
          )}
        </div>

        {/* 下一页 */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          title="下一页"
          className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 末页 */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          title="末页"
          className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-white/10 mx-2"></div>

        {/* 跳转页面 */}
        <form onSubmit={handleJump} className="flex items-center gap-2 pr-2">
          <input
            type="number"
            min="1"
            max={totalPages}
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
            className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-center placeholder-gray-500"
            placeholder={currentPage}
          />
          <button
            type="submit"
            className="bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold py-1.5 px-3 rounded-lg transition-all shadow-md active:scale-95 uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            Go
          </button>
        </form>
      </div>
    </div>
  );
};

export default Pagination;
