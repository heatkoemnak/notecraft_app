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
  filePath?: string;
  fileName?: string;
  language?: string;
  fileContent?: string;
  selectedCode?: string;
  selectionLineRange?: string;
  cursorLine?: number;
  rootPath?: string;
  projectTree?: string;
  history?: CodeAgentMessage[];
}

export interface CodeAgentResult {
  reply: string;
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
    description: 'Fast coding reasoning, debugging & structured file edits',
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
  chat: 'Answer the developer question clearly and provide ready-to-apply code edits whenever code changes or new code are requested.',
  explain:
    'Explain how the code works step-by-step: control flow, data structures, side effects, dependencies, and any gotchas. Only propose code if the user explicitly asks for edits.',
  fix: 'Identify bugs, race conditions, null/edge-case crashes, security flaws, or type errors, explain each issue clearly, and provide targeted fixes in edits (targetAction: "edit-hunks").',
  refactor:
    'Refactor the code for better readability, modularity, error handling, and idiomatic style while preserving exact external behavior. Provide targeted search-and-replace blocks in edits (targetAction: "edit-hunks") rather than rewriting unchanged code.',
  tests:
    'Write thorough, practical unit/integration tests covering happy paths and edge cases matching the language and testing idioms of this project.',
  types:
    'Add strong type annotations, interfaces/types, and concise JSDoc/docstrings without changing runtime logic. Provide targeted updates in edits (targetAction: "edit-hunks").',
  implement:
    'Implement the requested feature or new file cleanly, following the architecture and conventions of the open workspace.',
};

function buildSystemInstruction(input: CodeAgentInput): string {
  const mode = input.taskMode || 'chat';
  const hasFile = Boolean(input.fileName?.trim() || input.filePath?.trim());
  const hasSelection = Boolean(input.selectedCode?.trim());

  return [
    'You are an expert senior software engineer and AI coding pair-programmer embedded inside a remote SSH code editor.',
    `TASK FOCUS: ${TASK_GUIDANCE[mode]}`,
    '',
    'RULES FOR CODE GENERATION & EDITS:',
    '1. Ground every answer in the active file, highlighted selection, and loaded remote directory tree provided in the context. Do not invent non-existent project files or APIs.',
    '2. Respond ONLY with a valid JSON object matching this exact schema:',
    '   {"reply": string, "edits": [{"oldCode": string, "newCode": string, "description": string}], "proposedCode": string | null, "summary": string, "targetAction": "none" | "edit-hunks" | "replace-selection" | "replace-file" | "insert-at-cursor" | "create-file", "suggestedFileName": string | null}',
    '3. Keep "reply" concise, technical Markdown explaining the reasoning, findings, or changes. Do NOT paste unchanged file sections inside "reply".',
    '4. CRITICAL — DO NOT REWRITE THE WHOLE FILE when editing existing code:',
    hasFile
      ? hasSelection
        ? [
            '   - When changing the active file or highlighted selection, PREFER "targetAction": "edit-hunks" with targeted items in "edits" (and set "proposedCode": null).',
            '   - Each item in "edits" MUST copy the exact verbatim existing lines into "oldCode" (include 1–2 surrounding lines if needed so it matches uniquely) and put ONLY the updated replacement lines into "newCode".',
            '   - If creating a separate test/helper file (e.g. Write Tests), set "targetAction": "create-file", set "suggestedFileName", "edits": [], and put the new file content in "proposedCode".',
          ].join('\n')
        : [
            '   - When updating an open file, ALWAYS prefer "targetAction": "edit-hunks" with small, targeted items in "edits" (and set "proposedCode": null). NEVER rewrite unchanged lines of the whole file!',
            '   - Each item in "edits" MUST have "oldCode" copied verbatim from the active file (with enough exact lines to match uniquely) and "newCode" with only the changed block.',
            '   - To insert brand new code at the cursor without replacing existing lines, set "oldCode": "" in an edit OR use "targetAction": "insert-at-cursor" with "proposedCode".',
            '   - Only set "targetAction": "create-file" (with "proposedCode" and "suggestedFileName") when generating a separate file such as unit tests or a new module.',
          ].join('\n')
      : '   - Since no file is open in the editor, when generating code or a new file, set "targetAction": "create-file", set "edits": [], set "suggestedFileName" (e.g. "src/utils/helper.ts"), and put the complete file content in "proposedCode".',
    '5. If the user is only asking a question or explanation with no code edits, set "targetAction": "none", "edits": [], "proposedCode": null, and "suggestedFileName": null.',
    '6. "summary" should be a short phrase (< 12 words) describing what was answered or changed.',
  ].join('\n');
}

function buildContextPrompt(input: CodeAgentInput): string {
  const parts: string[] = [];

  if (input.rootPath?.trim()) {
    parts.push(`Remote Workspace Root: ${input.rootPath.trim()}`);
  }

  if (input.projectTree?.trim()) {
    parts.push(`Loaded Project Explorer Tree:\n${input.projectTree.trim().slice(0, 8000)}`);
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
      const clipped = input.fileContent.slice(0, 32000);
      const wasClipped = input.fileContent.length > 32000;
      parts.push(
        `Active File Content${wasClipped ? ' (truncated to first 32,000 chars)' : ''}:\n\`\`\`\n${clipped}\n\`\`\``
      );
    }
  } else {
    parts.push('Active File: (none currently open in editor)');
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
        ? obj.description.trim().slice(0, 120)
        : undefined;
    result.push({ oldCode, newCode, description });
  }
  return result.slice(0, 30);
}

function parseAgentPayload(
  rawText: string,
  model: string,
  provider: 'gemini' | 'groq',
  hasFile: boolean
): CodeAgentResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(rawText);
  } catch {
    // Graceful fallback: return raw markdown reply if model answered in plain text
    const clean = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return {
      reply: clean || 'Completed.',
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

  const edits = sanitizeEditHunks(parsed.edits);

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

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 120)
      : edits.length > 0
      ? `Proposed ${edits.length} targeted update${edits.length === 1 ? '' : 's'}`
      : proposedCode
      ? 'Prepared code update'
      : 'Answered coding question';

  const suggestedFileName =
    typeof parsed.suggestedFileName === 'string' && parsed.suggestedFileName.trim()
      ? parsed.suggestedFileName.trim().replace(/^\/+/, '')
      : null;

  return {
    reply,
    edits,
    proposedCode,
    summary,
    targetAction,
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
    .slice(-10)
    .filter((m) => typeof m?.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content.slice(0, 6000) }],
    }));

  const contents = [
    ...historyItems,
    { role: 'user' as const, parts: [{ text: currentUserPrompt }] },
  ];

  try {
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
            summary: { type: Type.STRING },
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

    return parseAgentPayload(
      rawText,
      GEMINI_CODE_AGENT_MODEL,
      'gemini',
      Boolean(input.fileName || input.filePath)
    );
  } catch (err) {
    if (err instanceof CodeAgentError) throw err;
    const statusRaw =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 502;
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to invoke Gemini AI Code Agent';
    throw new CodeAgentError(message, statusRaw >= 400 && statusRaw < 600 ? statusRaw : 502);
  }
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
      throw new CodeAgentError('AI Code Agent request timed out. Try a smaller file or simpler prompt.', 504);
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
    .slice(-10)
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

  return parseAgentPayload(
    rawResponse,
    model,
    'groq',
    Boolean(input.fileName || input.filePath)
  );
}

export async function runCodeAgent(input: CodeAgentInput): Promise<CodeAgentResult> {
  const requested = typeof input.model === 'string' ? input.model.trim() : '';
  const geminiReady = Boolean(getConfiguredGeminiApiKey());
  const groqReady = hasConfiguredGroqKey();

  if (!requested) {
    if (geminiReady) return runWithGemini(input);
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
    return runWithGemini(input);
  }

  return runWithGroq(input, requested);
}
