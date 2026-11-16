import mermaid from 'mermaid';

export const MERMAID_FONT_FAMILY =
  "'Kantumruy Pro', 'Noto Sans Khmer', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";

export function isDiagramLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return normalized === 'mermaid' || normalized === 'flowchart';
}

export function detectDiagramLabel(code: string): string {
  const firstNonEmpty =
    code
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('%%')) || '';

  const lower = firstNonEmpty.toLowerCase();
  if (lower.startsWith('flowchart') || lower.startsWith('graph')) return 'Flowchart';
  if (lower.startsWith('sequencediagram')) return 'Sequence diagram';
  if (lower.startsWith('classdiagram')) return 'Class diagram';
  if (lower.startsWith('statediagram')) return 'State diagram';
  if (lower.startsWith('erdiagram')) return 'ER diagram';
  if (lower.startsWith('gantt')) return 'Gantt chart';
  if (lower.startsWith('pie')) return 'Pie chart';
  if (lower.startsWith('mindmap')) return 'Mindmap';
  if (lower.startsWith('gitgraph')) return 'Git graph';
  if (lower.startsWith('journey')) return 'User journey';
  if (lower.startsWith('timeline')) return 'Timeline';
  return 'Diagram';
}

export interface DiagramTemplate {
  id: string;
  label: string;
  description: string;
  code: string;
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'flowchart-process',
    label: 'Flowchart',
    description: 'Linear & branching process steps',
    code: `flowchart TD
  N1(["Start Request"])
  N2["Validate Payload"]
  N3{"Authenticated?"}
  N4["Process Action"]
  N5["Return 401 Error"]
  N6(["Send Response"])
  N1 --> N2
  N2 --> N3
  N3 -->|Yes| N4
  N3 -->|No| N5
  N4 --> N6`,
  },
  {
    id: 'system-arch',
    label: 'Architecture',
    description: 'Left-to-right service topology',
    code: `flowchart LR
  Client(["Web Client"])
  Gateway["API Gateway"]
  Auth["Auth Service"]
  App["NoteCraft Core"]
  DB[("PostgreSQL")]
  Client -->|HTTPS| Gateway
  Gateway --> Auth
  Gateway --> App
  App --> DB`,
  },
  {
    id: 'sequence',
    label: 'Sequence',
    description: 'Request/response timeline',
    code: `sequenceDiagram
  actor User
  participant UI as NoteCraft UI
  participant API as Express API
  participant DB as PostgreSQL

  User->>UI: Save document
  UI->>API: PATCH /api/notes/:id
  API->>DB: UPDATE notes SET content
  DB-->>API: Row updated
  API-->>UI: 200 OK`,
  },
  {
    id: 'er-schema',
    label: 'ER Schema',
    description: 'Database entities & relations',
    code: `erDiagram
  USERS ||--o{ NOTES : owns
  FOLDERS ||--o{ NOTES : organizes
  NOTES ||--o{ NOTE_SHARES : shares
  USERS {
    string id
    string email
    string name
  }
  NOTES {
    string id
    string title
    text content
  }`,
  },
  {
    id: 'state',
    label: 'State Machine',
    description: 'Lifecycle states & transitions',
    code: `stateDiagram-v2
  [*] --> Draft
  Draft --> Reviewing : Submit
  Reviewing --> Published : Approve
  Reviewing --> Draft : Request changes
  Published --> Archived : Archive
  Archived --> [*]`,
  },
  {
    id: 'mindmap',
    label: 'Mindmap',
    description: 'Hierarchical topic breakdown',
    code: `mindmap
  root((Project Launch))
    Engineering
      API Endpoints
      Database Schema
      Automated Tests
    Design
      User Flows
      Dark Mode Polish
    Operations
      Docker Compose
      Backups`,
  },
];

export type FlowchartDirection = 'TD' | 'LR';
export type FlowchartShape = 'process' | 'rounded' | 'decision' | 'database' | 'circle';
export type FlowchartEdgeStyle = 'solid' | 'dashed' | 'thick';

export interface FlowchartNode {
  id: string;
  label: string;
  shape: FlowchartShape;
}

export interface FlowchartEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  style: FlowchartEdgeStyle;
}

export interface FlowchartModel {
  direction: FlowchartDirection;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

export const DEFAULT_FLOWCHART_MODEL: FlowchartModel = {
  direction: 'TD',
  nodes: [
    { id: 'N1', label: 'Start Request', shape: 'rounded' },
    { id: 'N2', label: 'Validate Payload', shape: 'process' },
    { id: 'N3', label: 'Authenticated?', shape: 'decision' },
    { id: 'N4', label: 'Process Action', shape: 'process' },
    { id: 'N5', label: 'Return 401 Error', shape: 'process' },
    { id: 'N6', label: 'Save to Database', shape: 'database' },
  ],
  edges: [
    { id: 'E1', from: 'N1', to: 'N2', label: '', style: 'solid' },
    { id: 'E2', from: 'N2', to: 'N3', label: '', style: 'solid' },
    { id: 'E3', from: 'N3', to: 'N4', label: 'Yes', style: 'solid' },
    { id: 'E4', from: 'N3', to: 'N5', label: 'No', style: 'dashed' },
    { id: 'E5', from: 'N4', to: 'N6', label: '', style: 'solid' },
  ],
};

function sanitizeMermaidLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\r?\n/g, ' ').trim() || 'Step';
}

function formatNodeSyntax(node: FlowchartNode): string {
  const safe = sanitizeMermaidLabel(node.label);
  switch (node.shape) {
    case 'rounded':
      return `${node.id}(["${safe}"])`;
    case 'decision':
      return `${node.id}{"${safe}"}`;
    case 'database':
      return `${node.id}[("${safe}")]`;
    case 'circle':
      return `${node.id}(("${safe}"))`;
    case 'process':
    default:
      return `${node.id}["${safe}"]`;
  }
}

export function serializeFlowchartToMermaid(model: FlowchartModel): string {
  const lines: string[] = [`flowchart ${model.direction}`];
  for (const node of model.nodes) {
    lines.push(`  ${formatNodeSyntax(node)}`);
  }

  const nodeIds = new Set(model.nodes.map((n) => n.id));
  for (const edge of model.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    const arrow =
      edge.style === 'dashed' ? '-.->' : edge.style === 'thick' ? '==>' : '-->';
    const cleanLabel = edge.label.replace(/\|/g, '/').replace(/"/g, "'").trim();
    if (cleanLabel) {
      lines.push(`  ${edge.from} ${arrow}|"${cleanLabel}"| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} ${arrow} ${edge.to}`);
    }
  }

  return lines.join('\n');
}

function stripOuterQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseNodeToken(token: string): FlowchartNode | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const patterns: Array<{ regex: RegExp; shape: FlowchartShape }> = [
    { regex: /^([A-Za-z0-9_]+)\(\[([\s\S]+)\]\)$/, shape: 'rounded' },
    { regex: /^([A-Za-z0-9_]+)\[\(([\s\S]+)\)\]$/, shape: 'database' },
    { regex: /^([A-Za-z0-9_]+)\(\(([\s\S]+)\)\)$/, shape: 'circle' },
    { regex: /^([A-Za-z0-9_]+)\{([\s\S]+)\}$/, shape: 'decision' },
    { regex: /^([A-Za-z0-9_]+)\[([\s\S]+)\]$/, shape: 'process' },
    { regex: /^([A-Za-z0-9_]+)\(([\s\S]+)\)$/, shape: 'rounded' },
  ];

  for (const { regex, shape } of patterns) {
    const m = regex.exec(trimmed);
    if (m) {
      return {
        id: m[1],
        label: stripOuterQuotes(m[2]),
        shape,
      };
    }
  }

  if (/^[A-Za-z0-9_]+$/.test(trimmed)) {
    return { id: trimmed, label: trimmed, shape: 'process' };
  }

  return null;
}

export function parseMermaidToFlowchart(code: string): FlowchartModel | null {
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'));

  if (lines.length === 0) return null;

  const headerMatch = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)$/i.exec(lines[0]);
  if (!headerMatch) return null;

  const rawDir = headerMatch[1].toUpperCase();
  const direction: FlowchartDirection = rawDir === 'LR' || rawDir === 'RL' ? 'LR' : 'TD';

  const nodeMap = new Map<string, FlowchartNode>();
  const edges: FlowchartEdge[] = [];
  let edgeSeq = 0;

  const upsertNode = (parsed: FlowchartNode) => {
    const existing = nodeMap.get(parsed.id);
    if (!existing) {
      nodeMap.set(parsed.id, parsed);
    } else if (existing.label === existing.id && parsed.label !== parsed.id) {
      nodeMap.set(parsed.id, parsed);
    }
  };

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    // Bail out gracefully for complex directives (subgraphs, classDef, style, click)
    if (/^(subgraph|end|style|classDef|class|click|linkStyle)\b/i.test(line)) {
      return null;
    }

    const edgeMatch =
      /^(.+?)\s*(-->|-\.->|==>)(?:\|([^|]+)\|)?\s*(.+)$/.exec(line);
    if (edgeMatch) {
      const fromNode = parseNodeToken(edgeMatch[1]);
      const toNode = parseNodeToken(edgeMatch[4]);
      if (!fromNode || !toNode) return null;

      upsertNode(fromNode);
      upsertNode(toNode);

      const arrow = edgeMatch[2];
      const style: FlowchartEdgeStyle =
        arrow === '-.->' ? 'dashed' : arrow === '==>' ? 'thick' : 'solid';
      const label = edgeMatch[3] ? stripOuterQuotes(edgeMatch[3]) : '';

      edgeSeq += 1;
      edges.push({
        id: `E${edgeSeq}`,
        from: fromNode.id,
        to: toNode.id,
        label,
        style,
      });
      continue;
    }

    const standaloneNode = parseNodeToken(line);
    if (!standaloneNode) return null;
    upsertNode(standaloneNode);
  }

  const nodes = Array.from(nodeMap.values());
  if (nodes.length === 0) return null;

  return { direction, nodes, edges };
}

let renderQueue: Promise<unknown> = Promise.resolve();
let renderSeq = 0;
let lastInitializedDark: boolean | null = null;

function configureMermaid(isDark: boolean) {
  if (lastInitializedDark === isDark) return;
  lastInitializedDark = isDark;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    logLevel: 'fatal',
    theme: 'base',
    flowchart: {
      curve: 'basis',
      htmlLabels: true,
      padding: 14,
      nodeSpacing: 40,
      rankSpacing: 48,
    },
    themeVariables: isDark
      ? {
          darkMode: true,
          background: '#19191d',
          primaryColor: '#1f2430',
          primaryTextColor: '#f4f4f5',
          primaryBorderColor: '#4b5563',
          lineColor: '#94a3b8',
          secondaryColor: '#25252b',
          secondaryTextColor: '#e4e4e7',
          secondaryBorderColor: '#52525b',
          tertiaryColor: '#1b1b20',
          tertiaryTextColor: '#e4e4e7',
          tertiaryBorderColor: '#3f3f46',
          edgeLabelBackground: '#19191d',
          clusterBkg: '#141418',
          clusterBorder: '#3f3f46',
          nodeTextColor: '#f4f4f5',
          titleColor: '#f4f4f5',
          actorBkg: '#1f2430',
          actorBorder: '#4b5563',
          actorTextColor: '#f4f4f5',
          actorLineColor: '#64748b',
          signalColor: '#e4e4e7',
          signalTextColor: '#f4f4f5',
          labelBoxBkgColor: '#1f2430',
          labelBoxBorderColor: '#4b5563',
          labelTextColor: '#f4f4f5',
          fontFamily: MERMAID_FONT_FAMILY,
          fontSize: '14px',
        }
      : {
          darkMode: false,
          background: '#fafafa',
          primaryColor: '#eff6ff',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#93c5fd',
          lineColor: '#64748b',
          secondaryColor: '#f8fafc',
          secondaryTextColor: '#1e293b',
          secondaryBorderColor: '#cbd5e1',
          tertiaryColor: '#f1f5f9',
          tertiaryTextColor: '#1e293b',
          tertiaryBorderColor: '#cbd5e1',
          edgeLabelBackground: '#ffffff',
          clusterBkg: '#f8fafc',
          clusterBorder: '#cbd5e1',
          nodeTextColor: '#0f172a',
          titleColor: '#0f172a',
          actorBkg: '#eff6ff',
          actorBorder: '#93c5fd',
          actorTextColor: '#0f172a',
          actorLineColor: '#64748b',
          signalColor: '#1e293b',
          signalTextColor: '#0f172a',
          labelBoxBkgColor: '#ffffff',
          labelBoxBorderColor: '#cbd5e1',
          labelTextColor: '#0f172a',
          fontFamily: MERMAID_FONT_FAMILY,
          fontSize: '14px',
        },
  });
}

export function renderMermaidSvg(
  code: string,
  isDark: boolean
): Promise<{ svg: string; bindFunctions?: (element: Element) => void }> {
  const trimmed = code.trim();
  if (!trimmed) {
    return Promise.reject(new Error('Diagram source is empty.'));
  }

  const task = renderQueue.then(async () => {
    configureMermaid(isDark);
    renderSeq += 1;
    const id = `notecraft-mmd-${renderSeq}`;
    try {
      const result = await mermaid.render(id, trimmed);
      return result;
    } catch (err) {
      const stray = document.getElementById(`d${id}`) || document.getElementById(id);
      if (stray) stray.remove();
      throw err;
    }
  });

  renderQueue = task.catch(() => undefined);
  return task;
}

export function useIsDarkTheme(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark');
}
