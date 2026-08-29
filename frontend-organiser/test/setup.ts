// vitest setup — runs before each test file's module graph is imported.
//
// Copied verbatim from frontend-respondents/test/setup.ts (the Tranche-A
// precedent). Some organiser code under test touches browser globals at import
// time (e.g. state stores reading localStorage in their constructors). Rather
// than pulling in jsdom, we install minimal Node-side stubs for the few globals
// the test graph touches. Tests may override these (window.location.href,
// alert) per-case.

(globalThis as any).localStorage = (() => {
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
})();

(globalThis as any).window = { location: { href: '' } };
(globalThis as any).document = { querySelector: () => null };
(globalThis as any).alert = (_msg?: any) => {};
