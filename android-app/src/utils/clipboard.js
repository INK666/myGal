/**
 * 跨平台剪贴板复制工具
 * 完美支持移动端 Android WebView 以及非 HTTPS 局域网 HTTP 环境
 */
export async function copyToClipboard(text) {
  if (text === null || text === undefined) return false;
  const str = String(text);
  if (!str) return false;

  // 1. 优先尝试现代 Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch (e) {
      console.warn('[Clipboard] navigator.clipboard.writeText failed, falling back:', e);
    }
  }

  // 2. 针对 Android WebView / HTTP 局域网降级使用 textarea + execCommand
  if (typeof document !== 'undefined') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = str;
      // 保持不可见但处于可视区域内，避免 Android 滚动条跳动
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      textArea.style.opacity = '0.01';
      textArea.setAttribute('readonly', '');

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, str.length);

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.error('[Clipboard] execCommand fallback failed:', err);
      return false;
    }
  }

  return false;
}
