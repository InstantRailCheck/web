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
