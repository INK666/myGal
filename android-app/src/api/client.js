/**
 * myGal Mobile API Client
 * 负责处理与 PC 端 myGal 服务的全套 HTTP 通信与鉴权
 */

export class ApiClient {
  constructor(serverUrl = 'http://127.0.0.1:37689', token = '') {
    this.serverUrl = this.normalizeUrl(serverUrl);
    this.token = token;
    this.primaryUrl = this.serverUrl;
    this.backupUrl = '';
    this.onFailover = null;
    this.isFailingOver = false;
  }

  normalizeUrl(url) {
    let clean = String(url || '').trim();
    if (!clean) return 'http://127.0.0.1:37689';
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'http://' + clean;
    }
    clean = clean.replace(/\/+$/, '');
    try {
      const u = new URL(clean);
      // 纯 IP 且没有显式指定端口，自动补充默认端口 37689
      if (!u.port && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(u.hostname)) {
        u.port = '37689';
        return u.origin;
      }
      return u.origin + (u.pathname === '/' ? '' : u.pathname);
    } catch {
      return clean;
    }
  }

  setCredentials(serverUrl, token) {
    this.serverUrl = this.normalizeUrl(serverUrl);
    this.token = token;
  }

  setFailoverConfig({ primaryUrl, backupUrl, onFailover }) {
    this.primaryUrl = primaryUrl ? this.normalizeUrl(primaryUrl) : '';
    this.backupUrl = backupUrl ? this.normalizeUrl(backupUrl) : '';
    if (typeof onFailover === 'function') {
      this.onFailover = onFailover;
    }
  }

  getAlternateUrl() {
    const cur = this.normalizeUrl(this.serverUrl);
    const pri = this.normalizeUrl(this.primaryUrl);
    const bkp = this.normalizeUrl(this.backupUrl);

    if (bkp && cur === pri) return bkp;
    if (pri && cur === bkp) return pri;
    if (bkp && cur !== bkp) return bkp;
    if (pri && cur !== pri) return pri;
    return '';
  }

  async request(endpoint, options = {}) {
    const url = `${this.serverUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutMs = options.timeout || 8000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 204) {
        return { success: true };
      }

      const isJson = response.headers.get('content-type')?.includes('application/json');
      if (!isJson) {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      // 检查是否可以静默容灾切换到备用 IP（仅在网络超时/不可达且未在容灾递归时触发）
      const isNetworkError =
        error.name === 'AbortError' ||
        error.message?.includes('Failed to fetch') ||
        error.message?.includes('NetworkError') ||
        error.message?.includes('Network request failed');

      if (isNetworkError && !this.isFailingOver && !options._skipFailover) {
        const altUrl = this.getAlternateUrl();
        if (altUrl) {
          console.warn(`[ApiClient] Request to ${this.serverUrl}${endpoint} failed (${error.message}), trying backup: ${altUrl}...`);
          this.isFailingOver = true;
          try {
            const backupUrlFull = `${altUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
            const backupController = new AbortController();
            const backupTimeoutId = setTimeout(() => backupController.abort(), options.timeout || 8000);

            const backupRes = await fetch(backupUrlFull, {
              ...options,
              headers,
              signal: backupController.signal
            });
            clearTimeout(backupTimeoutId);

            if (backupRes.ok || backupRes.status === 204) {
              const previousUrl = this.serverUrl;
              this.serverUrl = altUrl;
              this.isFailingOver = false;

              if (typeof this.onFailover === 'function') {
                this.onFailover(altUrl, previousUrl);
              }

              if (backupRes.status === 204) {
                return { success: true };
              }
              const isJson = backupRes.headers.get('content-type')?.includes('application/json');
              if (!isJson) return backupRes;
              return await backupRes.json();
            }
          } catch (backupErr) {
            console.warn(`[ApiClient] Backup URL ${altUrl} also failed:`, backupErr);
          } finally {
            this.isFailingOver = false;
          }
        }
      }

      if (error.name === 'AbortError') {
        throw new Error('请求超时，请检查 PC 端 myGal 是否在线并允许局域网连接');
      }
      throw error;
    }
  }

  // --- 基础状态与健康检查 ---
  async checkHealth(options = {}) {
    return this.request('/api/health', { timeout: 3000, ...options });
  }

  async getStats() {
    const res = await this.request('/api/stats');
    return res.data;
  }

  async getRootPaths() {
    const res = await this.request('/api/root-paths');
    return res.data;
  }

  async getHistory(limit = 50, offset = 0) {
    const res = await this.request(`/api/history?limit=${limit}&offset=${offset}`);
    return res.data;
  }

  // --- 标签操作 ---
  async getTags() {
    const res = await this.request('/api/tags');
    return res.data;
  }

  async createTag(name, color = '#6366f1') {
    const res = await this.request('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color })
    });
    return res.data;
  }

  async updateTag(tagId, name, color) {
    const res = await this.request(`/api/tags/${tagId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, color })
    });
    return res.data;
  }

  async deleteTag(tagId) {
    const res = await this.request(`/api/tags/${tagId}`, {
      method: 'DELETE'
    });
    return res.data;
  }

  // --- 游戏列表与详情 ---
  async getGames(options = {}) {
    const params = new URLSearchParams();
    if (options.all) params.set('all', options.all);
    if (options.page) params.set('page', options.page);
    if (options.pageSize) params.set('pageSize', options.pageSize);
    if (options.query) params.set('query', options.query);
    if (options.tag) params.set('tag', options.tag);
    if (options.rootPathId) params.set('rootPathId', options.rootPathId);
    if (options.sort) params.set('sort', options.sort);
    if (options.order) params.set('order', options.order);

    const res = await this.request(`/api/games?${params.toString()}`);
    return res.data;
  }

  /**
   * 全量获取当前服务端的全部游戏列表（供离线缓存同步使用）
   * @param {Function} [onProgress] 进度回调 (0 ~ 100)
   */
  async getAllGames(onProgress = null) {
    try {
      onProgress?.(10);
      const res = await this.getGames({ all: 1, pageSize: 'all' });
      if (res?.items && Array.isArray(res.items)) {
        const total = typeof res.total === 'number' ? res.total : res.items.length;
        // 如果已获取完整列表或数量达到 total，直接返回
        if (res.items.length >= total || res.items.length > 200) {
          onProgress?.(100);
          return { items: res.items, total };
        }
      }

      // 服务端若为旧版本限制分页（如单页上限200），通过自动循环分页兜底
      let allItems = Array.isArray(res?.items) ? [...res.items] : [];
      let page = 2;
      const total = res?.total || allItems.length;

      while (allItems.length < total) {
        const percent = Math.min(95, Math.round(10 + (allItems.length / Math.max(1, total)) * 85));
        onProgress?.(percent);

        const nextRes = await this.getGames({ page, pageSize: 200 });
        if (!nextRes?.items || nextRes.items.length === 0) break;
        allItems = [...allItems, ...nextRes.items];
        page++;
        if (page > 50) break; // 安全防死循环上限 (10000款)
      }

      onProgress?.(100);
      return { items: allItems, total: total || allItems.length };
    } catch (err) {
      onProgress?.(100);
      throw err;
    }
  }

  async getGameDetail(gameId) {
    const res = await this.request(`/api/games/${gameId}`);
    return res.data;
  }

  getCoverUrl(gameId) {
    if (!gameId) return null;
    const base = `${this.serverUrl}/api/covers/${gameId}`;
    return this.token ? `${base}?token=${encodeURIComponent(this.token)}` : base;
  }

  // --- 游戏管理写操作 ---
  async updateGameAlias(gameId, alias) {
    const res = await this.request(`/api/games/${gameId}/alias`, {
      method: 'POST',
      body: JSON.stringify({ alias })
    });
    return res.data;
  }

  async updateGamePinned(gameId, pinned) {
    const res = await this.request(`/api/games/${gameId}/pinned`, {
      method: 'POST',
      body: JSON.stringify({ pinned: !!pinned })
    });
    return res.data;
  }

  async addTagToGame(gameId, tagIdOrName) {
    const isId = typeof tagIdOrName === 'number';
    const res = await this.request(`/api/games/${gameId}/tags`, {
      method: 'POST',
      body: JSON.stringify(isId ? { tagId: tagIdOrName } : { tagName: tagIdOrName })
    });
    return res.data;
  }

  async removeTagFromGame(gameId, tagId) {
    const res = await this.request(`/api/games/${gameId}/tags/${tagId}`, {
      method: 'DELETE'
    });
    return res.data;
  }

  async scrapeCover(gameId) {
    const res = await this.request(`/api/games/${gameId}/scrape-cover`, {
      method: 'POST',
      timeout: 30000
    });
    return res.data;
  }

  async uploadGameCover(gameId, imageData) {
    const res = await this.request(`/api/games/${gameId}/cover`, {
      method: 'POST',
      body: JSON.stringify({ image: imageData }),
      timeout: 35000
    });
    return res.data;
  }

  async launchGame(gameId, exePath = null) {
    const res = await this.request(`/api/games/${gameId}/launch`, {
      method: 'POST',
      body: JSON.stringify({ exePath })
    });
    return res.data;
  }

  // --- 游戏文件与下载 ---
  async getGameFiles(gameId) {
    const res = await this.request(`/api/games/${gameId}/files`);
    return res.data;
  }

  getDownloadFileUrl(gameId, relativeFilePath = '') {
    const params = new URLSearchParams();
    if (relativeFilePath) {
      params.set('file', relativeFilePath);
    }
    if (this.token) params.set('token', this.token);
    const query = params.toString();
    return `${this.serverUrl}/api/games/${gameId}/download${query ? `?${query}` : ''}`;
  }
}

export const api = new ApiClient(
  typeof localStorage !== 'undefined' ? localStorage.getItem('mygal_server_url') || '' : '',
  typeof localStorage !== 'undefined' ? localStorage.getItem('mygal_server_token') || '' : ''
);
