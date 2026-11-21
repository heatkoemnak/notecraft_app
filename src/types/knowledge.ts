export type KnowledgeCategory =
  | 'project_structure'
  | 'database_structure'
  | 'business_logic'
  | 'development_rules'
  | 'development_history';

export type KnowledgeSourceType =
  | 'manual'
  | 'ssh-scan'
  | 'note-import'
  | 'template'
  | 'git-history';

export interface KnowledgeEntry {
  id: string;
  systemName: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  moduleName?: string;
  models?: string[];
  filePaths?: string[];
  sourceType: KnowledgeSourceType;
  workspaceRoot?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RetrievedKnowledgeItem {
  id: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  content: string;
  moduleName?: string;
  models?: string[];
  filePaths?: string[];
  score: number;
  reasons: string[];
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  snippet: string;
}

export interface ErpScannedModuleInfo {
  name: string;
  path: string;
  displayName: string;
  version: string;
  depends: string[];
  dataFiles: string[];
  summary: string;
  pyFilesCount: number;
  xmlFilesCount: number;
  jsFilesCount: number;
}

export interface ErpScannedModelInfo {
  module: string;
  filePath: string;
  className: string;
  modelName: string;
  inheritModels: string[];
  description: string;
  fields: Array<{ name: string; fieldType: string; comodel?: string; stringLabel?: string }>;
  methods: string[];
}

export interface ErpScannedViewInfo {
  module: string;
  filePath: string;
  xmlId: string;
  model: string;
  inheritId?: string;
  viewType?: string;
}

export interface ErpScannedAccessRule {
  module: string;
  filePath: string;
  id: string;
  name: string;
  modelId: string;
  groupId: string;
  perms: string;
}

export interface ErpWorkspaceScanResult {
  rootPath: string;
  scannedAt: number;
  gitRemote?: string;
  gitBranch?: string;
  gitBranches: string[];
  recentCommits: Array<{ hash: string; date: string; author: string; subject: string }>;
  configFiles: Array<{ path: string; snippet: string }>;
  modules: ErpScannedModuleInfo[];
  models: ErpScannedModelInfo[];
  views: ErpScannedViewInfo[];
  accessRules: ErpScannedAccessRule[];
  recordRules: Array<{ module: string; filePath: string; xmlId: string; model: string; domainForce: string }>;
}

export const KNOWLEDGE_CATEGORY_META: Record<
  KnowledgeCategory,
  {
    label: string;
    shortLabel: string;
    description: string;
    accentClass: string;
  }
> = {
  project_structure: {
    label: 'Project Structure',
    shortLabel: 'Structure',
    description: 'GitLab repos, addons paths, custom modules, depends, Python/XML/JS & config.',
    accentClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  database_structure: {
    label: 'Database Structure',
    shortLabel: 'Database',
    description: 'Models, fields, relations, PostgreSQL tables, ACLs & record rules.',
    accentClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  business_logic: {
    label: 'Business Logic',
    shortLabel: 'Business',
    description: 'Sales, Purchase, Inventory, Accounting, Vehicle Service & module workflows.',
    accentClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  development_rules: {
    label: 'Development Rules',
    shortLabel: 'Rules',
    description: 'Coding conventions, customization patterns, deployment & anti-patterns to avoid.',
    accentClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  development_history: {
    label: 'Development History',
    shortLabel: 'History',
    description: 'Past fixes, Git branches, technical decisions & known issues.',
    accentClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
};
