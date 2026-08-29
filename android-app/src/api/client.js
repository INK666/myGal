/**
 * myGal Mobile API Client
 * 负责处理与 PC 端 myGal 服务的全套 HTTP 通信与鉴权
 */

export class ApiClient {
  constructor(serverUrl = 'http://127.0.0.1:37689', token = '') {
    this.serverUrl = this.normalizeUrl(serverUrl);
    this.token = token;
  }

  normalizeUrl(url) {
    let clean = String(url || '').trim();
    if (!clean) return 'http://127.0.0.1:37689';
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'http://' + clean;
    }
    return clean.replace(/\/+$/, '');
  }

  setCredentials(serverUrl, token) {
    this.serverUrl = this.normalizeUrl(serverUrl);
    this.token = token;
  }

  async request(endpoint, options = {}) {
    const url = `${this.serverUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);

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

  getDownloadFileUrl(gameId, relativeFilePath) {
    const params = new URLSearchParams({ file: relativeFilePath });
    if (this.token) params.set('token', this.token);
    return `${this.serverUrl}/api/games/${gameId}/download?${params.toString()}`;
  }
}

export const api = new ApiClient(
  typeof localStorage !== 'undefined' ? localStorage.getItem('mygal_server_url') || '' : '',
  typeof localStorage !== 'undefined' ? localStorage.getItem('mygal_server_token') || '' : ''
);
