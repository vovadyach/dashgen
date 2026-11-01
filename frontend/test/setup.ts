import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts each test's page by itself only when the test
// functions are globals, and here they're imported.
afterEach(() => {
  cleanup();
});

// jsdom has no ResizeObserver, and lays nothing out, so a width never
// changes. The question box watches its width only to fit its text again.
globalThis.ResizeObserver = class {
  observe() {
    // Nothing changes size in jsdom.
  }
  unobserve() {
    // Nothing to stop watching.
  }
  disconnect() {
    // Nothing to stop watching.
  }
};
