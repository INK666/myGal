import React, { useState, useRef } from 'react';
import { X, Image as ImageIcon, Sparkles, Sliders, RotateCcw, Check, Upload, Palette } from 'lucide-react';

export const PRESET_WALLPAPERS = [
  {
    id: 'none',
    name: '默认纯黑',
    preview: 'bg-gray-950',
    type: 'color',
    style: { background: '#030712' }
  },
  {
    id: 'aurora',
    name: '极光幻境',
    preview: 'bg-gradient-to-tr from-indigo-950 via-purple-950 to-pink-950',
    type: 'gradient',
    style: {
      background: 'radial-gradient(ellipse at top right, rgba(99, 102, 241, 0.4), transparent 60%), radial-gradient(ellipse at bottom left, rgba(236, 72, 153, 0.3), transparent 60%), #030712'
    }
  },
  {
    id: 'deep-space',
    name: '深空星云',
    preview: 'bg-gradient-to-b from-blue-950 via-slate-950 to-gray-950',
    type: 'gradient',
    style: {
      background: 'radial-gradient(circle at 50% 20%, rgba(59, 130, 246, 0.35), transparent 50%), radial-gradient(circle at 80% 80%, rgba(147, 51, 234, 0.3), transparent 50%), #050814'
    }
  },
  {
    id: 'cyberpunk',
    name: '赛博霓虹',
    preview: 'bg-gradient-to-r from-emerald-950 via-cyan-950 to-blue-950',
    type: 'gradient',
    style: {
      background: 'radial-gradient(circle at 20% 30%, rgba(16, 185, 129, 0.35), transparent 50%), radial-gradient(circle at 80% 70%, rgba(6, 182, 212, 0.35), transparent 50%), #030d12'
    }
  },
  {
    id: 'sunset',
    name: '暮色晚霞',
    preview: 'bg-gradient-to-tr from-orange-950 via-amber-950 to-rose-950',
    type: 'gradient',
    style: {
      background: 'radial-gradient(circle at 70% 30%, rgba(244, 63, 94, 0.35), transparent 50%), radial-gradient(circle at 20% 80%, rgba(245, 158, 11, 0.3), transparent 50%), #0f0508'
    }
  }
];

export default function WallpaperModal({
  isOpen,
  onClose,
  wallpaperConfig,
  onUpdateWallpaper,
  showToast
}) {
  const [activeTab, setActiveTab] = useState('preset'); // 'preset' | 'custom' | 'adjust'
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const { presetId, customImage, blur, opacity } = wallpaperConfig;

  // 处理本地图片选择并转为 Base64 存储
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast?.('请选择正确的图片文件', 'error');
      return;
    }

    // 限制图片大小并压缩
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1920;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
        onUpdateWallpaper({
          presetId: 'custom',
          customImage: compressedBase64
        });
        showToast?.('自定义壁纸设置成功！', 'success');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="glass-modal rounded-[28px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh] border border-white/10">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5 bg-gray-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-pink-600 to-indigo-600 text-white shrink-0 shadow-lg shadow-pink-600/30">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">壁纸与个性化背景</h3>
              <p className="text-[11px] text-gray-400">自定义移动端专属壁纸与毛玻璃效果</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white shrink-0 active-press transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="p-3 bg-gray-950/40 border-b border-white/5 flex gap-1.5 text-xs">
          <button
            onClick={() => setActiveTab('preset')}
            className={`flex-1 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'preset'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-gray-900 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>预设背景</span>
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`flex-1 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'custom'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-gray-900 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>自定义图片</span>
          </button>
          <button
            onClick={() => setActiveTab('adjust')}
            className={`flex-1 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'adjust'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-gray-900 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>效果调节</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 min-h-0">
          {/* Tab 1: 预设背景 */}
          {activeTab === 'preset' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {PRESET_WALLPAPERS.map((preset) => {
                  const isSelected = presetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      onClick={() => {
                        onUpdateWallpaper({ presetId: preset.id });
                        showToast?.(`已应用壁纸: ${preset.name}`, 'info');
                      }}
                      className={`relative rounded-2xl p-3 h-24 flex flex-col justify-end cursor-pointer overflow-hidden border transition-all active-press ${
                        isSelected
                          ? 'border-indigo-400 ring-2 ring-indigo-500/40 shadow-lg shadow-indigo-500/20'
                          : 'border-white/10 hover:border-white/20'
                      }`}
                      style={preset.style}
                    >
                      <div className="absolute inset-0 bg-black/20" />
                      <div className="relative z-10 flex items-center justify-between">
                        <span className="font-bold text-xs text-white drop-shadow-md">{preset.name}</span>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center">
                            <Check className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 2: 自定义本地图片 */}
          {activeTab === 'custom' && (
            <div className="space-y-4 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              {customImage ? (
                <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-video group">
                  <img src={customImage} alt="Custom Wallpaper" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
                    >
                      更换图片
                    </button>
                    <button
                      onClick={() => {
                        onUpdateWallpaper({ presetId: 'none', customImage: null });
                        showToast?.('已移除自定义壁纸', 'info');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-red-600/80 text-white text-xs font-semibold"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/15 hover:border-indigo-500/50 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors bg-gray-900/40 active-press"
                >
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">点击上传手机相册图片</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">支持 JPG、PNG、WEBP 高清壁纸</div>
                  </div>
                </div>
              )}

              {customImage && presetId !== 'custom' && (
                <button
                  onClick={() => {
                    onUpdateWallpaper({ presetId: 'custom' });
                    showToast?.('已应用自定义壁纸', 'success');
                  }}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 active-press transition-all"
                >
                  设为当前壁纸
                </button>
              )}
            </div>
          )}

          {/* Tab 3: 毛玻璃与暗度调节 */}
          {activeTab === 'adjust' && (
            <div className="space-y-5">
              {/* Blur Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 font-medium">背景毛玻璃模糊度</span>
                  <span className="text-indigo-400 font-mono font-bold">{blur}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={blur}
                  onChange={(e) => onUpdateWallpaper({ blur: Number(e.target.value) })}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>清晰 (0px)</span>
                  <span>适中 (10px)</span>
                  <span>强力模糊 (30px)</span>
                </div>
              </div>

              {/* Opacity/Darkness Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 font-medium">遮罩暗度 (保护文字可读性)</span>
                  <span className="text-indigo-400 font-mono font-bold">{Math.round(opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => onUpdateWallpaper({ opacity: Number(e.target.value) })}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>透亮 (10%)</span>
                  <span>推荐 (65%)</span>
                  <span>深沉 (95%)</span>
                </div>
              </div>

              <button
                onClick={() => {
                  onUpdateWallpaper({ blur: 8, opacity: 0.65 });
                  showToast?.('已恢复推荐视觉调节', 'info');
                }}
                className="w-full py-2 rounded-xl bg-gray-900 hover:bg-gray-850 text-gray-400 hover:text-white text-xs font-medium border border-white/5 flex items-center justify-center gap-1.5 active-press transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重置为推荐参数</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-gray-950/80 border-t border-white/5 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 active-press transition-all"
          >
            完成设置
          </button>
        </div>
      </div>
    </div>
  );
}
