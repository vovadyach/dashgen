import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts each test's page by itself only when the test
// functions are globals, and here they're imported.
afterEach(() => {
  cleanup();
});
