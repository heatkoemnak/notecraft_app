import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import {
  generateAiCommitMessage,
  getGitBadgeMeta,
  GitCommandRunner,
  GitCommitInfo,
  GitFileChange,
  GitStatusSnapshot,
} from '../utils/gitClient';
import { getFileIconColorClass } from './ProjectTreeView';

interface GitSourceControlPanelProps {
  currentRemotePath: string;
  gitStatus: GitStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void> | void;
  onRunGit: GitCommandRunner;
  onInspectChangeDiff: (change: GitFileChange, staged: boolean) => void;
  onInspectCommit: (commit: GitCommitInfo) => void;
  onOpenFile: (fullPath: string) => void;
  onAfterWorkingTreeMutated?: (affectedPaths?: string[]) => void;
}

export function GitSourceControlPanel({
  currentRemotePath,
  gitStatus,
  loading,
  error,
  onRefresh,
  onRunGit,
  onInspectChangeDiff,
  onInspectCommit,
  onOpenFile,
  onAfterWorkingTreeMutated,
}: GitSourceControlPanelProps) {
  const [commitMessage, setCommitMessage] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [commitsOpen, setCommitsOpen] = useState(true);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [confirmDiscardTarget, setConfirmDiscardTarget] = useState<
    | { kind: 'single'; change: GitFileChange }
    | { kind: 'all' }
    | null
  >(null);

  const repoCwd = gitStatus?.repoRoot || currentRemotePath;

  const stagedChanges = useMemo(
    () => (gitStatus?.changes || []).filter((c) => c.staged),
    [gitStatus?.changes]
  );

  const unstagedChanges = useMemo(
    () => (gitStatus?.changes || []).filter((c) => c.unstaged),
    [gitStatus?.changes]
  );

  const showTempNotice = (msg: string) => {
    setStatusNotice(msg);
    window.setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const executeGit = async (
    label: string,
    action: Parameters<GitCommandRunner>[0],
    payload?: Record<string, unknown>,
    options?: { refreshAfter?: boolean; affectedPaths?: string[]; successNotice?: string }
  ) => {
    setBusyAction(label);
    setLocalError(null);
    try {
      const res = await onRunGit(action, payload, repoCwd);
      if (options?.refreshAfter !== false) {
        await onRefresh();
      }
      if (options?.affectedPaths) {
        onAfterWorkingTreeMutated?.(options.affectedPaths);
      }
      if (options?.successNotice) {
        showTempNotice(options.successNotice);
      }
      return res;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Git operation failed.');
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const handleCommit = async () => {
    const clean = commitMessage.trim();
    if (!clean) {
      setLocalError('Enter a commit message first.');
      return;
    }
    const stageAll = stagedChanges.length === 0 && unstagedChanges.length > 0;
    const res = await executeGit(
      'commit',
      'commit',
      { message: clean, stageAll },
      { successNotice: 'Committed changes.' }
    );
    if (res) {
      setCommitMessage('');
    }
  };

  const handleGenerateAiCommit = async () => {
    if (!gitStatus?.isRepo) return;
    setBusyAction('ai-commit');
    setLocalError(null);
    try {
      const stagedOnly = stagedChanges.length > 0;
      const summaryRes = await onRunGit('diffSummary', { stagedOnly }, repoCwd);
      const diffText = typeof summaryRes.diffText === 'string' ? summaryRes.diffText : '';
      const changedFiles = (stagedOnly ? stagedChanges : unstagedChanges).map((c) => c.path);
      const generated = await generateAiCommitMessage({
        diffText,
        changedFiles,
        branch: gitStatus.branch,
      });
      setCommitMessage(generated);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not generate commit message.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSwitchBranch = async (branchName: string, create = false) => {
    setBranchMenuOpen(false);
    setCreatingBranch(false);
    setNewBranchName('');
    await executeGit(
      'checkout',
      'checkout',
      { branch: branchName, create },
      {
        affectedPaths: [],
        successNotice: `Switched to ${branchName}`,
      }
    );
  };

  const handleConfirmDiscard = async () => {
    if (!confirmDiscardTarget) return;
    const target = confirmDiscardTarget;
    setConfirmDiscardTarget(null);

    if (target.kind === 'single') {
      const c = target.change;
      await executeGit(
        'discard',
        'discard',
        {
          trackedPaths: c.untracked ? [] : [c.path],
          untrackedPaths: c.untracked ? [c.path] : [],
        },
        {
          affectedPaths: [c.fullPath],
          successNotice: `Discarded changes in ${c.path}`,
        }
      );
      return;
    }

    const trackedPaths = unstagedChanges.filter((c) => !c.untracked).map((c) => c.path);
    const untrackedPaths = unstagedChanges.filter((c) => c.untracked).map((c) => c.path);
    await executeGit(
      'discard',
      'discard',
      { trackedPaths, untrackedPaths },
      {
        affectedPaths: unstagedChanges.map((c) => c.fullPath),
        successNotice: 'Discarded all unstaged changes.',
      }
    );
  };

  const activeError = localError || error;

  if (loading && !gitStatus) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-[12px] text-neutral-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        <span>Inspecting Git status...</span>
      </div>
    );
  }

  if (gitStatus && !gitStatus.gitInstalled) {
    return (
      <div className="p-4 text-[12px] text-neutral-400 space-y-2">
        <div className="flex items-center gap-2 text-amber-300 font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Git not found on remote host</span>
        </div>
        <p className="text-[11.5px] leading-relaxed text-neutral-400">
          Install <code className="font-mono-code text-neutral-200">git</code> on the server to
          use Source Control.
        </p>
      </div>
    );
  }

  if (!gitStatus || !gitStatus.isRepo) {
    return (
      <div className="p-4 space-y-3">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-2.5">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
            <GitBranch className="w-4 h-4 text-blue-400 shrink-0" />
            <span>Source Control</span>
          </div>
          <p className="text-[11.5px] text-neutral-400 leading-relaxed">
            The current folder{' '}
            <code className="font-mono-code text-neutral-200 break-all">
              {currentRemotePath || '~'}
            </code>{' '}
            does not have a Git repository initialized yet.
          </p>
          {activeError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
              {activeError}
            </div>
          )}
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              void executeGit(
                'init',
                'init',
                {},
                { successNotice: 'Initialized Git repository.' }
              )
            }
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[12px] font-medium cursor-pointer transition-colors"
          >
            {busyAction === 'init' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <GitBranch className="w-3.5 h-3.5" />
            )}
            <span>Initialize Repository</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-neutral-200">
      {/* Branch & Remote Actions Bar */}
      <div className="shrink-0 px-2.5 py-2 border-b border-white/[0.08] space-y-2 bg-[#14141b]">
        <div className="flex items-center justify-between gap-1.5">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setBranchMenuOpen((p) => !p)}
              title={`Current branch: ${gitStatus.branch}`}
              className="w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded-md border border-white/10 bg-[#0e0e13] hover:bg-white/[0.06] text-[11.5px] font-medium text-white cursor-pointer"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <GitBranch className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="font-mono-code truncate">{gitStatus.branch || 'HEAD'}</span>
              </span>
              {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                <span className="text-[10.5px] font-mono-code text-blue-300 shrink-0 tabular-nums">
                  {gitStatus.ahead > 0 ? `↑${gitStatus.ahead}` : ''}
                  {gitStatus.behind > 0 ? ` ↓${gitStatus.behind}` : ''}
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
            </button>

            {branchMenuOpen && (
              <div className="absolute left-0 right-0 mt-1 rounded-lg border border-white/15 bg-[#191922] shadow-2xl py-1 z-40 max-h-60 overflow-y-auto">
                {gitStatus.branches.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => void handleSwitchBranch(b.name, false)}
                    className={`w-full px-2.5 py-1.5 text-left text-[11.5px] font-mono-code flex items-center justify-between gap-2 hover:bg-white/10 cursor-pointer ${
                      b.current ? 'text-blue-300 bg-blue-500/10' : 'text-neutral-200'
                    }`}
                  >
                    <span className="truncate">{b.name}</span>
                    {b.current && <Check className="w-3 h-3 text-blue-400 shrink-0" />}
                  </button>
                ))}
                <div className="my-1 border-t border-white/10" />
                {!creatingBranch ? (
                  <button
                    type="button"
                    onClick={() => setCreatingBranch(true)}
                    className="w-full px-2.5 py-1.5 text-left text-[11.5px] text-emerald-300 hover:bg-white/10 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Create new branch...</span>
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newBranchName.trim()) {
                        void handleSwitchBranch(newBranchName.trim(), true);
                      }
                    }}
                    className="px-2 py-1.5 flex items-center gap-1"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="feat/new-branch"
                      className="font-mono-code flex-1 min-w-0 px-2 py-1 text-[11px] rounded border border-white/15 bg-[#0e0e13] text-white focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 rounded bg-blue-600 text-white text-[10.5px] font-medium cursor-pointer"
                    >
                      Go
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              disabled={busyAction !== null || !gitStatus.hasRemote}
              onClick={() =>
                void executeGit('pull', 'pull', {}, {
                  affectedPaths: [],
                  successNotice: 'Pulled remote changes.',
                })
              }
              title={gitStatus.hasRemote ? 'Pull from remote (git pull)' : 'No remote configured'}
              className="p-1.5 rounded text-neutral-300 hover:text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer"
            >
              {busyAction === 'pull' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <ArrowDownToLine className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              disabled={busyAction !== null || !gitStatus.hasRemote}
              onClick={() =>
                void executeGit('push', 'push', {}, {
                  successNotice: 'Pushed commits to remote.',
                })
              }
              title={gitStatus.hasRemote ? 'Push to remote (git push)' : 'No remote configured'}
              className="p-1.5 rounded text-neutral-300 hover:text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer"
            >
              {busyAction === 'push' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <ArrowUpFromLine className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              disabled={loading || busyAction !== null}
              onClick={() => void onRefresh()}
              title="Refresh Git status"
              className="p-1.5 rounded text-neutral-300 hover:text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Cursor-style Commit Input Box */}
        <div className="space-y-1.5">
          <div className="relative">
            <textarea
              rows={2}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleCommit();
                }
              }}
              placeholder="Commit message (Ctrl+Enter to commit)"
              className="w-full pr-8 px-2.5 py-1.5 text-[11.5px] rounded-lg border border-white/12 bg-[#0c0c11] text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500 resize-none leading-snug"
            />
            <button
              type="button"
              disabled={
                busyAction !== null ||
                (stagedChanges.length === 0 && unstagedChanges.length === 0)
              }
              onClick={() => void handleGenerateAiCommit()}
              title="Generate commit message from changes with AI"
              className="absolute right-1.5 top-1.5 p-1 rounded text-blue-300 hover:text-white hover:bg-blue-500/20 disabled:opacity-30 cursor-pointer"
            >
              {busyAction === 'ai-commit' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <button
            type="button"
            disabled={
              busyAction !== null ||
              (stagedChanges.length === 0 && unstagedChanges.length === 0)
            }
            onClick={() => void handleCommit()}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-[12px] font-medium cursor-pointer transition-colors"
          >
            {busyAction === 'commit' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>
              {stagedChanges.length > 0
                ? `Commit (${stagedChanges.length} staged)`
                : unstagedChanges.length > 0
                ? `Commit All (${unstagedChanges.length})`
                : 'Commit'}
            </span>
          </button>
        </div>
      </div>

      {activeError && (
        <div className="mx-2 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300 flex items-start justify-between gap-2 shrink-0">
          <span className="break-words">{activeError}</span>
          <button
            type="button"
            onClick={() => setLocalError(null)}
            className="text-red-300 hover:text-white shrink-0 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {statusNotice && (
        <div className="mx-2 mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 flex items-center gap-1.5 shrink-0">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{statusNotice}</span>
        </div>
      )}

      {confirmDiscardTarget && (
        <div className="mx-2 mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200 space-y-2 shrink-0">
          <div className="font-medium">
            {confirmDiscardTarget.kind === 'all'
              ? `Discard all ${unstagedChanges.length} unstaged change(s)?`
              : `Discard changes in "${confirmDiscardTarget.change.path}"?`}
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmDiscardTarget(null)}
              className="px-2 py-0.5 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmDiscard()}
              className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium cursor-pointer"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Changes + Commit History Lists */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-2 space-y-2">
        {/* Staged Changes */}
        <div>
          <div className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-white/[0.04]">
            <button
              type="button"
              onClick={() => setStagedOpen((p) => !p)}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-300 cursor-pointer"
            >
              {stagedOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
              )}
              <span>Staged Changes</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/10 text-[10px] text-neutral-300 tabular-nums">
                {stagedChanges.length}
              </span>
            </button>

            {stagedChanges.length > 0 && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  void executeGit('unstage-all', 'unstage', { paths: [] })
                }
                title="Unstage all changes"
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <Minus className="w-3 h-3" />
              </button>
            )}
          </div>

          {stagedOpen && (
            <div className="mt-0.5 space-y-0.5">
              {stagedChanges.length === 0 ? (
                <div className="px-6 py-1 text-[11px] text-neutral-500">No staged changes</div>
              ) : (
                stagedChanges.map((change) => {
                  const badge = getGitBadgeMeta(change, 'staged');
                  const fileName = change.path.split('/').pop() || change.path;
                  return (
                    <div
                      key={`staged-${change.path}`}
                      className="group flex items-center justify-between gap-1 px-2 py-1 rounded hover:bg-white/[0.06]"
                    >
                      <button
                        type="button"
                        onClick={() => onInspectChangeDiff(change, true)}
                        title={`Inspect staged diff: ${change.path}`}
                        className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
                      >
                        <FileText
                          className={`w-3.5 h-3.5 shrink-0 ${getFileIconColorClass(fileName)}`}
                        />
                        <span className="text-[11.5px] text-neutral-100 truncate">
                          {fileName}
                        </span>
                        {change.path.includes('/') && (
                          <span className="text-[10.5px] text-neutral-500 truncate">
                            {change.path.slice(0, change.path.lastIndexOf('/'))}
                          </span>
                        )}
                      </button>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenFile(change.fullPath)}
                          title="Open file in editor"
                          className="hidden group-hover:inline-flex p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <FileText className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void executeGit('unstage', 'unstage', { paths: [change.path] })
                          }
                          title="Unstage file"
                          className="hidden group-hover:inline-flex p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span
                          title={badge.title}
                          className={`w-4 text-center font-mono-code text-[11px] font-semibold ${badge.className}`}
                        >
                          {badge.letter}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Working Tree / Untracked Changes */}
        <div>
          <div className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-white/[0.04]">
            <button
              type="button"
              onClick={() => setChangesOpen((p) => !p)}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-300 cursor-pointer"
            >
              {changesOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
              )}
              <span>Changes</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/10 text-[10px] text-neutral-300 tabular-nums">
                {unstagedChanges.length}
              </span>
            </button>

            {unstagedChanges.length > 0 && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => setConfirmDiscardTarget({ kind: 'all' })}
                  title="Discard all unstaged changes"
                  className="p-1 rounded text-neutral-400 hover:text-red-300 hover:bg-white/10 cursor-pointer"
                >
                  <Undo2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void executeGit('stage-all', 'stage', { paths: [] })}
                  title="Stage all changes"
                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {changesOpen && (
            <div className="mt-0.5 space-y-0.5">
              {unstagedChanges.length === 0 ? (
                <div className="px-6 py-1 text-[11px] text-neutral-500">
                  Working tree clean
                </div>
              ) : (
                unstagedChanges.map((change) => {
                  const badge = getGitBadgeMeta(change, 'unstaged');
                  const fileName = change.path.split('/').pop() || change.path;
                  return (
                    <div
                      key={`unstaged-${change.path}`}
                      className="group flex items-center justify-between gap-1 px-2 py-1 rounded hover:bg-white/[0.06]"
                    >
                      <button
                        type="button"
                        onClick={() => onInspectChangeDiff(change, false)}
                        title={`Inspect changes: ${change.path}`}
                        className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
                      >
                        <FileText
                          className={`w-3.5 h-3.5 shrink-0 ${getFileIconColorClass(fileName)}`}
                        />
                        <span className="text-[11.5px] text-neutral-100 truncate">
                          {fileName}
                        </span>
                        {change.path.includes('/') && (
                          <span className="text-[10.5px] text-neutral-500 truncate">
                            {change.path.slice(0, change.path.lastIndexOf('/'))}
                          </span>
                        )}
                      </button>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenFile(change.fullPath)}
                          title="Open file in editor"
                          className="hidden group-hover:inline-flex p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <FileText className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            setConfirmDiscardTarget({ kind: 'single', change })
                          }
                          title="Discard changes"
                          className="hidden group-hover:inline-flex p-1 rounded text-neutral-400 hover:text-red-300 hover:bg-white/10 cursor-pointer"
                        >
                          <Undo2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void executeGit('stage', 'stage', { paths: [change.path] })
                          }
                          title="Stage file"
                          className="hidden group-hover:inline-flex p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <span
                          title={badge.title}
                          className={`w-4 text-center font-mono-code text-[11px] font-semibold ${badge.className}`}
                        >
                          {badge.letter}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Recent Commits (Graph / History) */}
        <div className="pt-1 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setCommitsOpen((p) => !p)}
            className="w-full flex items-center justify-between px-1.5 py-1 rounded hover:bg-white/[0.04] text-[11px] font-semibold uppercase tracking-wider text-neutral-300 cursor-pointer"
          >
            <span className="flex items-center gap-1">
              {commitsOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
              )}
              <History className="w-3 h-3 text-neutral-400" />
              <span>Commits</span>
            </span>
            <span className="px-1.5 rounded-full bg-white/10 text-[10px] text-neutral-300 tabular-nums">
              {gitStatus.commits.length}
            </span>
          </button>

          {commitsOpen && (
            <div className="mt-1 space-y-0.5">
              {gitStatus.commits.length === 0 ? (
                <div className="px-6 py-1 text-[11px] text-neutral-500">No commits yet</div>
              ) : (
                gitStatus.commits.map((commit) => (
                  <button
                    key={commit.hash}
                    type="button"
                    onClick={() => onInspectCommit(commit)}
                    title={`${commit.shortHash} · ${commit.author} (${commit.relativeDate})`}
                    className="w-full px-2 py-1.5 rounded hover:bg-white/[0.06] text-left flex items-start gap-2 cursor-pointer transition-colors"
                  >
                    <GitCommitHorizontal className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] text-neutral-100 truncate">
                        {commit.message}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10.5px] text-neutral-500 truncate">
                        <span className="font-mono-code text-neutral-400">
                          {commit.shortHash}
                        </span>
                        <span>·</span>
                        <span className="truncate">{commit.author}</span>
                        <span>·</span>
                        <span className="shrink-0">{commit.relativeDate}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
