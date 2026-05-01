import type { BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import pty from 'node-pty'
import type { CreateTerminalRequest, SSHProfile, TerminalSessionInfo } from '@shared/types'
import { buildSshCommand } from '@main/utils/ssh'

const execFileAsync = promisify(execFile)

// OSC marker emitted by shell hook on every prompt
const PROMPT_OSC = '\x1b]6973;PROMPT\x07'

// Literal text of the printf command appended by runConfirmed for SSH sessions.
// We filter this text from terminal output so the user never sees it.
const PROMPT_ECHO_SNIPPET = "; printf '\\x1b]6973;PROMPT\\x07'"

interface ManagedSession {
  pty: pty.IPty
  info: TerminalSessionInfo
  cwdTimer?: NodeJS.Timeout
  zdotdir?: string  // temp dir to clean up on kill
  promptMarkerRemainder?: string
  /** Buffered data while looking for PROMPT_ECHO_SNIPPET in the output stream. */
  echoFilterBuffer?: string
}

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedSession>()

  constructor(private readonly getWindow: () => BrowserWindow | undefined) {}

  createLocal(request: CreateTerminalRequest = {}): TerminalSessionInfo {
    const shell = process.env.SHELL || '/bin/zsh'
    const cwd = request.cwd || process.env.HOME || homedir()

    return this.spawn({
      kind: 'local',
      label: shell.split('/').at(-1) || 'shell',
      command: shell,
      file: shell,
      args: [],
      cwd,
      cols: request.cols,
      rows: request.rows,
      shell
    })
  }

  connectSsh(profile: SSHProfile, request: CreateTerminalRequest = {}): TerminalSessionInfo {
    const ssh = buildSshCommand(profile)

    return this.spawn({
      kind: 'ssh',
      label: ssh.label,
      command: `${ssh.command} ${ssh.args.join(' ')}`,
      file: ssh.command,
      args: ssh.args,
      cwd: process.env.HOME || homedir(),
      cols: request.cols,
      rows: request.rows
    })
  }

  write(sessionId: string, data: string): void {
    this.requireSession(sessionId).pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.requireSession(sessionId).pty.resize(cols, rows)
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    if (session.cwdTimer) {
      clearInterval(session.cwdTimer)
    }
    if (session.zdotdir) {
      try { rmSync(session.zdotdir, { recursive: true }) } catch { /* ignore */ }
    }

    session.pty.kill()
    this.sessions.delete(sessionId)
    this.emit('terminal:exit', { sessionId, exitCode: 0 })
  }

  runConfirmed(sessionId: string, command: string): void {
    const normalized = command.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    if (!normalized) {
      return
    }

    const session = this.requireSession(sessionId)
    // For SSH sessions the shell hook is not installed, so we append a printf that
    // emits the PROMPT_OSC marker after the command finishes.  The literal echo of
    // the printf is stripped from terminal output so the user never sees it.
    if (session.info.kind === 'ssh') {
      session.echoFilterBuffer = ''
      this.write(sessionId, `${normalized}${PROMPT_ECHO_SNIPPET}\r`)
    } else {
      this.write(sessionId, `${normalized}\r`)
    }
  }

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info)
  }

  private spawn(options: {
    kind: TerminalSessionInfo['kind']
    label: string
    command: string
    file: string
    args: string[]
    cwd: string
    cols?: number
    rows?: number
    shell?: string
  }): TerminalSessionInfo {
    const id = randomUUID()
    const info: TerminalSessionInfo = {
      id,
      kind: options.kind,
      label: options.label,
      cwd: options.cwd,
      shell: options.shell,
      command: options.command,
      createdAt: Date.now()
    }

    const hookEnv = options.kind === 'local' ? buildHookEnv(options.shell) : { env: {} }

    const child = pty.spawn(options.file, options.args, {
      name: 'xterm-256color',
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      cwd: options.cwd,
      env: { ...createPtyEnv(), ...hookEnv.env }
    })

    const managed: ManagedSession = { pty: child, info, zdotdir: hookEnv.zdotdir }
    this.sessions.set(id, managed)

    child.onData((data) => {
      // Filter the echo of the appended printf from SSH agent commands
      let filtered = data
      if (managed.echoFilterBuffer !== undefined) {
        const combined = managed.echoFilterBuffer + data
        const idx = combined.indexOf(PROMPT_ECHO_SNIPPET)
        if (idx !== -1) {
          // Found the echo snippet — remove it and stop filtering
          filtered = combined.slice(0, idx) + combined.slice(idx + PROMPT_ECHO_SNIPPET.length)
          managed.echoFilterBuffer = undefined
        } else {
          // Not found yet — keep buffering (up to a reasonable limit)
          if (combined.length > 4096) {
            // Give up filtering — the snippet should have appeared by now
            filtered = combined
            managed.echoFilterBuffer = undefined
          } else {
            managed.echoFilterBuffer = combined
            filtered = ''
          }
        }
      }

      if (filtered) {
        const parsed = stripPromptMarkers(managed, filtered)
        if (parsed.sawPrompt) {
          this.emit('terminal:prompt', { sessionId: id })
        }
        if (parsed.data) {
          this.emit('terminal:data', { sessionId: id, data: parsed.data })
        }
      } else {
        // Even when echo-filter swallows all data, still check for prompt markers
        // in the buffer so we don't miss the PROMPT_OSC.
        const parsed = stripPromptMarkers(managed, data)
        if (parsed.sawPrompt) {
          this.emit('terminal:prompt', { sessionId: id })
        }
      }
    })

    child.onExit(({ exitCode }) => {
      if (managed.promptMarkerRemainder) {
        this.emit('terminal:data', { sessionId: id, data: managed.promptMarkerRemainder })
        managed.promptMarkerRemainder = undefined
      }
      if (managed.cwdTimer) {
        clearInterval(managed.cwdTimer)
      }
      if (managed.zdotdir) {
        try { rmSync(managed.zdotdir, { recursive: true }) } catch { /* ignore */ }
      }
      this.sessions.delete(id)
      this.emit('terminal:exit', { sessionId: id, exitCode })
    })

    if (options.kind === 'local') {
      managed.cwdTimer = setInterval(() => {
        void this.refreshCwd(id)
      }, 2_000)
    }

    return info
  }

  private async refreshCwd(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const cwd = await readProcessCwd(session.pty.pid)
    if (cwd && cwd !== session.info.cwd) {
      session.info.cwd = cwd
      this.emit('terminal:cwd', { sessionId, cwd })
    }
  }

  private requireSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Terminal session ${sessionId} was not found.`)
    }

    return session
  }

  private emit(channel: string, payload: unknown): void {
    this.getWindow()?.webContents.send(channel, payload)
  }
}

interface HookEnv {
  env: Record<string, string>
  zdotdir?: string
}

function buildHookEnv(shell: string | undefined): HookEnv {
  const shellName = shell?.split('/').at(-1) ?? ''

  if (shellName === 'bash') {
    const existing = process.env.PROMPT_COMMAND ? `; ${process.env.PROMPT_COMMAND}` : ''
    return {
      env: { PROMPT_COMMAND: `printf "\\033]6973;PROMPT\\007"${existing}` }
    }
  }

  if (shellName === 'zsh') {
    const home = process.env.HOME ?? homedir()
    const realZdotdir = process.env.ZDOTDIR ?? home
    const realZdotdirLiteral = zshSingleQuoted(realZdotdir)

    const tmpDir = mkdtempSync(join(tmpdir(), 'ait-zdotdir-'))

    // .zshenv — sourced for all zsh instances (login + non-login)
    writeFileSync(join(tmpDir, '.zshenv'), [
      '___ait_boot_zdotdir="$ZDOTDIR"',
      `___ait_user_zdotdir=${realZdotdirLiteral}`,
      'ZDOTDIR="$___ait_user_zdotdir"',
      '[ -f "$ZDOTDIR/.zshenv" ] && source "$ZDOTDIR/.zshenv" 2>/dev/null',
      '___ait_user_zdotdir="$ZDOTDIR"',
      'ZDOTDIR="$___ait_boot_zdotdir"',
      'export ___AIT_USER_ZDOTDIR="$___ait_user_zdotdir"'
    ].join('\n') + '\n')

    // .zshrc — let user's rc see their real ZDOTDIR, then add hook AFTER it.
    writeFileSync(join(tmpDir, '.zshrc'), [
      `___ait_default_zdotdir=${realZdotdirLiteral}`,
      'ZDOTDIR="${___AIT_USER_ZDOTDIR:-$___ait_default_zdotdir}"',
      '[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc" 2>/dev/null',
      '___ait_precmd() { printf "\\033]6973;PROMPT\\007"; }',
      'precmd_functions+=(___ait_precmd)',
      'unset ___AIT_USER_ZDOTDIR ___ait_boot_zdotdir ___ait_default_zdotdir ___ait_user_zdotdir'
    ].join('\n') + '\n')

    return { env: { ZDOTDIR: tmpDir }, zdotdir: tmpDir }
  }

  // Unknown shell: fall back to env-based PROMPT_COMMAND (works for some shells)
  return { env: {} }
}

function zshSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function createPtyEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .filter(([key]) => !isNpmRunnerEnv(key))
  )

  return withUtf8Locale(env)
}

function isNpmRunnerEnv(key: string): boolean {
  return key === 'npm_config_prefix' || key.startsWith('npm_')
}

function withUtf8Locale(env: Record<string, string>): Record<string, string> {
  const fallbackLang = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'

  if (!isUtf8Locale(env.LANG)) {
    env.LANG = fallbackLang
  }

  if (!isUtf8Locale(env.LC_CTYPE)) {
    env.LC_CTYPE = process.platform === 'darwin' ? 'UTF-8' : env.LANG
  }

  if (env.LC_ALL && !isUtf8Locale(env.LC_ALL)) {
    env.LC_ALL = env.LANG
  }

  return env
}

function isUtf8Locale(value: string | undefined): boolean {
  return Boolean(value && /utf-?8/i.test(value))
}

function stripPromptMarkers(
  session: ManagedSession,
  data: string
): { data: string; sawPrompt: boolean } {
  let input = `${session.promptMarkerRemainder ?? ''}${data}`
  let clean = ''
  let sawPrompt = false

  while (true) {
    const markerIndex = input.indexOf(PROMPT_OSC)
    if (markerIndex === -1) {
      break
    }

    clean += input.slice(0, markerIndex)
    input = input.slice(markerIndex + PROMPT_OSC.length)
    sawPrompt = true
  }

  const remainderLength = longestPromptMarkerPrefixAtEnd(input)
  const completeLength = input.length - remainderLength
  clean += input.slice(0, completeLength)
  session.promptMarkerRemainder = remainderLength > 0 ? input.slice(completeLength) : undefined

  return { data: clean, sawPrompt }
}

function longestPromptMarkerPrefixAtEnd(value: string): number {
  const maxLength = Math.min(value.length, PROMPT_OSC.length - 1)

  for (let length = maxLength; length > 0; length -= 1) {
    if (PROMPT_OSC.startsWith(value.slice(-length))) {
      return length
    }
  }

  return 0
}

async function readProcessCwd(pid: number): Promise<string | undefined> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
      return stdout
        .split('\n')
        .find((line) => line.startsWith('n/'))
        ?.slice(1)
    } catch {
      return undefined
    }
  }

  if (process.platform === 'linux') {
    try {
      const { readlink } = await import('node:fs/promises')
      return await readlink(`/proc/${pid}/cwd`)
    } catch {
      return undefined
    }
  }

  return undefined
}
