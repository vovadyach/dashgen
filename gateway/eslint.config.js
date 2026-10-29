// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  // The type-aware rules catch mistakes like a promise nobody awaits.
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // node:test's test() returns a promise that the runner itself awaits.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              name: ["test", "describe"],
              package: "node:test",
            },
          ],
        },
      ],
    },
  },
  {
    // This file isn't part of the TypeScript project, so it gets the plain rules.
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
