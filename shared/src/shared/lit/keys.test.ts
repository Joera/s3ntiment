import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLitApiKey } from './keys.js';
import { NillccValidationError } from '../nillcc-validation.js';

// Producer-side wiring test for the /api/lit/usage-key caller: a payload the
// backend would reject must throw locally (before the fetch); a valid payload
// reaches the wire.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLitApiKey producer-side validation', () => {
  it('does NOT call the backend when the payload would be rejected', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ apiKey: 'k' }) }));
    vi.stubGlobal('fetch', fetchMock);

    // userAddr missing -> validateUsageKey fails locally -> throw, no fetch.
    await expect(
      fetchLitApiKey('http://backend', '', '0xsig', '0xpool'),
    ).rejects.toBeInstanceOf(NillccValidationError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a valid payload to the backend and returns the apiKey', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ apiKey: 'k-1' }) }));
    vi.stubGlobal('fetch', fetchMock);

    const apiKey = await fetchLitApiKey('http://backend', '0xAddr', '0xsig', '0xpool');

    expect(apiKey).toBe('k-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, any];
    expect(url).toContain('/api/lit/usage-key');
    expect(JSON.parse(opts.body)).toEqual({
      userAddr: '0xAddr',
      signature: '0xsig',
      poolId: '0xpool',
    });
  });
});
