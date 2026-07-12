# Taviraq Agent Brief

Read this first when working in this project. Keep changes small, product-minded, and scoped to the user request.

## Product

Taviraq is a macOS-first Electron desktop terminal with:

- real local PTY sessions via `node-pty`
- SSH sessions through the system `ssh` binary
- a right-side LLM assistant panel
- OpenAI-compatible provider/model configuration
- read-only context mode and agent mode
- command safety checks before agent-mode auto-execution

## Stack

- Electron + electron-vite
- React + TypeScript renderer
- `xterm.js` terminal UI
- `node-pty` shell sessions
- `keytar` for API keys
- OpenAI-compatible `/v1/models` and `/v1/chat/completions`

## Key Files

- `src/main/index.ts`: Electron window setup and IPC registration.
- `src/main/services/TerminalManager.ts`: PTY lifecycle, terminal writes/resizes, local and SSH sessions.
- `src/main/services/llmService.ts`: model listing, streaming chat, command-risk classification.
- `src/main/services/configStore.ts`: non-secret app config in Electron user data.
- `src/main/services/telemetryService.ts`: opt-in Aptabase telemetry; gating and event emission.
- `src/shared/telemetryConfig.ts`: telemetry settings defaults/normalization (shared main+renderer).
- `src/renderer/src/components/TelemetryConsent.tsx`: first-run opt-in consent prompt.
- `src/preload/index.ts`: safe renderer API bridge.
- `src/shared/types.ts`: IPC/shared domain types.
- `src/renderer/src/App.tsx`: shell layout, sessions, sidebar resize, persisted UI settings.
- `src/renderer/src/components/LlmPanel.tsx`: assistant chat, settings screen, agent loop, command confirmation.
- `src/renderer/src/components/TerminalPane.tsx`: xterm setup, terminal rendering, output buffer sync.
- `src/renderer/src/components/MessageContent.tsx`: assistant markdown-ish text and runnable code blocks.
- `src/renderer/src/styles.css`: app styling.

## Important Flows

- Renderer calls `window.api.*` from `src/preload/index.ts`; do not import Electron APIs in renderer components.
- LLM chat streams through `llm:chatStream` IPC events.
- Agent mode expects the assistant to return exactly one fenced shell command when a command is needed.
- Before agent mode auto-runs a command, renderer calls `llm:assessCommandRisk`.
- Command-risk checks use `provider.commandRiskModel`, not the normal chat model.
- If command-risk classification fails or cannot be parsed, treat the command as risky and require user confirmation.
- Agent command output is sent back to the LLM as context but shown in the chat as a subtle system-style output item, not a normal user bubble.

## UI/Product Rules

- Settings live in the settings screen, not inline inside the assistant sidebar.
- The assistant sidebar is user-resizable by dragging the divider; width is stored in `localStorage`.
- The sidebar default width is not the minimum width. Keep `DEFAULT_SIDEBAR_WIDTH`, `MIN_SIDEBAR_WIDTH`, `MAX_SIDEBAR_WIDTH`, `MIN_WORKSPACE_WIDTH`, the resizer width, and the matching CSS grid constraints synchronized.
- When changing assistant sidebar visibility animation, keep the grid track, resizer, and panel timings synchronized; disable those transitions during drag-resize so the divider follows the pointer immediately.
- For `localStorage` numeric preferences, check `getItem(...) === null` before `Number(...)`; `Number(null) === 0` can accidentally turn a missing value into the minimum.
- Text size is entered with a number input and stored in `localStorage`; there is no HTML `min`, but invalid or non-positive values should not be applied to xterm.
- Dangerous command confirmation must be an in-app modal, not `window.confirm` or a browser/system alert.
- Use existing visual language: dark surfaces, restrained borders, lucide icons, compact controls.
- For privacy/security features, prefer truthful UX over optimistic wording: never show "Protected" or a green enabled state unless the corresponding protection is effectively active at runtime.
- When a feature has a master toggle plus nested scope toggles, explicitly handle the "enabled, but no active scopes" state with a warning/empty protection state or by restoring safe defaults when the user re-enables it.
- For Electron layout/UI changes, verify the real Electron runtime when possible. A normal browser/Vite check may miss preload-only APIs, and a built app can still use stale `out/` assets until `npm run build` is run.
- When changing a renderer default applied through CSS variables, apply the selected value before the first paint (for example, in a layout effect or bootstrap style); a passive effect can visibly flash the old default.
- After significant privacy/security UI changes, add or update a screenshot smoke test that exercises the key states in the real Electron runtime, saves PNGs under ignored `screenshots/`, and assert-checks the key labels and ARIA state.

## Data Persistence & Import/Export

Persistent data types and their storage:
- **Providers**: `config.json` via ConfigStore (`src/main/services/configStore.ts`)
- **API Keys**: OS keychain via SecretStore (`src/main/services/secretStore.ts`)
- **Prompts**: `prompts/*.md` via PromptStore (`src/main/services/promptStore.ts`)
- **Preferences** (textSize, sidebarWidth): localStorage in renderer

### Adding new persistent data to import/export

1. Add field to `ExportData` in `src/shared/types.ts`
2. Collect in `data:export` handler (`src/main/index.ts`) — pass from renderer if stored in localStorage
3. Restore in `data:import` handler (`src/main/index.ts`) — implement merge logic (skip existing by ID/key)
4. Return new counts/values in `ImportResult` (`src/shared/types.ts`)
5. Apply in `handleImport()` in `LlmPanel.tsx`

## Telemetry

Privacy is a product value; treat telemetry as opt-in by default and keep these invariants:

- **Default off.** Nothing is sent until the user explicitly opts in (consent prompt or
  Settings toggle). `enabled` is forced false in `normalizeTelemetrySettings` unless the
  consent decision is `granted`, so a tampered/imported config cannot silently enable it.
- **Aggregate only.** Events carry no free-form content (no terminal text, commands,
  prompts, paths, secrets, persistent install id). The only app-supplied props are
  documented low-cardinality, non-identifying enums (currently just `error_class` on
  `ai_request_failed`); everything else is a bare name. Aptabase appends only coarse
  context (OS, version, locale, rotating session).
- **Release-only.** Runs solely in packaged signed release builds (no dev, no `0.0.0`
  unsigned packages) and only when an Aptabase key is configured; otherwise a hard no-op.
- **Consent lifecycle.** When adding/changing events, audit the full lifecycle: events
  fired before consent must replay after opt-in (`config:setTelemetrySettings`), the SDK
  must init before `app.whenReady()`, and telemetry settings must carry through
  import/export (see below). Emit events only from `main`, gated on consent.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:ui:screenshots
npm run build
```

Run at least `npm run typecheck` after TypeScript changes. Prefer `npm run lint`, `npm test`, and `npm run build` before handing off larger changes.

## PR QA (AI-Driven)

When asked to QA, test, or verify a specific PR number:

1. Follow `docs/qa/pr-qa-runbook.md` — it defines the full workflow.
2. Use `scripts/qa-pr-ai.mjs` to launch the Electron app and drive interactions.
3. Generate `--steps` JSON by reading the PR's `## Manual QA` section and the changed source files.
4. Read each screenshot with the `Read` tool (multimodal) and verify against the PR's expected results.
5. Produce a report in the format from `docs/qa/agent-runbook.md`.

Do not mark a Manual QA step as passed unless you have seen a screenshot or assertion confirming the expected behavior.

Visual evidence is always obtainable for this app, so never report that screenshots
could not be captured: the renderer is a headless-driveable Electron app. Drive it via
`scripts/qa-pr-ai.mjs`, or for ad-hoc checks launch it under Playwright + `TAVIRAQ_DEMO_MODE=1`
(see `scripts/record-demo.mjs` for the launch/typing/screenshot pattern). For behavior that
only manifests against a prior version, build the parent commit the same way and capture a
before/after pair.

## QA Catalog And Test-Case Runs

When asked to run or update Taviraq QA/test cases:

1. Read `docs/qa/README.md` and `docs/qa/agent-runbook.md`.
2. Use `scripts/qa-cases.mjs` only to list, filter, export, or generate report checklists. Do not describe checklist generation as running the test cases.
3. Treat `docs/qa/test-cases/*.md` as the source of truth for case IDs, steps, expected results, and automation notes.
4. For each requested case, actually execute the steps or the closest relevant automated, Electron smoke, or manual verification.
5. Do not mark a case as passed unless every expected result was actually checked.
6. For Electron smoke cases, prefer `TAVIRAQ_DEMO_MODE=1` when real provider credentials are not required. Capture observable evidence such as screenshots, IPC payloads, terminal output, or generated files.
7. After every run, write a Markdown report file and also paste the report in chat.
8. Report grouped results and include a `Not Passed` block with detailed `Reason`, `Expected`, `Actual`, `Evidence`, and `Next` fields for every failed, blocked, or skipped case.
9. Clearly distinguish:
   - tooling validation, such as `qa-cases.mjs list/json/report`;
   - automated project checks, such as lint, typecheck, tests, and build;
   - actual QA test-case execution.
10. If a case cannot be fully executed because of missing providers, SSH hosts, keychain access, packaging requirements, or other environment limits, mark it as `⚠️ blocked`, not passed.

## Editing Notes

- Prefer minimal changes over broad refactors.
- New first-party code files under `src/`, `tests/`, and `scripts/`, plus root
  TypeScript config files, must include an MPL-2.0 SPDX header in the correct
  syntax for their file type. Run `npm run check:spdx` before handing off.
- Do not rewrite generated `out/` files manually.
- Do not touch `node_modules/`.
- Keep IPC types in `src/shared/types.ts` synchronized with `src/preload/index.ts` and `src/main/index.ts`.
- API keys are secrets and belong in keychain via `keytar`; do not persist them in config files.
- A packaged app launched from Finder has no shell environment, so build-time config (keys,
  endpoints) must be injected via electron-vite `define` in `electron.vite.config.ts`, not
  read from `process.env` at runtime. Keep a `process.env` fallback only for tests.
