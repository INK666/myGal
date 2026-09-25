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

  async startDownload({ gameId, relPath = '', fileName = '', title = '' }) {
    const finalFileName = fileName || relPath.split('/').pop() || 'game_download';
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
      error: null,
      startedAt: Date.now()
    };

    this.tasks.set(taskId, task);
    this.notify();

    try {
      // 1. 尝试获取短时下载凭据，避免管理 Token 泄露
      let downloadUrl = '';
      try {
        const ticketRes = await api.createDownloadTicket(gameId, relPath);
        if (ticketRes?.downloadUrl) {
          downloadUrl = ticketRes.downloadUrl;
          if (ticketRes.size) {
            task.totalSize = ticketRes.size;
          }
        }
      } catch (ticketErr) {
        console.warn('[DownloadManager] 申请票据失败，回退至普通下载链接:', ticketErr);
      }

      // 若未申请到票据（如文件夹或旧版本后端），回退到普通下载地址
      if (!downloadUrl) {
        downloadUrl = api.getDownloadFileUrl(gameId, relPath);
      }

      // 2. 原生 Android 环境：调用系统级 DownloadManager
      if (Capacitor.isNativePlatform()) {
        const res = await NativeDownloader.startDownload({
          url: downloadUrl,
          fileName: finalFileName,
          title: finalTitle,
          description: `正在通过局域网下载: ${finalFileName}`
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
      a.download = finalFileName;
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
