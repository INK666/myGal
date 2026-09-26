import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Download,
  Folder,
  FolderOpen,
  File,
  Search,
  RefreshCw,
  AlertCircle,
  Save,
  HardDrive,
  ChevronRight,
  ChevronLeft,
  CheckSquare,
  Square,
  FileCode,
  FileText,
  FileArchive,
  PlaySquare,
  Image as ImageIcon,
  Music,
  Video,
  Layers,
  ArrowUpDown,
  CheckCircle2,
  Check,
  Package
} from 'lucide-react';
import { api } from '../api/client';
import { useServer } from '../contexts/ServerContext';
import { downloadManager } from '../utils/downloadManager';

export default function FileTransferModal({ game, isOpen, onClose }) {
  const { showToast } = useServer();
  const [allFiles, setAllFiles] = useState([]);
  const [isSingleFile, setIsSingleFile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(''); // 当前所在目录相对路径，空字符串表示根目录
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all' | 'saves' | 'exe' | 'data' | 'media'
  const [selectedPaths, setSelectedPaths] = useState(new Set()); // 已选中的相对路径集合 (文件或文件夹)
  const [isDownloading, setIsDownloading] = useState(false);
  const [sortField, setSortField] = useState('name'); // 'name' | 'size' | 'mtime'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [downloadTasks, setDownloadTasks] = useState([]);

  useEffect(() => {
    if (!isOpen || !game?.id) return;
    return downloadManager.subscribe((tasks) => {
      setDownloadTasks(tasks.filter((t) => t.gameId === game.id));
    });
  }, [isOpen, game?.id]);

  useEffect(() => {
    if (!isOpen || !game?.id) return;
    setCurrentPath('');
    setSearch('');
    setSelectedPaths(new Set());
    loadFiles();
  }, [isOpen, game?.id]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await api.getGameFiles(game.id);
      if (res?.success) {
        setAllFiles(res.files || []);
        const single = !!res.isSingleFile || (res.files?.length === 1 && !res.files[0]?.isDir && !res.files[0]?.path?.includes('/'));
        setIsSingleFile(single);
      } else {
        showToast('获取文件列表失败: ' + (res?.error || '未知错误'), 'error');
      }
    } catch (err) {
      showToast('获取文件出错: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const formatDate = (mtime) => {
    if (!mtime) return '-';
    try {
      const d = new Date(mtime);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hour = String(d.getHours()).padStart(2, '0');
      const minute = String(d.getMinutes()).padStart(2, '0');
      return `${year}/${month}/${day} ${hour}:${minute}`;
    } catch {
      return '-';
    }
  };

  // 获取文件对应的图标与分类颜色
  const getFileIcon = (file) => {
    if (file.isDir) return <Folder className="w-5 h-5 text-amber-400 fill-amber-400/20 shrink-0" />;
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    if (['xp3', 'dat', 'pak', 'arc', 'bin', 'rar', 'zip', '7z', 'tar', 'gz', 'iso'].includes(ext)) {
      return <FileArchive className="w-5 h-5 text-blue-400 shrink-0" />;
    }
    if (['exe', 'bat', 'cmd', 'msi'].includes(ext)) {
      return <PlaySquare className="w-5 h-5 text-emerald-400 shrink-0" />;
    }
    if (['sav', 'ini', 'cfg', 'json', 'xml', 'dat'].includes(ext) || file.path.toLowerCase().includes('save')) {
      return <Save className="w-5 h-5 text-amber-400 shrink-0" />;
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg', 'ico'].includes(ext)) {
      return <ImageIcon className="w-5 h-5 text-purple-400 shrink-0" />;
    }
    if (['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) {
      return <Music className="w-5 h-5 text-pink-400 shrink-0" />;
    }
    if (['mp4', 'avi', 'mkv', 'wmv', 'webm', 'mov'].includes(ext)) {
      return <Video className="w-5 h-5 text-rose-400 shrink-0" />;
    }
    if (['txt', 'log', 'md', 'doc', 'pdf'].includes(ext)) {
      return <FileText className="w-5 h-5 text-gray-300 shrink-0" />;
    }
    return <File className="w-5 h-5 text-gray-400 shrink-0" />;
  };

  // 触发单项下载
  const triggerSingleDownload = async (relPath, fileName) => {
    const isDirectory = !fileName ? false : fileName.endsWith('.zip');
    const targetName = fileName || relPath.split('/').pop() || (game.alias || game.name || 'download');
    try {
      await downloadManager.startDownload({
        gameId: game.id,
        relPath,
        fileName: targetName,
        title: `${game.alias || game.name}: ${targetName}`
      });
      showToast(isDirectory ? `已提交打包下载任务: ${targetName}` : `已加入系统下载队列: ${targetName}`, 'success');
    } catch (err) {
      showToast('启动下载失败: ' + (err?.message || String(err)), 'error');
    }
  };

  // 执行下载 (支持单项或批量)
  const handleDownload = (item) => {
    try {
      const isDirectory = item.isDir;
      const downloadName = isDirectory ? `${item.name}.zip` : item.name;
      triggerSingleDownload(item.path, downloadName);
    } catch (err) {
      showToast('下载出错: ' + err.message, 'error');
    }
  };

  // 一键下载整个游戏（单文件/压缩包直接下载，文件夹打包为 .zip 下载）
  const handleDownloadWholeGame = () => {
    try {
      if (isSingleFile && allFiles.length > 0) {
        const fileObj = allFiles[0];
        triggerSingleDownload(fileObj.path, fileObj.name);
      } else {
        const zipName = `${game.alias || game.name}.zip`;
        triggerSingleDownload('', zipName);
      }
    } catch (err) {
      showToast('下载出错: ' + err.message, 'error');
    }
  };

  // 批量下载已选中的所有项目
  const handleBatchDownload = async () => {
    if (selectedPaths.size === 0 || isDownloading) return;
    setIsDownloading(true);
    showToast(`正在依次启动 ${selectedPaths.size} 个项目的下载任务...`, 'info');

    const pathsToDownload = Array.from(selectedPaths);
    for (let i = 0; i < pathsToDownload.length; i++) {
      const relPath = pathsToDownload[i];
      const fileObj = allFiles.find((f) => f.path === relPath);
      const name = fileObj ? (fileObj.isDir ? `${fileObj.name}.zip` : fileObj.name) : relPath.split('/').pop();
      await triggerSingleDownload(relPath, name);
      // 间隔 600ms 防止瞬时迸发
      if (i < pathsToDownload.length - 1) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    setIsDownloading(false);
    showToast(`已成功发起 ${pathsToDownload.length} 个下载任务`, 'success');
  };

  // 构建面包屑导航路径数组
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [{ name: '全部文件', path: '' }];
    const parts = currentPath.split('/').filter(Boolean);
    const crumbs = [{ name: '全部文件', path: '' }];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ name: part, path: acc });
    }
    return crumbs;
  }, [currentPath]);

  // 计算当前层级下的直接子文件夹与直接子文件
  const currentDirectoryItems = useMemo(() => {
    const curClean = currentPath.replace(/\/+$/, '');
    const directFoldersMap = new Map();
    const directFiles = [];

    for (const file of allFiles) {
      const p = file.path;
      // 排除当前路径自身
      if (p === curClean) continue;

      // 检查是否属于当前目录的子级
      if (curClean === '') {
        // 根目录下
        const slashIdx = p.indexOf('/');
        if (slashIdx === -1) {
          // 根目录下的直接项
          if (file.isDir) {
            if (!directFoldersMap.has(p)) {
              directFoldersMap.set(p, {
                name: file.name,
                path: file.path,
                isDir: true,
                size: 0,
                mtime: file.mtime,
                itemCount: 0
              });
            }
          } else {
            directFiles.push(file);
          }
        } else {
          // 子文件夹下的项：累加到根目录的第一层文件夹
          const folderName = p.slice(0, slashIdx);
          if (!directFoldersMap.has(folderName)) {
            directFoldersMap.set(folderName, {
              name: folderName,
              path: folderName,
              isDir: true,
              size: 0,
              mtime: file.mtime,
              itemCount: 0
            });
          }
          const fObj = directFoldersMap.get(folderName);
          if (!file.isDir) {
            fObj.size += file.size || 0;
            fObj.itemCount += 1;
          }
        }
      } else {
        // 在某个子目录下
        if (p.startsWith(curClean + '/')) {
          const subRel = p.slice(curClean.length + 1);
          const slashIdx = subRel.indexOf('/');
          if (slashIdx === -1) {
            // 直接子项
            if (file.isDir) {
              if (!directFoldersMap.has(p)) {
                directFoldersMap.set(p, {
                  name: file.name,
                  path: file.path,
                  isDir: true,
                  size: 0,
                  mtime: file.mtime,
                  itemCount: 0
                });
              }
            } else {
              directFiles.push(file);
            }
          } else {
            // 更深层级的子项：累加到直接子文件夹
            const folderSubName = subRel.slice(0, slashIdx);
            const fullFolderRel = `${curClean}/${folderSubName}`;
            if (!directFoldersMap.has(fullFolderRel)) {
              directFoldersMap.set(fullFolderRel, {
                name: folderSubName,
                path: fullFolderRel,
                isDir: true,
                size: 0,
                mtime: file.mtime,
                itemCount: 0
              });
            }
            const fObj = directFoldersMap.get(fullFolderRel);
            if (!file.isDir) {
              fObj.size += file.size || 0;
              fObj.itemCount += 1;
            }
          }
        }
      }
    }

    const folders = Array.from(directFoldersMap.values());

    // 排序比较函数
    const sortFn = (a, b) => {
      if (sortField === 'size') {
        return sortOrder === 'asc' ? a.size - b.size : b.size - a.size;
      }
      if (sortField === 'mtime') {
        const mA = a.mtime || 0;
        const mB = b.mtime || 0;
        return sortOrder === 'asc' ? mA - mB : mB - mA;
      }
      return sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    };

    folders.sort(sortFn);
    directFiles.sort(sortFn);

    return { folders, files: directFiles, allItems: [...folders, ...directFiles] };
  }, [allFiles, currentPath, sortField, sortOrder]);

  // 全局搜索与类型过滤结果
  const globalSearchResults = useMemo(() => {
    if (!search.trim() && filterType === 'all') return null;

    const q = search.toLowerCase().trim();
    return allFiles.filter((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const matchesSearch = !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
      if (!matchesSearch) return false;

      if (filterType === 'saves') {
        return f.path.toLowerCase().includes('save') || ['sav', 'ini', 'cfg', 'json', 'dat'].includes(ext);
      }
      if (filterType === 'exe') {
        return ['exe', 'bat', 'cmd'].includes(ext);
      }
      if (filterType === 'data') {
        return ['xp3', 'pak', 'arc', 'bin', 'rar', 'zip', '7z', 'iso'].includes(ext);
      }
      if (filterType === 'media') {
        return ['jpg', 'png', 'webp', 'mp3', 'ogg', 'wav', 'mp4', 'avi'].includes(ext);
      }
      return true;
    });
  }, [allFiles, search, filterType]);

  // 当前显示的条目列表
  const displayedItems = useMemo(() => {
    if (globalSearchResults !== null) return globalSearchResults;
    return currentDirectoryItems.allItems;
  }, [globalSearchResults, currentDirectoryItems]);

  // 勾选/取消勾选单个项目
  const toggleSelect = (pathKey, e) => {
    e?.stopPropagation();
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };

  // 全选/反选当前页
  const toggleSelectAll = () => {
    const allCurrentKeys = displayedItems.map((item) => item.path);
    const allSelected = allCurrentKeys.length > 0 && allCurrentKeys.every((k) => selectedPaths.has(k));

    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allCurrentKeys.forEach((k) => next.delete(k));
      } else {
        allCurrentKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  // 计算已选中项的总大小
  const selectedTotalSize = useMemo(() => {
    let sum = 0;
    for (const p of selectedPaths) {
      const matched = allFiles.find((f) => f.path === p);
      if (matched && !matched.isDir) {
        sum += matched.size || 0;
      }
    }
    return sum;
  }, [selectedPaths, allFiles]);

  const isAllCurrentSelected = displayedItems.length > 0 && displayedItems.every((item) => selectedPaths.has(item.path));
  const isSomeSelected = selectedPaths.size > 0;

  if (!isOpen || !game) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="glass-modal rounded-[28px] w-full max-w-xl overflow-hidden shadow-2xl flex flex-col h-[90vh] max-h-[850px] border border-white/10">
        {/* --- 顶部 Header --- */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5 bg-gray-950/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shrink-0 shadow-lg shadow-emerald-600/30">
              <HardDrive className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-white truncate flex items-center gap-2">
                <span>文件/数据下载管理</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${isSingleFile ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                  {isSingleFile ? '单文件/压缩包' : `${allFiles.length} 项`}
                </span>
              </h3>
              <p className="text-[11px] text-gray-400 truncate mt-0.5">{game.alias || game.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white shrink-0 active-press transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* --- 单文件/压缩包模式专享快速下载横幅 --- */}
        {isSingleFile && allFiles.length > 0 && (
          <div className="mx-4 mt-3 p-3 rounded-2xl bg-gradient-to-r from-blue-950/70 via-indigo-950/50 to-blue-900/40 border border-blue-500/30 shadow-lg flex items-center justify-between gap-3 animate-fade-in shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-600/25 text-blue-300 flex items-center justify-center shrink-0 border border-blue-500/30 shadow-inner">
                <Package className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white truncate">{allFiles[0].name}</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/25 text-blue-300 font-mono font-semibold">
                    {(allFiles[0].name.split('.').pop() || 'FILE').toUpperCase()}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">
                  大小: {formatSize(allFiles[0].size)} {allFiles[0].mtime ? `· 修改时间: ${formatDate(allFiles[0].mtime)}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={handleDownloadWholeGame}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center justify-center gap-1.5 active-press shrink-0"
              title="直接下载完整压缩包文件"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载文件</span>
            </button>
          </div>
        )}

        {/* --- 搜索与快捷过滤胶囊栏 --- */}
        <div className="px-4 py-3 bg-gray-950/40 border-b border-white/5 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isSingleFile ? "搜索文件名..." : "搜索当前游戏中的文件或子路径..."}
              className="w-full bg-gray-900/90 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {!isSingleFile && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar text-xs py-0.5">
              {[
                { key: 'all', label: '全部' },
                { key: 'saves', label: '存档/配置', icon: Save },
                { key: 'exe', label: '运行程序', icon: PlaySquare },
                { key: 'data', label: '封包数据', icon: FileArchive },
                { key: 'media', label: '图片/影音', icon: ImageIcon }
              ].map((tab) => {
                const Icon = tab.icon;
                const active = filterType === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setFilterType(tab.key)}
                    className={`px-3 py-1 rounded-xl font-medium transition-all shrink-0 flex items-center gap-1.5 active-press ${
                      active
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                        : 'bg-gray-900/70 text-gray-400 hover:text-gray-200 border border-white/5'
                    }`}
                  >
                    {Icon && <Icon className="w-3 h-3" />}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* --- Windows 文件夹式面包屑路径导航与整包下载栏 --- */}
        <div className="px-4 py-2 bg-gray-900/70 border-b border-white/5 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {currentPath && (
              <button
                onClick={() => {
                  const parts = currentPath.split('/');
                  parts.pop();
                  setCurrentPath(parts.join('/'));
                }}
                className="px-2 py-1 rounded-lg bg-gray-800 hover:bg-gray-750 text-gray-300 hover:text-white flex items-center gap-1 shrink-0 font-medium active-press"
                title="返回上一级"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>返回</span>
              </button>
            )}

            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                {idx > 0 && <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                <button
                  onClick={() => {
                    setCurrentPath(crumb.path);
                    setSearch('');
                  }}
                  className={`px-2 py-1 rounded-lg shrink-0 font-medium transition-colors ${
                    idx === breadcrumbs.length - 1
                      ? 'text-emerald-300 font-bold bg-emerald-500/10'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* 向上一个级别：一键打包下载完整游戏按钮 */}
            {!isSingleFile && (
              <button
                onClick={handleDownloadWholeGame}
                className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-white bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 px-2.5 py-1 rounded-lg shrink-0 active-press font-semibold transition-all shadow-sm"
                title="打包下载整个游戏文件夹为 .zip"
              >
                <Download className="w-3 h-3 text-emerald-400" />
                <span>整包下载</span>
              </button>
            )}

            <button
              onClick={() => {
                if (sortField === 'name') {
                  if (sortOrder === 'asc') setSortOrder('desc');
                  else { setSortField('size'); setSortOrder('desc'); }
                } else if (sortField === 'size') {
                  if (sortOrder === 'desc') setSortOrder('asc');
                  else { setSortField('mtime'); setSortOrder('desc'); }
                } else {
                  setSortField('name');
                  setSortOrder('asc');
                }
              }}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white bg-gray-850 px-2 py-1 rounded-lg border border-white/5 shrink-0"
              title="切换排序"
            >
              <ArrowUpDown className="w-3 h-3 text-emerald-400" />
              <span>
                {sortField === 'name'
                  ? `名称 ${sortOrder === 'asc' ? 'A-Z' : 'Z-A'}`
                  : sortField === 'size'
                  ? `大小 ${sortOrder === 'desc' ? '大-小' : '小-大'}`
                  : '时间'}
              </span>
            </button>
          </div>
        </div>

        {/* --- 当前游戏正在下载的即时小进度条 --- */}
        {(() => {
          const activeGameDownload = downloadTasks.find(
            (t) => (t.status === 'RUNNING' || t.status === 'PENDING' || t.status === 'PACKAGING') && t.gameId === game.id
          );
          if (!activeGameDownload) return null;
          const isPreCompressing =
            activeGameDownload.status === 'PACKAGING' ||
            ((activeGameDownload.status === 'RUNNING' || activeGameDownload.status === 'PENDING') &&
              (activeGameDownload.progress === 0 || !activeGameDownload.bytesDownloaded));

          return (
            <div className="mx-4 mt-2 p-2.5 rounded-xl bg-indigo-950/70 border border-indigo-500/40 flex items-center justify-between text-xs animate-slide-up shadow-md">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {isPreCompressing ? (
                  <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                ) : (
                  <Download className="w-4 h-4 text-emerald-400 animate-bounce shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-gray-200 font-medium text-[11px]">
                      {activeGameDownload.fileName}
                    </span>
                    {isPreCompressing ? (
                      <span className="font-mono text-amber-300 font-bold text-[11px] shrink-0 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
                        预压缩中
                      </span>
                    ) : (
                      <span className="font-mono text-indigo-300 font-bold text-[11px] shrink-0">
                        {activeGameDownload.progress}%
                      </span>
                    )}
                  </div>
                  {isPreCompressing ? (
                    <div className="text-[10px] text-amber-300/90 mt-0.5 truncate font-medium">
                      {activeGameDownload.statusMessage || 'PC 端预压缩中，请稍候...'}
                    </div>
                  ) : null}
                  <div className="w-full bg-gray-800 rounded-full h-1 mt-1 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isPreCompressing
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-300 animate-pulse w-full'
                          : 'bg-gradient-to-r from-indigo-500 to-emerald-400'
                      }`}
                      style={isPreCompressing ? { width: '100%' } : { width: `${Math.max(2, activeGameDownload.progress)}%` }}
                    />
                  </div>
                </div>
              </div>
              {!isPreCompressing && activeGameDownload.speed && (
                <span className="font-mono text-emerald-400 text-[10px] shrink-0 ml-3">
                  {activeGameDownload.speed}
                </span>
              )}
            </div>
          );
        })()}

        {/* --- 列表顶栏：全选与列名 --- */}
        <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between text-[11px] text-gray-400 bg-gray-950/30">
          <div
            onClick={toggleSelectAll}
            className="flex items-center gap-2 cursor-pointer select-none hover:text-white"
          >
            {isAllCurrentSelected ? (
              <CheckSquare className="w-4 h-4 text-emerald-400 fill-emerald-400/20" />
            ) : (
              <Square className="w-4 h-4 text-gray-500" />
            )}
            <span>
              {selectedPaths.size > 0 ? `已选中 ${selectedPaths.size} 项` : '全选'}
            </span>
          </div>

          <div className="flex items-center gap-6">
            <span>大小 / 修改时间</span>
            <span className="w-7 text-center">操作</span>
          </div>
        </div>

        {/* --- 文件夹与文件列表核心展示区 --- */}
        <div className="p-3 overflow-y-auto space-y-1.5 flex-1 divide-y divide-white/[0.03]">
          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3 text-xs text-gray-400">
              <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <span>读取 PC 端游戏目录中...</span>
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="py-24 text-center text-xs text-gray-500 space-y-2">
              <FolderOpen className="w-10 h-10 mx-auto text-gray-700 mb-2" />
              <p>{search ? '未找到匹配的文件或文件夹' : '当前文件列表为空'}</p>
            </div>
          ) : (
            displayedItems.map((item) => {
              const isSelected = selectedPaths.has(item.path);
              const isDir = item.isDir;

              return (
                <div
                  key={item.path}
                  onClick={() => {
                    if (isDir) {
                      setCurrentPath(item.path);
                      setSearch('');
                    } else {
                      toggleSelect(item.path);
                    }
                  }}
                  className={`p-2.5 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-all active-press border ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500/40 shadow-sm'
                      : 'glass-panel hover:bg-gray-850/70 border-white/5'
                  }`}
                >
                  {/* 左侧：选择框 + 图标 + 名称/路径 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => toggleSelect(item.path, e)}
                      className="p-1 text-gray-400 hover:text-emerald-300 shrink-0"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400 fill-emerald-400/20" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />
                      )}
                    </button>

                    {getFileIcon(item)}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold text-xs truncate ${isDir ? 'text-amber-200' : 'text-white'}`}>
                          {item.name}
                        </span>
                        {isDir && item.itemCount > 0 && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 font-mono">
                            {item.itemCount} 项
                          </span>
                        )}
                        {!isDir && isSingleFile && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono">
                            完整文件
                          </span>
                        )}
                      </div>

                      {/* 显示下级路径或子文件数 */}
                      <div className="text-[10px] text-gray-500 truncate mt-0.5 font-mono">
                        {globalSearchResults !== null ? item.path : isDir ? '文件夹' : formatSize(item.size)}
                        {item.mtime && ` · ${formatDate(item.mtime)}`}
                      </div>
                    </div>
                  </div>

                  {/* 右侧：操作按钮与大小 */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-[11px] font-mono text-gray-300">{formatSize(item.size)}</div>
                    </div>

                    {(() => {
                      const itemTask = downloadTasks.find(
                        (t) =>
                          t.relPath === item.path ||
                          t.fileName === item.name ||
                          t.fileName === `${item.name}.zip`
                      );
                      const isItemPreCompressing =
                        itemTask &&
                        (itemTask.status === 'PACKAGING' ||
                          ((itemTask.status === 'RUNNING' || itemTask.status === 'PENDING') &&
                            (itemTask.progress === 0 || !itemTask.bytesDownloaded)));
                      const isItemRunning =
                        itemTask &&
                        (itemTask.status === 'RUNNING' || itemTask.status === 'PENDING');

                      if (isItemPreCompressing) {
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadManager.cancelDownload(itemTask.id);
                            }}
                            className="p-1.5 px-2 rounded-xl bg-amber-600/30 hover:bg-rose-500/20 text-amber-300 hover:text-rose-300 border border-amber-500/40 hover:border-rose-500/40 text-[10px] font-mono font-bold flex items-center gap-1 active-press transition-colors"
                            title="PC 端预压缩中，点击可取消"
                          >
                            <div className="w-2.5 h-2.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
                            <span>预压缩中</span>
                          </button>
                        );
                      }

                      if (isItemRunning) {
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadManager.cancelDownload(itemTask.id);
                            }}
                            className="p-1.5 px-2 rounded-xl bg-indigo-600/30 hover:bg-rose-500/20 text-indigo-300 hover:text-rose-300 border border-indigo-500/40 hover:border-rose-500/40 text-[10px] font-mono font-bold flex items-center gap-1 active-press transition-colors"
                            title="正在下载，点击可取消"
                          >
                            <div className="w-2.5 h-2.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
                            <span>{itemTask.progress}%</span>
                          </button>
                        );
                      }

                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(item);
                          }}
                          className={`p-2 rounded-xl active-press transition-all ${
                            isDir
                              ? 'bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white'
                              : 'bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white'
                          }`}
                          title={isDir ? '打包下载此文件夹 (.zip)' : '直接下载此文件'}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      );
                    })()}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* --- 底部浮动批量操作栏 (当有选中项时激活) --- */}
        {isSomeSelected && (
          <div className="p-3 bg-gray-900/95 border-t border-emerald-500/30 backdrop-blur-xl flex items-center justify-between gap-3 animate-slide-up">
            <div className="min-w-0">
              <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>已选中 {selectedPaths.size} 项</span>
                {selectedTotalSize > 0 && (
                  <span className="text-[11px] text-gray-400 font-mono">
                    (共 {formatSize(selectedTotalSize)})
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPaths(new Set())}
                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-300 text-xs font-medium active-press"
              >
                取消选择
              </button>
              <button
                type="button"
                onClick={handleBatchDownload}
                disabled={isDownloading}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 active-press disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>打包下载中...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>批量下载 ({selectedPaths.size})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
