// SPDX-License-Identifier: MPL-2.0
import { app } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SaveSessionStateRequest, SessionStateSnapshot } from '@shared/types'
import { trimTerminalOutputBuffer } from '@shared/terminalText'

const SESSION_STATE_FILE = 'session-state.json'
export const MAX_SAVED_OUTPUT_CHARS = 2 * 1024 * 1024

export function trimSavedOutput(output: string, maxChars = MAX_SAVED_OUTPUT_CHARS): string {
  // Naively re-slicing here can bisect an OSC 633;E marker that
  // trimTerminalOutputBuffer (App.tsx's renderer-side cap) already had to
  // widen slightly to keep intact, undoing that protection at save time.
  return trimTerminalOutputBuffer(output, maxChars)
}

export function normalizeSessionState(snapshot: SaveSessionStateRequest): SessionStateSnapshot {
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions.map((session) => ({
    ...session,
    reconnectCommand: session.reconnectCommand || reconnectCommandFromTarget(session.remoteTarget),
    output: trimSavedOutput(session.output ?? '')
  })) : []

  const liveSessionIds = new Set(sessions.map((session) => session.id))
  const assistantThreads = Object.fromEntries(
    Object.entries(snapshot.assistantThreads ?? {})
      .filter(([sessionId]) => liveSessionIds.has(sessionId))
      .map(([sessionId, thread]) => [
        sessionId,
        {
          messages: Array.isArray(thread.messages) ? thread.messages : [],
          draft: typeof thread.draft === 'string' ? thread.draft : '',
          session: thread.session,
          savedChatId: typeof thread.savedChatId === 'string' ? thread.savedChatId : undefined
        }
      ])
  )

  return {
    version: 1,
    savedAt: snapshot.savedAt || new Date().toISOString(),
    activeSessionId: snapshot.activeSessionId && liveSessionIds.has(snapshot.activeSessionId)
      ? snapshot.activeSessionId
      : sessions[0]?.id,
    sessions,
    assistantThreads
  }
}

function reconnectCommandFromTarget(remoteTarget: string | undefined): string | undefined {
  return remoteTarget ? `ssh ${shellQuote(remoteTarget)}` : undefined
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`
}

export class SessionStateStore {
  private readonly path = join(app.getPath('userData'), SESSION_STATE_FILE)

  async load(): Promise<SessionStateSnapshot | undefined> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as Partial<SessionStateSnapshot>
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return undefined
      return normalizeSessionState({
        version: 1,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
        activeSessionId: parsed.activeSessionId,
        sessions: parsed.sessions,
        assistantThreads: parsed.assistantThreads ?? {}
      })
    } catch {
      return undefined
    }
  }

  async save(snapshot: SaveSessionStateRequest): Promise<void> {
    const normalized = normalizeSessionState(snapshot)
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(normalized, null, 2), 'utf8')
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }
}
