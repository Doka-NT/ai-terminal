// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { looksLikeShellPrompt, TerminalManager } from '../../src/main/services/TerminalManager'
import type { TerminalSessionInfo } from '../../src/shared/types'

function createManagerWithSession(
  info: Partial<TerminalSessionInfo>,
  inputLine?: string,
  sends: Array<{ channel: string; payload: unknown }> = []
): { manager: TerminalManager; writes: string[] } {
  const writes: string[] = []
  const manager = new TerminalManager(() => ({
    webContents: {
      send: (channel: string, payload: unknown) => sends.push({ channel, payload })
    }
  }) as never)
  const sessionInfo: TerminalSessionInfo = {
    id: 'session-1',
    kind: 'local',
    label: 'zsh',
    cwd: '/tmp',
    shell: '/bin/zsh',
    command: '/bin/zsh',
    createdAt: 1,
    ...info
  }

  ;(manager as unknown as {
    sessions: Map<string, unknown>
  }).sessions.set(sessionInfo.id, {
    info: sessionInfo,
    inputLine,
    pty: {
      write: (data: string) => writes.push(data),
      resize: () => undefined,
      kill: () => undefined,
      pid: 123
    }
  })

  return { manager, writes }
}

describe('TerminalManager.runConfirmed', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs confirmed commands without changing the existing empty-line behavior', () => {
    const { manager, writes } = createManagerWithSession({})

    manager.runConfirmed('session-1', 'pwd')

    expect(writes).toEqual(['pwd\r'])
  })

  it('cancels pending user input before running a confirmed local command', () => {
    vi.useFakeTimers()
    const { manager, writes } = createManagerWithSession({}, 'git status')

    manager.runConfirmed('session-1', 'pwd')

    expect(writes).toEqual(['\x03'])

    vi.advanceTimersByTime(100)

    expect(writes).toEqual(['\x03', 'pwd\r'])
  })

  it('cancels pending user input before running a confirmed SSH command', () => {
    vi.useFakeTimers()
    const { manager, writes } = createManagerWithSession({ kind: 'ssh' }, 'ls')

    manager.runConfirmed('session-1', 'pwd')

    expect(writes).toEqual(['\x03'])

    vi.advanceTimersByTime(100)

    expect(writes).toEqual(['\x03', 'pwd\r'])
  })

  it('keeps local sessions local when running SSH-looking confirmed commands', () => {
    const sends: Array<{ channel: string; payload: unknown }> = []
    const { manager, writes } = createManagerWithSession({}, undefined, sends)

    manager.runConfirmed('session-1', 'ssh git@github.com')

    const [session] = manager.list()
    expect(writes).toEqual(['ssh git@github.com\r'])
    expect(session.kind).toBe('local')
    expect(session.label).toBe('zsh')
    expect(session.remoteHost).toBeUndefined()
    expect(session.remoteTarget).toBeUndefined()
    expect(session.reconnectCommand).toBeUndefined()
    expect(sends.filter((send) => send.channel === 'terminal:session')).toEqual([])
  })

  it('writes resolved SSH commands while emitting placeholder metadata', () => {
    const sends: Array<{ channel: string; payload: unknown }> = []
    const { manager, writes } = createManagerWithSession({ kind: 'ssh' }, undefined, sends)

    manager.runConfirmed(
      'session-1',
      'curl -H "Authorization: Bearer real-token" https://example.test',
      'curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test'
    )

    expect(writes).toEqual(['curl -H "Authorization: Bearer real-token" https://example.test\r'])
    expect(sends).toContainEqual({
      channel: 'terminal:command',
      payload: {
        sessionId: 'session-1',
        command: 'curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test',
        echoed: false
      }
    })
  })

  it('uses placeholder metadata for resolved local command markers', () => {
    const { manager } = createManagerWithSession({})

    manager.runConfirmed(
      'session-1',
      'curl -H "Authorization: Bearer real-token" https://example.test',
      'curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test'
    )

    const display = (manager as unknown as {
      displayCommandForParsedMarker: (session: unknown, command: string) => string
      sessions: Map<string, unknown>
    }).displayCommandForParsedMarker(
      (manager as unknown as { sessions: Map<string, unknown> }).sessions.get('session-1'),
      'curl -H "Authorization: Bearer real-token" https://example.test'
    )

    expect(display).toBe('curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test')
  })

  it('emits command events for commands typed inside direct SSH sessions', () => {
    const sends: Array<{ channel: string; payload: unknown }> = []
    const { manager, writes } = createManagerWithSession({ kind: 'ssh' }, undefined, sends)

    manager.write('session-1', 'ls -la\r')

    const [session] = manager.list()
    expect(writes).toEqual(['ls -la\r'])
    expect(session.kind).toBe('ssh')
    expect(sends).toContainEqual({
      channel: 'terminal:command',
      payload: { sessionId: 'session-1', command: 'ls -la', echoed: false }
    })
  })

  it('keeps local sessions local when typing SSH-looking commands', () => {
    const sends: Array<{ channel: string; payload: unknown }> = []
    const { manager, writes } = createManagerWithSession({}, undefined, sends)

    manager.write('session-1', 'git fetch origin main\r')
    manager.write('session-1', 'ssh -T git@github.com\r')

    const [session] = manager.list()
    expect(writes).toEqual(['git fetch origin main\r', 'ssh -T git@github.com\r'])
    expect(session.kind).toBe('local')
    expect(session.label).toBe('zsh')
    expect(session.remoteHost).toBeUndefined()
    expect(session.remoteTarget).toBeUndefined()
    expect(session.reconnectCommand).toBeUndefined()
    expect(sends.filter((send) => send.channel === 'terminal:session')).toEqual([])
  })
})

describe('TerminalManager.connectSshCommand', () => {
  it('spawns duplicated SSH tabs as SSH sessions with preserved metadata', () => {
    const manager = new TerminalManager(() => undefined)
    const spawn = vi.spyOn(manager as unknown as {
      spawn: (options: unknown) => TerminalSessionInfo
    }, 'spawn').mockReturnValue({
      id: 'session-2',
      kind: 'ssh',
      label: 'Production',
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com',
      reconnectCommand: 'ssh -p 2222 deploy@myhost.com',
      command: 'ssh -p 2222 deploy@myhost.com',
      createdAt: 2
    })

    const session = manager.connectSshCommand({
      command: 'ssh -p 2222 deploy@myhost.com',
      cwd: '/tmp',
      label: 'Production'
    })

    expect(session.kind).toBe('ssh')
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'ssh',
      label: 'Production',
      command: 'ssh -p 2222 deploy@myhost.com',
      file: 'ssh',
      args: ['-p', '2222', 'deploy@myhost.com'],
      cwd: '/tmp',
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com',
      reconnectCommand: 'ssh -p 2222 deploy@myhost.com'
    }))
  })

  it('expands common shell path syntax only for local SSH path options', () => {
    const manager = new TerminalManager(() => undefined)
    const spawn = vi.spyOn(manager as unknown as {
      spawn: (options: unknown) => TerminalSessionInfo
    }, 'spawn').mockReturnValue({
      id: 'session-3',
      kind: 'ssh',
      label: 'deploy@myhost.com',
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com',
      reconnectCommand: 'ssh -i "$HOME/.ssh/id_ed25519" -F ~/ssh/config deploy@myhost.com \'echo $HOME\'',
      command: 'ssh -i "$HOME/.ssh/id_ed25519" -F ~/ssh/config deploy@myhost.com \'echo $HOME\'',
      createdAt: 3
    })

    manager.connectSshCommand({
      command: 'ssh -i "$HOME/.ssh/id_ed25519" -F ~/ssh/config deploy@myhost.com \'echo $HOME\'',
      cwd: '/tmp'
    })
    const home = homedir()

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        '-i',
        `${process.env.HOME ?? ''}/.ssh/id_ed25519`,
        '-F',
        `${home}/ssh/config`,
        'deploy@myhost.com',
        'echo $HOME'
      ]
    }))
  })

  it('expands path-like -o values without touching remote commands', () => {
    const manager = new TerminalManager(() => undefined)
    const spawn = vi.spyOn(manager as unknown as {
      spawn: (options: unknown) => TerminalSessionInfo
    }, 'spawn').mockReturnValue({
      id: 'session-4',
      kind: 'ssh',
      label: 'deploy@myhost.com',
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com',
      reconnectCommand: 'ssh -o IdentityFile=$HOME/.ssh/id_ed25519 deploy@myhost.com \'echo ${HOME}\'',
      command: 'ssh -o IdentityFile=$HOME/.ssh/id_ed25519 deploy@myhost.com \'echo ${HOME}\'',
      createdAt: 4
    })

    manager.connectSshCommand({
      command: 'ssh -o IdentityFile=$HOME/.ssh/id_ed25519 deploy@myhost.com \'echo ${HOME}\'',
      cwd: '/tmp'
    })

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        '-o',
        `IdentityFile=${process.env.HOME ?? ''}/.ssh/id_ed25519`,
        'deploy@myhost.com',
        'echo ${HOME}'
      ]
    }))
  })

  it('does not treat -l login values as the SSH target', () => {
    const manager = new TerminalManager(() => undefined)
    const spawn = vi.spyOn(manager as unknown as {
      spawn: (options: unknown) => TerminalSessionInfo
    }, 'spawn').mockReturnValue({
      id: 'session-5',
      kind: 'ssh',
      label: 'deploy@myhost.com',
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com',
      reconnectCommand: 'ssh -l deploy -i ~/id_ed25519 myhost.com',
      command: 'ssh -l deploy -i ~/id_ed25519 myhost.com',
      createdAt: 5
    })

    manager.connectSshCommand({
      command: 'ssh -l deploy -i ~/id_ed25519 myhost.com',
      cwd: '/tmp'
    })

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        '-l',
        'deploy',
        '-i',
        `${homedir()}/id_ed25519`,
        'myhost.com'
      ],
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com'
    }))
  })

  it('does not expand single-quoted SSH path option values', () => {
    const manager = new TerminalManager(() => undefined)
    const spawn = vi.spyOn(manager as unknown as {
      spawn: (options: unknown) => TerminalSessionInfo
    }, 'spawn').mockReturnValue({
      id: 'session-6',
      kind: 'ssh',
      label: 'myhost.com',
      remoteHost: 'myhost.com',
      remoteTarget: 'myhost.com',
      reconnectCommand: 'ssh -i \'$HOME/.ssh/id_ed25519\' -F "$HOME/.ssh/config" myhost.com',
      command: 'ssh -i \'$HOME/.ssh/id_ed25519\' -F "$HOME/.ssh/config" myhost.com',
      createdAt: 6
    })

    manager.connectSshCommand({
      command: 'ssh -i \'$HOME/.ssh/id_ed25519\' -F "$HOME/.ssh/config" myhost.com',
      cwd: '/tmp'
    })

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        '-i',
        '$HOME/.ssh/id_ed25519',
        '-F',
        `${process.env.HOME ?? ''}/.ssh/config`,
        'myhost.com'
      ]
    }))
  })

  it('does not treat -P tag values as the SSH target', () => {
    const manager = new TerminalManager(() => undefined)
    const spawn = vi.spyOn(manager as unknown as {
      spawn: (options: unknown) => TerminalSessionInfo
    }, 'spawn').mockReturnValue({
      id: 'session-7',
      kind: 'ssh',
      label: 'myhost.com',
      remoteHost: 'myhost.com',
      remoteTarget: 'myhost.com',
      reconnectCommand: 'ssh -P work -i ~/id_ed25519 myhost.com',
      command: 'ssh -P work -i ~/id_ed25519 myhost.com',
      createdAt: 7
    })

    manager.connectSshCommand({
      command: 'ssh -P work -i ~/id_ed25519 myhost.com',
      cwd: '/tmp'
    })

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        '-P',
        'work',
        '-i',
        `${homedir()}/id_ed25519`,
        'myhost.com'
      ],
      remoteHost: 'myhost.com',
      remoteTarget: 'myhost.com'
    }))
  })
})

describe('looksLikeShellPrompt', () => {
  it('recognizes SSH prompts that include bracketed paste and OSC title sequences', () => {
    expect(looksLikeShellPrompt('\x1b[?2004h\x1b]0;deploy@example: ~\x07deploy@example:~$ ')).toBe(true)
  })

  it('recognizes SSH prompts that include ST-terminated OSC title sequences', () => {
    expect(looksLikeShellPrompt('\x1b]0;deploy@example: ~\x1b\\deploy@example:~$ ')).toBe(true)
  })

  it('preserves prompt text between multiple ST-terminated OSC title sequences', () => {
    expect(looksLikeShellPrompt('\x1b]0;before\x1b\\deploy@example:~$ \x1b]0;after\x1b\\')).toBe(true)
  })
})
