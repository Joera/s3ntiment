import { validateUsageKeyInput, validateUsageKeyOutput } from '../nillcc/index.js';

export async function fetchLitApiKey(
  backendUrl: string,
  userAddr: string,
  signature: string,
  poolId: string,
  signal?: AbortSignal
): Promise<string> {

  // Producer-side boundary defense: a payload the backend would reject is
  // caught here, before the fetch, instead of sent. validateUsageKeyInput
  // throws (canonical zod module).
  validateUsageKeyInput({ userAddr, signature, poolId });

  const response: any = await fetch(`${backendUrl}/api/lit/usage-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAddr, signature, poolId }),
    signal,
  });

  if (!response.ok) {
    const { msg } = await response.json();
    throw new Error(msg ?? 'fetchLitApiKey: unauthorized');
  }

  const body = await response.json();
  // Output conformance: the usage-key boundary returns { apiKey }. Runs only on
  // an ok response; a wrong shape fails loudly with a field-named message.
  validateUsageKeyOutput(body);
  const { apiKey } = body;
  return apiKey;
}