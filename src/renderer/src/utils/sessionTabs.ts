// SPDX-License-Identifier: MPL-2.0
import type { TerminalSessionInfo } from '@shared/types'

export type SessionTabStatus = 'running' | 'idle' | 'exited' | 'disconnected' | 'reconnecting'

export interface SessionTabInfo extends TerminalSessionInfo {
  status: SessionTabStatus
}

export interface SessionTabStatusMeta {
  label: string
  className: string
}

export type SessionRenderStatus = 'live' | 'exited' | 'disconnected' | 'reconnecting' | undefined

const STATUS_META: Record<SessionTabStatus, SessionTabStatusMeta> = {
  running: { label: 'Running', className: 'running' },
  idle: { label: 'Idle', className: 'idle' },
  exited: { label: 'Exited', className: 'exited' },
  disconnected: { label: 'Disconnected', className: 'disconnected' },
  reconnecting: { label: 'Reconnecting', className: 'reconnecting' }
}

export function getTabLabel(session: TerminalSessionInfo): string {
  if (session.kind !== 'ssh') {
    return session.label
  }

  const label = session.label?.trim()
  const remoteTarget = session.remoteTarget?.trim()
  const remoteHost = session.remoteHost?.trim()

  if (label && label !== remoteTarget) return label
  return label || remoteTarget || remoteHost || 'SSH session'
}

export function getCwdBasename(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined

  const normalized = cwd.replace(/\/+$/, '')
  if (!normalized || normalized === '/') return '/'

  return normalized.split('/').at(-1)
}

export function compactPath(path: string | undefined, maxLength = 36): string | undefined {
  if (!path) return undefined
  if (path.length <= maxLength) return path
  if (maxLength <= 3) return path.slice(0, maxLength)

  const keep = maxLength - 1
  const headLength = Math.ceil(keep * 0.42)
  const tailLength = keep - headLength

  return `${path.slice(0, headLength)}…${path.slice(-tailLength)}`
}

export function getSessionCommandTarget(session: TerminalSessionInfo): string {
  if (session.kind === 'ssh') {
    return session.remoteTarget || session.label || session.remoteHost || 'SSH session'
  }

  return getCwdBasename(session.cwd) || session.cwd || session.label || 'local shell'
}

export function getSshTabIndicatorTitle(session: TerminalSessionInfo): string | undefined {
  if (session.kind !== 'ssh') return undefined

  const remoteTarget = session.remoteTarget?.trim()
  const remoteHost = session.remoteHost?.trim()
  const target = remoteTarget || remoteHost || session.label?.trim()

  return target ? `SSH: ${target}` : 'SSH session'
}

export function getSessionStatusMeta(status: SessionTabStatus): SessionTabStatusMeta {
  return STATUS_META[status]
}

export function isLiveSessionStatus(status: SessionTabStatus | undefined): boolean {
  return status === 'running' || status === 'idle'
}

export function sessionStatusAfterPrompt(status: SessionTabStatus): SessionTabStatus {
  return isLiveSessionStatus(status) ? 'idle' : status
}

export function getSessionRenderStatus(status: SessionTabStatus | undefined): SessionRenderStatus {
  if (isLiveSessionStatus(status)) return 'live'
  if (status === 'exited' || status === 'disconnected' || status === 'reconnecting') return status
  return undefined
}

export function mergeRestoredSessionOutput(restoredOutput: string, earlyOutput: string | undefined): string {
  return earlyOutput ? `${restoredOutput}${earlyOutput}` : restoredOutput
}

export function formatSessionUptime(createdAt: number, now = Date.now()): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return 'unknown'

  const elapsedSeconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (elapsedSeconds < 60) return '<1m'

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  const minutes = elapsedMinutes % 60
  if (elapsedHours < 24) return minutes ? `${elapsedHours}h ${minutes}m` : `${elapsedHours}h`

  const days = Math.floor(elapsedHours / 24)
  const hours = elapsedHours % 24
  return hours ? `${days}d ${hours}h` : `${days}d`
}

export function getSessionTooltip(session: SessionTabInfo, now = Date.now()): string {
  const status = getSessionStatusMeta(session.status).label
  const lines = [
    `${getTabLabel(session)} (${status})`,
    `Target: ${getSessionCommandTarget(session)}`
  ]

  if (session.remoteTarget) lines.push(`Remote: ${session.remoteTarget}`)
  if (session.cwd) lines.push(`CWD: ${session.cwd}`)
  lines.push(`Uptime: ${formatSessionUptime(session.createdAt, now)}`)
  if (session.reconnectCommand) lines.push(`Reconnect: ${session.reconnectCommand}`)

  return lines.join('\n')
}
