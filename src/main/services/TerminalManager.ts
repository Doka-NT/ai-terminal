// SPDX-License-Identifier: MPL-2.0
import type { BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import pty from 'node-pty'
import type { CreateSshCommandRequest, CreateTerminalRequest, SSHProfile, TerminalCommandEvent, TerminalSessionInfo } from '@shared/types'
import { buildSshCommand, parseSshCommand } from '@main/utils/ssh'
import { resolveExistingCwd } from '@main/utils/cwd'

const execFileAsync = promisify(execFile)

// OSC marker emitted by shell hook on every prompt
const PROMPT_OSC = '\x1b]6973;PROMPT\x07'
const COMMAND_OSC_PREFIX = '\x1b]6973;COMMAND;'
const AIT_OSC_PREFIX = '\x1b]6973;'
const OSC_END = '\x07'
const ESC = String.fromCharCode(27)
const ANSI_CSI_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ESC}\\](?:[^${ESC}\\x07]|${ESC}(?!\\\\))*?(?:\\x07|${ESC}\\\\)`, 'g')

const CANCEL_INPUT_SEQUENCE = '\x03'
const CONFIRMED_COMMAND_DELAY_MS = 100

interface ManagedSession {
  pty: pty.IPty
  info: TerminalSessionInfo
  cwdTimer?: NodeJS.Timeout
  zdotdir?: string  // temp dir to clean up on kill
  promptMarkerRemainder?: string
  inputLine?: string
  inputEscapeSequence?: boolean
  pendingCommandDisplay?: {
    written: string
    display: string
  }
}

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedSession>()

  constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly onSessionClosed?: (sessionId: string) => void
  ) {}

  createLocal(request: CreateTerminalRequest = {}): TerminalSessionInfo {
    const shell = process.env.SHELL || '/bin/zsh'
    const fallbackCwd = process.env.HOME || homedir()
    const cwd = resolveExistingCwd(request.cwd, fallbackCwd)

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
      rows: request.rows,
      remoteHost: ssh.remoteHost,
      remoteTarget: ssh.remoteTarget,
      reconnectCommand: `${ssh.command} ${ssh.args.join(' ')}`
    })
  }

  connectSshCommand(request: CreateSshCommandRequest): TerminalSessionInfo {
    const ssh = parseSshCommand(request.command)
    if (!ssh) {
      throw new Error('A valid ssh command is required.')
    }
    const fallbackCwd = process.env.HOME || homedir()

    return this.spawn({
      kind: 'ssh',
      label: request.label?.trim() || request.remoteTarget || ssh.remoteTarget,
      command: request.command,
      file: ssh.file,
      args: expandSshCommandArgs(ssh.args, ssh.argSingleQuoted),
      cwd: resolveExistingCwd(request.cwd, fallbackCwd),
      cols: request.cols,
      rows: request.rows,
      remoteHost: request.remoteHost || ssh.remoteHost,
      remoteTarget: request.remoteTarget || ssh.remoteTarget,
      reconnectCommand: request.command
    })
  }

  write(sessionId: string, data: string): void {
    const session = this.requireSession(sessionId)
    this.trackInput(session, data)
    session.pty.write(data)
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
    if (this.sessions.delete(sessionId)) {
      this.onSessionClosed?.(sessionId)
    }
    this.emit('terminal:exit', { sessionId, exitCode: 0 })
  }

  killAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.kill(sessionId)
    }
  }

  runConfirmed(sessionId: string, command: string, displayCommand = command): void {
    const normalized = command.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    const normalizedDisplay = displayCommand.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    if (!normalized) {
      return
    }

    const session = this.requireSession(sessionId)
    const hadPendingInput = this.clearPendingInput(session)
    if (hadPendingInput) {
      this.write(sessionId, CANCEL_INPUT_SEQUENCE)
    }

    const run = (): void => {
      if (!this.sessions.has(sessionId)) {
        return
      }

      if (session.info.kind === 'ssh') {
        this.emitCommand({ sessionId, command: normalizedDisplay || normalized, echoed: false })
      } else {
        if (normalizedDisplay && normalizedDisplay !== normalized) {
          session.pendingCommandDisplay = {
            written: normalized,
            display: normalizedDisplay
          }
        }
      }

      session.pty.write(`${normalized}\r`)
    }

    if (hadPendingInput) {
      setTimeout(run, CONFIRMED_COMMAND_DELAY_MS)
    } else {
      run()
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
    remoteHost?: string
    remoteTarget?: string
    reconnectCommand?: string
  }): TerminalSessionInfo {
    const id = randomUUID()
    const info: TerminalSessionInfo = {
      id,
      kind: options.kind,
      label: options.label,
      cwd: options.cwd,
      shell: options.shell,
      localLabel: options.kind === 'local' ? options.label : undefined,
      remoteHost: options.remoteHost,
      remoteTarget: options.remoteTarget,
      reconnectCommand: options.reconnectCommand,
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
      const parsed = stripTerminalMarkers(managed, data)
      if (parsed.data) {
        this.emit('terminal:data', { sessionId: id, data: parsed.data })
      }
      for (const command of parsed.commands) {
        this.emitCommand({
          sessionId: id,
          command: this.displayCommandForParsedMarker(managed, command),
          echoed: true
        })
      }
      if (parsed.sawPrompt || (managed.info.kind === 'ssh' && looksLikeShellPrompt(parsed.data))) {
        this.emit('terminal:prompt', { sessionId: id })
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
      if (this.sessions.delete(id)) {
        this.onSessionClosed?.(id)
      }
      this.emit('terminal:exit', { sessionId: id, exitCode })
    })

    if (options.kind === 'local') {
      managed.cwdTimer = setInterval(() => {
        void this.refreshLocalSession(id)
      }, 2_000)
    }

    return info
  }

  private async refreshLocalSession(sessionId: string): Promise<void> {
    await this.refreshCwd(sessionId)
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

  private trackInput(session: ManagedSession, data: string): void {
    for (const char of data) {
      if (session.inputEscapeSequence) {
        if (char >= '@' && char <= '~') {
          session.inputEscapeSequence = false
        }
      } else if (char === '\x1b') {
        session.inputLine = ''
        session.inputEscapeSequence = true
      } else if (char === '\r' || char === '\n') {
        if (session.info.kind === 'ssh') {
          const command = (session.inputLine ?? '').trim()
          if (command) {
            this.emitCommand({ sessionId: session.info.id, command, echoed: false })
          }
        }
        session.inputLine = ''
      } else if (char === '\x7f' || char === '\b') {
        session.inputLine = (session.inputLine ?? '').slice(0, -1)
      } else if (char === '\x03') {
        session.inputLine = ''
      } else if (char >= ' ') {
        session.inputLine = `${session.inputLine ?? ''}${char}`
      }
    }
  }

  private clearPendingInput(session: ManagedSession): boolean {
    if (!session.inputLine) {
      return false
    }

    session.inputLine = ''
    session.inputEscapeSequence = false
    return true
  }

  private displayCommandForParsedMarker(session: ManagedSession, command: string): string {
    const pending = session.pendingCommandDisplay
    if (!pending || pending.written !== command.trim()) {
      return command
    }

    session.pendingCommandDisplay = undefined
    return pending.display
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

  private emitCommand(payload: TerminalCommandEvent): void {
    this.emit('terminal:command', payload)
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
      'HISTFILE="${ZDOTDIR:-$HOME}/.zsh_history"',
      '[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc" 2>/dev/null',
      'fc -R "$HISTFILE" 2>/dev/null || true',
      'unset ZSH_AUTOSUGGEST_USE_ASYNC',
      '___ait_precmd() { printf "\\033]6973;PROMPT\\007"; }',
      '___ait_preexec() { printf "\\033]6973;COMMAND;%s\\007" "$1"; }',
      'precmd_functions+=(___ait_precmd)',
      'preexec_functions+=(___ait_preexec)',
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

function stripTerminalMarkers(
  session: ManagedSession,
  data: string
): { data: string; sawPrompt: boolean; commands: string[] } {
  let input = `${session.promptMarkerRemainder ?? ''}${data}`
  let clean = ''
  let sawPrompt = false
  const commands: string[] = []

  while (true) {
    const markerIndex = input.indexOf(AIT_OSC_PREFIX)
    if (markerIndex === -1) {
      break
    }

    clean += input.slice(0, markerIndex)
    input = input.slice(markerIndex)

    if (input.startsWith(PROMPT_OSC)) {
      input = input.slice(PROMPT_OSC.length)
      sawPrompt = true
      continue
    }

    if (input.startsWith(COMMAND_OSC_PREFIX)) {
      const endIndex = input.indexOf(OSC_END, COMMAND_OSC_PREFIX.length)
      if (endIndex === -1) {
        session.promptMarkerRemainder = input
        return { data: clean, sawPrompt, commands }
      }
      const command = input.slice(COMMAND_OSC_PREFIX.length, endIndex).trim()
      if (command) {
        commands.push(command)
      }
      input = input.slice(endIndex + OSC_END.length)
      continue
    }

    clean += input[0]
    input = input.slice(1)
  }

  const remainderLength = longestTerminalMarkerPrefixAtEnd(input)
  const completeLength = input.length - remainderLength
  clean += input.slice(0, completeLength)
  session.promptMarkerRemainder = remainderLength > 0 ? input.slice(completeLength) : undefined

  return { data: clean, sawPrompt, commands }
}

function longestTerminalMarkerPrefixAtEnd(value: string): number {
  const candidates = [PROMPT_OSC, COMMAND_OSC_PREFIX]
  const maxLength = Math.min(value.length, Math.max(...candidates.map((candidate) => candidate.length - 1)))

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = value.slice(-length)
    if (candidates.some((candidate) => candidate.startsWith(suffix))) {
      return length
    }
  }

  return 0
}

export function looksLikeShellPrompt(data: string): boolean {
  const lastLine = stripAnsi(data)
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim())
    .at(-1)

  if (!lastLine) {
    return false
  }

  return /^[#$%>] $/.test(lastLine) ||
    /^\[[^\]\n]+@[\w.-]+[^\]\n]*\][#$%>] $/.test(lastLine) ||
    /^[\w.-]+@[\w.-]+(?::[^\n]*)?[#$%>] $/.test(lastLine) ||
    /^[\w.-]+(?::[^\n]*)?[#$%>] $/.test(lastLine)
}

function stripAnsi(value: string): string {
  return value
    .replace(ANSI_OSC_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
}

function expandSshCommandArgs(args: string[], argSingleQuoted: boolean[]): string[] {
  const expanded: string[] = []
  let beforeTarget = true

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const singleQuoted = argSingleQuoted[index] ?? false

    if (!beforeTarget) {
      expanded.push(arg)
      continue
    }

    if (arg === '--') {
      expanded.push(arg)
      beforeTarget = false
      continue
    }

    if (SSH_PATH_OPTIONS_WITH_VALUE.has(arg)) {
      expanded.push(arg)
      if (args[index + 1] !== undefined) {
        expanded.push(expandSshCommandArg(args[index + 1], argSingleQuoted[index + 1] ?? false))
        index += 1
      }
      continue
    }

    const pathPrefix = SSH_PATH_OPTION_PREFIXES_WITH_VALUE.find((prefix) => arg.startsWith(prefix) && arg.length > prefix.length)
    if (pathPrefix) {
      expanded.push(`${pathPrefix}${expandSshCommandArg(arg.slice(pathPrefix.length), singleQuoted)}`)
      continue
    }

    if (arg === '-o') {
      expanded.push(arg)
      if (args[index + 1] !== undefined) {
        expanded.push(expandSshOptionValue(args[index + 1], argSingleQuoted[index + 1] ?? false))
        index += 1
      }
      continue
    }

    if (arg.startsWith('-o') && arg.length > 2) {
      expanded.push(`-o${expandSshOptionValue(arg.slice(2), singleQuoted)}`)
      continue
    }

    if (SSH_OPTIONS_WITH_VALUE.has(arg)) {
      expanded.push(arg)
      if (args[index + 1] !== undefined) {
        expanded.push(args[index + 1])
        index += 1
      }
      continue
    }

    if (SSH_OPTION_PREFIXES_WITH_VALUE.some((prefix) => arg.startsWith(prefix) && arg.length > prefix.length)) {
      expanded.push(arg)
      continue
    }

    if (arg.startsWith('-')) {
      expanded.push(arg)
      continue
    }

    beforeTarget = false
    expanded.push(arg)
  }

  return expanded
}

function expandSshOptionValue(value: string, singleQuoted: boolean): string {
  const equalIndex = value.indexOf('=')
  if (equalIndex === -1) {
    return value
  }

  const key = value.slice(0, equalIndex).toLowerCase()
  if (!SSH_PATH_CONFIG_OPTIONS.has(key)) {
    return value
  }

  return `${value.slice(0, equalIndex + 1)}${expandSshCommandArg(value.slice(equalIndex + 1), singleQuoted)}`
}

function expandSshCommandArg(arg: string, singleQuoted: boolean): string {
  if (singleQuoted) {
    return arg
  }

  const withVariables = arg.replace(/\$(\w+)|\$\{([A-Za-z_]\w*)\}/g, (_match, bare: string | undefined, braced: string | undefined) => {
    const name = bare ?? braced
    return name ? process.env[name] ?? '' : ''
  })

  if (withVariables === '~') {
    return homedir()
  }

  if (withVariables.startsWith('~/')) {
    return `${homedir()}${withVariables.slice(1)}`
  }

  return withVariables
}

const SSH_PATH_OPTIONS_WITH_VALUE = new Set(['-E', '-F', '-I', '-i', '-S'])
const SSH_PATH_OPTION_PREFIXES_WITH_VALUE = ['-E', '-F', '-I', '-i', '-S']
const SSH_PATH_CONFIG_OPTIONS = new Set([
  'certificatefile',
  'globalknownhostsfile',
  'identityagent',
  'identityfile',
  'pkcs11provider',
  'securitykeyprovider',
  'userknownhostsfile'
])
const SSH_OPTIONS_WITH_VALUE = new Set([
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m',
  '-O', '-o', '-P', '-p', '-Q', '-R', '-S', '-W', '-w'
])
const SSH_OPTION_PREFIXES_WITH_VALUE = [
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m',
  '-O', '-o', '-P', '-p', '-Q', '-R', '-S', '-W', '-w'
]

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
