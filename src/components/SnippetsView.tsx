import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Snippet } from '../types/notes';
import { formatRelativeDate } from '../utils/markdown';
import { MarkdownRenderer } from './MarkdownRenderer';

interface SnippetsViewProps {
  snippets: Snippet[];
  activeNoteTitle: string | null;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onNewSnippet: () => void;
  onEditSnippet: (snippet: Snippet) => void;
  onDeleteSnippet: (snippetId: string) => void;
  onInsertIntoActiveNote: (snippet: Snippet) => void;
}

export function SnippetsView({
  snippets,
  activeNoteTitle,
  sidebarOpen,
  onOpenSidebar,
  onNewSnippet,
  onEditSnippet,
  onDeleteSnippet,
  onInsertIntoActiveNote,
}: SnippetsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(snippets.map((s) => s.category))).sort();
    return ['All', ...unique];
  }, [snippets]);

  const filteredSnippets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return snippets
      .filter((s) => (selectedCategory === 'All' ? true : s.category === selectedCategory))
      .filter(
        (s) =>
          !q ||
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q) ||
          s.language.toLowerCase().includes(q)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [snippets, selectedCategory, searchQuery]);

  const handleCopy = async (snippet: Snippet) => {
    const stripped = snippet.content
      .replace(/^```[a-zA-Z0-9_-]*\n/, '')
      .replace(/\n```$/, '');
    try {
      await navigator.clipboard.writeText(stripped);
      setCopiedId(snippet.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Clipboard blocked fallback
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#121214]">
      {/* Top Workspace Header */}
      <header className="h-[52px] shrink-0 px-5 border-b border-neutral-200 dark:border-white/[0.07] flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open sidebar"
              className="p-2 -ml-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer shrink-0"
            >
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            </button>
          )}
          <h1 className="text-[15px] font-semibold text-neutral-950 dark:text-white whitespace-nowrap truncate">
            Snippet Library
          </h1>
          <span className="hidden sm:inline text-[13px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap tabular-nums">
            · {snippets.length} organized blocks
          </span>
        </div>

        <button
          type="button"
          onClick={onNewSnippet}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New snippet</span>
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-6 py-7">
        <div className="max-w-[1040px] mx-auto space-y-6">
          {/* Intro + Search & Filter Controls */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-[24px] font-semibold tracking-tight text-neutral-950 dark:text-white">
                  Organized Technical Snippets
                </h2>
                <p className="text-[14px] text-neutral-600 dark:text-neutral-400 mt-1">
                  Reusable commands, configuration blocks, and Markdown templates ready to insert into any document.
                </p>
              </div>

              <div className="relative w-full sm:w-72 shrink-0">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter snippets..."
                  className="w-full pl-9 pr-3 py-2 text-[13.5px] rounded-lg border border-neutral-200 dark:border-white/[0.1] bg-neutral-50 dark:bg-[#19191d] text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Category Segmented Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {categories.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
                        : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Empty State */}
          {filteredSnippets.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 dark:border-white/[0.08] p-10 text-center space-y-3">
              <p className="text-[15px] font-medium text-neutral-900 dark:text-white">
                No matching snippets found
              </p>
              <p className="text-[13.5px] text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
                Save frequently used commands, config templates, or Markdown sections to keep your technical notes consistent.
              </p>
              <button
                type="button"
                onClick={onNewSnippet}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create snippet</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {filteredSnippets.map((snippet) => (
                <article
                  key={snippet.id}
                  className="flex flex-col rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-white dark:bg-[#161619] overflow-hidden"
                >
                  <div className="px-5 pt-4 pb-3 border-b border-neutral-200/80 dark:border-white/[0.06] flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold text-neutral-950 dark:text-white truncate">
                        {snippet.title}
                      </h3>
                      <div className="mt-1 flex items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                        <span>{snippet.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-code">{snippet.language}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeDate(snippet.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {confirmDeleteId === snippet.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteSnippet(snippet.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2 py-1 text-[11.5px] font-medium text-red-600 dark:text-red-400 rounded hover:bg-red-500/10 cursor-pointer"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-1.5 py-1 text-[11.5px] text-neutral-500 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onEditSnippet(snippet)}
                            aria-label={`Edit ${snippet.title}`}
                            title="Edit snippet"
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(snippet.id)}
                            aria-label={`Delete ${snippet.title}`}
                            title="Delete snippet"
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-red-500 dark:text-neutral-400 dark:hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="px-5 py-3 flex-1">
                    {snippet.description && (
                      <p className="text-[13px] text-neutral-600 dark:text-neutral-400 mb-2">
                        {snippet.description}
                      </p>
                    )}
                    <div className="max-h-56 overflow-y-auto text-[13px] [&_.my-5]:my-2">
                      <MarkdownRenderer content={snippet.content} />
                    </div>
                  </div>

                  <div className="px-5 py-3 border-t border-neutral-200/80 dark:border-white/[0.06] bg-neutral-50/60 dark:bg-white/[0.015] flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleCopy(snippet)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {copiedId === snippet.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy raw</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onInsertIntoActiveNote(snippet)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer whitespace-nowrap truncate max-w-[240px]"
                    >
                      <span className="truncate">
                        {activeNoteTitle ? `Insert into "${activeNoteTitle}"` : 'Insert into new note'}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
