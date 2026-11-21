import type {
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeSourceType,
  RetrievedKnowledgeItem,
} from '../src/types/knowledge.ts';

export type { KnowledgeCategory, KnowledgeEntry, KnowledgeSourceType, RetrievedKnowledgeItem };

const VALID_CATEGORIES = new Set<KnowledgeCategory>([
  'project_structure',
  'database_structure',
  'business_logic',
  'development_rules',
  'development_history',
]);

const VALID_SOURCES = new Set<KnowledgeSourceType>([
  'manual',
  'ssh-scan',
  'note-import',
  'template',
  'git-history',
]);

const ERP_DOMAIN_EXPANSIONS: Array<{ triggers: string[]; expand: string[] }> = [
  {
    triggers: ['vehicle', 'visit', 'service', 'workshop', 'garage', 'car', 'repair', 'maintenance', 'inspection'],
    expand: [
      'vehicle.visit',
      'vehicle_visit',
      'fleet.vehicle',
      'fleet',
      'res.partner',
      'customer',
      'sale.order',
      'stock.picking',
      'stock.move',
      'account.move',
      'maqsu_vehicle',
      'vehicle_service',
    ],
  },
  {
    triggers: ['sale', 'sales', 'quotation', 'order', 'so', 'customer', 'invoice'],
    expand: ['sale.order', 'sale.order.line', 'res.partner', 'account.move', 'stock.picking', 'crm'],
  },
  {
    triggers: ['purchase', 'vendor', 'supplier', 'po', 'rfq', 'procurement'],
    expand: ['purchase.order', 'purchase.order.line', 'res.partner', 'stock.picking', 'account.move'],
  },
  {
    triggers: ['inventory', 'stock', 'warehouse', 'picking', 'delivery', 'transfer', 'spare', 'part', 'parts', 'product'],
    expand: [
      'stock.picking',
      'stock.move',
      'stock.move.line',
      'stock.quant',
      'stock.warehouse',
      'stock.location',
      'product.template',
      'product.product',
    ],
  },
  {
    triggers: ['accounting', 'account', 'journal', 'ledger', 'payment', 'invoice', 'bill', 'tax'],
    expand: ['account.move', 'account.move.line', 'account.journal', 'account.payment', 'account.tax'],
  },
  {
    triggers: ['field', 'column', 'model', 'inherit', 'table', 'postgres', 'sql', 'database', 'relation', 'many2one', 'one2many'],
    expand: ['_name', '_inherit', 'ir.model.access', 'ir.rule', 'postgresql', 'fields.', 'views', 'security'],
  },
  {
    triggers: ['xml', 'view', 'form', 'tree', 'list', 'kanban', 'search', 'menu', 'action', 'xpath', 'qweb'],
    expand: ['ir.ui.view', 'inherit_id', 'xpath', 'ir.actions.act_window', 'ir.ui.menu'],
  },
  {
    triggers: ['security', 'acl', 'permission', 'access', 'rule', 'group', 'rights'],
    expand: ['ir.model.access.csv', 'ir.rule', 'res.groups', 'perm_read', 'perm_write', 'perm_create', 'perm_unlink'],
  },
  {
    triggers: ['deploy', 'git', 'gitlab', 'branch', 'upgrade', 'module', 'manifest', 'addon', 'config', 'odoo.conf'],
    expand: ['__manifest__.py', 'depends', 'addons_path', 'odoo.conf', 'gitlab', 'migration'],
  },
];

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'have',
  'will',
  'should',
  'could',
  'would',
  'about',
  'need',
  'want',
  'make',
  'what',
  'when',
  'where',
  'how',
  'existing',
  'system',
  'feature',
  'new',
  'add',
  'update',
  'edit',
  'code',
  'file',
]);

export function sanitizeKnowledgeCategory(value: unknown): KnowledgeCategory {
  if (typeof value === 'string' && VALID_CATEGORIES.has(value as KnowledgeCategory)) {
    return value as KnowledgeCategory;
  }
  return 'business_logic';
}

export function sanitizeStringList(value: unknown, maxItems = 40, maxLen = 200): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, maxLen);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function sanitizeKnowledgeEntry(raw: unknown): KnowledgeEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim().slice(0, 120) : '';
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 200) : '';
  const content = typeof obj.content === 'string' ? obj.content.trim().slice(0, 48000) : '';
  if (!id || !title || !content) return null;

  const sourceType =
    typeof obj.sourceType === 'string' && VALID_SOURCES.has(obj.sourceType as KnowledgeSourceType)
      ? (obj.sourceType as KnowledgeSourceType)
      : 'manual';

  const now = Date.now();
  return {
    id,
    systemName:
      typeof obj.systemName === 'string' && obj.systemName.trim()
        ? obj.systemName.trim().slice(0, 80)
        : 'MAQSU ERP',
    category: sanitizeKnowledgeCategory(obj.category),
    title,
    summary:
      typeof obj.summary === 'string' && obj.summary.trim()
        ? obj.summary.trim().slice(0, 400)
        : content.replace(/\s+/g, ' ').slice(0, 180),
    content,
    tags: sanitizeStringList(obj.tags, 40, 80),
    moduleName:
      typeof obj.moduleName === 'string' && obj.moduleName.trim()
        ? obj.moduleName.trim().slice(0, 120)
        : undefined,
    models: sanitizeStringList(obj.models, 30, 100),
    filePaths: sanitizeStringList(obj.filePaths, 30, 260),
    sourceType,
    workspaceRoot:
      typeof obj.workspaceRoot === 'string' && obj.workspaceRoot.trim()
        ? obj.workspaceRoot.trim().slice(0, 300)
        : undefined,
    enabled: obj.enabled !== false,
    createdAt: Number.isFinite(Number(obj.createdAt)) ? Number(obj.createdAt) : now,
    updatedAt: Number.isFinite(Number(obj.updatedAt)) ? Number(obj.updatedAt) : now,
  };
}

function tokenizeText(text: string): string[] {
  const lower = text.toLowerCase();
  // Preserve dotted/underscored model identifiers like vehicle.visit or vehicle_visit, plus individual words
  const dotted = lower.match(/[a-z0-9]+(?:[._-][a-z0-9]+)+/g) ?? [];
  const words = lower.match(/[a-z0-9]{2,}/g) ?? [];
  const all = [...dotted, ...words];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const tok of all) {
    if (STOP_WORDS.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    unique.push(tok);
    // Normalize dots <-> underscores for Odoo model/table equivalence
    if (tok.includes('.')) {
      const alt = tok.replace(/\./g, '_');
      if (!seen.has(alt)) {
        seen.add(alt);
        unique.push(alt);
      }
    } else if (tok.includes('_')) {
      const alt = tok.replace(/_/g, '.');
      if (!seen.has(alt)) {
        seen.add(alt);
        unique.push(alt);
      }
    }
  }
  return unique;
}

export function retrieveRelevantKnowledge(
  entries: KnowledgeEntry[],
  params: {
    query: string;
    activeFilePath?: string;
    activeFileContent?: string;
    relatedFilePaths?: string[];
    workspaceRoot?: string;
    maxItems?: number;
    maxTotalChars?: number;
  }
): {
  retrieved: RetrievedKnowledgeItem[];
  catalogSummary: string;
  expandedTerms: string[];
} {
  const activeEntries = entries.filter((e) => e.enabled);
  if (activeEntries.length === 0) {
    return { retrieved: [], catalogSummary: '', expandedTerms: [] };
  }

  const maxItems = params.maxItems ?? 5;
  const maxTotalChars = params.maxTotalChars ?? 9000;

  const combinedQueryText = [
    params.query || '',
    params.activeFilePath || '',
    ...(params.relatedFilePaths || []),
    // Include only top 1500 chars of active file for model/module signal detection
    (params.activeFileContent || '').slice(0, 1500),
  ].join('\n');

  const baseTokens = tokenizeText(combinedQueryText);
  const queryLower = combinedQueryText.toLowerCase();

  // Domain graph expansion for ERP / Odoo queries
  const expandedSet = new Set<string>();
  for (const rule of ERP_DOMAIN_EXPANSIONS) {
    if (rule.triggers.some((t) => queryLower.includes(t) || baseTokens.includes(t))) {
      for (const exp of rule.expand) {
        expandedSet.add(exp.toLowerCase());
      }
    }
  }

  // Detect whether query is asking for implementation/code modification vs pure explanation
  const isCodeImplementationTask =
    /\b(add|create|implement|fix|modify|update|refactor|field|view|model|migration|rule|inherit|xml|python|module|bug|permission|access|integration)\b/i.test(
      params.query || ''
    );

  const scored: Array<{
    entry: KnowledgeEntry;
    score: number;
    reasons: string[];
  }> = [];

  for (const entry of activeEntries) {
    let score = 0;
    const reasons = new Set<string>();

    const titleLower = entry.title.toLowerCase();
    const summaryLower = entry.summary.toLowerCase();
    const contentLower = entry.content.toLowerCase();
    const moduleLower = (entry.moduleName || '').toLowerCase();
    const tagsLower = entry.tags.map((t) => t.toLowerCase());
    const modelsLower = (entry.models || []).map((m) => m.toLowerCase());
    const filesLower = (entry.filePaths || []).map((f) => f.toLowerCase());

    // 1. Exact workspace root affinity
    if (
      params.workspaceRoot &&
      entry.workspaceRoot &&
      params.workspaceRoot.trim().replace(/\/+$/, '') ===
        entry.workspaceRoot.trim().replace(/\/+$/, '')
    ) {
      score += 4;
    }

    // 2. Active file or related file direct path/module overlap
    const allContextPaths = [params.activeFilePath, ...(params.relatedFilePaths || [])]
      .filter((p): p is string => Boolean(p))
      .map((p) => p.toLowerCase());

    for (const ctxPath of allContextPaths) {
      if (moduleLower && ctxPath.includes(moduleLower)) {
        score += 18;
        reasons.add(`active module: ${entry.moduleName}`);
      }
      if (filesLower.some((fp) => ctxPath.endsWith(fp) || fp.endsWith(ctxPath))) {
        score += 24;
        reasons.add('matches active file');
      }
    }

    // 3. Model name matching (very high weight for ERP)
    for (const model of modelsLower) {
      const underscoreModel = model.replace(/\./g, '_');
      if (queryLower.includes(model) || queryLower.includes(underscoreModel)) {
        score += 28;
        reasons.add(`model: ${model}`);
      } else if (expandedSet.has(model) || expandedSet.has(underscoreModel)) {
        score += 14;
        reasons.add(`related model: ${model}`);
      }
    }

    // 4. Module name matching
    if (moduleLower && (queryLower.includes(moduleLower) || expandedSet.has(moduleLower))) {
      score += 20;
      reasons.add(`module: ${entry.moduleName}`);
    }

    // 5. Base token scoring across title, tags, summary, content
    for (const tok of baseTokens) {
      if (tok.length < 2) continue;
      if (tagsLower.some((t) => t === tok || t.includes(tok))) {
        score += 11;
        reasons.add(`tag: ${tok}`);
      }
      if (titleLower.includes(tok)) {
        score += 10;
        reasons.add(`title: ${tok}`);
      }
      if (summaryLower.includes(tok)) {
        score += 5;
      }
      if (contentLower.includes(tok)) {
        score += 3;
      }
    }

    // 6. Expanded ERP domain concept scoring
    for (const exp of expandedSet) {
      if (tagsLower.includes(exp)) {
        score += 8;
        reasons.add(`domain: ${exp}`);
      } else if (titleLower.includes(exp)) {
        score += 7;
        reasons.add(`domain: ${exp}`);
      } else if (contentLower.includes(exp)) {
        score += 3;
      }
    }

    // 7. Development rules baseline boost for implementation requests
    if (isCodeImplementationTask && entry.category === 'development_rules') {
      score += 10;
      if (reasons.size === 0) reasons.add('coding & architecture rules');
    }

    // Slight recency / manual curation preference so human-trained docs stay prominent
    if (entry.sourceType === 'manual' || entry.sourceType === 'note-import') {
      score += 2;
    }

    if (score > 0) {
      scored.push({
        entry,
        score,
        reasons: Array.from(reasons).slice(0, 4),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);

  // Pick top items while enforcing category coverage (so Rules/DB/History aren't crowded out by 8 files from 1 category)
  const selected: typeof scored = [];
  const selectedIds = new Set<string>();
  let totalChars = 0;

  const tryAdd = (item: (typeof scored)[number], perDocLimit: number) => {
    if (selectedIds.has(item.entry.id) || selected.length >= maxItems) return false;
    const clippedLen = Math.min(item.entry.content.length, perDocLimit);
    if (totalChars + clippedLen > maxTotalChars && selected.length >= 2) return false;
    selected.push(item);
    selectedIds.add(item.entry.id);
    totalChars += clippedLen;
    return true;
  };

  // First pass: guarantee top hit from each relevant pillar that scored >= 8 (and always include top dev rule for implementation tasks)
  const categoryOrder: KnowledgeCategory[] = [
    'business_logic',
    'database_structure',
    'development_rules',
    'project_structure',
    'development_history',
  ];
  for (const cat of categoryOrder) {
    const bestInCat = scored.find(
      (item) => item.entry.category === cat && (item.score >= 8 || (isCodeImplementationTask && cat === 'development_rules'))
    );
    if (bestInCat) {
      tryAdd(bestInCat, 3400);
    }
  }

  // Second pass: fill remaining slots by highest overall score
  for (const item of scored) {
    if (selected.length >= maxItems) break;
    tryAdd(item, 3200);
  }

  // Sort final selection by relevance score descending
  selected.sort((a, b) => b.score - a.score);

  const retrieved: RetrievedKnowledgeItem[] = selected.map(({ entry, score, reasons }) => ({
    id: entry.id,
    category: entry.category,
    title: entry.title,
    summary: entry.summary,
    content: entry.content.slice(0, 3400),
    moduleName: entry.moduleName,
    models: entry.models,
    filePaths: entry.filePaths,
    score,
    reasons: reasons.length > 0 ? reasons : [entry.category.replace('_', ' ')],
  }));

  const catalogLines = activeEntries.slice(0, 80).map((e) => {
    const meta = [
      e.category,
      e.moduleName ? `module:${e.moduleName}` : '',
      e.models && e.models.length > 0 ? `models:${e.models.slice(0, 4).join(',')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    return `- [${meta}] ${e.title}`;
  });

  return {
    retrieved,
    catalogSummary: catalogLines.join('\n'),
    expandedTerms: Array.from(expandedSet).slice(0, 20),
  };
}
