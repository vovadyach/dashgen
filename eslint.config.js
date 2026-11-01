// @ts-check
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  // Build output.
  globalIgnores(["**/dist/"]),
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
      // node:test's describe(), it() and test() return promises that the runner itself awaits.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              name: ["describe", "it", "test"],
              package: "node:test",
            },
          ],
        },
      ],
    },
  },
  {
    // React's rules for hooks and components, the ones its compiler relies on too.
    files: ["frontend/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // This file isn't part of the TypeScript project, so it gets the plain rules.
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
