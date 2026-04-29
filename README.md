# AI Terminal

A macOS-first Warp-like terminal MVP built with Electron, React, TypeScript, `xterm.js`, `node-pty`, system OpenSSH, and an OpenAI-compatible LLM backend.

## Current MVP

- Local shell sessions through a real PTY.
- SSH sessions through the system `ssh` binary, so `~/.ssh/config`, ssh-agent, keys, and ProxyJump keep working normally.
- Right-side LLM panel with read-only context mode and agent mode.
- OpenAI-compatible provider settings with searchable model pickers.
- Model loading from `{baseUrl}/v1/models`.
- Streaming chat through `{baseUrl}/v1/chat/completions`.
- Agent mode can run safe commands in the active terminal and asks for in-app confirmation before risky commands.
- Command-risk checks use a separately selected safety model.
- Assistant responses render runnable fenced shell commands and markdown tables.
- API keys stored through the OS keychain via `keytar`; non-secret settings are stored in the Electron user data folder.

## Important LLM Note

ChatGPT Plus is not an official API entitlement. Use an OpenAI-compatible API key from OpenAI Platform, OpenRouter, LM Studio, or another compatible gateway.

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm run test
npm run build
```

## macOS Package

```bash
make build
```

The package is written to `dist/` as a `.pkg` installer and a `.zip` containing the macOS app. Local builds are unsigned unless a Developer ID signing identity is configured on the machine.

## Manual Acceptance

1. Start the app with `npm run dev`.
2. Confirm a local shell opens and accepts input.
3. Select terminal output and send a prompt in the LLM panel.
4. Configure an OpenAI-compatible `baseUrl`, save the API key, load models, and select chat and safety models.
5. Ask for a harmless command such as listing the current directory.
6. Verify agent mode runs a safe command in the active terminal.
7. Ask for a risky command and verify the in-app confirmation appears before execution.
8. Open an SSH session using a host from `~/.ssh/config` or a direct host/user pair.
