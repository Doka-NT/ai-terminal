// SPDX-License-Identifier: MPL-2.0
import type { BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import pty from 'node-pty'
import type { CreateSshCommandRequest, CreateTerminalRequest, SSHProfile, TerminalSessionInfo } from '@shared/types'
import { buildSshCommand, parseSshCommand, parseSshCommandTarget } from '@main/utils/ssh'
import { resolveExistingCwd } from '@main/utils/cwd'
import { decodeShellIntegrationCommand } from '@shared/terminalText'

const execFileAsync = promisify(execFile)

const OSC_END = '\x07'
// Legacy 6973 prefix (stripped for defence-in-depth if old hooks remain)
const AIT_LEGACY_PREFIX = '\x1b]6973;'
// 633;E prefix used for display-command substitution in rewrite633E
const OSC_633E_PREFIX = '\x1b]633;E;'
// Broader shell-integration OSC families rewrite633E must also buffer when a
// PTY chunk splits them mid-sequence — 133;A/B/C/D (prompt lifecycle) and
// 633;P (cwd) carry no secret, but an unterminated fragment left in
// outputBuffers is still plain-text OSC framing that stripAnsi can't match.
const OSC_133_PREFIX = '\x1b]133;'
const OSC_633_PREFIX = '\x1b]633;'
const SHELL_INTEGRATION_OSC_PREFIXES = [OSC_133_PREFIX, OSC_633_PREFIX]
const OSC_133_PROMPT_SEQUENCES = ['\x1b]133;A\x07', '\x1b]133;A\x1b\\']
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
  transientSsh?: boolean
  osc633ERemainder?: string
  osc133PromptRemainder?: string
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

      const wasSshSession = session.info.kind === 'ssh'
      if (normalizedDisplay && normalizedDisplay !== normalized) {
        session.pendingCommandDisplay = {
          written: normalized,
          display: normalizedDisplay
        }
      }
      if (!wasSshSession) {
        this.captureSubmittedCommand(session, normalized)
      }

      if (wasSshSession) {
        session.pty.write(`${normalized}\r`)
      } else {
        session.pty.write(`${normalized}\r`)
      }
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
    const nonce = options.kind === 'local' ? randomUUID() : undefined
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
      createdAt: Date.now(),
      shellIntegrationNonce: nonce
    }

    const hookEnv = options.kind === 'local' ? buildHookEnv(options.shell, nonce) : { env: {} }

    const child = pty.spawn(options.file, [...options.args, ...(hookEnv.args ?? [])], {
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
      const sawSemanticPrompt = detectOsc133Prompt(managed, parsed.data)
      if (parsed.data) {
        const safe = rewrite633E(managed, parsed.data)
        this.emit('terminal:data', { sessionId: id, data: safe })
      }
      if (parsed.sawPrompt || sawSemanticPrompt || (managed.info.kind === 'ssh' && looksLikeShellPrompt(parsed.data))) {
        this.restoreTransientSsh(managed)
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
    await Promise.all([
      this.refreshCwd(sessionId),
      this.refreshSshChild(sessionId)
    ])
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

  private async refreshSshChild(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.info.localLabel) {
      return
    }

    const parsed = await readSshDescendant(session.pty.pid)
    if (parsed) {
      this.updateTransientSsh(session, parsed)
      session.info.reconnectCommand = parsed.command
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
        if (session.info.kind === 'local') {
          this.captureSubmittedCommand(session, session.inputLine ?? '')
        } else if (session.info.kind === 'ssh') {
          // SSH block command text handled by shell 633;E hooks if available
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

  private captureSubmittedCommand(session: ManagedSession, command: string): void {
    const parsed = parseSshCommandTarget(command)
    if (!parsed) {
      return
    }

    this.updateTransientSsh(session, parsed)
    session.info.reconnectCommand = command
  }

  private displayCommandForParsedMarker(session: ManagedSession, command: string): string {
    const pending = session.pendingCommandDisplay
    if (!pending || pending.written !== command.trim()) {
      return command
    }

    session.pendingCommandDisplay = undefined
    return pending.display
  }

  private updateTransientSsh(session: ManagedSession, parsed: { remoteHost: string; remoteTarget: string }): void {
    const changed = session.info.kind !== 'ssh' ||
      session.info.label !== parsed.remoteTarget ||
      session.info.remoteHost !== parsed.remoteHost ||
      session.info.remoteTarget !== parsed.remoteTarget

    session.info.kind = 'ssh'
    session.info.label = parsed.remoteTarget
    session.info.remoteHost = parsed.remoteHost
    session.info.remoteTarget = parsed.remoteTarget
    session.transientSsh = true

    if (changed) {
      this.emit('terminal:session', session.info)
    }
  }

  private restoreTransientSsh(session: ManagedSession): void {
    if (!session.transientSsh) {
      return
    }

    session.transientSsh = false
    session.info.kind = 'local'
    session.info.label = session.info.localLabel ?? session.info.shell?.split('/').at(-1) ?? 'shell'
    session.info.remoteHost = undefined
    session.info.remoteTarget = undefined
    this.emit('terminal:session', session.info)
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
  args?: string[]
}

export function buildHookEnv(shell: string | undefined, nonce: string | undefined): HookEnv {
  const shellName = shell?.split('/').at(-1) ?? ''

  if (shellName === 'bash') {
    return buildBashHookEnv(nonce)
  }

  if (shellName === 'zsh') {
    return buildZshHookEnv(nonce)
  }

  if (shellName === 'fish') {
    return buildFishHookEnv(nonce)
  }

  // Unknown shell: no shell integration
  return { env: {} }
}

function buildBashHookEnv(nonce: string | undefined): HookEnv {
  const home = process.env.HOME ?? homedir()
  const nonceLit = (nonce ?? '').replace(/'/g, "'\\''")
  const homeLit = home.replace(/'/g, "'\\''")

  // bash --init-file: sources this file instead of ~/.bashrc for interactive shells.
  // Install once, source the user's rc files, then layer OSC 133/633 hooks over
  // the prompt state that bash actually has after startup.
  const tmpDir = mkdtempSync(join(tmpdir(), 'ait-bash-'))
  const initFile = join(tmpDir, 'bash_init')
  const initContent = [
    'if [[ ${___ait_si_installed:-0} == 1 ]]; then',
    '  return 0 2>/dev/null || exit 0',
    'fi',
    '___ait_si_installed=1',
    '[ -f /etc/bash.bashrc ] && source /etc/bash.bashrc',
    `___ait_si_user_bashrc='${homeLit}/.bashrc'`,
    '[ -f "$___ait_si_user_bashrc" ] && source "$___ait_si_user_bashrc"',
    'if [[ ${PS1+x} ]]; then',
    '  ___ait_si_user_ps1=$PS1',
    'else',
    "  ___ait_si_user_ps1='\\$ '",
    'fi',
    '___ait_si_user_ps0=${PS0-}',
    '___ait_si_precmd() {',
    '  local _ec=$?',
    '  ___ait_si_captured_this_cycle=0',
    '  printf \'\\033]133;D;%s\\007\' "$_ec"',
    '  printf \'\\033]633;P;Cwd=%s\\007\' "$PWD"',
    '  return "$_ec"',
    '}',
    'if declare -p PROMPT_COMMAND 2>/dev/null | grep -q \'^declare -a\'; then',
    '  PROMPT_COMMAND=(___ait_si_precmd "${PROMPT_COMMAND[@]}")',
    'else',
    '  ___ait_si_user_prompt_command=${PROMPT_COMMAND-}',
    "  PROMPT_COMMAND='___ait_si_precmd'",
    '  if [[ -n $___ait_si_user_prompt_command ]]; then',
    "    PROMPT_COMMAND+='; '",
    '    PROMPT_COMMAND+=$___ait_si_user_prompt_command',
    '  fi',
    'fi',
    "PS1='\\[\\e]133;A\\a\\]'\"$___ait_si_user_ps1\"'\\[\\e]133;B\\a\\]'",
    // PS0 no longer carries our hook — only the user's original PS0, if any.
    // $BASH_COMMAND inside a PS0 command substitution (or even a bare
    // parameter expansion) is NOT yet updated to the upcoming command —
    // verified directly in bash 5.3 with a real PTY: PS0 always sees a stale
    // value from the previous prompt cycle. PS0 fires before bash updates
    // $BASH_COMMAND for the command that triggered it, so no expression
    // inside PS0 can read the real command text.
    'PS0="$___ait_si_user_ps0"',
    // The DEBUG trap is the only mechanism that reliably sees the real
    // upcoming command ($BASH_COMMAND is correct there). Installed last so
    // nothing earlier in this file (which doesn't match the ___ait_si_*
    // guard below) fires it first and consumes the once-per-cycle capture.
    // Known limitation: only the first simple command of a compound line
    // (`a && b`) is captured, matching $BASH_COMMAND's own per-simple-command
    // granularity; a user's own additional PROMPT_COMMAND entries chained
    // after ours can occasionally consume this cycle's capture before the
    // real next command runs.
    '___ait_si_captured_this_cycle=0',
    '___ait_si_debug_hook() {',
    '  case "$BASH_COMMAND" in',
    '    ___ait_si_*) return ;;',
    '  esac',
    '  [[ $___ait_si_captured_this_cycle == 1 ]] && return',
    '  ___ait_si_captured_this_cycle=1',
    '  local _c="$BASH_COMMAND" _e',
    '  _e="${_c//\\\\/\\\\\\\\}"',
    '  _e="${_e//;/\\x3b}"',
    "  _e=\"${_e//$'\\n'/\\x0a}\"",
    "  _e=\"${_e//$'\\r'/\\x0d}\"",
    `  printf '\\033]633;E;%s;%s\\007\\033]133;C\\007' "$_e" '${nonceLit}'`,
    '}',
    "trap '___ait_si_debug_hook' DEBUG"
  ].join('\n')
  writeFileSync(initFile, initContent + '\n')

  return {
    env: {},
    args: ['--init-file', initFile],
    zdotdir: tmpDir
  }
}

function buildZshHookEnv(nonce: string | undefined): HookEnv {
  const home = process.env.HOME ?? homedir()
  const realZdotdir = process.env.ZDOTDIR ?? home
  const realZdotdirLiteral = zshSingleQuoted(realZdotdir)
  const nonceLiteral = nonce ? zshSingleQuoted(nonce) : "''"

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

  // .zshrc — source user's rc first, then append our hooks so they run last.
  // The OSC 133/633 hooks run after theme managers (oh-my-zsh, starship, etc.)
  // that register their own precmd/preexec via precmd_functions.
  writeFileSync(join(tmpDir, '.zshrc'), [
    `___ait_default_zdotdir=${realZdotdirLiteral}`,
    'ZDOTDIR="${___AIT_USER_ZDOTDIR:-$___ait_default_zdotdir}"',
    'HISTFILE="${ZDOTDIR:-$HOME}/.zsh_history"',
    '[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc" 2>/dev/null',
    'fc -R "$HISTFILE" 2>/dev/null || true',
    'unset ZSH_AUTOSUGGEST_USE_ASYNC',
    // OSC 133/633 hooks (appended after theme hooks so they run last in precmd)
    `___ait_si_nonce=${nonceLiteral}`,
    // precmd: close previous block (133;D), update cwd (633;P), mark prompt start
    // (133;A via printf before PROMPT renders), append 133;B to end of PROMPT for
    // command-start marker. Re-appends each time so theme resets are handled.
    '___ait_si_precmd() {',
    '  printf "\\033]133;D;%d\\007" "$?"',
    '  printf "\\033]633;P;Cwd=%s\\007" "$PWD"',
    '  printf "\\033]133;A\\007"',
    // Append 133;B to PROMPT only if not already present; strip stale copy first
    "  local _ait_b=$'\\e]133;B\\a'",
    '  PROMPT="${PROMPT//%{$_ait_b%}/}"',
    '  PROMPT="${PROMPT}%{$_ait_b%}"',
    '}',
    // preexec: emit command text (633;E with nonce) + output start (133;C)
    '___ait_si_preexec() {',
    '  local _ait_cmd="$1"',
    // Escape: \ -> \\, ; -> \x3b, newline -> \x0a, CR -> \x0d
    '  local _ait_esc="${_ait_cmd//\\\\/\\\\\\\\}"',
    '  _ait_esc="${_ait_esc//;/\\\\x3b}"',
    "  _ait_esc=\"${_ait_esc//$'\\n'/\\\\x0a}\"",
    "  _ait_esc=\"${_ait_esc//$'\\r'/\\\\x0d}\"",
    '  printf "\\033]633;E;%s;%s\\007" "$_ait_esc" "$___ait_si_nonce"',
    '  printf "\\033]133;C\\007"',
    '}',
    'precmd_functions+=(___ait_si_precmd)',
    'preexec_functions+=(___ait_si_preexec)',
    'unset ___AIT_USER_ZDOTDIR ___ait_boot_zdotdir ___ait_default_zdotdir ___ait_user_zdotdir'
  ].join('\n') + '\n')

  return { env: { ZDOTDIR: tmpDir }, zdotdir: tmpDir }
}

function buildFishHookEnv(nonce: string | undefined): HookEnv {
  // Run the generated hook after fish has loaded its normal conf.d and
  // config.fish files. This keeps the user's XDG_CONFIG_HOME unchanged for
  // both startup configuration and every child process launched by fish.
  const tmpDir = mkdtempSync(join(tmpdir(), 'ait-fish-'))
  const confDPath = join(tmpDir, 'fish', 'conf.d')
  try { mkdirSync(confDPath, { recursive: true }) } catch { /* ignore */ }

  const nonceLiteral = nonce ? fishQuoted(nonce) : "''"
  const hooks = [
    'function __ait_si_fish_prompt --on-event fish_prompt',
    '  printf "\\033]133;D;%d\\007" "$__ait_si_last_status"',
    '  printf "\\033]633;P;Cwd=%s\\007" "$PWD"',
    '  printf "\\033]133;A\\007"',
    'end',
    'function __ait_si_fish_preexec --on-event fish_preexec',
    `  set -l _ait_nonce ${nonceLiteral}`,
    // Escape order: backslash first, then delimiters — fish double-quotes: \\ → \
    '  set -l _ait_esc (string replace --all -- "\\\\" "\\\\\\\\" -- $argv[1])',
    '  set _ait_esc (string replace --all -- ";" "\\x3b" -- $_ait_esc)',
    '  set _ait_esc (string replace --all -- "\\n" "\\x0a" -- $_ait_esc)',
    '  set _ait_esc (string replace --all -- "\\r" "\\x0d" -- $_ait_esc)',
    '  printf "\\033]633;E;%s;%s\\007" "$_ait_esc" "$_ait_nonce"',
    '  printf "\\033]133;C\\007"',
    'end',
    'function __ait_si_fish_postexec --on-event fish_postexec',
    '  set -g __ait_si_last_status $status',
    'end'
  ].join('\n')

  const hookFile = join(confDPath, 'taviraq.fish')
  writeFileSync(hookFile, hooks + '\n')
  return {
    env: {},
    args: ['-C', `source ${fishQuoted(hookFile)}`],
    zdotdir: tmpDir
  }
}


function fishQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
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

// Strip any remaining legacy 6973 markers (defence-in-depth: hooks in old shell configs).
// Returns cleaned data and whether a 6973;PROMPT was seen (for SSH heuristic).
function stripTerminalMarkers(
  session: ManagedSession,
  data: string
): { data: string; sawPrompt: boolean } {
  let input = `${session.promptMarkerRemainder ?? ''}${data}`
  let clean = ''
  let sawPrompt = false

  while (true) {
    const idx = input.indexOf(AIT_LEGACY_PREFIX)
    if (idx === -1) break

    clean += input.slice(0, idx)
    input = input.slice(idx + AIT_LEGACY_PREFIX.length)

    // Find end of the OSC sequence
    const end = input.indexOf(OSC_END)
    if (end === -1) {
      session.promptMarkerRemainder = AIT_LEGACY_PREFIX + input
      return { data: clean, sawPrompt }
    }
    const body = input.slice(0, end)
    if (body === 'PROMPT') sawPrompt = true
    input = input.slice(end + OSC_END.length)
  }

  // Buffer trailing partial legacy prefix for next chunk
  const maxPfx = AIT_LEGACY_PREFIX.length - 1
  const tailLen = Math.min(input.length, maxPfx)
  let remainder = 0
  for (let l = tailLen; l > 0; l--) {
    if (AIT_LEGACY_PREFIX.startsWith(input.slice(-l))) { remainder = l; break }
  }
  clean += input.slice(0, input.length - remainder)
  session.promptMarkerRemainder = remainder > 0 ? input.slice(-remainder) : undefined

  return { data: clean, sawPrompt }
}

// Rewrite 633;E sequences so display commands with [[TAVIRAQ_SECRET_*]] placeholders
// are not exposed to the renderer. Uses session.pendingCommandDisplay set by runConfirmed.
export function rewrite633E(session: ManagedSession, data: string): string {
  const remainder = session.osc633ERemainder
  // Fast path: nothing pending from a prior chunk, and this chunk contains no
  // full or trailing-partial shell-integration OSC prefix to buffer. A
  // partial prefix must still be buffered even with no secret substitution
  // pending — otherwise an unterminated OSC fragment (633;E carrying the
  // nonce, or 133;*/633;P framing) can sit in outputBuffers where stripAnsi
  // can't recognize it as an OSC sequence and it reaches provider context
  // as plain text.
  const hasFullIntroducer = SHELL_INTEGRATION_OSC_PREFIXES.some((prefix) => data.indexOf(prefix) !== -1)
  const hasPartialPrefix = SHELL_INTEGRATION_OSC_PREFIXES.some((prefix) => trailingPrefixLength(data, prefix) > 0)
  if (!remainder && !hasFullIntroducer && !hasPartialPrefix) {
    return data
  }

  let input = `${remainder ?? ''}${data}`
  let output = ''
  session.osc633ERemainder = undefined

  while (true) {
    const idx133 = input.indexOf(OSC_133_PREFIX)
    const idx633 = input.indexOf(OSC_633_PREFIX)
    const idx = idx133 === -1 ? idx633 : idx633 === -1 ? idx133 : Math.min(idx133, idx633)
    if (idx === -1) {
      const partialPrefixLength = Math.max(
        ...SHELL_INTEGRATION_OSC_PREFIXES.map((prefix) => trailingPrefixLength(input, prefix))
      )
      output += input.slice(0, input.length - partialPrefixLength)
      session.osc633ERemainder = partialPrefixLength > 0
        ? input.slice(-partialPrefixLength)
        : undefined
      break
    }

    output += input.slice(0, idx)
    const isCommandMarker = input.startsWith(OSC_633E_PREFIX, idx)
    const matchedPrefix = isCommandMarker ? OSC_633E_PREFIX : idx === idx633 ? OSC_633_PREFIX : OSC_133_PREFIX
    const rest = input.slice(idx + matchedPrefix.length)

    const endBel = rest.indexOf('\x07')
    const endSt = rest.indexOf('\x1b\\')
    const endIdx = endBel === -1 ? endSt : endSt === -1 ? endBel : Math.min(endBel, endSt)
    if (endIdx === -1) {
      // Keep the incomplete sequence in main until xterm's OSC terminator arrives.
      session.osc633ERemainder = input.slice(idx)
      break
    }
    const term = rest[endIdx] === '\x07' ? '\x07' : '\x1b\\'
    const payload = rest.slice(0, endIdx)
    input = rest.slice(endIdx + term.length)

    if (!isCommandMarker) {
      output += `${matchedPrefix}${payload}${term}`
      continue
    }

    const lastSemi = payload.lastIndexOf(';')
    const nonce = lastSemi !== -1 ? payload.slice(lastSemi + 1) : ''
    const escapedCmd = lastSemi !== -1 ? payload.slice(0, lastSemi) : payload
    const rawCmd = decodeShellIntegrationCommand(escapedCmd).trim()

    if (session.pendingCommandDisplay?.written === rawCmd) {
      const display = session.pendingCommandDisplay.display
      session.pendingCommandDisplay = undefined
      const safeEscaped = display
        .replace(/\\/g, '\\\\').replace(/;/g, '\\x3b')
        .replace(/\r/g, '\\x0d').replace(/\n/g, '\\x0a')
      output += `${OSC_633E_PREFIX}${safeEscaped};${nonce}${term}`
    } else {
      output += `${OSC_633E_PREFIX}${payload}${term}`
    }
  }

  return output
}

function trailingPrefixLength(value: string, prefix: string): number {
  const maxLength = Math.min(value.length, prefix.length - 1)
  for (let length = maxLength; length > 0; length -= 1) {
    if (prefix.startsWith(value.slice(-length))) return length
  }
  return 0
}

export function detectOsc133Prompt(session: ManagedSession, data: string): boolean {
  const input = `${session.osc133PromptRemainder ?? ''}${data}`
  const sawPrompt = OSC_133_PROMPT_SEQUENCES.some((sequence) => input.includes(sequence))
  const remainderLength = Math.max(
    ...OSC_133_PROMPT_SEQUENCES.map((sequence) => trailingPrefixLength(input, sequence))
  )
  session.osc133PromptRemainder = remainderLength > 0 ? input.slice(-remainderLength) : undefined
  return sawPrompt
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

interface ProcessInfo {
  pid: number
  ppid: number
  command: string
}

async function readSshDescendant(rootPid: number): Promise<{ remoteHost: string; remoteTarget: string; command: string } | undefined> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return undefined
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='])
    const processes = stdout
      .split('\n')
      .map(parseProcessLine)
      .filter((process): process is ProcessInfo => Boolean(process))

    const childrenByParent = new Map<number, ProcessInfo[]>()
    for (const process of processes) {
      const children = childrenByParent.get(process.ppid) ?? []
      children.push(process)
      childrenByParent.set(process.ppid, children)
    }

    const queue = [...childrenByParent.get(rootPid) ?? []]
    for (let index = 0; index < queue.length; index += 1) {
      const process = queue[index]
      const parsed = parseSshCommandTarget(process.command)
      if (parsed) {
        return { ...parsed, command: process.command }
      }
      queue.push(...childrenByParent.get(process.pid) ?? [])
    }
  } catch {
    return undefined
  }

  return undefined
}

function parseProcessLine(line: string): ProcessInfo | undefined {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
  if (!match) {
    return undefined
  }

  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    command: match[3]
  }
}
