import { registerPlugin, Capacitor } from '@capacitor/core';
import { api } from '../api/client';

const NativeUploader = registerPlugin('NativeUploader');

/**
 * 上传管理器（与 downloadManager 对称）
 * 职责：
 *  - 任务生命周期：创建/开始/暂停/恢复/取消/删除
 *  - 申请 PC 端票据（可选 rootPathId 指定落盘根目录）
 *  - 调用原生 UploadService 执行分块事务上传
 *  - 订阅原生进度事件，维护任务状态 + 持久化（localStorage）
 *  - 断网/进程重启后：带原 ticket 查进度 → 404 则带 resumeTicket 重新认领续传
 */
class UploadManager {
  constructor() {
    this.listeners = new Set();
    this.tasks = new Map(); // id -> task
    this.nativeListenerAttached = false;
    this.restore();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getAllTasks());
    return () => this.listeners.delete(listener);
  }

  notify() {
    const list = this.getAllTasks();
    for (const l of this.listeners) {
      try { l(list); } catch (err) { console.error('[UploadManager] listener error:', err); }
    }
    this.persist();
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ---------- 持久化 ----------
  persist() {
    try {
      const list = this.getAllTasks().map((t) => ({
        id: t.id,
        ticket: t.ticket,
        uri: t.uri,
        fileName: t.fileName,
        finalName: t.finalName,
        folderName: t.folderName,
        fileSize: t.fileSize,
        receivedBytes: t.receivedBytes,
        rootPathId: t.rootPathId,
        rootPathLabel: t.rootPathLabel,
        status: t.status,
        error: t.error,
        createdAt: t.createdAt
      }));
      localStorage.setItem('mygal_upload_tasks', JSON.stringify(list));
    } catch (err) {
      console.warn('[UploadManager] 任务持久化失败:', err);
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem('mygal_upload_tasks');
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      for (const t of list) {
        // 上次退出时正在跑的，恢复为「已暂停」等待用户继续（不自动重传，避免误耗流量）
        if (t.status === 'UPLOADING' || t.status === 'PENDING') t.status = 'PAUSED';
        this.tasks.set(t.id, {
          ...t,
          speed: '',
          statusMessage: t.status === 'PAUSED' ? '已暂停（点继续可续传）' : ''
        });
      }
    } catch (err) {
      console.warn('[UploadManager] 任务恢复失败:', err);
    }
  }

  // ---------- 原生事件订阅 ----------
  async ensureNativeListener() {
    if (this.nativeListenerAttached || !Capacitor.isNativePlatform()) return;
    this.nativeListenerAttached = true;
    await NativeUploader.addListener('uploadEvent', (payload) => {
      const { event, taskId, receivedBytes, fileSize, reason } = payload || {};
      const task = this.tasks.get(taskId);
      if (!task) return;
      if (event === 'uploadProgress') {
        task.receivedBytes = receivedBytes || 0;
        task.fileSize = fileSize || task.fileSize;
        task.progress = task.fileSize > 0 ? Math.floor((task.receivedBytes / task.fileSize) * 100) : 0;
        task.status = 'UPLOADING';
        task.statusMessage = '';
      } else if (event === 'uploadComplete') {
        task.status = 'COMPLETED';
        task.receivedBytes = task.fileSize;
        task.progress = 100;
        task.statusMessage = '上传完成，PC 端已收到';
      } else if (event === 'uploadPaused') {
        task.status = 'PAUSED';
        task.receivedBytes = receivedBytes || task.receivedBytes;
        task.error = reason || '上传中断';
        task.statusMessage = reason || '已暂停（点继续可续传）';
      } else if (event === 'uploadCancelled') {
        task.status = 'CANCELLED';
        task.statusMessage = '已取消';
      }
      this.notify();
    });
  }

  // ---------- 核心流程 ----------

  // 选择文件（只选，不上传），返回 { uri, fileName, fileSize }
  async pickFile() {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('上传功能需要在安卓 App 内使用');
    }
    return await NativeUploader.pickFile({});
  }

  // 开始上传：先申请票据 → 拉起原生服务
  async startUpload({ uri, fileName, fileSize, rootPathId = null, rootPathLabel = '' }) {
    await this.ensureNativeListener();

    const taskId = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const task = {
      id: taskId,
      ticket: null,
      uri,
      fileName,
      fileSize,
      receivedBytes: 0,
      progress: 0,
      rootPathId,
      rootPathLabel,
      status: 'PENDING',
      statusMessage: '正在申请上传许可...',
      error: null,
      speed: '',
      createdAt: Date.now()
    };
    this.tasks.set(taskId, task);
    this.notify();

    try {
      const ticketRes = await api.createUploadTicket({ fileName, fileSize, rootPathId });
      task.ticket = ticketRes.ticket;
      task.finalName = ticketRes.finalName;
      // PC 端会在所选根目录下建一个同名文件夹（含扩展名），文件存在里面
      task.folderName = ticketRes.folderName || fileName;
      task.chunkSize = ticketRes.chunkSize || 16 * 1024 * 1024;
      task.resumeFromBytes = ticketRes.resumeFromBytes || 0;
      task.receivedBytes = task.resumeFromBytes;
      task.statusMessage = task.resumeFromBytes > 0 ? '检测到已传部分，正在续传...' : '';
      this.notify();

      await NativeUploader.startUpload({
        uri,
        serverUrl: api.serverUrl,
        token: api.token,
        ticket: task.ticket,
        taskId,
        fileName,
        fileSize,
        chunkSize: task.chunkSize
      });
      task.status = 'UPLOADING';
      this.notify();
      return task;
    } catch (err) {
      task.status = 'FAILED';
      task.error = this.humanizeError(err);
      task.statusMessage = task.error;
      this.notify();
      throw err;
    }
  }

  // 把服务端/网络错误转成人话
  humanizeError(err) {
    const status = err?.statusCode;
    const msg = err?.serverMessage || err?.message || String(err);
    if (status === 403 && /未开启上传/.test(msg)) {
      return 'PC 端未开启上传许可，请让 PC 端在「设置 → 局域网 API → 允许移动端上传」中开启';
    }
    if (status === 403) return '上传许可已失效：' + msg;
    if (status === 404) return 'PC 端找不到该上传任务（可能已过期），请重新发起';
    if (status === 413) return '文件超过 PC 端设置的上传大小上限';
    if (status === 507) return msg; // 磁盘空间不足，服务端已给明确文案
    if (status === 429) return 'PC 端上传任务已满（最多 2 个并发），请等前一个传完';
    if (status === 503) return msg;
    if (/Failed to fetch|NetworkError|Network request failed|Load failed/.test(msg)) {
      return '连不上 PC 端，请检查是否在同一局域网';
    }
    return msg;
  }

  // 继续/重试：带原 ticket 查进度 → 404 则带 resumeTicket 重新认领
  async resumeUpload(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    await this.ensureNativeListener();
    if (!task.uri) {
      task.status = 'FAILED';
      task.error = '文件访问权限已失效，请重新选择文件上传';
      this.notify();
      return;
    }

    task.statusMessage = '正在对齐服务端进度...';
    task.error = null;
    this.notify();

    try {
      let ticket = task.ticket;
      let resumeFrom = task.receivedBytes || 0;

      if (ticket) {
        try {
          const st = await api.getUploadStatus(ticket);
          if (st.status === 'completed') {
            task.status = 'COMPLETED';
            task.progress = 100;
            task.statusMessage = '上传完成（PC 端已收到）';
            this.notify();
            return;
          }
          if (st.status === 'uploading') {
            resumeFrom = st.receivedBytes || 0;
          }
        } catch (err) {
          if (err?.statusCode === 404) {
            ticket = null; // 票据失效，走重新申请 + 认领
          } else {
            throw err;
          }
        }
      }

      if (!ticket) {
        const res = await api.createUploadTicket({
          fileName: task.fileName,
          fileSize: task.fileSize,
          rootPathId: task.rootPathId,
          resumeTicket: task.ticket || ''
        });
        ticket = res.ticket;
        task.ticket = ticket;
        task.chunkSize = res.chunkSize || task.chunkSize;
        resumeFrom = res.resumeFromBytes || 0;
        task.finalName = res.finalName || task.finalName;
      }

      task.receivedBytes = resumeFrom;
      task.progress = task.fileSize > 0 ? Math.floor((resumeFrom / task.fileSize) * 100) : 0;
      this.notify();

      await NativeUploader.startUpload({
        uri: task.uri,
        serverUrl: api.serverUrl,
        token: api.token,
        ticket,
        taskId,
        fileName: task.fileName,
        fileSize: task.fileSize,
        chunkSize: task.chunkSize || 16 * 1024 * 1024
      });
      task.status = 'UPLOADING';
      task.statusMessage = '';
      this.notify();
    } catch (err) {
      task.status = 'FAILED';
      task.error = this.humanizeError(err);
      task.statusMessage = task.error;
      this.notify();
    }
  }

  async cancelUpload(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    try {
      if (Capacitor.isNativePlatform()) await NativeUploader.cancelUpload({ taskId });
    } catch (err) {
      console.warn('[UploadManager] 取消原生上传失败:', err);
    }
    // 通知服务端清理 .part（幂等）
    if (task.ticket) {
      try { await api.cancelUploadTicket(task.ticket); } catch (err) {
        console.warn('[UploadManager] 服务端取消失败:', err);
      }
    }
    task.status = 'CANCELLED';
    task.statusMessage = '已取消，PC 端临时文件与空文件夹已清理';
    this.notify();
  }

  removeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'UPLOADING' || task.status === 'PENDING') return; // 运行中不可删
    this.tasks.delete(taskId);
    this.notify();
  }
}

export const uploadManager = new UploadManager();
