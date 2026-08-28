import React, { useState, useEffect } from 'react';
import { X, Download, Folder, File, Search, RefreshCw, AlertCircle, Save, HardDrive } from 'lucide-react';
import { api } from '../api/client';
import { useServer } from '../contexts/ServerContext';

export default function FileTransferModal({ game, isOpen, onClose }) {
  const { showToast } = useServer();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all' | 'saves' | 'exe'
  const [downloadingFile, setDownloadingFile] = useState(null);

  useEffect(() => {
    if (!isOpen || !game?.id) return;
    loadFiles();
  }, [isOpen, game?.id]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await api.getGameFiles(game.id);
      if (res?.success) {
        setFiles(res.files || []);
      } else {
        showToast('获取文件列表失败: ' + (res?.error || '未知错误'), 'error');
      }
    } catch (err) {
      showToast('获取文件出错: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !game) return null;

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const handleDownload = (file) => {
    try {
      const downloadUrl = api.getDownloadFileUrl(game.id, file.path);
      // Trigger download in browser / mobile webview
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`已开始下载: ${file.name}`, 'success');
    } catch (err) {
      showToast('下载出错: ' + err.message, 'error');
    }
  };

  const isSaveFile = (pathName) => {
    const lower = pathName.toLowerCase();
    return (
      lower.includes('savedata') ||
      lower.includes('save') ||
      lower.endsWith('.dat') ||
      lower.endsWith('.sav') ||
      lower.endsWith('.ini') ||
      lower.endsWith('.json')
    );
  };

  const filteredFiles = files.filter((f) => {
    if (f.isDir) return false;
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase().trim()) ||
      f.path.toLowerCase().includes(search.toLowerCase().trim());
    if (!matchesSearch) return false;

    if (filterType === 'saves') return isSaveFile(f.path);
    if (filterType === 'exe') return f.name.toLowerCase().endsWith('.exe');
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-lg animate-fade-in">
      <div className="glass-modal rounded-[28px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-600/20 text-emerald-400 shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-white truncate">数据/存档传输</h3>
              <p className="text-[11px] text-gray-400 truncate">{game.alias || game.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-4 bg-gray-950/60 border-b border-white/5 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索文件名或路径..."
              className="w-full bg-gray-900 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-1.5 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-xl font-medium transition-all ${
                filterType === 'all'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              全部文件
            </button>
            <button
              onClick={() => setFilterType('saves')}
              className={`px-3 py-1 rounded-xl font-medium transition-all flex items-center gap-1 ${
                filterType === 'saves'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              <Save className="w-3 h-3" />
              <span>存档与配置</span>
            </button>
            <button
              onClick={() => setFilterType('exe')}
              className={`px-3 py-1 rounded-xl font-medium transition-all ${
                filterType === 'exe'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              可执行程序
            </button>
          </div>
        </div>

        {/* File List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-gray-400">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <span>读取 PC 端游戏文件夹中...</span>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500">
              {search ? '未找到符合条件的文件' : '未检测到文件'}
            </div>
          ) : (
            filteredFiles.map((file, idx) => (
              <div
                key={idx}
                className="glass-panel p-3 rounded-2xl flex items-center justify-between gap-3 border border-white/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <File className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold text-xs text-white truncate">{file.name}</span>
                  </div>
                  <div className="text-[10px] font-mono text-gray-400 truncate mt-0.5 pl-6">
                    {file.path}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-gray-400">{formatSize(file.size)}</span>
                  <button
                    onClick={() => handleDownload(file)}
                    className="p-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white active-press transition-all"
                    title="下载到手机"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
