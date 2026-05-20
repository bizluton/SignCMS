import "@testing-library/jest-dom";

// Guard for tests using `// @vitest-environment node`, where `window` is undefined.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // jsdom doesn't ship ResizeObserver. Layout-aware components (DesignStage,
  // some studio widgets) expect it; provide a no-op stub so tests don't crash.
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe()   {}
      unobserve() {}
      disconnect() {}
    };
  }
}
