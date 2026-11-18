export type ViewMode = 'read' | 'write' | 'split';

export type SidebarFilter =
  | { type: 'all' }
  | { type: 'starred' }
  | { type: 'snippets' }
  | { type: 'ssh' }
  | { type: 'database' }
  | { type: 'folder'; folderId: string };

export type SharePermission = 'view' | 'edit';
export type LinkAccess = 'off' | 'view' | 'edit';

export interface NoteShareEntry {
  id: string;
  noteId: string;
  recipientEmail: string;
  recipientName?: string | null;
  recipientUserId?: string | null;
  permission: SharePermission;
  createdAt: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface NoteDocument {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  isSharedWithMe?: boolean;
  ownerName?: string;
  ownerEmail?: string;
  sharedPermission?: SharePermission;
  shares?: NoteShareEntry[];
  shareToken?: string | null;
  linkAccess?: LinkAccess;
}

export interface SharedLinkNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  shareToken: string;
  linkAccess: SharePermission;
  ownerName: string;
  ownerEmail: string;
}

export interface Snippet {
  id: string;
  title: string;
  description: string;
  category: string;
  language: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface HeadingItem {
  id: string;
  text: string;
  level: number;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export type SshAuthType = 'password' | 'privateKey';

export interface SshProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  lastConnectedAt?: number | null;
  createdAt: number;
}

export type DatabaseEngine = 'postgres' | 'mysql';

export interface DatabaseProfile {
  id: string;
  label: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  lastConnectedAt?: number | null;
  createdAt: number;
}

export interface DatabaseTableColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  foreignKey?: string | null;
}

export interface DatabaseTableInfo {
  schema: string;
  name: string;
  estimatedRows: number | null;
  columns: DatabaseTableColumn[];
}

export interface DatabaseQueryResult {
  columns: Array<{ name: string; type?: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  command?: string;
}

