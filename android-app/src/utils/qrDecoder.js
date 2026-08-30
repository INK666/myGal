import jsQR from 'jsqr';
import { Html5Qrcode } from 'html5-qrcode';

/**
 * 将 File/Blob 转为 HTMLImageElement
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * 使用 Canvas + jsQR 进行多尺度、正反色二维码识别
 */
function tryJsQR(img, maxDim = null) {
  try {
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    if (!origW || !origH) return null;

    let targetW = origW;
    let targetH = origH;
    if (maxDim && (origW > maxDim || origH > maxDim)) {
      const scale = maxDim / Math.max(origW, origH);
      targetW = Math.max(1, Math.round(origW * scale));
      targetH = Math.max(1, Math.round(origH * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, targetW, targetH);
    const imageData = ctx.getImageData(0, 0, targetW, targetH);

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });

    return code?.data || null;
  } catch (err) {
    console.warn('[QR] jsQR scan attempt failed:', err);
    return null;
  }
}

/**
 * 独立的离屏 Html5Qrcode 识别回退
 */
async function tryHtml5QrcodeOffscreen(file) {
  const hiddenId = '__offscreen_qr_scanner_' + Date.now();
  const div = document.createElement('div');
  div.id = hiddenId;
  div.style.position = 'fixed';
  div.style.left = '-9999px';
  div.style.top = '-9999px';
  div.style.width = '300px';
  div.style.height = '300px';
  div.style.opacity = '0';
  div.style.pointerEvents = 'none';
  document.body.appendChild(div);

  try {
    const scanner = new Html5Qrcode(hiddenId);
    const text = await scanner.scanFile(file, false);
    try { scanner.clear(); } catch {}
    return text || null;
  } catch {
    return null;
  } finally {
    if (div.parentNode) {
      div.parentNode.removeChild(div);
    }
  }
}

/**
 * 从本地图片文件解析二维码内容（完全解耦摄像头，多级高精度识别）
 * @param {File|Blob} file 选取的图片文件
 * @returns {Promise<string>} 解析出的文本
 */
export async function decodeQrFromImage(file) {
  if (!file) {
    throw new Error('未提供有效的图片文件');
  }

  // 1. 尝试使用原生 BarcodeDetector（在 Android WebView / Chrome 83+ 极快且准确）
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const img = await loadImage(file);
      const barcodes = await barcodeDetector.detect(img);
      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
        return barcodes[0].rawValue;
      }
    } catch (err) {
      console.warn('[QR] Native BarcodeDetector failed, falling back to jsQR:', err);
    }
  }

  // 2. 加载图片并使用 jsQR 进行多尺度和反色扫描
  try {
    const img = await loadImage(file);

    // 尺度 1：缩放到 1200px（针对手机高分辨率截图/拍照，平衡速度与清晰度）
    let result = tryJsQR(img, 1200);
    if (result) return result;

    // 尺度 2：原始尺寸扫描（避免局部细小二维码因缩放丢失细节）
    result = tryJsQR(img, null);
    if (result) return result;

    // 尺度 3：缩放到 600px（针对低画质或高噪点大图）
    result = tryJsQR(img, 600);
    if (result) return result;

    // 尺度 4：缩放到 1800px
    result = tryJsQR(img, 1800);
    if (result) return result;
  } catch (err) {
    console.warn('[QR] jsQR pipeline failed:', err);
  }

  // 3. 离屏独立 Html5Qrcode ZXing 回退
  try {
    const fallbackResult = await tryHtml5QrcodeOffscreen(file);
    if (fallbackResult) {
      return fallbackResult;
    }
  } catch (err) {
    console.warn('[QR] Offscreen Html5Qrcode failed:', err);
  }

  throw new Error('未能从所选图片中识别出有效二维码');
}
