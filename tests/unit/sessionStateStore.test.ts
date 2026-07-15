// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/ai-terminal-tests'
  }
}))

import { MAX_SAVED_OUTPUT_CHARS, normalizeSessionState, trimSavedOutput } from '@main/services/sessionStateStore'

describe('session state helpers', () => {
  it('keeps only the newest output when terminal scrollback exceeds the limit', () => {
    const output = `${'a'.repeat(MAX_SAVED_OUTPUT_CHARS)}tail`

    expect(trimSavedOutput(output)).toBe(`${'a'.repeat(MAX_SAVED_OUTPUT_CHARS - 4)}tail`)
  })

  it('does not bisect an OSC marker the naive cut would otherwise split', () => {
    const marker = '\x1b]633;E;ls;NONCE\x07'
    const output = 'x'.repeat(50) + marker + 'TAIL'
    const maxChars = 11 // lands inside the marker's payload for a naive slice(-11)

    expect(output.slice(-maxChars)).toBe(';NONCE\x07TAIL')
    expect(trimSavedOutput(output, maxChars)).toBe(marker + 'TAIL')
  })

  it('drops assistant threads for sessions that are no longer open', () => {
    const snapshot = normalizeSessionState({
      version: 1,
      savedAt: '2026-05-03T00:00:00.000Z',
      activeSessionId: 'missing',
      sessions: [{
        id: 'live',
        kind: 'local',
        label: 'zsh',
        command: '/bin/zsh',
        createdAt: 1,
        status: 'running',
        output: 'hello'
      }],
      assistantThreads: {
        live: { messages: [{ role: 'user', content: 'hi' }], draft: 'next' },
        missing: { messages: [{ role: 'assistant', content: 'stale' }], draft: '' }
      }
    })

    expect(snapshot.activeSessionId).toBe('live')
    expect(Object.keys(snapshot.assistantThreads)).toEqual(['live'])
  })

  it('preserves saved chat ids for restorable assistant threads', () => {
    const snapshot = normalizeSessionState({
      version: 1,
      savedAt: '2026-05-03T00:00:00.000Z',
      activeSessionId: 'live',
      sessions: [{
        id: 'live',
        kind: 'local',
        label: 'zsh',
        command: '/bin/zsh',
        createdAt: 1,
        status: 'running',
        output: ''
      }],
      assistantThreads: {
        live: {
          messages: [{ role: 'assistant', content: '2 secret(s) masked before sending to LLM.' }],
          draft: '',
          savedChatId: 'chat-privacy'
        }
      }
    })

    expect(snapshot.assistantThreads.live?.savedChatId).toBe('chat-privacy')
  })

  it('drops malformed saved chat ids from restorable assistant threads', () => {
    const snapshot = normalizeSessionState({
      version: 1,
      savedAt: '2026-05-03T00:00:00.000Z',
      activeSessionId: 'live',
      sessions: [{
        id: 'live',
        kind: 'local',
        label: 'zsh',
        command: '/bin/zsh',
        createdAt: 1,
        status: 'running',
        output: ''
      }],
      assistantThreads: {
        live: {
          messages: [],
          draft: '',
          savedChatId: 42 as unknown as string
        }
      }
    })

    expect(snapshot.assistantThreads.live?.savedChatId).toBeUndefined()
  })

  it('backfills an ssh reconnect command from the saved remote target', () => {
    const snapshot = normalizeSessionState({
      version: 1,
      savedAt: '2026-05-03T00:00:00.000Z',
      activeSessionId: 'ssh-tab',
      sessions: [{
        id: 'ssh-tab',
        kind: 'ssh',
        label: 'artem@cloud-vm',
        remoteHost: 'cloud-vm',
        remoteTarget: 'artem@cloud-vm',
        command: '/bin/zsh',
        createdAt: 1,
        status: 'disconnected',
        output: ''
      }],
      assistantThreads: {}
    })

    expect(snapshot.sessions[0].reconnectCommand).toBe('ssh artem@cloud-vm')
  })

  it('preserves a local shell integration nonce for trusted transcript restore', () => {
    const snapshot = normalizeSessionState({
      version: 1,
      savedAt: '2026-05-03T00:00:00.000Z',
      activeSessionId: 'local-tab',
      sessions: [{
        id: 'local-tab',
        kind: 'local',
        label: 'zsh',
        command: '/bin/zsh',
        createdAt: 1,
        shellIntegrationNonce: 'saved-nonce',
        status: 'running',
        output: '\x1b]633;E;pwd;saved-nonce\x07'
      }],
      assistantThreads: {}
    })

    expect(snapshot.sessions[0].shellIntegrationNonce).toBe('saved-nonce')
  })
})
