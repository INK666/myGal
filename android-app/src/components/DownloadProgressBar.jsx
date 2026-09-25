import React, { useState, useEffect } from 'react';
import { Download, CheckCircle, AlertCircle, X, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
import { downloadManager } from '../utils/downloadManager';

export default function DownloadProgressBar() {
  const [tasks, setTasks] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsubscribe = downloadManager.subscribe((allTasks) => {
      setTasks(allTasks);
    });
    return unsubscribe;
  }, []);

  // 只要有任何任务存在，就显示悬浮条
  if (!tasks || tasks.length === 0) return null;

  const activeTask = tasks.find((t) => t.status === 'RUNNING' || t.status === 'PENDING') || tasks[0];
  const isRunning = activeTask?.status === 'RUNNING' || activeTask?.status === 'PENDING';
  const isSuccess = activeTask?.status === 'SUCCESSFUL';
  const isFailed = activeTask?.status === 'FAILED';

  const formatSize = (bytes) => downloadManager.formatBytes(bytes);

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 max-w-md mx-auto pointer-events-auto select-none transition-all duration-300">
      <div className="bg-gray-900/90 backdrop-blur-xl border border-indigo-500/30 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden text-white">
        {/* 主进度条主体 */}
        <div className="p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-inner ${
                  isSuccess
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : isFailed
                    ? 'bg-rose-500/20 text-rose-400'
                    : 'bg-indigo-500/20 text-indigo-400'
                }`}
              >
                {isSuccess ? (
                  <CheckCircle className="w-4 h-4" />
                ) : isFailed ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <Download className={`w-4 h-4 ${isRunning ? 'animate-bounce' : ''}`} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-100 truncate" title={activeTask.fileName}>
                    {activeTask.fileName}
                  </p>
                  <span className="text-[11px] font-mono font-bold text-indigo-300 shrink-0">
                    {activeTask.progress}%
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>
                    {formatSize(activeTask.bytesDownloaded)} / {formatSize(activeTask.totalSize || 0)}
                  </span>
                  {activeTask.speed && (
                    <span className="text-emerald-400 font-mono font-medium">
                      {activeTask.speed}
                    </span>
                  )}
                  {isSuccess && <span className="text-emerald-400 font-medium">下载完成</span>}
                  {isFailed && <span className="text-rose-400 font-medium">下载失败</span>}
                </div>
              </div>
            </div>

            {/* 操作控制按钮 */}
            <div className="flex items-center gap-1 shrink-0">
              {tasks.length > 1 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  title={expanded ? '收起详情' : '展开多任务'}
                >
                  {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </button>
              )}

              {isRunning ? (
                <button
                  onClick={() => downloadManager.cancelDownload(activeTask.id)}
                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 transition-colors"
                  title="取消下载"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={() => downloadManager.removeTask(activeTask.id)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  title="清除记录"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 进度条轨道 */}
          <div className="w-full bg-gray-800/80 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isSuccess
                  ? 'bg-emerald-400'
                  : isFailed
                  ? 'bg-rose-500'
                  : 'bg-gradient-to-r from-indigo-500 to-emerald-400'
              }`}
              style={{ width: `${Math.max(2, activeTask.progress)}%` }}
            />
          </div>
        </div>

        {/* 展开列表：多任务时显示其他任务 */}
        {expanded && tasks.length > 1 && (
          <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between text-[11px] text-gray-400 py-1">
              <span>下载任务列表 ({tasks.length})</span>
              <button
                onClick={() => downloadManager.clearFinished()}
                className="text-indigo-400 hover:underline text-[10px]"
              >
                清理已完成
              </button>
            </div>
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-gray-200 text-[11px]">{task.fileName}</p>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span>{task.progress}%</span>
                    <span>{formatSize(task.bytesDownloaded)}</span>
                    {task.speed && <span className="text-emerald-400 font-mono">{task.speed}</span>}
                  </div>
                </div>
                <button
                  onClick={() => downloadManager.removeTask(task.id)}
                  className="p-1 text-gray-500 hover:text-gray-300"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
