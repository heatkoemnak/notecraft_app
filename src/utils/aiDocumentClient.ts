export type GenerateDocType =
  | 'general'
  | 'spec'
  | 'runbook'
  | 'api'
  | 'meeting'
  | 'guide';

export type GenerateDocLength = 'concise' | 'standard' | 'detailed';

export interface GenerateDocumentRequest {
  prompt: string;
  docType: GenerateDocType;
  length: GenerateDocLength;
  includeTables: boolean;
  includeDiagrams: boolean;
  includeCode: boolean;
  existingTitle?: string;
  existingContent?: string;
}

export interface GenerateDocumentResult {
  title: string;
  content: string;
  summary: string;
  model: string;
}

export async function requestAiGenerateDocument(
  payload: GenerateDocumentRequest
): Promise<GenerateDocumentResult> {
  const res = await fetch('/api/ai/generate-document', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => null)) as
    | (GenerateDocumentResult & { error?: string })
    | { error?: string }
    | null;

  if (!res.ok || !data || !('content' in data)) {
    throw new Error(
      data?.error || `AI document generation failed (${res.status}).`
    );
  }

  return data;
}
