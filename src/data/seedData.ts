import type { Folder, NoteDocument, Snippet } from '../types/notes.ts';

const now = Date.now();
const hour = 3600 * 1000;
const day = 24 * hour;

export const INITIAL_FOLDERS: Folder[] = [
  { id: 'npm', name: 'npm', createdAt: now - 14 * day },
  { id: 'python', name: 'python', createdAt: now - 12 * day },
  { id: 'php', name: 'php', createdAt: now - 10 * day },
  { id: 'documents', name: 'Documents', createdAt: now - 8 * day },
];

export const INITIAL_NOTES: NoteDocument[] = [
  {
    id: 'note-portainer-overview',
    title: 'Portainer Overview',
    folderId: 'documents',
    starred: true,
    createdAt: now - 3 * day,
    updatedAt: now - 18 * 60 * 1000,
    content: `## What is Portainer.io?

**Portainer** is a web-based container management platform that allows you to manage Docker, Docker Compose, Kubernetes, and other container environments through a graphical user interface (GUI), instead of relying entirely on terminal commands.

In simple terms:

**Portainer is a dashboard for managing Docker containers.**

You can use it to deploy applications, start or stop containers, view logs, manage images, configure networks, and manage storage volumes.

### Core Capabilities

| Capability | Terminal Equivalent | Operational Benefit |
| :--- | :--- | :--- |
| Stack Deployment | \`docker compose up -d\` | Versioned compose files with instant env overrides |
| Live Container Logs | \`docker logs -f --tail 200\` | Searchable stdout/stderr streams in browser |
| Volume & Network Audit | \`docker volume ls\` / \`prune\` | Visual orphan detection before reclaiming disk |
| Registry & Image Pulls | \`docker pull\` / \`system df\` | Controlled image updates and tag pinning |

### Quick Deployment Snippet

Deploy Portainer CE with persistent state on the host Docker socket:

\`\`\`bash
docker volume create portainer_data

docker run -d \\
  -p 8000:8000 \\
  -p 9443:9443 \\
  --name portainer \\
  --restart=always \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v portainer_data:/data \\
  portainer/portainer-ce:lts
\`\`\`

> Note: Port \`9443\` exposes the HTTPS UI and API with a self-signed certificate by default. Put it behind a reverse proxy with TLS termination before exposing to a shared network.

### Pre-Flight Production Checklist

- [x] Pin \`portainer/portainer-ce:lts\` rather than \`latest\`
- [x] Mount \`portainer_data\` to a backed-up host volume
- [ ] Restrict \`9443\` ingress to VPN or internal Tailscale subnet
- [ ] Configure RBAC team roles and disable anonymous endpoints
`,
  },
  {
    id: 'note-git-changes',
    title: 'Check Git Changes Before Pull',
    folderId: 'documents',
    starred: false,
    createdAt: now - 4 * day,
    updatedAt: now - 3 * hour,
    content: `## Safe Pre-Pull Inspection Workflow

Before running \`git pull\`, inspect upstream commits and local working-tree modifications so merges never surprise you mid-branch.

### 1. Fetch Remote Metadata Without Modifying Files

\`\`\`bash
git fetch origin --prune
git status -sb
\`\`\`

### 2. Inspect Incoming Commits & Diff Stats

Compare your current \`HEAD\` against the tracked upstream branch:

\`\`\`bash
# Summary of commits you are about to pull
git log HEAD..@{u} --oneline --decorate

# File-level diff stat for incoming changes
git diff HEAD..@{u} --stat
\`\`\`

### 3. Stash Local Work Safely (Including Untracked Files)

If you have in-progress edits on the same files:

\`\`\`bash
git stash push -u -m "wip: before pulling main"
git pull --rebase origin main
git stash pop
\`\`\`

### Quick Verification Checklist

- [x] Verify active branch with \`git branch --show-current\`
- [ ] Confirm no untracked build artifacts pollute the working tree
- [ ] Run \`git diff --check\` to catch stray whitespace or conflict markers
`,
  },
  {
    id: 'note-testing-message',
    title: 'Correct Testing Message',
    folderId: 'documents',
    starred: false,
    createdAt: now - 5 * day,
    updatedAt: now - 1 * day,
    content: `## Engineering Verification & PR Test Summary

Use this structured snippet at the end of pull requests and release notes so reviewers can verify exact test coverage at a glance.

### Standard Verification Block

\`\`\`markdown
## Verification

### Automated Checks
- [x] Unit suite: \`npm test -- --run\` (48 passed, 0 skipped)
- [x] Typecheck & lint: \`npm run lint\` (0 errors)
- [x] Production bundle: \`npm run build\`

### Manual Scenarios Tested
1. Verified empty-state rendering when workspace storage is cleared.
2. Tested Markdown table & fenced code block copy behavior in Read mode.
3. Confirmed keyboard navigation (\`Cmd+K\`) across folders and snippets.
\`\`\`

### Commit Message Convention

Keep commit headers imperative, under 72 characters, and scoped to the subsystem:

\`\`\`text
fix(editor): preserve cursor offset when inserting markdown snippet

Previously, inserting a multi-line code snippet reset scroll position
to the bottom of the textarea. Now selectionStart and scrollTop are
restored immediately after state update.
\`\`\`
`,
  },
  {
    id: 'note-npm-workspaces',
    title: 'npm Workspaces & Clean Lockfiles',
    folderId: 'npm',
    starred: true,
    createdAt: now - 7 * day,
    updatedAt: now - 2 * day,
    content: `## Monorepo Package Management with npm

Keep shared UI and utility packages deterministic across CI and local machines using native npm workspaces.

### Root \`package.json\` Structure

\`\`\`json
{
  "name": "platform-monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm test --workspaces --if-present"
  }
}
\`\`\`

### Essential Workspace Commands

\`\`\`bash
# Install a dependency into a specific workspace
npm install zod --workspace=packages/core

# Run CI-safe deterministic install from package-lock.json
npm ci --prefer-offline

# Audit production dependencies only
npm audit --omit=dev
\`\`\`

> Always commit \`package-lock.json\` with LF line endings and avoid mixing \`npm install\` with \`yarn\` or \`pnpm\` inside the same workspace tree.
`,
  },
  {
    id: 'note-python-uv',
    title: 'Python Virtualenv & uv Reference',
    folderId: 'python',
    starred: false,
    createdAt: now - 8 * day,
    updatedAt: now - 4 * day,
    content: `## Fast Python Environments with uv

\`uv\` replaces \`pip\`, \`venv\`, and \`pip-tools\` with a single fast binary while remaining compatible with \`pyproject.toml\`.

### Bootstrap a Project

\`\`\`bash
uv venv .venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
\`\`\`

### Minimal \`pyproject.toml\`

\`\`\`toml
[project]
name = "service-worker"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115.0",
  "pydantic>=2.9.0",
]

[tool.ruff]
line-length = 100
target-version = "py312"
\`\`\`
`,
  },
  {
    id: 'note-php-strict',
    title: 'PHP Strict Types & Composer Autoload',
    folderId: 'php',
    starred: false,
    createdAt: now - 10 * day,
    updatedAt: now - 6 * day,
    content: `## Modern PHP 8.3 Service Baseline

Enforce strict scalar types and readonly DTOs across domain boundaries.

### Readonly DTO Pattern

\`\`\`php
<?php

declare(strict_types=1);

namespace App\\Domain\\Notes;

final readonly class NoteSummary
{
    public function __construct(
        public string $id,
        public string $title,
        public int $wordCount,
    ) {}
}
\`\`\`

### Dump Optimized Autoloader for Production

\`\`\`bash
composer install --no-dev --optimize-autoloader --classmap-authoritative
\`\`\`
`,
  },
];

export const INITIAL_SNIPPETS: Snippet[] = [
  {
    id: 'snip-git-diff',
    title: 'Git Pre-Pull Diff Check',
    description: 'Fetch remote origin and inspect incoming commits before merging or rebasing.',
    category: 'Git & CLI',
    language: 'bash',
    createdAt: now - 6 * day,
    updatedAt: now - 2 * day,
    content: `\`\`\`bash
git fetch origin --prune
git log HEAD..@{u} --oneline --decorate
git diff HEAD..@{u} --stat
\`\`\``,
  },
  {
    id: 'snip-docker-health',
    title: 'Docker Compose Healthcheck',
    description: 'Reliable HTTP healthcheck block with start period and retry bounds.',
    category: 'Docker & Infra',
    language: 'yaml',
    createdAt: now - 5 * day,
    updatedAt: now - 1 * day,
    content: `\`\`\`yaml
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://localhost:3000/health"]
  interval: 15s
  timeout: 3s
  retries: 3
  start_period: 10s
\`\`\``,
  },
  {
    id: 'snip-ts-abort-fetch',
    title: 'TypeScript Fetch with Timeout',
    description: 'Typed JSON fetch wrapper using AbortSignal.timeout for clean cancellation.',
    category: 'Node & npm',
    language: 'typescript',
    createdAt: now - 4 * day,
    updatedAt: now - 12 * hour,
    content: `\`\`\`typescript
export async function fetchJson<T>(url: string, timeoutMs = 5000): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(\`Request failed (\${response.status}): \${response.statusText}\`);
  }
  return response.json() as Promise<T>;
}
\`\`\``,
  },
  {
    id: 'snip-adr-template',
    title: 'Architecture Decision Record (ADR)',
    description: 'Lightweight Markdown structure for capturing technical decisions and trade-offs.',
    category: 'Documentation',
    language: 'markdown',
    createdAt: now - 7 * day,
    updatedAt: now - 3 * day,
    content: `## ADR: Decision Title

**Context:** Describe the technical constraint or architectural problem being solved.

**Decision:** State the chosen approach clearly and concisely.

### Trade-offs & Consequences
- **Positive:** Faster iteration and simpler deployment topology.
- **Negative:** Requires migration script if moving to multi-region later.

### Verification
- [ ] Benchmark latency under expected peak load
- [ ] Document rollback procedure`,
  },
  {
    id: 'snip-nginx-proxy',
    title: 'Nginx Reverse Proxy Block',
    description: 'HTTPS reverse proxy snippet with WebSocket upgrade and real-IP forwarding.',
    category: 'Docker & Infra',
    language: 'nginx',
    createdAt: now - 9 * day,
    updatedAt: now - 4 * day,
    content: `\`\`\`nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
\`\`\``,
  },
  {
    id: 'snip-sql-explain',
    title: 'PostgreSQL Query Plan Check',
    description: 'Analyze actual execution buffers and timing without mutating rows.',
    category: 'Database',
    language: 'sql',
    createdAt: now - 8 * day,
    updatedAt: now - 5 * day,
    content: `\`\`\`sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, title, updated_at
FROM notes
WHERE folder_id = 'documents'
ORDER BY updated_at DESC
LIMIT 25;
\`\`\``,
  },
  {
    id: 'snip-python-fastapi',
    title: 'FastAPI Lifespan Context',
    description: 'Modern async lifespan hook for initializing and tearing down connection pools.',
    category: 'Python',
    language: 'python',
    createdAt: now - 11 * day,
    updatedAt: now - 6 * day,
    content: `\`\`\`python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize pool or cache
    yield
    # Shutdown: close connections cleanly

app = FastAPI(lifespan=lifespan)
\`\`\``,
  },
];
