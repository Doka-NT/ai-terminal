// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Minimal in-process simulation of the command:approve / command:runConfirmed gate
// without importing the full Electron main process.

function makeGate() {
  const pendingApprovedCommands = new Map<string, Set<string>>()

  function resolveSecretPlaceholders(command: string): string {
    return command
  }

  const terminalManager = {
    runConfirmed: vi.fn()
  }

  function normalizeApprovalKey(command: string): string {
    return command.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  }

  function handleApprove(sessionId: string, command: string): void {
    if (!pendingApprovedCommands.has(sessionId)) {
      pendingApprovedCommands.set(sessionId, new Set())
    }
    pendingApprovedCommands.get(sessionId)!.add(normalizeApprovalKey(command))
  }

  function handleRunConfirmed(sessionId: string, command: string): void {
    const approved = pendingApprovedCommands.get(sessionId)
    const resolvedCommand = resolveSecretPlaceholders(command)
    const approvalKey = normalizeApprovalKey(command)
    if (!approved?.has(approvalKey)) {
      throw new Error('Command was not approved before execution.')
    }
    approved.delete(approvalKey)
    try {
      terminalManager.runConfirmed(sessionId, resolvedCommand, command)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Unable to resolve local secret placeholders.')
    }
  }

  return { handleApprove, handleRunConfirmed, terminalManager, pendingApprovedCommands }
}

describe('command:runConfirmed authorization gate', () => {
  let gate: ReturnType<typeof makeGate>

  beforeEach(() => {
    gate = makeGate()
  })

  it('throws when runConfirmed is called without prior approve', () => {
    expect(() => gate.handleRunConfirmed('session-1', 'ls -la')).toThrow(
      'Command was not approved before execution.'
    )
    expect(gate.terminalManager.runConfirmed).not.toHaveBeenCalled()
  })

  it('succeeds when approve is called before runConfirmed', () => {
    gate.handleApprove('session-1', 'ls -la')
    expect(() => gate.handleRunConfirmed('session-1', 'ls -la')).not.toThrow()
    expect(gate.terminalManager.runConfirmed).toHaveBeenCalledWith('session-1', 'ls -la', 'ls -la')
  })

  it('throws on a second runConfirmed call without a new approve', () => {
    gate.handleApprove('session-1', 'ls -la')
    gate.handleRunConfirmed('session-1', 'ls -la')
    expect(() => gate.handleRunConfirmed('session-1', 'ls -la')).toThrow(
      'Command was not approved before execution.'
    )
    expect(gate.terminalManager.runConfirmed).toHaveBeenCalledTimes(1)
  })

  it('isolates approvals by session', () => {
    gate.handleApprove('session-1', 'ls -la')
    expect(() => gate.handleRunConfirmed('session-2', 'ls -la')).toThrow(
      'Command was not approved before execution.'
    )
  })

  it('isolates approvals by command string within the same session', () => {
    gate.handleApprove('session-1', 'ls -la')
    expect(() => gate.handleRunConfirmed('session-1', 'rm -rf /')).toThrow(
      'Command was not approved before execution.'
    )
  })

  it('matches multiline heredoc commands across CRLF/whitespace differences', () => {
    const approved = 'cat <<EOF\nhello\nworld\nEOF'
    // The executed command arrives with CRLF line endings and trailing whitespace,
    // as commonly happens with LLM-proposed heredoc commands.
    const executed = 'cat <<EOF\r\nhello\r\nworld\r\nEOF\r\n  '
    gate.handleApprove('session-1', approved)
    expect(() => gate.handleRunConfirmed('session-1', executed)).not.toThrow()
    expect(gate.terminalManager.runConfirmed).toHaveBeenCalledTimes(1)
  })
})
