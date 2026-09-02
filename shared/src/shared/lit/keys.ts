import { throwOnFailure, validateUsageKey } from '../nillcc-validation.js';

export async function fetchLitApiKey(
  backendUrl: string,
  userAddr: string,
  signature: string,
  poolId: string,
  signal?: AbortSignal
): Promise<string> {

  // Producer-side boundary defense: a payload the backend would reject is
  // caught here, before the fetch, instead of sent.
  throwOnFailure(validateUsageKey({ userAddr, signature, poolId }));

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

  const { apiKey } = await response.json();
  return apiKey;
}