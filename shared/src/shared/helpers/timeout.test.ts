import { describe, it, expect } from 'vitest';
import { callWithTimeout } from './timeout.js';

describe('callWithTimeout', () => {
  it('resolves with the wrapped function result', async () => {
    await expect(callWithTimeout(async () => 'done', 1000)).resolves.toBe('done');
  });

  it('forwards an AbortController signal to the wrapped function', async () => {
    let signalSeen: AbortSignal | undefined;
    await callWithTimeout(async (signal) => {
      signalSeen = signal;
      return 0;
    }, 1000);
    expect(signalSeen).toBeDefined();
    expect(signalSeen!.aborted).toBe(false);
    expect(typeof signalSeen!.addEventListener).toBe('function');
  });

  it('rethrows a non-abort error unchanged', async () => {
    const boom = new Error('network down');
    await expect(callWithTimeout(async () => { throw boom; }, 1000)).rejects.toThrow('network down');
  });

  it('converts an AbortError thrown by the function into a timeout message', async () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    await expect(
      callWithTimeout(async () => { throw aborted; }, 5000),
    ).rejects.toThrow('Timed out after 5s');
  });

  it('aborts the signal after the timeout elapses while the function is pending', async () => {
    const result = callWithTimeout((signal) => new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }), 20);
    await expect(result).rejects.toThrow('Timed out after 0.02s');
  });

  it('uses the default 25s timeout when none is supplied', async () => {
    let signalSeen: AbortSignal | undefined;
    await callWithTimeout(async (signal) => {
      signalSeen = signal;
      return true;
    });
    // Just confirms default wiring runs; real 25s wait never fires because fn resolves.
    expect(signalSeen).toBeDefined();
    expect(signalSeen!.aborted).toBe(false);
  });
});
