import {
  ErpScannedAccessRule,
  ErpScannedModelInfo,
  ErpScannedModuleInfo,
  ErpScannedViewInfo,
  ErpWorkspaceScanResult,
  KnowledgeCategory,
  KnowledgeEntry,
  RetrievedKnowledgeItem,
} from '../types/knowledge';
import type { NoteDocument } from '../types/notes';
import { getUserStorageKeys, StorageBackendMode } from './authClient';

export function getKnowledgeStorageKey(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `notecraft.u.${safeId}.knowledge.v1`;
}

function readLocalKnowledge(userId: string): KnowledgeEntry[] {
  try {
    const raw = window.localStorage.getItem(getKnowledgeStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is KnowledgeEntry =>
          Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string')
      )
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  } catch {
    return [];
  }
}

function writeLocalKnowledge(userId: string, entries: KnowledgeEntry[]): void {
  try {
    window.localStorage.setItem(getKnowledgeStorageKey(userId), JSON.stringify(entries));
  } catch {
    // Ignore quota errors
  }
}

export async function fetchKnowledgeEntries(
  storageMode: StorageBackendMode,
  userId: string
): Promise<KnowledgeEntry[]> {
  if (storageMode === 'postgres') {
    const res = await fetch('/api/knowledge', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error || 'Failed to load AI knowledge base.');
    }
    const data = (await res.json()) as { entries?: KnowledgeEntry[] };
    return Array.isArray(data.entries) ? data.entries : [];
  }
  return readLocalKnowledge(userId);
}

export async function saveKnowledgeEntry(
  storageMode: StorageBackendMode,
  userId: string,
  entry: KnowledgeEntry
): Promise<KnowledgeEntry> {
  const now = Date.now();
  const normalized: KnowledgeEntry = {
    ...entry,
    id: entry.id || `kb-${now}-${Math.random().toString(36).slice(2, 7)}`,
    systemName: entry.systemName.trim() || 'MAQSU ERP',
    title: entry.title.trim(),
    summary: entry.summary.trim(),
    content: entry.content.trim(),
    tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
    models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    filePaths: Array.isArray(entry.filePaths) ? entry.filePaths.filter(Boolean) : [],
    createdAt: Number(entry.createdAt || now),
    updatedAt: now,
  };

  if (storageMode === 'postgres') {
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    });
    const data = (await res.json().catch(() => null)) as
      | { entry?: KnowledgeEntry; error?: string }
      | null;
    if (!res.ok || !data?.entry) {
      throw new Error(data?.error || 'Failed to save knowledge entry.');
    }
    return data.entry;
  }

  const existing = readLocalKnowledge(userId);
  const idx = existing.findIndex((item) => item.id === normalized.id);
  const next =
    idx >= 0
      ? existing.map((item) => (item.id === normalized.id ? normalized : item))
      : [normalized, ...existing];
  writeLocalKnowledge(userId, next);
  return normalized;
}

export async function saveKnowledgeEntriesBatch(
  storageMode: StorageBackendMode,
  userId: string,
  entries: KnowledgeEntry[]
): Promise<KnowledgeEntry[]> {
  if (entries.length === 0) return [];
  const now = Date.now();
  const normalizedList = entries.map((entry, idx) => ({
    ...entry,
    id: entry.id || `kb-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    systemName: entry.systemName.trim() || 'MAQSU ERP',
    title: entry.title.trim(),
    summary: entry.summary.trim(),
    content: entry.content.trim(),
    tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
    models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    filePaths: Array.isArray(entry.filePaths) ? entry.filePaths.filter(Boolean) : [],
    createdAt: Number(entry.createdAt || now),
    updatedAt: now,
  }));

  if (storageMode === 'postgres') {
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: normalizedList }),
    });
    const data = (await res.json().catch(() => null)) as
      | { entries?: KnowledgeEntry[]; error?: string }
      | null;
    if (!res.ok || !Array.isArray(data?.entries)) {
      throw new Error(data?.error || 'Failed to save knowledge entries.');
    }
    return data.entries;
  }

  const existing = readLocalKnowledge(userId);
  const map = new Map<string, KnowledgeEntry>(existing.map((e) => [e.id, e]));
  for (const item of normalizedList) {
    map.set(item.id, item);
  }
  const merged = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  writeLocalKnowledge(userId, merged);
  return normalizedList;
}

export async function deleteKnowledgeEntry(
  storageMode: StorageBackendMode,
  userId: string,
  id: string
): Promise<void> {
  if (storageMode === 'postgres') {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error || 'Failed to delete knowledge entry.');
    }
    return;
  }

  const existing = readLocalKnowledge(userId);
  writeLocalKnowledge(
    userId,
    existing.filter((e) => e.id !== id)
  );
}

export async function testKnowledgeRetrieval(
  query: string,
  entries: KnowledgeEntry[],
  workspaceRoot?: string
): Promise<{ retrieved: RetrievedKnowledgeItem[]; catalogSummary: string }> {
  const res = await fetch('/api/knowledge/retrieve', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      workspaceRoot,
      knowledgeEntries: entries,
    }),
  });

  const data = (await res.json().catch(() => null)) as
    | { retrieved?: RetrievedKnowledgeItem[]; catalogSummary?: string; error?: string }
    | null;
  if (!res.ok || !data || !Array.isArray(data.retrieved)) {
    throw new Error(data?.error || 'Failed to test knowledge retrieval.');
  }
  return {
    retrieved: data.retrieved,
    catalogSummary: typeof data.catalogSummary === 'string' ? data.catalogSummary : '',
  };
}

export async function loadNotesForKnowledgeImport(
  storageMode: StorageBackendMode,
  userId: string
): Promise<NoteDocument[]> {
  if (storageMode === 'postgres') {
    const res = await fetch('/api/workspace', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      throw new Error('Failed to load workspace notes.');
    }
    const data = (await res.json()) as { notes?: NoteDocument[] };
    return Array.isArray(data.notes) ? data.notes : [];
  }

  try {
    const raw = window.localStorage.getItem(getUserStorageKeys(userId).notes);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NoteDocument[]) : [];
  } catch {
    return [];
  }
}

function stableSlug(raw: string): string {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function safeModSlug(mod: string): string {
  return mod.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'module';
}

function dedupeStrings(items: Array<string | undefined | null>, max = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const clean = (item || '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Converts a live SSH ERP workspace AST/XML/CSV/Git scan into structured
 * KnowledgeEntry documents across Structure, Database, Business Logic, and History.
 */
export function buildKnowledgeEntriesFromErpScan(
  scan: ErpWorkspaceScanResult
): KnowledgeEntry[] {
  const now = scan.scannedAt || Date.now();
  const rootPath = (scan.rootPath || '/').trim() || '/';
  const rootKey = stableSlug(rootPath);
  const generated: KnowledgeEntry[] = [];

  const modules = Array.isArray(scan.modules) ? scan.modules : [];
  const models = Array.isArray(scan.models) ? scan.models : [];
  const views = Array.isArray(scan.views) ? scan.views : [];
  const accessRules = Array.isArray(scan.accessRules) ? scan.accessRules : [];
  const recordRules = Array.isArray(scan.recordRules) ? scan.recordRules : [];
  const configFiles = Array.isArray(scan.configFiles) ? scan.configFiles : [];

  // Index by module name
  const modelsByMod = new Map<string, ErpScannedModelInfo[]>();
  for (const m of models) {
    const list = modelsByMod.get(m.module) ?? [];
    list.push(m);
    modelsByMod.set(m.module, list);
  }
  const viewsByMod = new Map<string, ErpScannedViewInfo[]>();
  for (const v of views) {
    const list = viewsByMod.get(v.module) ?? [];
    list.push(v);
    viewsByMod.set(v.module, list);
  }
  const accessByMod = new Map<string, ErpScannedAccessRule[]>();
  for (const a of accessRules) {
    const list = accessByMod.get(a.module) ?? [];
    list.push(a);
    accessByMod.set(a.module, list);
  }
  const rulesByMod = new Map<
    string,
    Array<{ module: string; filePath: string; xmlId: string; model: string; domainForce: string }>
  >();
  for (const r of recordRules) {
    const list = rulesByMod.get(r.module) ?? [];
    list.push(r);
    rulesByMod.set(r.module, list);
  }

  // 1. Project Structure Overview
  const overviewLines: string[] = [
    `## Workspace Root: \`${rootPath}\``,
    scan.gitRemote ? `- Git Remote: \`${scan.gitRemote}\`` : '',
    scan.gitBranch ? `- Active Branch: \`${scan.gitBranch}\`` : '',
    `- Detected Modules (${modules.length}): ${modules.map((m) => `\`${m.name}\``).join(', ') || 'none'}`,
    '',
  ].filter(Boolean);

  if (configFiles.length > 0) {
    overviewLines.push('### Configuration Files');
    for (const cfg of configFiles.slice(0, 6)) {
      overviewLines.push(`#### \`${cfg.path}\`\n\`\`\`ini\n${cfg.snippet.trim()}\n\`\`\``);
    }
  }

  if (modules.length > 0) {
    overviewLines.push('### Custom Module Dependency Overview');
    for (const mod of modules.slice(0, 40)) {
      overviewLines.push(
        `- **${mod.name}** (${mod.displayName}) — path: \`${mod.path}\` | depends: ${
          mod.depends.join(', ') || 'base'
        } | files: ${mod.pyFilesCount} py, ${mod.xmlFilesCount} xml, ${mod.jsFilesCount} js`
      );
    }
  }

  generated.push({
    id: `scan-${rootKey}-project-overview`,
    systemName: 'MAQSU ERP',
    category: 'project_structure',
    title: `Workspace & Addons Architecture (${rootPath.split('/').filter(Boolean).pop() || rootPath})`,
    summary: `Scanned ${modules.length} modules, ${models.length} models, ${views.length} XML views at ${rootPath}.`,
    content: overviewLines.join('\n'),
    tags: dedupeStrings(['erp', 'addons', 'structure', scan.gitBranch, ...modules.slice(0, 12).map((m) => m.name)]),
    models: dedupeStrings(models.slice(0, 20).map((m) => m.modelName)),
    filePaths: dedupeStrings([
      ...configFiles.map((c) => c.path),
      ...modules.slice(0, 20).map((m) => `${m.path}/__manifest__.py`),
    ]),
    sourceType: 'ssh-scan',
    workspaceRoot: rootPath,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  // 2. Per-module entries (Structure + Database + Business Logic)
  const formatModuleChunk = (mod: ErpScannedModuleInfo) => {
    const modModels = modelsByMod.get(mod.name) ?? [];
    const modViews = viewsByMod.get(mod.name) ?? [];
    const modAcl = accessByMod.get(mod.name) ?? [];
    const modRules = rulesByMod.get(mod.name) ?? [];

    const allModModels = dedupeStrings(
      modModels.flatMap((m) => [m.modelName, ...m.inheritModels]),
      30
    );
    const allModPaths = dedupeStrings(
      [
        `${mod.path}/__manifest__.py`,
        ...modModels.map((m) => m.filePath),
        ...modViews.map((v) => v.filePath),
        ...modAcl.map((a) => a.filePath),
        ...modRules.map((r) => r.filePath),
      ],
      35
    );

    // 2a. Module Structure
    const structContent = [
      `## Module \`${mod.name}\` (${mod.displayName})`,
      `- Path: \`${mod.path}\``,
      mod.version ? `- Version: \`${mod.version}\`` : '',
      `- Depends: ${mod.depends.map((d) => `\`${d}\``).join(', ') || '`base`'}`,
      mod.summary ? `- Summary: ${mod.summary}` : '',
      `- Assets Count: ${mod.pyFilesCount} Python, ${mod.xmlFilesCount} XML, ${mod.jsFilesCount} JS`,
      '',
      mod.dataFiles.length > 0
        ? `### Manifest Data Files\n${mod.dataFiles.map((df) => `- \`${df}\``).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    generated.push({
      id: `scan-${rootKey}-struct-${safeModSlug(mod.name)}`,
      systemName: 'MAQSU ERP',
      category: 'project_structure',
      title: `Module ${mod.name} — Structure & Dependencies`,
      summary: `${mod.displayName}: depends on [${mod.depends.join(', ') || 'base'}], ${mod.dataFiles.length} manifest data files.`,
      content: structContent,
      tags: dedupeStrings([mod.name, ...mod.depends, 'manifest', 'module']),
      moduleName: mod.name,
      models: allModModels,
      filePaths: allModPaths,
      sourceType: 'ssh-scan',
      workspaceRoot: rootPath,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    // 2b. Module Database Schema & Security
    if (modModels.length > 0 || modAcl.length > 0 || modRules.length > 0) {
      const dbLines: string[] = [`## Database Schema & Security for \`${mod.name}\``];

      for (const model of modModels) {
        const pgTable = model.modelName.replace(/\./g, '_');
        const inheritLabel =
          model.inheritModels.length > 0
            ? ` (inherits: ${model.inheritModels.join(', ')})`
            : '';
        dbLines.push(
          `\n### Model \`${model.modelName}\`${inheritLabel} — Table \`${pgTable}\``,
          `- Class \`${model.className}\` in \`${model.filePath}\`${
            model.description ? ` — ${model.description}` : ''
          }`
        );
        if (model.fields.length > 0) {
          dbLines.push('| Field | Type | Relation / Label |', '| --- | --- | --- |');
          for (const f of model.fields) {
            const relOrLabel = f.comodel
              ? `-> ${f.comodel}${f.stringLabel ? ` (${f.stringLabel})` : ''}`
              : f.stringLabel || '';
            dbLines.push(`| \`${f.name}\` | \`${f.fieldType}\` | ${relOrLabel} |`);
          }
        }
      }

      if (modAcl.length > 0) {
        dbLines.push('\n### Access Control Rights (`ir.model.access.csv`)');
        dbLines.push('| ID | Model | Group | Perms (r/w/c/u) |', '| --- | --- | --- | --- |');
        for (const acl of modAcl.slice(0, 40)) {
          dbLines.push(
            `| \`${acl.id}\` | \`${acl.modelId}\` | \`${acl.groupId || 'all'}\` | \`${acl.perms}\` |`
          );
        }
      }

      if (modRules.length > 0) {
        dbLines.push('\n### Record Rules (`ir.rule`)');
        for (const rr of modRules.slice(0, 25)) {
          dbLines.push(
            `- \`${rr.xmlId}\` (${rr.model}) in \`${rr.filePath}\`: \`${rr.domainForce}\``
          );
        }
      }

      generated.push({
        id: `scan-${rootKey}-db-${safeModSlug(mod.name)}`,
        systemName: 'MAQSU ERP',
        category: 'database_structure',
        title: `Module ${mod.name} — Models, Fields & Security`,
        summary: `${modModels.length} ORM models, ${modAcl.length} ACL rows, ${modRules.length} record rules in ${mod.name}.`,
        content: dbLines.join('\n'),
        tags: dedupeStrings([
          mod.name,
          'models',
          'fields',
          'security',
          'ir.model.access',
          ...allModModels,
        ]),
        moduleName: mod.name,
        models: allModModels,
        filePaths: allModPaths,
        sourceType: 'ssh-scan',
        workspaceRoot: rootPath,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 2c. Module Business Logic & XML Views
    const hasMethods = modModels.some((m) => m.methods.length > 0);
    if (hasMethods || modViews.length > 0) {
      const bizLines: string[] = [
        `## Business Methods & XML Views for \`${mod.name}\``,
        `- Cross-module depends: ${mod.depends.join(', ') || 'base'}`,
      ];

      for (const m of modModels) {
        if (m.methods.length === 0) continue;
        bizLines.push(
          `\n### \`${m.modelName}\` Methods (\`${m.filePath}\`)`,
          m.methods.map((fn) => `- \`${fn}()\``).join('\n')
        );
      }

      if (modViews.length > 0) {
        bizLines.push('\n### XML Views (`ir.ui.view`)');
        for (const v of modViews.slice(0, 50)) {
          bizLines.push(
            `- \`${v.xmlId}\` (model: \`${v.model}\`${
              v.inheritId ? `, inherits: \`${v.inheritId}\`` : ''
            }) — \`${v.filePath}\``
          );
        }
      }

      generated.push({
        id: `scan-${rootKey}-biz-${safeModSlug(mod.name)}`,
        systemName: 'MAQSU ERP',
        category: 'business_logic',
        title: `Module ${mod.name} — Business Workflows & XML Views`,
        summary: `${modViews.length} XML views and ${modModels.reduce(
          (acc, m) => acc + m.methods.length,
          0
        )} Python methods in ${mod.name}.`,
        content: bizLines.join('\n'),
        tags: dedupeStrings([mod.name, 'views', 'xml', 'methods', 'workflow', ...allModModels]),
        moduleName: mod.name,
        models: allModModels,
        filePaths: allModPaths,
        sourceType: 'ssh-scan',
        workspaceRoot: rootPath,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  for (const mod of modules) {
    formatModuleChunk(mod);
  }

  // Fallback if repository has Python models/views outside __manifest__.py folders
  const coveredModules = new Set(modules.map((m) => m.name));
  const orphanModels = models.filter((m) => !coveredModules.has(m.module));
  if (orphanModels.length > 0) {
    generated.push({
      id: `scan-${rootKey}-db-orphan-models`,
      systemName: 'MAQSU ERP',
      category: 'database_structure',
      title: `Scanned Python Models (${orphanModels.length})`,
      summary: `ORM models detected outside manifest folders at ${rootPath}.`,
      content: orphanModels
        .slice(0, 40)
        .map(
          (m) =>
            `- **${m.modelName}** (\`${m.className}\` in \`${m.filePath}\`): fields=[${m.fields
              .slice(0, 12)
              .map((f) => `${f.name}:${f.fieldType}`)
              .join(', ')}]`
        )
        .join('\n'),
      tags: dedupeStrings(['models', 'scan', ...orphanModels.map((m) => m.modelName)]),
      models: dedupeStrings(orphanModels.map((m) => m.modelName)),
      filePaths: dedupeStrings(orphanModels.map((m) => m.filePath)),
      sourceType: 'ssh-scan',
      workspaceRoot: rootPath,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 3. Git Development History
  if (scan.gitBranch || scan.gitBranches.length > 0 || scan.recentCommits.length > 0) {
    const histLines: string[] = [
      `## Git Repository History (${rootPath})`,
      scan.gitRemote ? `- Remote: \`${scan.gitRemote}\`` : '',
      scan.gitBranch ? `- Current Branch: \`${scan.gitBranch}\`` : '',
      scan.gitBranches.length > 0
        ? `\n### Branches\n${scan.gitBranches.map((b) => `- \`${b}\``).join('\n')}`
        : '',
      scan.recentCommits.length > 0
        ? `\n### Recent Commits\n${scan.recentCommits
            .map((c) => `- \`${c.hash}\` (${c.date}) **${c.author}**: ${c.subject}`)
            .join('\n')}`
        : '',
    ].filter(Boolean);

    generated.push({
      id: `scan-${rootKey}-git-history`,
      systemName: 'MAQSU ERP',
      category: 'development_history',
      title: `Git Branches & Commit History (${scan.gitBranch || 'repo'})`,
      summary: `Branch ${scan.gitBranch || 'HEAD'} and ${scan.recentCommits.length} recent commits at ${rootPath}.`,
      content: histLines.join('\n'),
      tags: dedupeStrings(['git', 'history', 'commits', 'branches', scan.gitBranch]),
      sourceType: 'git-history',
      workspaceRoot: rootPath,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return generated;
}

export function isErpKnowledgeRelevantToCategory(
  entry: KnowledgeEntry,
  category: KnowledgeCategory | 'all'
): boolean {
  return category === 'all' || entry.category === category;
}
