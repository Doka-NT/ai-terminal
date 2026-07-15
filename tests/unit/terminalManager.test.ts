// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHookEnv, detectOsc133Prompt, looksLikeShellPrompt, rewrite633E, TerminalManager } from '../../src/main/services/TerminalManager'
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

  it('writes resolved SSH commands and stores placeholder for 633;E rewrite', () => {
    const sends: Array<{ channel: string; payload: unknown }> = []
    const { manager, writes } = createManagerWithSession({ kind: 'ssh' }, undefined, sends)

    manager.runConfirmed(
      'session-1',
      'curl -H "Authorization: Bearer real-token" https://example.test',
      'curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test'
    )

    expect(writes).toEqual(['curl -H "Authorization: Bearer real-token" https://example.test\r'])
    // terminal:command is no longer emitted — placeholder rewriting is done via rewrite633E
    expect(sends.filter((s) => s.channel === 'terminal:command')).toEqual([])
    // pendingCommandDisplay should be set so rewrite633E can substitute the placeholder
    const session = (manager as unknown as { sessions: Map<string, { pendingCommandDisplay?: { written: string; display: string } }> }).sessions.get('session-1')
    expect(session?.pendingCommandDisplay).toEqual({
      written: 'curl -H "Authorization: Bearer real-token" https://example.test',
      display: 'curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test'
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

  it('writes typed commands in SSH sessions without emitting terminal:command', () => {
    const sends: Array<{ channel: string; payload: unknown }> = []
    const { manager, writes } = createManagerWithSession({ kind: 'ssh' }, undefined, sends)

    manager.write('session-1', 'ls -la\r')

    expect(writes).toEqual(['ls -la\r'])
    // SSH command tracking now relies on shell 633;E hooks rather than input interception
    expect(sends.filter((s) => s.channel === 'terminal:command')).toEqual([])
  })
})

describe('OSC 633 command metadata', () => {
  it('buffers split command markers until it can replace resolved secrets', () => {
    const session = {
      pendingCommandDisplay: {
        written: 'curl -H "Authorization: Bearer real-token" https://example.test',
        display: 'curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test'
      }
    }

    const first = rewrite633E(
      session as never,
      'before\x1b]633;E;curl -H "Authorization: Bearer real-token" https://example.test;nonce'
    )
    const second = rewrite633E(session as never, '\x07after')

    expect(first).toBe('before')
    expect(second).toBe(
      '\x1b]633;E;curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_TOKEN]]" https://example.test;nonce\x07after'
    )
    expect(session.pendingCommandDisplay).toBeUndefined()
    expect(second).not.toContain('real-token')
  })

  it('buffers a command marker prefix split across PTY chunks', () => {
    const session = {
      pendingCommandDisplay: {
        written: 'echo real-token',
        display: 'echo [[TAVIRAQ_SECRET_1_TOKEN]]'
      }
    }

    expect(rewrite633E(session as never, 'before\x1b]63')).toBe('before')
    expect(rewrite633E(session as never, '3;E;echo real-token;nonce\x07after')).toBe(
      '\x1b]633;E;echo [[TAVIRAQ_SECRET_1_TOKEN]];nonce\x07after'
    )
  })

  it('preserves unmatched command markers without duplicating the nonce', () => {
    const session = {
      pendingCommandDisplay: {
        written: 'echo real-token',
        display: 'echo [[TAVIRAQ_SECRET_1_TOKEN]]'
      }
    }

    expect(rewrite633E(session as never, '\x1b]633;E;pwd;nonce\x07')).toBe(
      '\x1b]633;E;pwd;nonce\x07'
    )
  })

  it('matches the written command when it contains a literal backslash before a delimiter escape', () => {
    // Real command: printf '\x3b' real-token. The hook escapes the literal
    // backslash first (\ -> \\), so the wire payload carries two backslashes
    // before x3b. A naive sequential-replace decoder would fail to match this
    // against `written`, silently skipping the secret placeholder substitution.
    const session = {
      pendingCommandDisplay: {
        written: "printf '\\x3b' real-token",
        display: "printf '\\x3b' [[TAVIRAQ_SECRET_1_TOKEN]]"
      }
    }

    expect(rewrite633E(session as never, "\x1b]633;E;printf '\\\\x3b' real-token;nonce\x07")).toBe(
      "\x1b]633;E;printf '\\\\x3b' [[TAVIRAQ_SECRET_1_TOKEN]];nonce\x07"
    )
    expect(session.pendingCommandDisplay).toBeUndefined()
  })

  it('buffers a split 633;E marker even with no secret substitution pending', () => {
    const session: { pendingCommandDisplay?: unknown; osc633ERemainder?: string } = {}

    const first = rewrite633E(session as never, 'before\x1b]633;E;ls')
    expect(first).toBe('before')
    expect(session.osc633ERemainder).toBeTruthy()
    expect(first).not.toContain('nonce')

    const second = rewrite633E(session as never, ';nonce\x07after')
    expect(second).toBe('\x1b]633;E;ls;nonce\x07after')
    expect(session.osc633ERemainder).toBeUndefined()
  })

  it('buffers a split 133 prompt marker (not just 633;E) even with no secret pending', () => {
    const session: { osc633ERemainder?: string } = {}

    const first = rewrite633E(session as never, 'before\x1b]133;')
    expect(first).toBe('before')
    expect(session.osc633ERemainder).toBeTruthy()

    const second = rewrite633E(session as never, 'A\x07after')
    expect(second).toBe('\x1b]133;A\x07after')
    expect(session.osc633ERemainder).toBeUndefined()
  })

  it('buffers a split 633;P cwd marker (not just 633;E) even with no secret pending', () => {
    const session: { osc633ERemainder?: string } = {}

    const first = rewrite633E(session as never, 'before\x1b]633;P;Cwd=/tmp')
    expect(first).toBe('before')
    expect(session.osc633ERemainder).toBeTruthy()

    const second = rewrite633E(session as never, '\x07after')
    expect(second).toBe('\x1b]633;P;Cwd=/tmp\x07after')
    expect(session.osc633ERemainder).toBeUndefined()
  })

  it('passes complete 133 and 633;P markers through unchanged', () => {
    const session = {}
    expect(rewrite633E(session as never, 'x\x1b]133;A\x07y\x1b]633;P;Cwd=/tmp\x07z')).toBe(
      'x\x1b]133;A\x07y\x1b]633;P;Cwd=/tmp\x07z'
    )
  })
})

describe('shell integration nonce isolation', () => {
  const tempDirs: string[] = []
  const originalHome = process.env.HOME
  const originalPs1 = process.env.PS1
  const originalPs0 = process.env.PS0
  const originalPromptCommand = process.env.PROMPT_COMMAND

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalPs1 === undefined) delete process.env.PS1
    else process.env.PS1 = originalPs1
    if (originalPs0 === undefined) delete process.env.PS0
    else process.env.PS0 = originalPs0
    if (originalPromptCommand === undefined) delete process.env.PROMPT_COMMAND
    else process.env.PROMPT_COMMAND = originalPromptCommand
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    ['/bin/bash', 'bash_init'],
    ['/bin/zsh', '.zshrc'],
    ['/opt/homebrew/bin/fish', 'fish/conf.d/taviraq.fish']
  ])('embeds the nonce in the %s hook without exporting it to child commands', (shell, hookPath) => {
    const hook = buildHookEnv(shell, 'test-nonce')
    if (hook.zdotdir) tempDirs.push(hook.zdotdir)

    expect(hook.env).not.toHaveProperty('TAVIRAQ_SI_NONCE')
    expect(readFileSync(join(hook.zdotdir ?? '', hookPath), 'utf8')).toContain('test-nonce')
    expect(readFileSync(join(hook.zdotdir ?? '', hookPath), 'utf8')).not.toContain('set -gx TAVIRAQ_SI_NONCE')
  })

  it('injects fish hooks after normal startup without replacing XDG_CONFIG_HOME', () => {
    const hook = buildHookEnv('/opt/homebrew/bin/fish', 'test-nonce')
    if (hook.zdotdir) tempDirs.push(hook.zdotdir)

    expect(hook.env).not.toHaveProperty('XDG_CONFIG_HOME')
    expect(hook.args?.[0]).toBe('-C')
    expect(hook.args?.[1]).toContain('taviraq.fish')
    expect(readFileSync(join(hook.zdotdir ?? '', 'fish/conf.d/taviraq.fish'), 'utf8')).not.toContain('config.fish')
  })

  it('layers bash hooks over prompt state set by .bashrc and remains idempotent', () => {
    const home = mkdtempSync(join(tmpdir(), 'ait-bash-home-'))
    tempDirs.push(home)
    process.env.HOME = home
    process.env.PS1 = 'stale-parent-prompt'
    process.env.PS0 = 'stale-parent-ps0'
    process.env.PROMPT_COMMAND = 'stale_parent_hook'
    writeFileSync(join(home, '.bashrc'), [
      "PS1='custom-prompt> '",
      "PS0='user-ps0:'",
      "PROMPT_COMMAND=('printf user-one' 'printf user-two')"
    ].join('\n') + '\n')

    const hook = buildHookEnv('/bin/bash', 'test-nonce')
    if (hook.zdotdir) tempDirs.push(hook.zdotdir)
    const initFile = hook.args?.[1]
    expect(initFile).toBeTruthy()

    const output = execFileSync('/bin/bash', ['--noprofile', '-c', [
      'source "$1"',
      'source "$1"',
      'declare -p PS1 PS0 PROMPT_COMMAND ___ait_si_installed'
    ].join('\n'), 'bash', initFile ?? ''], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home }
    })

    const promptCommand = output.split('\n').find((line) => line.includes('PROMPT_COMMAND=')) ?? ''
    expect(output).toContain('custom-prompt> ')
    expect(output).toContain('user-ps0:')
    expect(output).not.toContain('stale-parent')
    expect(promptCommand).toContain('printf user-one')
    expect(promptCommand).toContain('printf user-two')
    expect(promptCommand.match(/___ait_si_precmd/g)).toHaveLength(1)
    expect(output).toContain('___ait_si_installed="1"')
  })

  it('preserves string PROMPT_COMMAND and handles unset prompt variables', () => {
    const home = mkdtempSync(join(tmpdir(), 'ait-bash-home-'))
    tempDirs.push(home)
    process.env.HOME = home
    writeFileSync(join(home, '.bashrc'), [
      'unset PS1 PS0',
      "PROMPT_COMMAND='printf user-hook'"
    ].join('\n') + '\n')

    const hook = buildHookEnv('/bin/bash', 'test-nonce')
    if (hook.zdotdir) tempDirs.push(hook.zdotdir)
    const initFile = hook.args?.[1]
    const output = execFileSync('/bin/bash', ['--noprofile', '-c', [
      'source "$1"',
      'declare -p PS1 PS0 PROMPT_COMMAND',
      'trap -p DEBUG'
    ].join('\n'), 'bash', initFile ?? ''], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home }
    })

    expect(output).toContain('printf user-hook')
    expect(output).toContain('133;A')
    expect(output).toContain('133;B')
    // Command text is captured via a DEBUG trap, not PS0 — $BASH_COMMAND
    // inside a PS0 substitution resolves to the substitution's own text, not
    // the command that triggered the prompt (verified directly in bash 5.3).
    expect(output).toContain('___ait_si_debug_hook')
  })

  it('captures the real typed command via the DEBUG trap, not the hook invocation itself', () => {
    // Regression test for a real bug: $BASH_COMMAND inside a PS0 command
    // substitution (or even a bare parameter expansion) resolves to the
    // substitution's OWN text, not the command that triggered the prompt —
    // verified directly in bash 5.3 with a real PTY. Every bash block's
    // command used to be the hook's own source text instead of what the
    // user ran. The DEBUG trap is the only mechanism that reliably sees the
    // real upcoming command.
    const home = mkdtempSync(join(tmpdir(), 'ait-bash-home-'))
    tempDirs.push(home)
    process.env.HOME = home
    writeFileSync(join(home, '.bashrc'), '')

    const hook = buildHookEnv('/bin/bash', 'test-nonce')
    if (hook.zdotdir) tempDirs.push(hook.zdotdir)
    const initFile = hook.args?.[1]

    const output = execFileSync('/bin/bash', ['--noprofile', '-c', [
      'source "$1"',
      'echo hi'
    ].join('\n'), 'bash', initFile ?? ''], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home }
    })

    expect(output).toContain('633;E;echo hi;test-nonce')
    expect(output).not.toContain('___ait_si_debug_hook;test-nonce')
    expect(output).not.toContain("PS0='")
  })

  it('preserves the last command exit status through the precmd hook for chained PROMPT_COMMAND entries', () => {
    const home = mkdtempSync(join(tmpdir(), 'ait-bash-home-'))
    tempDirs.push(home)
    process.env.HOME = home
    writeFileSync(join(home, '.bashrc'), '')

    const hook = buildHookEnv('/bin/bash', 'test-nonce')
    if (hook.zdotdir) tempDirs.push(hook.zdotdir)
    const initFile = hook.args?.[1]

    // Simulates what bash does when ___ait_si_precmd runs as one PROMPT_COMMAND
    // array entry among others: the exit status it leaves behind is what the
    // NEXT entry (e.g. a user's status-aware prompt hook) will see as $?.
    const output = execFileSync('/bin/bash', ['--noprofile', '-c', [
      'source "$1"',
      'false',
      '___ait_si_precmd >/dev/null',
      'echo "STATUS=$?"'
    ].join('\n'), 'bash', initFile ?? ''], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home }
    })

    expect(output).toContain('STATUS=1')
  })
})

describe('OSC 133 prompt detection', () => {
  it('recognizes BEL and ST prompt markers, including split chunks', () => {
    const session: { osc133PromptRemainder?: string } = {}

    expect(detectOsc133Prompt(session as never, 'before\x1b]133;')).toBe(false)
    expect(detectOsc133Prompt(session as never, 'A\x07after')).toBe(true)
    expect(detectOsc133Prompt(session as never, '\x1b]133;A\x1b\\')).toBe(true)
  })

  it('does not report unrelated OSC 133 lifecycle markers as prompts', () => {
    const session: { osc133PromptRemainder?: string } = {}

    expect(detectOsc133Prompt(session as never, '\x1b]133;C\x07')).toBe(false)
    expect(session.osc133PromptRemainder).toBeUndefined()
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
