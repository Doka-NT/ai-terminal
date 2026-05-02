import type { SSHProfile } from '@shared/types'

export interface SSHCommand {
  command: 'ssh'
  args: string[]
  label: string
  remoteHost: string
  remoteTarget: string
}

export interface ParsedSshTarget {
  remoteHost: string
  remoteTarget: string
}

export function buildSshCommand(profile: SSHProfile): SSHCommand {
  const host = profile.host.trim()
  if (!host) {
    throw new Error('SSH host is required.')
  }

  const args: string[] = []

  if (profile.port) {
    args.push('-p', String(profile.port))
  }

  if (profile.identityFile?.trim()) {
    args.push('-i', profile.identityFile.trim())
  }

  for (const arg of profile.extraArgs ?? []) {
    const trimmed = arg.trim()
    if (trimmed) {
      args.push(trimmed)
    }
  }

  const target = profile.user?.trim() ? `${profile.user.trim()}@${host}` : host
  args.push(target)

  return {
    command: 'ssh',
    args,
    label: profile.name?.trim() || target,
    remoteHost: host,
    remoteTarget: target
  }
}

export function parseSshCommandTarget(command: string): ParsedSshTarget | undefined {
  const words = splitShellWords(command.trim())
  if (!isSshExecutable(words[0])) {
    return undefined
  }

  let user: string | undefined

  for (let i = 1; i < words.length; i += 1) {
    const word = words[i]

    if (word === '--') {
      return targetFromWord(words[i + 1], user)
    }

    if (word === '-l') {
      user = words[i + 1]
      i += 1
      continue
    }

    if (word.startsWith('-l') && word.length > 2) {
      user = word.slice(2)
      continue
    }

    if (SSH_OPTIONS_WITH_VALUE.has(word)) {
      i += 1
      continue
    }

    if (SSH_OPTION_PREFIXES_WITH_VALUE.some((prefix) => word.startsWith(prefix) && word.length > prefix.length)) {
      continue
    }

    if (word.startsWith('-')) {
      continue
    }

    return targetFromWord(word, user)
  }

  return undefined
}

function isSshExecutable(word: string | undefined): boolean {
  if (!word) {
    return false
  }

  return word === 'ssh' || word.split('/').at(-1) === 'ssh'
}

function targetFromWord(word: string | undefined, user: string | undefined): ParsedSshTarget | undefined {
  if (!word) {
    return undefined
  }

  const target = word.startsWith('ssh://') ? word.slice('ssh://'.length).replace(/\/$/, '') : word
  const withoutPort = target.startsWith('[') ? target : target.replace(/:\d+$/, '')
  const atIndex = withoutPort.lastIndexOf('@')
  const remoteHost = atIndex === -1 ? withoutPort : withoutPort.slice(atIndex + 1)
  const remoteTarget = atIndex === -1 && user ? `${user}@${withoutPort}` : withoutPort

  return remoteHost ? { remoteHost, remoteTarget } : undefined
}

function splitShellWords(command: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false

  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char
      continue
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        words.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    words.push(current)
  }

  return words
}

const SSH_OPTIONS_WITH_VALUE = new Set([
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-m',
  '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w'
])

const SSH_OPTION_PREFIXES_WITH_VALUE = [
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-m',
  '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w'
]
