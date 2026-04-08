# AGENTS.md — Jsonium Agent Guide

Purpose
-------
Guidance for automated agents and contributors working on Jsonium (a Vue 3 + Monaco Editor uTools plugin).

Quick commands
--------------
Use the npm scripts declared in `package.json`.

```
# Start dev server (Vite)
npm run dev

# Build for production
npm run build

# Run all tests (Vitest)
npm run test

# Run Vitest with UI
npm run test:ui

# Run a single test file
npm run test -- src/__tests__/textUtils.test.js

# Run a single named test across files (use -t)
npm run test -- -t "normalizeLineEndings"

# Run a single file with an explicit filter
npx vitest src/__tests__/textUtils.test.js -t "normalizeLineEndings"

# Watch mode
npm run test -- --watch
```

Repository layout
-----------------
- `package.json` — scripts & deps
- `vitest.config.js` — test config
- `src/` — source code (components, services, utils, store)
- `src/__tests__/` — unit tests

Essentials: code style and patterns
----------------------------------
JavaScript
- Language: JavaScript (no TypeScript). Use JSDoc for complex types.
- Modules: ESM (`import` / `export`).
- Prefer `const`; use `let` only for mutation.
- Prefer arrow functions for callbacks and small helpers.
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer access.

Vue components
- Use `<script setup>` and Composition API.
- Use `defineProps` / `defineEmits` for interfaces; `defineExpose` for imperative APIs.
- Use `ref` for primitives, `reactive` or `readonly` for objects where appropriate.

Imports & organization
- Order imports: external, absolute/alias (`@/...`), then relative.
- Prefer `@` alias for `src` when available: `import x from '@/services/x.js'`.

Naming conventions
- Files: camelCase (e.g. `textUtils.js`).
- Vue components: PascalCase (e.g. `Editor.vue`).
- Functions / variables: camelCase.
- Constants: UPPER_SNAKE_CASE.
- CSS classes: kebab-case.

Formatting & linting
- The repo currently has no enforced ESLint/Prettier scripts. Recommended scripts if added:
  - `lint: eslint --ext .js,.vue src`
  - `format: prettier --write "src/**/*.{js,vue,css,json,md}"`
- Keep functions focused and short (cognitive complexity ≈ 10–13 max).

Error handling pattern
- Use `try/catch` around JSON parsing and external calls.
- Service functions should return `{ success: true, data }` or `{ success: false, error }` rather than throwing for expected validation/runtime errors.
- Log non-critical warnings with `console.warn` and real failures with `console.error`.

Testing
- Tests use Vitest with `happy-dom`.
- Test files: `*.test.js` or `*.spec.js` under `src/__tests__/`.
- Use `describe` / `it` / `expect` and `vi` for mocks/spies.
- Run a single test file: `npm run test -- path/to/file`.
- Filter by test name: `npm run test -- -t "partial name"`.

Monaco & editor
- Dynamically import Monaco and register workers with `import.meta.url` to avoid bundler issues.
- Register formatting providers and themes at runtime.

Pinia & state
- Use `defineStore` with clear state/getters/actions. Keep actions for mutations.

Cursor & Copilot rules
----------------------
- No `.cursor/` or `.cursorrules` files found in the repo root.
- No `.github/copilot-instructions.md` found. If these appear later, include them in this document and follow their rules.

Agent behaviour rules
--------------------
1. Make minimal, focused edits. Do not modify unrelated files.
2. Run tests locally after changes: `npm run test`. Aim for green tests before committing.
3. Commit locally when making repo changes. Do not push or force-push to remotes unless explicitly requested.
4. When blocked by ambiguity, ask exactly one targeted question; otherwise choose reasonable defaults aligned with these guidelines.
5. Avoid destructive git commands. Do not amend others' commits; do not use `--no-verify` or bypass hooks.

Where to look
-------------
- `package.json` — scripts and deps
- `vitest.config.js` — test runner setup
- `src/__tests__/` — tests to run locally
- `src/services/`, `src/utils/`, `src/components/` — common change targets

Suggested improvements (optional)
--------------------------------
1. Add ESLint + Prettier with pre-commit hooks (Husky) to standardize style.
2. Add a `CONTRIBUTING.md` summarizing these agent rules for humans.
3. Add a `scripts/ci-checks.sh` that runs lint, test, and build for CI.

Change log & verification
-------------------------
- This file contains build/test commands, style rules, testing examples, and agent rules.
- If you want this change committed, tests run, or a PR opened, see the execution summary created by the agent.

End of file
