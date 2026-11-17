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

export async function requestAiProofread(
  text: string,
  mode: ProofreadMode = 'proofread'
): Promise<ProofreadResult> {
  const res = await fetch('/api/ai/proofread', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode }),
  });

  const payload = (await res.json().catch(() => null)) as
    | (ProofreadResult & { error?: string })
    | { error?: string }
    | null;

  if (!res.ok || !payload || !('correctedText' in payload)) {
    throw new Error(
      payload?.error || `AI proofreading failed (${res.status}).`
    );
  }

  return payload;
}
