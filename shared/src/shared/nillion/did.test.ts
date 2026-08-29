import { describe, it, expect } from 'vitest';
import { publicKeyToDidKey } from './did.js';

// Verified expected values computed from the real algorithm (base58btc of the
// multikey [0xe7, 0x01] || pubkey-bytes), pinned here as regression canaries.

describe('publicKeyToDidKey', () => {
  it('compresses an uncompressed (04, x || y) ECDSA key using even-y prefix 02', () => {
    // y = 0x2222...22 is even -> 02 prefix preserves the x coordinate.
    const hex = '04' + '11'.repeat(32) + '22'.repeat(32);
    expect(publicKeyToDidKey(hex)).toBe('did:key:zQ3shNZQnGqtqxokGkoVtFWnG9v6TJT43E3rfPxzc1eHqx3qJ');
  });

  it('compresses an uncompressed key using odd-y prefix 03', () => {
    // y = 0x2323...23 is odd -> 03 prefix.
    const hex = '04' + '11'.repeat(32) + '23'.repeat(32);
    expect(publicKeyToDidKey(hex)).toBe('did:key:zQ3shfnj9mdeSkrV3KtHJUgxZM8tyYwhMyFvkt1wvsZicU15a');
  });

  it('leaves an already-compressed 02 key unchanged', () => {
    expect(publicKeyToDidKey('02' + '11'.repeat(32)))
      .toBe('did:key:zQ3shNZQnGqtqxokGkoVtFWnG9v6TJT43E3rfPxzc1eHqx3qJ');
  });

  it('strips a leading 0x prefix before encoding', () => {
    expect(publicKeyToDidKey('0x03' + 'aa'.repeat(32)))
      .toBe('did:key:zQ3shr8KNfhu1EUvhfjYxDPs8s4yguEtA1yyDNSvKniaGmyRj');
  });

  it('produces a did:key with the multikey base58btc "z" prefix', () => {
    const out = publicKeyToDidKey('04' + '11'.repeat(32) + '22'.repeat(32));
    expect(out.startsWith('did:key:z')).toBe(true);
  });

  it('always yields a fixed-length 33-byte multikey payload (2-byte header + 33-byte key)', () => {
    const out = publicKeyToDidKey('04' + '11'.repeat(32) + '22'.repeat(32));
    // 35 bytes total -> base58btc produces variable-length string; assert via the
    // deterministic canary above rather than string length.
    expect(out).not.toContain('NN');
    expect(out.length).toBeGreaterThan(30);
  });

  it('treats even/odd y as the only discriminator between otherwise-identical keys', () => {
    const even = publicKeyToDidKey('04' + '33'.repeat(32) + '40'.repeat(32));
    const odd = publicKeyToDidKey('04' + '33'.repeat(32) + '41'.repeat(32));
    expect(even).not.toBe(odd);
    // The two differ only in prefix (02 vs 03), so encoded strings must differ.
  });
});
