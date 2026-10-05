import React, { useState } from 'react';
import { X, Plus, Edit2, Trash2, Check, Tag } from 'lucide-react';
import { api } from '../api/client';
import { useServer } from '../contexts/ServerContext';

export default function TagManagerModal({ isOpen, tags = [], onClose, onTagsUpdated }) {
  const { showToast } = useServer();
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [editingTag, setEditingTag] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!newTagName.trim()) return;
    setLoading(true);
    try {
      await api.createTag(newTagName.trim(), newTagColor);
      setNewTagName('');
      showToast('标签创建成功', 'success');
      onTagsUpdated?.();
    } catch (err) {
      showToast('创建失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (tag) => {
    setEditingTag(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color || '#6366f1');
  };

  const handleSaveEdit = async (tagId) => {
    if (!editName.trim()) return;
    try {
      await api.updateTag(tagId, editName.trim(), editColor);
      setEditingTag(null);
      showToast('标签已更新', 'success');
      onTagsUpdated?.();
    } catch (err) {
      showToast('更新失败: ' + err.message, 'error');
    }
  };

  const handleDelete = async (tagId) => {
    try {
      await api.deleteTag(tagId);
      showToast('标签已删除', 'info');
      onTagsUpdated?.();
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    }
  };

  const filteredTags = tags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase().trim())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="glass-modal rounded-[28px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">标签管理</h3>
              <p className="text-[11px] text-gray-400">共 {tags.length} 个标签</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Create Bar */}
        <div className="p-4 bg-gray-950/60 border-b border-white/5 space-y-2">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="输入新标签名..."
              className="flex-1 bg-gray-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              type="color"
              value={newTagColor}
              onChange={(e) => setNewTagColor(e.target.value)}
              className="w-8 h-8 rounded-xl bg-transparent border-0 cursor-pointer p-0"
              title="标签颜色"
            />
            <button
              onClick={handleCreate}
              disabled={loading || !newTagName.trim()}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-white/5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标签..."
            className="w-full bg-gray-900/60 border border-white/5 rounded-xl px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none"
          />
        </div>

        {/* Tags List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1 min-h-0">
          {filteredTags.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500">
              {search ? '未找到匹配的标签' : '暂无标签'}
            </div>
          ) : (
            filteredTags.map((t) => (
              <div
                key={t.id}
                className="glass-panel p-2.5 rounded-2xl flex items-center justify-between gap-2 border border-white/5"
              >
                {editingTag === t.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 bg-gray-900 border border-indigo-500 rounded-lg px-2 py-1 text-xs text-white"
                      autoFocus
                    />
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer p-0"
                    />
                    <button
                      onClick={() => handleSaveEdit(t.id)}
                      className="p-1.5 rounded-lg bg-emerald-600 text-white"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setEditingTag(null)}
                      className="p-1.5 rounded-lg bg-gray-800 text-gray-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: t.color || '#6366f1' }}
                      />
                      <span className="font-semibold text-xs text-white truncate">{t.name}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleStartEdit(t)}
                        className="p-1.5 rounded-lg bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="p-1.5 rounded-lg bg-gray-850 hover:bg-red-950 text-gray-400 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
