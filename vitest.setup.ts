import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Vitest isn't run with `globals: true`, so RTL's automatic afterEach-based
// cleanup (which detects a global `afterEach`) never registers on its own.
afterEach(cleanup);

// jsdom doesn't implement these, but Radix UI's Popover/Select/Command
// primitives call them during open/close and scroll handling.
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement matchMedia at all (calling it throws) —
// components that check prefers-reduced-motion before animating (e.g.
// HomeRouteChecker.tsx's focusAndScrollTo) would fail every test that
// exercises them without this. Defaults to "no preference" (matches:
// false); a test exercising the reduced-motion path overrides this itself.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}
