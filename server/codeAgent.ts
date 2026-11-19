import { GoogleGenAI, Type } from '@google/genai';
import {
  getConfiguredGroqApiKey,
  getDefaultGroqModel,
  listAvailableGroqModels,
  sanitizeGroqModelId,
} from './groqModels.ts';

export const GEMINI_CODE_AGENT_MODEL = 'gemini-4-hydrogen';

export type CodeAgentTaskMode =
  | 'chat'
  | 'explain'
  | 'fix'
  | 'refactor'
  | 'tests'
  | 'types'
  | 'implement';

export type CodeAgentMode = 'plan' | 'auto';

export type CodeAgentTargetAction =
  | 'none'
  | 'edit-hunks'
  | 'replace-file'
  | 'replace-selection'
  | 'insert-at-cursor'
  | 'create-file';

export interface CodeAgentEditHunk {
  oldCode: string;
  newCode: string;
  description?: string;
}

export interface CodeAgentFileOperation {
  operation: 'edit-file' | 'create-file' | 'create-dir';
  path: string;
  description?: string;
  edits?: CodeAgentEditHunk[];
  content?: string | null;
}

export interface CodeAgentPlanStep {
  title: string;
  description: string;
  action: 'create-dir' | 'create-file' | 'edit-file' | 'verify';
  targetPath?: string;
}

export interface CodeAgentRelatedFile {
  path: string;
  content: string;
}

export interface CodeAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CodeAgentModelOption {
  id: string;
  label: string;
  description: string;
  provider: 'gemini' | 'groq';
  available: boolean;
}

export interface CodeAgentInput {
  prompt: string;
  model?: string;
  taskMode?: CodeAgentTaskMode;
  agentMode?: CodeAgentMode;
  filePath?: string;
  fileName?: string;
  language?: string;
  fileContent?: string;
  selectedCode?: string;
  selectionLineRange?: string;
  cursorLine?: number;
  rootPath?: string;
  projectTree?: string;
  relatedFiles?: CodeAgentRelatedFile[];
  history?: CodeAgentMessage[];
}

export interface CodeAgentResult {
  reply: string;
  mode: CodeAgentMode;
  plan: CodeAgentPlanStep[];
  fileOperations: CodeAgentFileOperation[];
  requestedFiles: string[];
  edits: CodeAgentEditHunk[];
  proposedCode: string | null;
  summary: string;
  targetAction: CodeAgentTargetAction;
  suggestedFileName: string | null;
  model: string;
  provider: 'gemini' | 'groq';
}

export class CodeAgentError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'CodeAgentError';
    this.status = status;
  }
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 45000;

export function getConfiguredGeminiApiKey(): string {
  const rawKey = process.env.GEMINI_API_KEY ?? '';
  const cleaned = rawKey.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!cleaned || cleaned === 'MY_GEMINI_API_KEY') return '';
  return cleaned;
}

function hasConfiguredGroqKey(): boolean {
  const key = getConfiguredGroqApiKey();
  return Boolean(key && key !== 'MY_GROQ_API_KEY');
}

export async function listCodeAgentModels(): Promise<{
  defaultModel: string;
  models: CodeAgentModelOption[];
  geminiAvailable: boolean;
  groqAvailable: boolean;
}> {
  const geminiAvailable = Boolean(getConfiguredGeminiApiKey());
  const groqAvailable = hasConfiguredGroqKey();
  const groqCatalog = await listAvailableGroqModels();

  const geminiOption: CodeAgentModelOption = {
    id: GEMINI_CODE_AGENT_MODEL,
    label: 'Gemini 4 Hydrogen',
    description: 'Fast coding reasoning, multi-file edits & workspace planning',
    provider: 'gemini',
    available: geminiAvailable,
  };

  const groqOptions: CodeAgentModelOption[] = groqCatalog.models.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    provider: 'groq',
    available: groqAvailable,
  }));

  const defaultModel = geminiAvailable
    ? GEMINI_CODE_AGENT_MODEL
    : groqAvailable
    ? groqCatalog.defaultModel
    : GEMINI_CODE_AGENT_MODEL;

  return {
    defaultModel,
    models: [geminiOption, ...groqOptions],
    geminiAvailable,
    groqAvailable,
  };
}

const TASK_GUIDANCE: Record<CodeAgentTaskMode, string> = {
  chat: 'Answer the developer question clearly and provide multi-file or targeted code changes whenever edits, new files, or new folders are requested.',
  explain:
    'Explain how the code or workspace works step-by-step: control flow, data structures, side effects, dependencies, and gotchas. Only propose edits if explicitly asked.',
  fix: 'Identify bugs, race conditions, null/edge-case crashes, security flaws, or type errors across the active file and any related files, and provide targeted fixes.',
  refactor:
    'Refactor the code for better readability, modularity, error handling, and idiomatic style while preserving external behavior. Update any affected callers/imports in related files too.',
  tests:
    'Write thorough, practical unit/integration tests covering happy paths and edge cases matching the project conventions (usually as a new test file).',
  types:
    'Add strong type annotations, interfaces/types, and concise JSDoc/docstrings without changing runtime logic across affected files.',
  implement:
    'Implement the requested feature cleanly across all required files, creating new folders or new files whenever appropriate.',
};

function buildSystemInstruction(input: CodeAgentInput): string {
  const taskMode = input.taskMode || 'chat';
  const agentMode: CodeAgentMode = input.agentMode === 'plan' ? 'plan' : 'auto';
  const hasFile = Boolean(input.fileName?.trim() || input.filePath?.trim());

  const modeRules =
    agentMode === 'plan'
      ? [
          'ACTIVE WORKSPACE MODE: PLAN MODE',
          '- Do NOT write code edits yet (`fileOperations`: [], `edits`: [], `proposedCode`: null, `targetAction`: "none").',
          '- Instead, analyze the request, active file, related files, and directory tree, then output a concrete step-by-step implementation plan in `"plan"`.',
          '- Every step in `"plan"` must specify `"title"`, `"description"`, `"action"` ("create-dir" | "create-file" | "edit-file" | "verify"), and `"targetPath"` (POSIX path or relative path from workspace root).',
          '- Summarize the architecture, files/folders to create or update, and any trade-offs in `"reply"`.',
          '- If you need to inspect other existing files from the tree before finalizing your plan, list up to 5 paths in `"requestedFiles"` (only paths not already provided in Related Files Context).',
        ].join('\n')
      : [
          'ACTIVE WORKSPACE MODE: AUTO MODE',
          '- Produce concrete, reviewable changes directly in `"fileOperations"` (and `"plan": []`).',
          '- MULTI-FILE UPDATES: If updating the active file also requires updating imports, types, callers, routes, or styles in OTHER files, include an entry in `"fileOperations"` for EACH affected file!',
          '- NEED MORE FILE CONTEXT FIRST? If you need the exact contents of existing project files from the Project Explorer Tree (that are not already in Related Files Context) before writing accurate `oldCode` search blocks, return `"requestedFiles": ["path/to/file1", ...]` (max 5 paths) with `"fileOperations": []` so the IDE can automatically fetch them and re-invoke you.',
          '- FOLDER & FILE CREATION: Whenever creating new folders or files is helpful or required:',
          '  * Include `{"operation": "create-dir", "path": "relative/or/abs/dir", "description": "..."}` when creating a standalone directory.',
          '  * Include `{"operation": "create-file", "path": "relative/or/abs/file.ts", "description": "...", "content": "..."}` when creating a new file (missing parent folders are created automatically).',
          '- TARGETED EDIT HUNKS (DO NOT REWRITE UNCHANGED LINES):',
          '  * For modifying any existing file (active file or related file), use `{"operation": "edit-file", "path": "...", "description": "...", "edits": [{"oldCode": "...", "newCode": "...", "description": "..."}]}`.',
          '  * Each `"oldCode"` MUST copy the exact verbatim existing lines from the provided file content (including indentation and 1–2 surrounding context lines if needed to match uniquely) and `"newCode"` MUST contain ONLY the updated lines.',
          '  * Also mirror active-file targeted edits into top-level `"edits"` (with `"targetAction": "edit-hunks"`, `"proposedCode": null`) if the active file is edited, so inline review opens immediately.',
          hasFile
            ? '  * Only set `"targetAction": "create-file"` with `"proposedCode"` if producing a single brand-new file and `"fileOperations"` is empty; prefer `"fileOperations"` for consistency.'
            : '  * When no active file is open, prefer `"fileOperations"` (`create-dir`, `create-file`, `edit-file`) for workspace changes.',
        ].join('\n');

  return [
    'You are an expert senior software engineer and AI coding agent embedded inside a remote SSH code editor.',
    `TASK FOCUS: ${TASK_GUIDANCE[taskMode]}`,
    '',
    modeRules,
    '',
    'OUTPUT SCHEMA (respond ONLY with valid JSON):',
    '{',
    '  "reply": string (concise technical Markdown; do NOT paste whole unchanged files),',
    '  "summary": string (< 12 words summarizing plan or changes),',
    '  "plan": [{"title": string, "description": string, "action": "create-dir" | "create-file" | "edit-file" | "verify", "targetPath": string}],',
    '  "requestedFiles": [string],',
    '  "fileOperations": [{',
    '    "operation": "edit-file" | "create-file" | "create-dir",',
    '    "path": string,',
    '    "description": string,',
    '    "edits": [{"oldCode": string, "newCode": string, "description": string}],',
    '    "content": string | null',
    '  }],',
    '  "edits": [{"oldCode": string, "newCode": string, "description": string}],',
    '  "proposedCode": string | null,',
    '  "targetAction": "none" | "edit-hunks" | "replace-selection" | "replace-file" | "insert-at-cursor" | "create-file",',
    '  "suggestedFileName": string | null',
    '}',
    '',
    'If the developer is only asking a question or explanation with no changes needed, set `"plan": []`, `"fileOperations": []`, `"edits": []`, `"proposedCode": null`, `"targetAction": "none"`.',
  ].join('\n');
}

function buildContextPrompt(input: CodeAgentInput): string {
  const parts: string[] = [];

  if (input.rootPath?.trim()) {
    parts.push(`Remote Workspace Root: ${input.rootPath.trim()}`);
  }

  if (input.projectTree?.trim()) {
    parts.push(`Loaded Project Explorer Tree:\n${input.projectTree.trim().slice(0, 10000)}`);
  }

  if (input.filePath?.trim() || input.fileName?.trim()) {
    const header = [
      `Active File: ${input.filePath?.trim() || input.fileName?.trim()}`,
      input.language?.trim() ? `Language: ${input.language.trim()}` : '',
      typeof input.cursorLine === 'number' ? `Cursor Line: ${input.cursorLine}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    parts.push(header);

    if (typeof input.fileContent === 'string') {
      const clipped = input.fileContent.slice(0, 30000);
      const wasClipped = input.fileContent.length > 30000;
      parts.push(
        `Active File Content${wasClipped ? ' (truncated to 30,000 chars)' : ''}:\n\`\`\`\n${clipped}\n\`\`\``
      );
    }
  } else {
    parts.push('Active File: (none currently open in editor)');
  }

  if (Array.isArray(input.relatedFiles) && input.relatedFiles.length > 0) {
    const relatedBlocks = input.relatedFiles
      .slice(0, 6)
      .map((rf) => {
        const body = (rf.content || '').slice(0, 14000);
        return `Related File: ${rf.path}\n\`\`\`\n${body}\n\`\`\``;
      });
    parts.push(`Related Project Files Context:\n\n${relatedBlocks.join('\n\n')}`);
  }

  if (input.selectedCode?.trim()) {
    parts.push(
      `Highlighted Selection${
        input.selectionLineRange ? ` (${input.selectionLineRange})` : ''
      }:\n\`\`\`\n${input.selectedCode.slice(0, 12000)}\n\`\`\``
    );
  }

  parts.push(`Developer Request:\n${input.prompt.trim()}`);
  return parts.join('\n\n');
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const trimmed = withoutThink || raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim()) as Record<string, unknown>;
      } catch {
        // continue
      }
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('Invalid JSON response from AI model');
  }
}

function sanitizeEditHunks(rawEdits: unknown): CodeAgentEditHunk[] {
  if (!Array.isArray(rawEdits)) return [];
  const result: CodeAgentEditHunk[] = [];
  for (const item of rawEdits) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const oldCode = typeof obj.oldCode === 'string' ? obj.oldCode.replace(/\r\n/g, '\n') : '';
    const newCode = typeof obj.newCode === 'string' ? obj.newCode.replace(/\r\n/g, '\n') : '';
    if (!oldCode && !newCode) continue;
    if (oldCode === newCode) continue;
    const description =
      typeof obj.description === 'string' && obj.description.trim()
        ? obj.description.trim().slice(0, 140)
        : undefined;
    result.push({ oldCode, newCode, description });
  }
  return result.slice(0, 30);
}

function sanitizePlanSteps(rawPlan: unknown): CodeAgentPlanStep[] {
  if (!Array.isArray(rawPlan)) return [];
  const steps: CodeAgentPlanStep[] = [];
  for (const item of rawPlan) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 160) : '';
    const description =
      typeof obj.description === 'string' ? obj.description.trim().slice(0, 500) : '';
    if (!title && !description) continue;
    const actionRaw = obj.action;
    const action: CodeAgentPlanStep['action'] =
      actionRaw === 'create-dir' ||
      actionRaw === 'create-file' ||
      actionRaw === 'edit-file' ||
      actionRaw === 'verify'
        ? actionRaw
        : 'edit-file';
    const targetPath =
      typeof obj.targetPath === 'string' && obj.targetPath.trim()
        ? obj.targetPath.trim().slice(0, 300)
        : undefined;
    steps.push({
      title: title || 'Step',
      description: description || title,
      action,
      targetPath,
    });
  }
  return steps.slice(0, 20);
}

function sanitizeFileOperations(rawOps: unknown): CodeAgentFileOperation[] {
  if (!Array.isArray(rawOps)) return [];
  const ops: CodeAgentFileOperation[] = [];
  for (const item of rawOps) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const opRaw = obj.operation;
    if (opRaw !== 'edit-file' && opRaw !== 'create-file' && opRaw !== 'create-dir') continue;
    const opPath = typeof obj.path === 'string' ? obj.path.trim().slice(0, 400) : '';
    if (!opPath) continue;
    const description =
      typeof obj.description === 'string' && obj.description.trim()
        ? obj.description.trim().slice(0, 160)
        : undefined;

    if (opRaw === 'create-dir') {
      ops.push({ operation: 'create-dir', path: opPath, description });
    } else if (opRaw === 'create-file') {
      const content = typeof obj.content === 'string' ? obj.content.replace(/\r\n/g, '\n') : '';
      ops.push({ operation: 'create-file', path: opPath, description, content });
    } else {
      const edits = sanitizeEditHunks(obj.edits);
      if (edits.length > 0) {
        ops.push({ operation: 'edit-file', path: opPath, description, edits });
      }
    }
  }
  return ops.slice(0, 25);
}

function sanitizeRequestedFiles(rawFiles: unknown): string[] {
  if (!Array.isArray(rawFiles)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of rawFiles) {
    if (typeof f !== 'string') continue;
    const clean = f.trim().slice(0, 350);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 5) break;
  }
  return out;
}

function normalizeTargetAction(
  candidate: unknown,
  hasEdits: boolean,
  hasProposedCode: boolean,
  hasFile: boolean
): CodeAgentTargetAction {
  if (hasEdits) {
    if (candidate === 'create-file' && hasProposedCode) return 'create-file';
    return 'edit-hunks';
  }
  if (!hasProposedCode) return 'none';
  if (
    candidate === 'edit-hunks' ||
    candidate === 'replace-file' ||
    candidate === 'replace-selection' ||
    candidate === 'insert-at-cursor' ||
    candidate === 'create-file' ||
    candidate === 'none'
  ) {
    return candidate === 'none' ? (hasFile ? 'replace-file' : 'create-file') : candidate;
  }
  return hasFile ? 'replace-file' : 'create-file';
}

function pathsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.trim().replace(/\/+$/, '');
  const nb = b.trim().replace(/\/+$/, '');
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

function parseAgentPayload(
  rawText: string,
  model: string,
  provider: 'gemini' | 'groq',
  input: CodeAgentInput
): CodeAgentResult {
  const mode: CodeAgentMode = input.agentMode === 'plan' ? 'plan' : 'auto';
  const hasFile = Boolean(input.fileName || input.filePath);

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(rawText);
  } catch {
    const clean = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return {
      reply: clean || 'Completed.',
      mode,
      plan: [],
      fileOperations: [],
      requestedFiles: [],
      edits: [],
      proposedCode: null,
      summary: 'AI response',
      targetAction: 'none',
      suggestedFileName: null,
      model,
      provider,
    };
  }

  const reply =
    typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : 'Completed.';

  const plan = sanitizePlanSteps(parsed.plan);
  const requestedFiles = sanitizeRequestedFiles(parsed.requestedFiles);

  if (mode === 'plan') {
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 120)
        : plan.length > 0
        ? `Plan with ${plan.length} step${plan.length === 1 ? '' : 's'}`
        : 'Implementation plan';

    return {
      reply,
      mode: 'plan',
      plan,
      fileOperations: [],
      requestedFiles,
      edits: [],
      proposedCode: null,
      summary,
      targetAction: 'none',
      suggestedFileName: null,
      model,
      provider,
    };
  }

  let fileOperations = sanitizeFileOperations(parsed.fileOperations);
  let edits = sanitizeEditHunks(parsed.edits);

  const rawCode =
    typeof parsed.proposedCode === 'string' && parsed.proposedCode.trim().length > 0
      ? parsed.proposedCode.replace(/\r\n/g, '\n')
      : null;

  const targetAction = normalizeTargetAction(
    parsed.targetAction,
    edits.length > 0,
    Boolean(rawCode),
    hasFile
  );
  const proposedCode = targetAction === 'none' || targetAction === 'edit-hunks' ? null : rawCode;

  const suggestedFileName =
    typeof parsed.suggestedFileName === 'string' && parsed.suggestedFileName.trim()
      ? parsed.suggestedFileName.trim().replace(/^\/+/, '')
      : null;

  // Keep active file edits and fileOperations synchronized seamlessly
  const activeFilePath = input.filePath?.trim() || input.fileName?.trim() || '';
  if (fileOperations.length > 0 && edits.length === 0 && activeFilePath) {
    const activeOp = fileOperations.find(
      (op) => op.operation === 'edit-file' && pathsMatch(op.path, activeFilePath)
    );
    if (activeOp?.edits && activeOp.edits.length > 0) {
      edits = activeOp.edits;
    }
  } else if (fileOperations.length === 0) {
    if (edits.length > 0 && activeFilePath) {
      fileOperations = [
        {
          operation: 'edit-file',
          path: activeFilePath,
          description:
            typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 140) : undefined,
          edits,
        },
      ];
    } else if (targetAction === 'create-file' && proposedCode && suggestedFileName) {
      fileOperations = [
        {
          operation: 'create-file',
          path: suggestedFileName,
          description:
            typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 140) : undefined,
          content: proposedCode,
        },
      ];
    }
  }

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 120)
      : fileOperations.length > 0
      ? `Prepared ${fileOperations.length} file update${fileOperations.length === 1 ? '' : 's'}`
      : edits.length > 0
      ? `Proposed ${edits.length} targeted update${edits.length === 1 ? '' : 's'}`
      : proposedCode
      ? 'Prepared code update'
      : 'Answered coding question';

  return {
    reply,
    mode: 'auto',
    plan,
    fileOperations,
    requestedFiles,
    edits,
    proposedCode,
    summary,
    targetAction: edits.length > 0 ? 'edit-hunks' : targetAction,
    suggestedFileName,
    model,
    provider,
  };
}

async function runWithGemini(input: CodeAgentInput): Promise<CodeAgentResult> {
  const apiKey = getConfiguredGeminiApiKey();
  if (!apiKey) {
    throw new CodeAgentError(
      'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in your environment secrets or switch to a Groq model.',
      503
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = buildSystemInstruction(input);
  const currentUserPrompt = buildContextPrompt(input);

  const historyItems = (Array.isArray(input.history) ? input.history : [])
    .slice(-14)
    .filter((m) => typeof m?.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content.slice(0, 6000) }],
    }));

  const contents = [
    ...historyItems,
    { role: 'user' as const, parts: [{ text: currentUserPrompt }] },
  ];

  const invokeGeminiOnce = async () => {
    const response = await ai.models.generateContent({
      model: GEMINI_CODE_AGENT_MODEL,
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            summary: { type: Type.STRING },
            plan: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  action: {
                    type: Type.STRING,
                    enum: ['create-dir', 'create-file', 'edit-file', 'verify'],
                  },
                  targetPath: { type: Type.STRING },
                },
                required: ['title', 'description', 'action'],
              },
            },
            requestedFiles: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            fileOperations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  operation: {
                    type: Type.STRING,
                    enum: ['edit-file', 'create-file', 'create-dir'],
                  },
                  path: { type: Type.STRING },
                  description: { type: Type.STRING },
                  edits: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        oldCode: { type: Type.STRING },
                        newCode: { type: Type.STRING },
                        description: { type: Type.STRING },
                      },
                      required: ['oldCode', 'newCode'],
                    },
                  },
                  content: { type: Type.STRING, nullable: true },
                },
                required: ['operation', 'path'],
              },
            },
            edits: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  oldCode: { type: Type.STRING },
                  newCode: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ['oldCode', 'newCode'],
              },
            },
            proposedCode: { type: Type.STRING, nullable: true },
            targetAction: {
              type: Type.STRING,
              enum: [
                'none',
                'edit-hunks',
                'replace-selection',
                'replace-file',
                'insert-at-cursor',
                'create-file',
              ],
            },
            suggestedFileName: { type: Type.STRING, nullable: true },
          },
          required: ['reply', 'summary', 'targetAction'],
        },
      },
    });

    const rawText = response.text;
    if (!rawText || !rawText.trim()) {
      throw new CodeAgentError('Gemini returned an empty response.', 502);
    }

    return parseAgentPayload(rawText, GEMINI_CODE_AGENT_MODEL, 'gemini', input);
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await invokeGeminiOnce();
    } catch (err) {
      lastErr = err;
      const statusRaw =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 502;
      const errMsg = err instanceof Error ? err.message : '';
      const isTransient =
        statusRaw === 503 ||
        statusRaw === 429 ||
        /high demand|unavailable|temporarily|rate limit/i.test(errMsg);
      if (attempt === 0 && isTransient) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        continue;
      }
      break;
    }
  }

  if (lastErr instanceof CodeAgentError) throw lastErr;
  const statusRaw =
    typeof (lastErr as { status?: unknown })?.status === 'number'
      ? (lastErr as { status: number }).status
      : 502;
  const message =
    lastErr instanceof Error && lastErr.message
      ? lastErr.message
      : 'Failed to invoke Gemini AI Code Agent';
  const normalizedStatus = /503|UNAVAILABLE|high demand/i.test(message)
    ? 503
    : statusRaw >= 400 && statusRaw < 600
    ? statusRaw
    : 502;
  throw new CodeAgentError(message, normalizedStatus);
}

async function callGroqChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  useJsonFormat: boolean
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.25,
      max_tokens: 6144,
      messages,
    };
    if (useJsonFormat) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = `Groq API error (${res.status})`;
      try {
        const errJson = (await res.json()) as { error?: { message?: string } };
        if (errJson?.error?.message) {
          errMsg = errJson.error.message;
        }
      } catch {
        // ignore
      }
      throw new CodeAgentError(errMsg, res.status);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new CodeAgentError('Groq AI returned an empty response.', 502);
    }
    return content;
  } catch (err) {
    if (err instanceof CodeAgentError) throw err;
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new CodeAgentError(
        'AI Code Agent request timed out. Try a smaller file or simpler prompt.',
        504
      );
    }
    throw new CodeAgentError(
      err instanceof Error ? err.message : 'Failed to reach Groq AI service',
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithGroq(input: CodeAgentInput, requestedModel?: string): Promise<CodeAgentResult> {
  const apiKey = getConfiguredGroqApiKey();
  if (!apiKey || apiKey === 'MY_GROQ_API_KEY') {
    throw new CodeAgentError(
      'GROQ_API_KEY is not configured on the server. Add GROQ_API_KEY or GEMINI_API_KEY to your environment secrets.',
      503
    );
  }

  const model = sanitizeGroqModelId(requestedModel, getDefaultGroqModel());
  const systemInstruction = buildSystemInstruction(input);
  const currentUserPrompt = buildContextPrompt(input);

  const historyItems = (Array.isArray(input.history) ? input.history : [])
    .slice(-14)
    .filter((m) => typeof m?.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content.slice(0, 6000),
    }));

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemInstruction },
    ...historyItems,
    { role: 'user', content: currentUserPrompt },
  ];

  let rawResponse: string;
  try {
    rawResponse = await callGroqChat(apiKey, model, messages, true);
  } catch (err) {
    if (err instanceof CodeAgentError && err.status === 400) {
      rawResponse = await callGroqChat(apiKey, model, messages, false);
    } else {
      throw err;
    }
  }

  return parseAgentPayload(rawResponse, model, 'groq', input);
}

export async function runCodeAgent(input: CodeAgentInput): Promise<CodeAgentResult> {
  const requested = typeof input.model === 'string' ? input.model.trim() : '';
  const geminiReady = Boolean(getConfiguredGeminiApiKey());
  const groqReady = hasConfiguredGroqKey();

  if (!requested) {
    if (geminiReady) {
      try {
        return await runWithGemini(input);
      } catch (err) {
        const isTransient = err instanceof CodeAgentError && (err.status === 503 || err.status === 429);
        if (isTransient && groqReady) {
          return runWithGroq(input, getDefaultGroqModel());
        }
        throw err;
      }
    }
    if (groqReady) return runWithGroq(input, getDefaultGroqModel());
    throw new CodeAgentError(
      'No AI API key is configured on the server. Add GEMINI_API_KEY or GROQ_API_KEY to your server environment secrets.',
      503
    );
  }

  if (requested === GEMINI_CODE_AGENT_MODEL || requested.toLowerCase().startsWith('gemini-')) {
    if (requested !== GEMINI_CODE_AGENT_MODEL) {
      throw new CodeAgentError(
        `Unsupported Gemini model "${requested}". Select ${GEMINI_CODE_AGENT_MODEL} instead.`,
        400
      );
    }
    try {
      return await runWithGemini(input);
    } catch (err) {
      const isTransient = err instanceof CodeAgentError && (err.status === 503 || err.status === 429);
      if (isTransient && groqReady) {
        return runWithGroq(input, getDefaultGroqModel());
      }
      throw err;
    }
  }

  return runWithGroq(input, requested);
}
