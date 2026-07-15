// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import {
  compactPath,
  formatSessionUptime,
  getCwdBasename,
  getSessionCommandTarget,
  getSessionRenderStatus,
  getSessionStatusMeta,
  getSessionTooltip,
  getSshTabIndicatorTitle,
  getTabLabel,
  isLiveSessionStatus,
  mergeRestoredSessionOutput,
  sessionStatusAfterPrompt,
  type SessionTabInfo
} from '@renderer/utils/sessionTabs'

describe('session tab helpers', () => {
  it('prefers the remote target for SSH tab labels and command targets', () => {
    const session: SessionTabInfo = {
      id: 'ssh-1',
      kind: 'ssh',
      label: 'production',
      remoteTarget: 'deploy@example.com',
      remoteHost: 'example.com',
      reconnectCommand: 'ssh deploy@example.com',
      cwd: '/Users/artem/project',
      command: 'ssh deploy@example.com',
      createdAt: 1_000,
      status: 'disconnected'
    }

    expect(getTabLabel(session)).toBe('production')
    expect(getSessionCommandTarget(session)).toBe('deploy@example.com')
    expect(getSshTabIndicatorTitle(session)).toBe('SSH: deploy@example.com')
    expect(getSessionTooltip(session, 121_000)).toContain('Remote: deploy@example.com')
    expect(getSessionTooltip(session, 121_000)).toContain('Reconnect: ssh deploy@example.com')
  })

  it('keeps transient SSH tab labels concise while tooltip details stay complete', () => {
    const session: SessionTabInfo = {
      id: 'ssh-2',
      kind: 'ssh',
      label: 'deploy@very-long-hostname.internal.example.com',
      remoteTarget: 'deploy@very-long-hostname.internal.example.com',
      remoteHost: 'very-long-hostname.internal.example.com',
      reconnectCommand: 'ssh deploy@very-long-hostname.internal.example.com',
      cwd: '/srv/app',
      command: 'ssh deploy@very-long-hostname.internal.example.com',
      createdAt: 1_000,
      status: 'running'
    }

    expect(getTabLabel(session)).toBe('deploy@very-long-hostname.internal.example.com')
    expect(getSessionTooltip(session, 121_000)).toContain('Remote: deploy@very-long-hostname.internal.example.com')
  })

  it('formats SSH badge titles only for remote sessions', () => {
    expect(getSshTabIndicatorTitle({
      id: 'local-1',
      kind: 'local',
      label: 'zsh',
      command: '/bin/zsh',
      createdAt: 1_000
    })).toBeUndefined()

    expect(getSshTabIndicatorTitle({
      id: 'ssh-3',
      kind: 'ssh',
      label: 'bastion',
      remoteHost: 'bastion.internal',
      command: 'ssh bastion.internal',
      createdAt: 1_000
    })).toBe('SSH: bastion.internal')

    expect(getSshTabIndicatorTitle({
      id: 'ssh-4',
      kind: 'ssh',
      label: '',
      command: 'ssh',
      createdAt: 1_000
    })).toBe('SSH session')
  })

  it('marks live background sessions idle when their prompt event arrives', () => {
    expect(sessionStatusAfterPrompt('running')).toBe('idle')
    expect(sessionStatusAfterPrompt('idle')).toBe('idle')
    expect(sessionStatusAfterPrompt('reconnecting')).toBe('reconnecting')
    expect(sessionStatusAfterPrompt('disconnected')).toBe('disconnected')
    expect(sessionStatusAfterPrompt('exited')).toBe('exited')
  })

  it('returns compact cwd badges and local command targets', () => {
    const session: SessionTabInfo = {
      id: 'local-1',
      kind: 'local',
      label: 'zsh',
      cwd: '/Users/artem/PhpstormProjects/Taviraq',
      command: '/bin/zsh',
      createdAt: 1_000,
      status: 'idle'
    }

    expect(getCwdBasename(session.cwd)).toBe('Taviraq')
    expect(getSessionCommandTarget(session)).toBe('Taviraq')
  })

  it('shortens long paths with a middle ellipsis', () => {
    const path = '/Users/artem/Library/Mobile Documents/com~apple~CloudDocs/_VideProjects/ai-terminal'

    expect(compactPath(path, 36)).toBe('/Users/artem/Li…Projects/ai-terminal')
    expect(compactPath('/Users/artem/project', 36)).toBe('/Users/artem/project')
    expect(compactPath(undefined, 36)).toBeUndefined()
  })

  it('formats session uptime for tab tooltips', () => {
    expect(formatSessionUptime(1_000, 30_000)).toBe('<1m')
    expect(formatSessionUptime(1_000, 181_000)).toBe('3m')
    expect(formatSessionUptime(1_000, 7_261_000)).toBe('2h 1m')
    expect(formatSessionUptime(1_000, 176_401_000)).toBe('2d 1h')
  })

  it('exposes tab status labels for idle and reconnecting sessions', () => {
    expect(getSessionStatusMeta('idle')).toEqual({ label: 'Idle', className: 'idle' })
    expect(getSessionStatusMeta('reconnecting')).toEqual({ label: 'Reconnecting', className: 'reconnecting' })
  })

  it('treats prompted sessions as live for terminal input', () => {
    expect(isLiveSessionStatus('running')).toBe(true)
    expect(isLiveSessionStatus('idle')).toBe(true)
    expect(isLiveSessionStatus('exited')).toBe(false)
    expect(isLiveSessionStatus('disconnected')).toBe(false)
    expect(isLiveSessionStatus('reconnecting')).toBe(false)
    expect(isLiveSessionStatus(undefined)).toBe(false)
  })

  it('keeps live session render identity stable across prompt status changes', () => {
    expect(getSessionRenderStatus('running')).toBe('live')
    expect(getSessionRenderStatus('idle')).toBe('live')
    expect(getSessionRenderStatus('disconnected')).toBe('disconnected')
    expect(getSessionRenderStatus('reconnecting')).toBe('reconnecting')
    expect(getSessionRenderStatus('exited')).toBe('exited')
    expect(getSessionRenderStatus(undefined)).toBeUndefined()
  })

  it('preserves early reconnect output after restored output', () => {
    expect(mergeRestoredSessionOutput('old transcript\n', 'Password: ')).toBe('old transcript\nPassword: ')
    expect(mergeRestoredSessionOutput('old transcript\n', undefined)).toBe('old transcript\n')
  })
})
