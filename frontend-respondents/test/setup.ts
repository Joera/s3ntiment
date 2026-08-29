// vitest setup — runs before each test file's module graph is imported.
//
// Some code under test touches browser globals at *import time* (e.g.
// src/state/store.ts instantiates UserStore, which reads localStorage in its
// constructor). Rather than pulling in jsdom, we install minimal Node-side
// stubs for the few globals the auth test graph touches. Tests may override
// these (window.location.href, alert) per-case.
//
// Each stub is installed ONLY if the global is not already defined. In the
// node environment none of these globals exist, so the stubs are installed
// exactly as before (behaviour unchanged for the node-env suite). In a DOM
// environment (happy-dom, activated per-file via `@vitest-environment
// happy-dom`) the real globals are already present, so they are left intact
// and the component/controller harness operates against a real DOM.

if (!(globalThis as any).localStorage) {
  (globalThis as any).localStorage = (() => {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    };
  })();
}

if (!(globalThis as any).window) {
  (globalThis as any).window = { location: { href: '' } };
}
if (!(globalThis as any).document) {
  (globalThis as any).document = { querySelector: () => null };
}
if (!(globalThis as any).alert) {
  (globalThis as any).alert = (_msg?: any) => {};
}
