import { describe, it, expect, vi } from 'vitest';

// auth.factory.ts imports `IServices` from ../services/services ONLY as a type
// (erased at runtime), so we neutralize that module with an empty mock — the
// same pattern invitation.factory.test.ts uses to keep the heavy
// waap-OPRF-Lit graph from loading at module scope.
vi.mock('../services/services', () => ({}));

import { authenticate } from './auth.factory';

describe('authenticate', () => {
  it('calls waap.hideModal() after a successful stealth-key auth', async () => {
    const hideModal = vi.fn();
    const signMessage = vi.fn().mockResolvedValue('0x-signature');
    const getSecp256k1 = vi.fn().mockResolvedValue('0x-key');
    const updateSignerWithKey = vi.fn().mockResolvedValue(undefined);

    const services: any = {
      waap: { signMessage, hideModal },
      oprf: { getSecp256k1 },
      safe: { updateSignerWithKey },
    };

    await authenticate(services);

    // The auth steps all ran...
    expect(signMessage).toHaveBeenCalledWith('Sign into your unlinkable account');
    expect(getSecp256k1).toHaveBeenCalled();
    expect(updateSignerWithKey).toHaveBeenCalled();
    // ...and the overlay was hidden exactly once, after auth completed, so the
    // SDK's full-viewport modal no longer swallows clicks on #next-btn.
    expect(hideModal).toHaveBeenCalledTimes(1);

    // hideModal runs after updateSignerWithKey (i.e. after the login step that
    // legitimately needs the iframe).
    const signOrder = signMessage.mock.invocationCallOrder[0];
    const keyOrder = getSecp256k1.mock.invocationCallOrder[0];
    const updateOrder = updateSignerWithKey.mock.invocationCallOrder[0];
    const hideOrder = hideModal.mock.invocationCallOrder[0];
    expect(hideOrder).toBeGreaterThan(signOrder);
    expect(hideOrder).toBeGreaterThan(keyOrder);
    expect(hideOrder).toBeGreaterThan(updateOrder);
  });

  it('is defensive when hideModal is not defined on the service', async () => {
    // Older / mocked service shapes may lack hideModal; `?.()` must not throw.
    const services: any = {
      waap: { signMessage: vi.fn().mockResolvedValue('0x-signature') },
      oprf: { getSecp256k1: vi.fn().mockResolvedValue('0x-key') },
      safe: { updateSignerWithKey: vi.fn().mockResolvedValue(undefined) },
    };
    await expect(authenticate(services)).resolves.toBeUndefined();
  });
});
