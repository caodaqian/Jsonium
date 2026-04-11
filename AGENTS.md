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

## utools 介绍

utools 是一个插件化的启动器，支持各个主流平台执行

## API 介绍

### 基础文档
[插件应用目录结构](https://www.u-tools.cn/docs/developer/information/file-structure.html)
一个插件应用应该包含哪些文件，了解插件应用项目的文件目录结构

[plugin.json 配置](https://www.u-tools.cn/docs/developer/information/plugin-json.html)
插件应用基础配置文件 plugin.json 配置说明

[认识 preload](https://www.u-tools.cn/docs/developer/information/preload-js/preload-js.html)
plugin.json 配置的 preload js 文件可以调用 Node.js API 的本地原生能力和 Electron 渲染进程 API

[使用 Node.js](https://www.u-tools.cn/docs/developer/information/preload-js/nodejs.html)
preload js 文件遵循 CommonJS 规范，通过 require 引入 Node.js (16.x 版本) 模块


### API 文档

[事件](https://www.u-tools.cn/docs/developer/api-reference/utools/events.html)
你可以根据需要，事先传递一些回调函数给这些事件，uTools 会在对应事件被触发时调用它们

[窗口](https://www.u-tools.cn/docs/developer/api-reference/utools/window.html)
用来实现一些跟 uTools 窗口相关的功能

[复制](https://www.u-tools.cn/docs/developer/api-reference/utools/copy.html)
执行复制文本、图像、文件(夹)

[输入](https://www.u-tools.cn/docs/developer/api-reference/utools/input.html)
向系统窗口粘贴文本、图片、文件及向系统窗口输入文本

[系统](https://www.u-tools.cn/docs/developer/api-reference/utools/system.html)
弹出通知、打开文件、在资源管理器中显示文件...

[屏幕](https://www.u-tools.cn/docs/developer/api-reference/utools/screen.html)
取色、截图、及获取屏幕信息

[用户](https://www.u-tools.cn/docs/developer/api-reference/utools/user.html)
通过用户接口，可以获取到用户的基本信息、临时 token 等

[动态指令](https://www.u-tools.cn/docs/developer/api-reference/utools/features.html)
动态控制插件应用的功能指令

[模拟按键](https://www.u-tools.cn/docs/developer/api-reference/utools/simulate.html)
模拟用户的键盘与鼠标按键操作

[AI](https://www.u-tools.cn/docs/developer/api-reference/utools/ai.html)
调用 AI 能力，支持 Function Calling

[FFmpeg](https://www.u-tools.cn/docs/developer/api-reference/utools/ffmpeg.html)
FFmpeg 以独立扩展的方式集成到 uTools, 可直接调用 FFmpeg

[本地数据库](https://www.u-tools.cn/docs/developer/api-reference/db/local-db.html)
数据存储(离线优先，支持云备份&同步)

[dbStorage](https://www.u-tools.cn/docs/developer/api-reference/db/db-storage.html)
基于 本地数据库 基础上，封装的一套类 localStorage API

[dbCryptoStorage](https://www.u-tools.cn/docs/developer/api-reference/db/db-crypto-storage.html)
基于 本地数据库 数据加密存储, dbStorage 加密存储版本

[可编程浏览器](https://www.u-tools.cn/docs/developer/api-reference/ubrowser/ubrowser.html)
uTools browser 简称 ubrowser，是根据 uTools 的特性，量身打造的一个可编程浏览器

[ubrowser 管理](https://www.u-tools.cn/docs/developer/api-reference/ubrowser/ubrowser.html)
用于管理 ubrowser 的实例对象，以及设置 ubrowser 的代理对象等

[团队应用](https://www.u-tools.cn/docs/developer/api-reference/team.html)
团队版插件应用相关的接口

[用户付费](https://www.u-tools.cn/docs/developer/api-reference/payment.html)
插件应用接入增值付费

[服务端 API](https://www.u-tools.cn/docs/developer/api-reference/server.html)
服务端使用 uTools 相关的一些接口。

## vite 插件
本项目开发过程中使用 vite 做为 dev 工具开发，会自动监听变更，并在 `http://localhost:4000` 上提供服务

因此，如果需要查看语法错误，你仅需执行命令编译，**不要使用 `npm run dev`**;
如果需要查看浏览器效果，直接访问  `http://localhost:4000` 上提供的服务，**无需命名行启动**;