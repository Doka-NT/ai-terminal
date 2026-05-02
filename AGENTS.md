# AI Terminal Agent Brief

Read this first when working in this project. Keep changes small, product-minded, and scoped to the user request.

## Product

AI Terminal is a macOS-first Electron desktop terminal with:

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
- Text size is entered with a number input and stored in `localStorage`; there is no HTML `min`, but invalid or non-positive values should not be applied to xterm.
- Dangerous command confirmation must be an in-app modal, not `window.confirm` or a browser/system alert.
- Use existing visual language: dark surfaces, restrained borders, lucide icons, compact controls.

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

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Run at least `npm run typecheck` after TypeScript changes. Prefer `npm run lint`, `npm test`, and `npm run build` before handing off larger changes.

## Editing Notes

- Prefer minimal changes over broad refactors.
- Do not rewrite generated `out/` files manually.
- Do not touch `node_modules/`.
- Keep IPC types in `src/shared/types.ts` synchronized with `src/preload/index.ts` and `src/main/index.ts`.
- API keys are secrets and belong in keychain via `keytar`; do not persist them in config files.
