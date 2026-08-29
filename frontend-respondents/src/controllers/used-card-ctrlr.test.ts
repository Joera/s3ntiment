import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks (hoisted so the controller's own imports are intercepted before
// resolution). The shared components barrel is neutralised (it registers
// custom elements at top level), the router singleton is faked, and the heavy
// `authenticate` factory is replaced per-test. `store` stays REAL (as in the
// auth-ctrlr / survey-ctrlr tests) since the controller simply binds a UI view
// to it; `viem/chains` and the JSON deployment import load natively in node.

vi.mock('@s3ntiment/shared/components', () => ({}));
vi.mock('../router.js', () => ({ router: { navigate: vi.fn() } }));
vi.mock('../auth.factory.js', () => ({ authenticate: vi.fn() }));

import { UsedCardController } from './used-card-ctrlr.js';
import { router } from '../router.js';
import { authenticate } from '../auth.factory.js';

const SURVEY_ID = 'survey-abc';

// Captures the click handler wired onto the #sign-in-btn element so a test can
// drive the "Sign in" flow directly.
function installBrowserGlobals() {
  const clickHandlers = new Map<string, Function>();
  // '#app' and the reactive selector '#used-card-content' both resolve to this
  // element so renderTemplate() builds and binds its view.
  const appEl: any = { innerHTML: '', style: {} };
  (globalThis as any).document = {
    querySelector: () => appEl,
    getElementById: (id: string) => ({
      addEventListener: (type: string, cb: Function) => void clickHandlers.set(type, cb),
    }),
  };
  (globalThis as any).window = { location: { href: '' } };
  (globalThis as any).alert = vi.fn();
  (globalThis as any).__usedCardGetClick = (type: string) => clickHandlers.get(type);
}

beforeEach(() => {
  vi.clearAllMocks();
  installBrowserGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UsedCardController — "Sign in" flow', () => {
  it('renders the used-card template and wires the sign-in button', async () => {
    const ctrl = new UsedCardController({} as any, SURVEY_ID);

    await ctrl.render();

    // the sign-in button received a click listener
    expect((globalThis as any).__usedCardGetClick('click')).toBeDefined();
    // a reactive view was bound to the UI store
    expect((ctrl as any).reactiveViews.length).toBe(1);
  });

  it('navigates to the survey route when authenticate() succeeds', async () => {
    (authenticate as any).mockResolvedValue(true);

    const ctrl = new UsedCardController({} as any, SURVEY_ID);
    await ctrl.render();

    const click = (globalThis as any).__usedCardGetClick('click');
    await click();

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), SURVEY_ID);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(`/surveys/${SURVEY_ID}`);
    expect((globalThis as any).alert).not.toHaveBeenCalled();
  });

  it('alerts and does not navigate when authenticate() returns false', async () => {
    (authenticate as any).mockResolvedValue(false);

    const ctrl = new UsedCardController({} as any, SURVEY_ID);
    await ctrl.render();

    const click = (globalThis as any).__usedCardGetClick('click');
    await click();

    expect((globalThis as any).alert).toHaveBeenCalledWith(
      'You did not register for this survey'
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('propagates a reject from authenticate() without navigating or alerting', async () => {
    // The controller does not try/catch authenticate(), so a rejected promise
    // propagates rather than falling through to the alert branch — asserting
    // the honest source behaviour.
    (authenticate as any).mockRejectedValue(new Error('auth blew up'));

    const ctrl = new UsedCardController({} as any, SURVEY_ID);
    await ctrl.render();

    const click = (globalThis as any).__usedCardGetClick('click');

    await expect(click()).rejects.toThrow('auth blew up');
    expect(router.navigate).not.toHaveBeenCalled();
    expect((globalThis as any).alert).not.toHaveBeenCalled();
  });

  it('destroy() clears every bound reactive view', async () => {
    const ctrl = new UsedCardController({} as any, SURVEY_ID);
    const viewA = { destroy: vi.fn() };
    const viewB = { destroy: vi.fn() };
    (ctrl as any).reactiveViews.push(viewA, viewB);

    ctrl.destroy();

    expect(viewA.destroy).toHaveBeenCalledTimes(1);
    expect(viewB.destroy).toHaveBeenCalledTimes(1);
    expect((ctrl as any).reactiveViews).toEqual([]);
  });
});
