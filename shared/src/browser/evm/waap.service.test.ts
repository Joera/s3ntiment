import { describe, it, expect, vi, afterEach } from 'vitest';
import type { WaapService as WaapServiceType } from './waap.service';

// The waap SDK pulls `react` and other browser-only modules at module scope, so
// it cannot load in the plain-node vitest environment. Mock it out so importing
// waap.service.ts (and its `WaapService` class) stays a leaf-only resolve. This
// is the same "keep the heavy graph out of node" convention used by the other
// test suites in this repo. The mock never needs a real provider because the
// tests below never touch the constructor / login path — they exercise the
// DOM-teardown helper only.
vi.mock('@human.tech/waap-sdk', () => ({
  initWaaP: vi.fn(),
  AuthenticationMethod: {},
}));

// Import the real class by direct relative source path (the shared-package
// convention) so we test the actual implementation, not a stub.
import { WaapService } from './waap.service';

describe('WaapService.hideModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Install a fake `document.getElementById` that returns the given element (or
  // null). This is the only DOM surface hideModal touches, so a 2-line stub is
  // the honest seam here — no jsdom/happy-dom needed.
  function installContainer(element: any) {
    const getById = vi.fn(() => element);
    vi.stubGlobal('document', { getElementById: getById });
    return getById;
  }

  // Build an instance without running the constructor (which would start the
  // SDK initPromise). hideModal references neither `this` nor the provider, so
  // a prototype-derived instance is a faithful invocation target.
  function instance(): WaapServiceType {
    return Object.create(WaapService.prototype) as WaapServiceType;
  }

  it('targets #waap-wallet-iframe-container and neutralizes the full-viewport overlay', () => {
    const container = { style: {} };
    const getById = installContainer(container);

    instance().hideModal();

    expect(getById).toHaveBeenCalledWith('waap-wallet-iframe-container');
    // Every one of these is what stops the fixed 100%x100% scrim from swallowing
    // pointer events over the whole app (see audit §4).
    expect(container.style.display).toBe('none');
    expect(container.style.pointerEvents).toBe('none');
    expect(container.style.visibility).toBe('hidden');
    expect(container.style.zIndex).toBe('-1');
  });

  it('is a defensive no-op when the overlay container is absent', () => {
    installContainer(null);
    expect(() => instance().hideModal()).not.toThrow();
  });
});
