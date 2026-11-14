import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Snippet } from '../types/notes';

interface SnippetModalProps {
  isOpen: boolean;
  initialSnippet?: Partial<Snippet> | null;
  categories: string[];
  onClose: () => void;
  onSave: (data: {
    id?: string;
    title: string;
    description: string;
    category: string;
    language: string;
    content: string;
  }) => void;
}

const LANGUAGES = [
  'bash',
  'typescript',
  'javascript',
  'python',
  'yaml',
  'json',
  'sql',
  'php',
  'nginx',
  'markdown',
  'text',
];

export function SnippetModal({
  isOpen,
  initialSnippet,
  categories,
  onClose,
  onSave,
}: SnippetModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Documentation');
  const [language, setLanguage] = useState('bash');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTitle(initialSnippet?.title || '');
    setDescription(initialSnippet?.description || '');
    setCategory(initialSnippet?.category || categories[0] || 'Documentation');
    setLanguage(initialSnippet?.language || 'bash');
    setContent(initialSnippet?.content || '');
  }, [isOpen, initialSnippet, categories]);

  if (!isOpen) return null;

  const isEditing = Boolean(initialSnippet?.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    onSave({
      id: initialSnippet?.id,
      title: title.trim(),
      description: description.trim(),
      category: category.trim() || 'General',
      language: language.trim() || 'text',
      content,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-modal-title"
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-white/[0.08]">
          <h2 id="snippet-modal-title" className="text-[16px] font-semibold text-neutral-950 dark:text-white">
            {isEditing ? 'Edit snippet' : 'Save technical snippet'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close snippet modal"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Docker Compose Healthcheck"
                autoFocus
                className="w-full px-3 py-2 text-[14px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                  Category
                </label>
                <input
                  type="text"
                  list="snippet-categories-list"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Git & CLI"
                  className="w-full px-3 py-2 text-[14px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                />
                <datalist id="snippet-categories-list">
                  {categories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                  Format
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short explanation of when to use this snippet"
              className="w-full px-3 py-2 text-[14px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
              Markdown or code snippet
            </label>
            <textarea
              required
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste Markdown block, CLI command, or config template..."
              className="w-full px-3.5 py-2.5 text-[13.5px] font-mono-code leading-relaxed rounded-lg border border-neutral-300 dark:border-white/12 bg-neutral-50 dark:bg-[#111114] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-[13.5px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              {isEditing ? 'Save changes' : 'Save snippet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
