export type ProofreadMode = 'proofread' | 'spelling' | 'clarity';

export interface ProofreadChange {
  original: string;
  corrected: string;
  reason: string;
}

export interface ProofreadResult {
  correctedText: string;
  summary: string;
  changes: ProofreadChange[];
  model: string;
}

export class GroqProofreadError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GroqProofreadError';
    this.status = status;
  }
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const REQUEST_TIMEOUT_MS = 25000;

interface ProtectedSegment {
  token: string;
  value: string;
}

function protectNonProseSegments(input: string): {
  maskedText: string;
  restore: (output: string) => string;
} {
  const segments: ProtectedSegment[] = [];
  const register = (value: string): string => {
    const token = `__NC_KEEP_${segments.length}__`;
    segments.push({ token, value });
    return token;
  };

  // 1. Protect fenced code blocks (including ```mermaid diagrams) line by line
  const lines = input.split('\n');
  const outLines: string[] = [];
  let inFence = false;
  let fenceBuffer: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inFence && /^\s*```/.test(line)) {
      inFence = true;
      fenceBuffer = [line];
      continue;
    }
    if (inFence) {
      fenceBuffer.push(line);
      if (/^\s*```\s*$/.test(line)) {
        outLines.push(register(fenceBuffer.join('\n')));
        inFence = false;
        fenceBuffer = [];
      }
      continue;
    }
    outLines.push(line);
  }
  if (inFence && fenceBuffer.length > 0) {
    outLines.push(...fenceBuffer);
  }

  let maskedText = outLines.join('\n');

  // 2. Protect table metadata HTML comments
  maskedText = maskedText.replace(/<!--\s*table-(?:widths|theme):[^>]*-->/g, (m) =>
    register(m)
  );

  // 3. Protect internal image/file storage URIs inside Markdown links/images
  maskedText = maskedText.replace(
    /notecraft-(?:img|file):\/\/[^\s)>]+/g,
    (m) => register(m)
  );

  const restore = (output: string): string => {
    let restored = output;
    for (const seg of segments) {
      if (restored.includes(seg.token)) {
        restored = restored.split(seg.token).join(seg.value);
      }
    }
    return restored;
  };

  return { maskedText, restore };
}

function buildSystemPrompt(mode: ProofreadMode): string {
  const sharedRules = [
    'You are a precise technical proofreader and copy editor.',
    'CRITICAL RULES:',
    '1. Preserve all Markdown syntax (# headings, **bold**, *italic*, ~~strikethrough~~, `inline code`, [links](url), bullet/numbered lists, task checkboxes - [ ] / - [x], blockquotes >, horizontal rules ---, and Markdown tables | ... |) exactly unless fixing prose text inside them.',
    '2. NEVER modify text inside `inline code` backticks, link URLs, or any __NC_KEEP_N__ placeholder tokens. Keep every __NC_KEEP_N__ token in its exact position verbatim.',
    '3. Keep technical identifiers, product names, camelCase/snake_case symbols, CLI flags, and intentional formatting untouched.',
    '4. Preserve original paragraph structure and line breaks.',
    '5. Respond ONLY with a valid JSON object (no markdown fences) using this exact schema:',
    '{"correctedText": string, "summary": string, "changes": [{"original": string, "corrected": string, "reason": string}]}',
    'Limit "changes" to the most meaningful edits (max 15 items). If no edits are needed, return the exact original text as "correctedText", set "summary" to "No spelling or grammar issues found.", and set "changes" to [].',
  ].join('\n');

  if (mode === 'spelling') {
    return `${sharedRules}\n\nTASK MODE: SPELLING ONLY.\nFix only misspelled words and obvious typos. Do not rephrase sentences or alter grammar/punctuation unless fixing a misspelled word.`;
  }

  if (mode === 'clarity') {
    return `${sharedRules}\n\nTASK MODE: CLARITY & GRAMMAR.\nFix all spelling mistakes, typos, punctuation, and grammar errors, and lightly polish awkward or wordy phrasing for crisp, natural technical prose while keeping the exact meaning.`;
  }

  return `${sharedRules}\n\nTASK MODE: SPELLING & GRAMMAR.\nFix spelling mistakes, typos, punctuation, verb tense, articles, and grammar errors while keeping the author's exact voice, phrasing, and meaning.`;
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
    if (fenced) {
      return JSON.parse(fenced[1].trim()) as Record<string, unknown>;
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('Invalid JSON response from Groq AI');
  }
}

async function callGroqChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  useJsonFormat: boolean
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Proofread the following text and return the JSON result:\n\n${userText}`,
        },
      ],
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
        // ignore parse failure
      }
      throw new GroqProofreadError(errMsg, res.status);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new GroqProofreadError('Groq AI returned an empty response', 502);
    }
    return content;
  } catch (err) {
    if (err instanceof GroqProofreadError) throw err;
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new GroqProofreadError('Groq AI request timed out. Please try again.', 504);
    }
    throw new GroqProofreadError(
      err instanceof Error ? err.message : 'Failed to reach Groq AI service',
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

function resolveGroqConfig(): { apiKey: string; model: string } {
  const rawKey = process.env.GROQ_API_KEY ?? process.env.GROQ_KEY ?? '';
  const apiKey = rawKey.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!apiKey || apiKey === 'MY_GROQ_API_KEY') {
    throw new GroqProofreadError(
      'GROQ_API_KEY is not configured on the server. Add GROQ_API_KEY to your environment secrets or Docker/Portainer stack environment variables and restart the server.',
      503
    );
  }
  const rawModel = process.env.GROQ_MODEL ?? '';
  const model =
    rawModel.trim().replace(/^['"]|['"]$/g, '').trim() || DEFAULT_GROQ_MODEL;
  return { apiKey, model };
}

export async function proofreadWithGroq({
  text,
  mode = 'proofread',
}: {
  text: string;
  mode?: ProofreadMode;
}): Promise<ProofreadResult> {
  const { apiKey, model } = resolveGroqConfig();
  const systemPrompt = buildSystemPrompt(mode);
  const { maskedText, restore } = protectNonProseSegments(text);

  let rawResponse: string;
  try {
    rawResponse = await callGroqChat(apiKey, model, systemPrompt, maskedText, true);
  } catch (err) {
    if (err instanceof GroqProofreadError && err.status === 400) {
      rawResponse = await callGroqChat(apiKey, model, systemPrompt, maskedText, false);
    } else {
      throw err;
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(rawResponse);
  } catch {
    throw new GroqProofreadError('Failed to parse Groq AI proofreading response.', 502);
  }

  const rawCorrected =
    typeof parsed.correctedText === 'string' ? parsed.correctedText : maskedText;
  const correctedText = restore(rawCorrected);

  const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];
  const changes: ProofreadChange[] = rawChanges
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      original: restore(typeof item.original === 'string' ? item.original : ''),
      corrected: restore(typeof item.corrected === 'string' ? item.corrected : ''),
      reason: typeof item.reason === 'string' && item.reason.trim() ? item.reason.trim() : 'Edit',
    }))
    .filter((c) => c.original && c.corrected && c.original !== c.corrected)
    .slice(0, 15);

  const rawSummary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  const summary =
    rawSummary ||
    (correctedText === text
      ? 'No spelling or grammar issues found.'
      : changes.length > 0
      ? `Suggested ${changes.length} ${changes.length === 1 ? 'improvement' : 'improvements'}.`
      : 'Applied spelling and grammar improvements.');

  return {
    correctedText,
    summary,
    changes,
    model,
  };
}
