import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLitApiKey } from './keys.js';

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

    // userAddr missing -> validateUsageKeyInput fails locally -> throws a plain
    // Error whose message names the offending field (userAddr) -> no fetch.
    await expect(
      fetchLitApiKey('http://backend', '', '0xsig', '0xpool'),
    ).rejects.toThrow(/userAddr/);

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

  it('output conformance: an ok response with a WRONG shape (missing apiKey) fails loudly', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ foo: 'bar' }) }));
    vi.stubGlobal('fetch', fetchMock);

    // validateUsageKeyOutput (real) throws a field-named error on the body.
    await expect(
      fetchLitApiKey('http://backend', '0xAddr', '0xsig', '0xpool'),
    ).rejects.toThrow(/Usage key output validation failed/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('output conformance: a non-ok response surfaces the real backend error (NOT a misleading output-validation error)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ msg: 'unauthorized' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchLitApiKey('http://backend', '0xAddr', '0xsig', '0xpool'),
    ).rejects.toThrow(/unauthorized/);

    // The real backend message surfaces; the output validator never runs.
    await expect(
      fetchLitApiKey('http://backend', '0xAddr', '0xsig', '0xpool'),
    ).rejects.not.toThrow(/Usage key output validation failed/);
  });
});
