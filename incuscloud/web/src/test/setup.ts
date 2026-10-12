import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// The console imports much of Incendio: the first render of a file can take a while.
configure({ asyncUtilTimeout: 5000 });

// Node's own experimental localStorage global (undefined without --localstorage-file)
// hides jsdom's; give the tests an in-memory one.
if (!globalThis.localStorage) {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

// jsdom has no matchMedia; Incendio asks it for the colour scheme and screen sizes.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
