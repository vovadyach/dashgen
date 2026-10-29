# 4. npm workspaces for the TypeScript code

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The gateway is TypeScript, and the React frontend will be too. Until now the gateway owned the tools (TypeScript, ESLint, Prettier), and the Claude Code hooks borrowed them through relative paths. Each new package would have brought its own copy of the tools, its own settings and its own lockfile.

Some code also has to be shared. The frontend needs the gateway's request, response and error schemas: to check a question before sending it, and to know the shape of what comes back.

The options considered:

- **Separate packages,** each installed on its own. Simple, but the settings drift apart, and sharing schemas means copying them.
- **npm workspaces.** Built into npm: one install and one lockfile for every package, the tools installed once at the root, and local packages linked so they can import each other by name.
- **pnpm workspaces.** Faster installs and stricter about undeclared dependencies, but one more tool for every contributor and for CI.
- **Turborepo or Nx** on top. They cache and order tasks across packages, which pays off with dozens of packages, not three.

## Decision

The repo root is an npm workspace with `gateway` and `packages/*`. The frontend joins it in step 5.

- The root `package.json` holds the shared tools and the repo-wide scripts: `format`, `lint`, `typecheck` and `test`. `tsconfig.base.json` and `eslint.config.js` hold the shared settings, which each package and the hooks extend.
- `packages/contracts` holds the Zod schemas that more than one package needs. Packages import it as `@dashgen/contracts`.
- Packages are consumed as TypeScript source, with no build step. npm links `@dashgen/contracts` into `node_modules`, and Node follows the link to `packages/contracts`, where it runs the `.ts` files directly.

## Consequences

- One `npm ci` installs everything, and one lockfile pins it.
- A change to a schema in `contracts` is type-checked against every package that uses it in the same `make check`.
- The hooks use the root's tools directly, with no borrowed paths.
- npm hoists packages to the root `node_modules`, so a package can import a dependency it never declared and still work locally. Each package must list what it imports.
- Shared packages must stay TypeScript that Node can strip, because nothing compiles them.
- There's no task caching, so every check runs every time. At this size it takes seconds. Turborepo is the next step if that changes.
