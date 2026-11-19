export interface GitFileChange {
  path: string;
  fullPath: string;
  indexStatus: string;
  workTreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  relativeDate: string;
  refs: string;
}

export interface GitStatusSnapshot {
  gitInstalled: boolean;
  isRepo: boolean;
  cwd: string;
  repoRoot: string | null;
  branch: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  changes: GitFileChange[];
  branches: GitBranchInfo[];
  commits: GitCommitInfo[];
}

export interface GitDiffResult {
  path: string;
  staged: boolean;
  untracked: boolean;
  diffText: string;
  newFilePreview?: string;
}

export interface GitCommitDetailResult {
  hash: string;
  diffText: string;
}

export type GitCommandAction =
  | 'status'
  | 'init'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'diff'
  | 'diffSummary'
  | 'commitDetails'
  | 'checkout'
  | 'pull'
  | 'push'
  | 'fetch';

export type GitCommandRunner = (
  action: GitCommandAction,
  payload?: Record<string, unknown>,
  cwd?: string
) => Promise<Record<string, unknown>>;

export function getGitBadgeMeta(change: GitFileChange, mode: 'staged' | 'unstaged'): {
  letter: string;
  title: string;
  className: string;
} {
  if (change.untracked) {
    return {
      letter: 'U',
      title: 'Untracked file',
      className: 'text-emerald-400',
    };
  }
  const code = (mode === 'staged' ? change.indexStatus : change.workTreeStatus) || 'M';
  switch (code) {
    case 'A':
      return { letter: 'A', title: 'Added', className: 'text-emerald-400' };
    case 'D':
      return { letter: 'D', title: 'Deleted', className: 'text-red-400' };
    case 'R':
      return { letter: 'R', title: 'Renamed', className: 'text-blue-400' };
    case 'C':
      return { letter: 'C', title: 'Copied', className: 'text-blue-400' };
    case 'U':
      return { letter: '!', title: 'Unmerged conflict', className: 'text-red-400' };
    default:
      return { letter: 'M', title: 'Modified', className: 'text-amber-400' };
  }
}

export async function generateAiCommitMessage(params: {
  diffText: string;
  changedFiles: string[];
  branch?: string;
}): Promise<string> {
  const res = await fetch('/api/ai/git-commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok || !data.message) {
    throw new Error(data.error || 'Failed to generate commit message.');
  }
  return data.message;
}
