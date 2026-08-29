import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from './retries.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value on the first successful attempt', async () => {
    const fn = vi.fn(async () => 42);
    await expect(withRetry(fn, { retries: 3 })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes an AbortController signal to the wrapped function', async () => {
    let signalSeen: AbortSignal | undefined;
    await withRetry(async (signal) => {
      signalSeen = signal;
      return 1;
    }, { retries: 1 });
    expect(signalSeen).toBeDefined();
    expect(signalSeen!.aborted).toBe(false);
    expect(typeof signalSeen!.addEventListener).toBe('function');
  });

  it('retries until success, calling onRetry with each failed attempt', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const promise = withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('boom');
      return 'ok';
    }, { retries: 5, onRetry });
    const assertion = expect(promise).resolves.toBe('ok');
    // Backoff sleeps after attempts 1 and 2: 1000ms + 2000ms = 3000ms.
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(calls).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ message: 'boom' }));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ message: 'boom' }));
  });

  it('throws the last error after exhausting all retries', async () => {
    const onRetry = vi.fn();
    const promise = withRetry(async () => {
      throw new Error('persistent');
    }, { retries: 3, onRetry });
    const assertion = expect(promise).rejects.toThrow('persistent');
    // Backoff after attempts 1 and 2: 1000 + 2000 = 3000ms.
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('honours a non-default retry count', async () => {
    const onRetry = vi.fn();
    const promise = withRetry(async () => {
      throw new Error('again');
    }, { retries: 2, onRetry });
    const assertion = expect(promise).rejects.toThrow('again');
    // Backoff after attempt 1 only: 1000ms.
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('converts an AbortError into a timeout message', async () => {
    const boom = new Error('aborted');
    boom.name = 'AbortError';
    const assertion = withRetry(async () => {
      throw boom;
    }, { retries: 1, timeoutMs: 25000 });
    await expect(assertion).rejects.toThrow('Timed out after 25s');
  });
});
