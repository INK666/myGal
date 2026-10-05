import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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

// ===== 模块级纯函数（原为组件内定义，移出以便 FileRow 复用且保持引用稳定）=====
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

// 列表每批渲染的条目数（长目录分批挂载，避免一次性渲染几百个卡片把 WebView 卡死）
const FILE_PAGE_SIZE = 60;

// ===== 行组件（React.memo）：下载进度每秒更新时，只有状态真正变化的行才重渲染 =====
// 注意：downloadManager 会原地修改 task 对象（task.progress = ...），
// 所以这里必须传原始值（taskId/taskStatus/taskProgress）而不是 task 对象引用，
// 否则 memo 比较永远相等 → 行 UI 卡在旧状态。
const FileRow = React.memo(function FileRow({
  item,
  isSelected,
  showFullPath,
  isSingleFile,
  taskId,
  taskStatus,
  taskProgress,
  taskPackaging,
  onToggle,
  onOpenDir,
  onDownload
}) {
  const isDir = item.isDir;

  // 预压缩只可能是文件夹下载（服务端真在打包）；单文件直传不该显示预压缩中
  const isItemPreCompressing = taskId && taskStatus === 'PACKAGING' && taskPackaging;
  const isItemRunning = taskId && (taskStatus === 'RUNNING' || taskStatus === 'PENDING') && !isItemPreCompressing;

  return (
    <div
      onClick={() => {
        if (isDir) {
          onOpenDir(item.path);
        } else {
          onToggle(item.path);
        }
      }}
      className={`p-2.5 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-colors active-press border ${
        isSelected
          ? 'bg-emerald-950/40 border-emerald-500/40 shadow-sm'
          : 'bg-slate-900/75 hover:bg-gray-850/70 border-white/5'
      }`}
    >
      {/* 左侧：选择框 + 图标 + 名称/路径 */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <button
          type="button"
          onClick={(e) => onToggle(item.path, e)}
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
            {showFullPath ? item.path : isDir ? '文件夹' : formatSize(item.size)}
            {item.mtime && ` · ${formatDate(item.mtime)}`}
          </div>
        </div>
      </div>

      {/* 右侧：操作按钮与大小 */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right hidden sm:block">
          <div className="text-[11px] font-mono text-gray-300">{formatSize(item.size)}</div>
        </div>

        {isItemPreCompressing ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadManager.cancelDownload(taskId);
            }}
            className="p-1.5 px-2 rounded-xl bg-amber-600/30 hover:bg-rose-500/20 text-amber-300 hover:text-rose-300 border border-amber-500/40 hover:border-rose-500/40 text-[10px] font-mono font-bold flex items-center gap-1 active-press transition-colors"
            title="PC 端预压缩中，点击可取消"
          >
            <div className="w-2.5 h-2.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <span>预压缩中</span>
          </button>
        ) : isItemRunning ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadManager.cancelDownload(taskId);
            }}
            className="p-1.5 px-2 rounded-xl bg-indigo-600/30 hover:bg-rose-500/20 text-indigo-300 hover:text-rose-300 border border-indigo-500/40 hover:border-rose-500/40 text-[10px] font-mono font-bold flex items-center gap-1 active-press transition-colors"
            title="正在下载，点击可取消"
          >
            <div className="w-2.5 h-2.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <span>{taskProgress}%</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(item);
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
        )}
      </div>
    </div>
  );
});

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
    // 性能关键：下载期间 downloadManager 每秒 notify 一次。
    // 只有「本游戏的任务状态签名」真正变化时才 setState，
    // 否则（如 statusMessage 跳动、其他游戏任务进度）直接跳过，整个弹窗不重渲染。
    let lastSig = null;
    return downloadManager.subscribe((tasks) => {
      const mine = tasks.filter((t) => t.gameId === game.id);
      const sig = mine.map((t) => `${t.id}:${t.status}:${t.progress}:${t.bytesDownloaded || 0}`).join('|');
      if (lastSig !== null && sig === lastSig) return;
      lastSig = sig;
      setDownloadTasks(mine);
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

  // formatSize / formatDate / getFileIcon 已提升到模块级（见文件头部），逻辑与原实现一致

  // 触发单项下载。needPackaging=false 表示单文件直传（PC 端不打包，跳过预压缩等待）
  const triggerSingleDownload = async (relPath, fileName, needPackaging = true) => {
    const targetName = fileName || relPath.split('/').pop() || (game.alias || game.name || 'download');
    try {
      await downloadManager.startDownload({
        gameId: game.id,
        relPath,
        fileName: targetName,
        title: `${game.alias || game.name}: ${targetName}`,
        needPackaging
      });
      showToast(needPackaging ? `已提交打包下载任务: ${targetName}` : `已加入系统下载队列: ${targetName}`, 'success');
    } catch (err) {
      showToast('启动下载失败: ' + (err?.message || String(err)), 'error');
    }
  };

  // 执行下载 (支持单项或批量)
  const handleDownload = (item) => {
    try {
      const isDirectory = item.isDir;
      const downloadName = isDirectory ? `${item.name}.zip` : item.name;
      // 文件夹才需要 PC 端打包成 .zip；单文件直接原样传
      triggerSingleDownload(item.path, downloadName, isDirectory);
    } catch (err) {
      showToast('下载出错: ' + err.message, 'error');
    }
  };

  // 稳定回调（FileRow 的 memo 依赖引用稳定；handleDownload 依赖 game/showToast，用 ref 转发避免陈旧闭包）
  const handleDownloadRef = useRef(handleDownload);
  handleDownloadRef.current = handleDownload;
  const stableDownload = useCallback((item) => handleDownloadRef.current(item), []);
  const stableOpenDir = useCallback((p) => {
    setCurrentPath(p);
    setSearch('');
  }, []);

  // 一键下载整个游戏（单文件/压缩包直接下载，文件夹打包为 .zip 下载）
  const handleDownloadWholeGame = () => {
    try {
      if (isSingleFile && allFiles.length > 0) {
        const fileObj = allFiles[0];
        triggerSingleDownload(fileObj.path, fileObj.name, false); // 单文件：直传，不打包
      } else {
        const zipName = `${game.alias || game.name}.zip`;
        triggerSingleDownload('', zipName, true); // 整个游戏目录：打包成 .zip
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
      // 目录才打包；文件直传（查不到类型时按需打包的旧行为兜底）
      await triggerSingleDownload(relPath, name, fileObj ? fileObj.isDir : true);
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

  // ---- 长列表分批渲染 ----
  // 实测：247 项一次性挂载会把 Android WebView 拖死（每行都是带边框/圆角的卡片，
  // 滚动时大量行同时参与合成 → 掉帧、部分行来不及合成显示为空白）。
  // 改为「首屏 FILE_PAGE_SIZE 项 + 滚动到底自动续加」，切目录/搜索/排序时重置。
  const [visibleCount, setVisibleCount] = useState(FILE_PAGE_SIZE);
  const listRef = useRef(null);

  const visibleItems = useMemo(
    () => (visibleCount >= displayedItems.length ? displayedItems : displayedItems.slice(0, visibleCount)),
    [displayedItems, visibleCount]
  );
  const hasMoreItems = visibleCount < displayedItems.length;

  // 切目录 / 改搜索 / 改筛选 / 换排序 → 回到首批并滚回顶部
  useEffect(() => {
    setVisibleCount(FILE_PAGE_SIZE);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [currentPath, search, filterType, sortField, sortOrder]);

  const growVisible = useCallback(() => {
    setVisibleCount((c) => (c >= displayedItems.length ? c : Math.min(c + FILE_PAGE_SIZE, displayedItems.length)));
  }, [displayedItems.length]);

  // 滚动到距底部 320px 以内就续加一批（同一批内重复触发会被 setState 同值 bail out 掉）
  const handleListScroll = useCallback((e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 320) return;
    growVisible();
  }, [growVisible]);

  // 下载任务索引：原实现每行都调一次 downloadTasks.find()，247 行 × 每次渲染 = O(n²)。
  // 这里一次建 Map，查找变 O(1)；键名与原比较逻辑（relPath / fileName / fileName+'.zip'）完全等价。
  const taskIndex = useMemo(() => {
    const m = new Map();
    for (const t of downloadTasks) {
      if (t.relPath) m.set(`p:${t.relPath}`, t);
      if (t.fileName) {
        m.set(`n:${t.fileName}`, t);
        if (t.fileName.toLowerCase().endsWith('.zip')) m.set(`n:${t.fileName.slice(0, -4)}`, t);
      }
    }
    return m;
  }, [downloadTasks]);

  // 勾选/取消勾选单个项目（useCallback 稳定引用：FileRow memo 依赖）
  const toggleSelect = useCallback((pathKey, e) => {
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
  }, []);

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

        {/* --- 文件夹与文件列表核心展示区 ---
             min-h-0 是必需的：flex 子项默认 min-height:auto，长列表会把容器顶开，
             溢出部分被外层 overflow-hidden 直接裁掉（表现为「底部的文件看不到、也滚不到」）。 */}
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="p-3 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-1.5 divide-y divide-white/[0.03]"
        >
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
            <>
              {visibleItems.map((item) => {
                const itemTask =
                  taskIndex.get(`p:${item.path}`) ||
                  taskIndex.get(`n:${item.name}`) ||
                  taskIndex.get(`n:${item.name}.zip`);
                return (
                  <FileRow
                    key={item.path}
                    item={item}
                    isSelected={selectedPaths.has(item.path)}
                    showFullPath={globalSearchResults !== null}
                    isSingleFile={isSingleFile}
                    taskId={itemTask?.id}
                    taskStatus={itemTask?.status}
                    taskProgress={itemTask?.progress}
                    taskPackaging={itemTask ? itemTask.packaging !== false : false}
                    onToggle={toggleSelect}
                    onOpenDir={stableOpenDir}
                    onDownload={stableDownload}
                  />
                );
              })}

              {/* 分批渲染的进度提示 / 手动续加载兜底（纯滚动也能自动加载） */}
              {hasMoreItems && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={growVisible}
                    className="w-full py-2.5 rounded-2xl bg-slate-900/70 border border-white/5 text-[11px] text-gray-400 hover:text-emerald-300 hover:border-emerald-500/30 active-press transition-colors"
                  >
                    已显示 {visibleItems.length} / {displayedItems.length} 项 · 继续滚动或点击加载更多
                  </button>
                </div>
              )}
            </>
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
