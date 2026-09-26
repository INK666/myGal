import { registerPlugin, Capacitor } from '@capacitor/core';
import { api } from '../api/client';

const NativeDownloader = registerPlugin('NativeDownloader');

class DownloadManager {
  constructor() {
    this.listeners = new Set();
    this.tasks = new Map(); // id -> task
    this.pollTimer = null;
    this.lastBytesMap = new Map(); // id -> { bytes, time }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getAllTasks());
    return () => this.listeners.delete(listener);
  }

  notify() {
    const taskList = this.getAllTasks();
    for (const listener of this.listeners) {
      try {
        listener(taskList);
      } catch (err) {
        console.error('[DownloadManager] listener error:', err);
      }
    }
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).reverse();
  }

  getActiveTask() {
    return Array.from(this.tasks.values()).find(
      (t) => t.status === 'RUNNING' || t.status === 'PENDING'
    ) || null;
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  sanitizeFileName(name) {
    if (!name) return 'game_download';
    let s = name.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
    s = s.replace(/^[. ]+|[. ]+$/g, '');
    return s || 'download';
  }

  async openDownloadsFolder() {
    if (Capacitor.isNativePlatform()) {
      try {
        await NativeDownloader.openDownloadsFolder();
        return true;
      } catch (err) {
        console.warn('[DownloadManager] 打开系统下载目录失败:', err);
      }
    }
    return false;
  }

  async startDownload({ gameId, relPath = '', fileName = '', title = '' }) {
    const rawFileName = fileName || relPath.split('/').pop() || 'game_download';
    const finalFileName = this.sanitizeFileName(rawFileName);
    const finalTitle = title || finalFileName;
    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    const task = {
      id: taskId,
      nativeId: null,
      gameId,
      relPath,
      fileName: finalFileName,
      title: finalTitle,
      bytesDownloaded: 0,
      totalSize: 0,
      progress: 0,
      speed: '',
      status: 'PENDING',
      statusMessage: '',
      error: null,
      startedAt: Date.now()
    };

    this.tasks.set(taskId, task);
    this.notify();

    try {
      // 1. 尝试触发或检测 PC 端后台异步打包状态
      let downloadUrl = '';
      let archiveFilename = finalFileName;

      task.status = 'PACKAGING';
      task.statusMessage = '正在连接 PC 端并检测预压缩状态...';
      this.notify();

      let prepareRes = null;
      try {
        const rawPrep = await api.prepareArchive(gameId, relPath);
        prepareRes = rawPrep?.data || rawPrep;
      } catch (prepErr) {
        console.warn('[DownloadManager] prepareArchive 调用失败，尝试直接下载:', prepErr);
      }

      if (prepareRes && prepareRes.status === 'packaging') {
        task.status = 'PACKAGING';
        task.statusMessage = 'PC 端预压缩中，请稍候...';
        this.notify();

        // 轮询打包状态，最长等待 20 分钟 (800 次 * 1.5s)
        let ready = false;
        for (let i = 0; i < 800; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          // 如果用户中途取消了任务，退出
          const current = this.tasks.get(taskId);
          if (!current || current.status === 'CANCELLED') return current;

          try {
            const rawStatus = await api.getArchiveStatus(gameId, relPath);
            const statusRes = rawStatus?.data || rawStatus;
            if (statusRes && statusRes.status === 'ready') {
              downloadUrl = statusRes.downloadUrl;
              archiveFilename = statusRes.filename || finalFileName;
              task.totalSize = statusRes.size || 0;
              ready = true;
              break;
            } else if (statusRes && statusRes.status === 'error') {
              throw new Error('PC 端预压缩失败: ' + (statusRes.error || '未知错误'));
            } else if (statusRes && statusRes.status === 'packaging') {
              const sec = Math.round((statusRes.elapsedMs || (i * 1500)) / 1000);
              task.statusMessage = `PC 端预压缩中 (${sec}s)...`;
              this.notify();
            }
          } catch (pollErr) {
            console.warn('[DownloadManager] 轮询打包状态异常:', pollErr);
          }
        }

        if (!ready) {
          throw new Error('PC 端打包等待超时 (超过 20 分钟)');
        }
      } else if (prepareRes && prepareRes.status === 'ready') {
        downloadUrl = prepareRes.downloadUrl;
        archiveFilename = prepareRes.filename || finalFileName;
        task.totalSize = prepareRes.size || 0;
      }

      // 如果未走 prepareArchive 或没有获得下载链接，回退到短时票据或普通下载
      if (!downloadUrl) {
        try {
          const ticketRes = await api.createDownloadTicket(gameId, relPath);
          if (ticketRes?.downloadUrl) {
            downloadUrl = ticketRes.downloadUrl;
            if (ticketRes.size) task.totalSize = ticketRes.size;
          }
        } catch (ticketErr) {
          console.warn('[DownloadManager] 申请票据失败，回退至普通下载链接:', ticketErr);
        }
      }

      if (!downloadUrl) {
        downloadUrl = api.getDownloadFileUrl(gameId, relPath);
      }

      task.status = 'RUNNING';
      task.statusMessage = '';
      task.fileName = archiveFilename;
      this.notify();

      // 2. 原生 Android 环境：调用系统级 DownloadManager
      if (Capacitor.isNativePlatform()) {
        const res = await NativeDownloader.startDownload({
          url: downloadUrl,
          fileName: archiveFilename,
          title: finalTitle,
          description: `正在通过局域网高速下载: ${archiveFilename}`
        });

        task.nativeId = res.downloadId;
        task.status = 'RUNNING';
        this.notify();
        this.ensurePolling();
        return task;
      }

      // 3. Web 浏览器回退：模拟下载
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = archiveFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      task.status = 'SUCCESSFUL';
      task.progress = 100;
      this.notify();
      return task;
    } catch (err) {
      task.status = 'FAILED';
      task.error = err?.message || String(err);
      task.statusMessage = '';
      this.notify();
      throw err;
    }
  }

  ensurePolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollProgress(), 1000);
  }

  stopPollingIfIdle() {
    const hasRunning = Array.from(this.tasks.values()).some(
      (t) => t.status === 'RUNNING' || t.status === 'PENDING'
    );
    if (!hasRunning && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollProgress() {
    if (!Capacitor.isNativePlatform()) return;

    let hasChange = false;
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if ((task.status === 'RUNNING' || task.status === 'PENDING') && task.nativeId) {
        try {
          const res = await NativeDownloader.checkProgress({ downloadId: task.nativeId });
          const bytes = Number(res.bytesDownloaded || 0);
          const total = Number(res.totalSize || 0);

          if (bytes !== task.bytesDownloaded || total !== task.totalSize || res.status !== task.status) {
            hasChange = true;
          }

          // 计算下载速度
          const last = this.lastBytesMap.get(task.id);
          if (last) {
            const timeDiff = (now - last.time) / 1000;
            if (timeDiff >= 0.8) {
              const bytesDiff = Math.max(0, bytes - last.bytes);
              const speedBps = bytesDiff / timeDiff;
              task.speed = this.formatBytes(speedBps) + '/s';
              this.lastBytesMap.set(task.id, { bytes, time: now });
            }
          } else {
            this.lastBytesMap.set(task.id, { bytes, time: now });
            task.speed = '';
          }

          task.bytesDownloaded = bytes;
          task.totalSize = total;
          task.progress = total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : 0;
          task.status = res.status;

          // 只要进度条为 0，标记为预压缩中状态提示
          if (task.progress === 0 && bytes === 0 && (task.status === 'RUNNING' || task.status === 'PENDING')) {
            task.statusMessage = '预压缩中...';
          } else if (bytes > 0) {
            task.statusMessage = '';
          }

          // 120 秒网络超时机制：若启动超过 120 秒仍处于 0 字节，判定为连接超时
          if (task.status === 'RUNNING' && bytes === 0 && (now - task.startedAt) > 120000) {
            task.status = 'FAILED';
            task.error = '连接超时 (超过 120 秒无数据传输，请重试)';
            task.speed = '';
            hasChange = true;
          }

          if (res.status === 'SUCCESSFUL') {
            task.progress = 100;
            task.speed = '';
            hasChange = true;
          } else if (res.status === 'FAILED') {
            task.error = `下载失败 (代码: ${res.reason || 0})`;
            task.speed = '';
            hasChange = true;
          }
        } catch (err) {
          console.warn('[DownloadManager] checkProgress error for task:', task.id, err);
        }
      }
    }

    if (hasChange) {
      this.notify();
    }
    this.stopPollingIfIdle();
  }

  async cancelDownload(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.nativeId && Capacitor.isNativePlatform()) {
      try {
        await NativeDownloader.cancelDownload({ downloadId: task.nativeId });
      } catch (err) {
        console.warn('[DownloadManager] cancel error:', err);
      }
    }

    task.status = 'CANCELLED';
    task.speed = '';
    this.notify();
    this.stopPollingIfIdle();
  }

  removeTask(taskId) {
    this.cancelDownload(taskId);
    this.tasks.delete(taskId);
    this.lastBytesMap.delete(taskId);
    this.notify();
  }

  clearFinished() {
    for (const [id, task] of this.tasks.entries()) {
      if (['SUCCESSFUL', 'FAILED', 'CANCELLED'].includes(task.status)) {
        this.tasks.delete(id);
        this.lastBytesMap.delete(id);
      }
    }
    this.notify();
  }
}

export const downloadManager = new DownloadManager();
