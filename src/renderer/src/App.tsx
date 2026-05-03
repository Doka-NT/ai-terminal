import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { PanelRightClose, PanelRightOpen, Plus, Settings2, X } from 'lucide-react'
import type { RestorableAssistantThreads, RestoredTerminalSession, SessionStateSnapshot, TerminalSessionInfo } from '@shared/types'
import { TerminalPane } from './components/TerminalPane'
import { LlmPanel } from './components/LlmPanel'
import { LanguageProvider } from './i18n/LanguageContext'
import type { Language } from './i18n/translations'

interface SessionState extends TerminalSessionInfo {
  status: 'running' | 'exited' | 'disconnected'
}

const MAX_OUTPUT_CHARS = 2 * 1024 * 1024
const DEFAULT_SIDEBAR_WIDTH = 380
const MIN_SIDEBAR_WIDTH = 300
const MAX_SIDEBAR_WIDTH = 720
const MIN_WORKSPACE_WIDTH = 520
const DEFAULT_TEXT_SIZE = 13.5
const SIDEBAR_WIDTH_KEY = 'ai-terminal.sidebarWidth'
const SIDEBAR_VISIBLE_KEY = 'ai-terminal.sidebarVisible'
const TEXT_SIZE_KEY = 'ai-terminal.textSize'
const LANGUAGE_KEY = 'ai-terminal.language'
const RESTORE_SESSIONS_KEY = 'ai-terminal.restoreSessions'
const MAX_OUTPUT_CONTEXT_KEY = 'ai-terminal.maxOutputContext'
const DEFAULT_HIDE_SHORTCUT = 'CommandOrControl+Shift+Space'
const DEFAULT_MAX_OUTPUT_CONTEXT = 20000

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function storedNumber(key: string, fallback: number, min: number, max: number): number {
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) ? clamp(value, min, max) : fallback
}

function storedPositiveNumber(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getTabLabel(session: TerminalSessionInfo): string {
  if (session.kind !== 'ssh') {
    return session.label
  }

  const remoteTarget = session.remoteTarget?.trim()
  if (!remoteTarget) {
    return session.label
  }

  return session.label && session.label !== remoteTarget
    ? `${session.label} · ${remoteTarget}`
    : remoteTarget
}

export function App(): JSX.Element {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [selectedText, setSelectedText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [terminalClearVersion, setTerminalClearVersion] = useState(0)
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    window.localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== 'false'
  )
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
  )
  const [textSize, setTextSize] = useState(() =>
    storedPositiveNumber(TEXT_SIZE_KEY, DEFAULT_TEXT_SIZE)
  )
  const [language, setLanguage] = useState<Language>(() =>
    (window.localStorage.getItem(LANGUAGE_KEY) as Language) ?? 'en'
  )
  const [restoreSessions, setRestoreSessions] = useState(() =>
    window.localStorage.getItem(RESTORE_SESSIONS_KEY) !== 'false'
  )
  const [restoredAssistantThreads, setRestoredAssistantThreads] = useState<RestorableAssistantThreads>({})
  const [hideShortcut, setHideShortcut] = useState(DEFAULT_HIDE_SHORTCUT)
  const [maxOutputContext, setMaxOutputContext] = useState(() =>
    storedPositiveNumber(MAX_OUTPUT_CONTEXT_KEY, DEFAULT_MAX_OUTPUT_CONTEXT)
  )
  const maxOutputContextRef = useRef(maxOutputContext)
  const outputBuffers = useRef(new Map<string, string>())
  const appShellRef = useRef<HTMLElement>(null)
  const restoreInitializedRef = useRef(false)
  const restoreSessionsOnLaunchRef = useRef(restoreSessions)
  const restoreSessionsRef = useRef(restoreSessions)
  const saveTimerRef = useRef<number>()
  const sessionsRef = useRef<SessionState[]>([])
  const activeSessionIdRef = useRef<string>()
  const assistantThreadsRef = useRef<RestorableAssistantThreads>({})

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  )
  const activeCwd = activeSession?.cwd ?? activeSession?.command ?? ''

  const getOutputForSession = useCallback((sessionId: string): string => {
    const buf = outputBuffers.current.get(sessionId) ?? ''
    return buf.slice(-maxOutputContextRef.current)
  }, [])

  const getOutput = useCallback((): string => {
    if (!activeSessionId) return ''
    return getOutputForSession(activeSessionId)
  }, [activeSessionId, getOutputForSession])

  const scheduleSessionStateSave = useCallback(() => {
    if (!restoreInitializedRef.current || !restoreSessionsRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined
      const liveSessions = sessionsRef.current
      const liveSessionIds = new Set(liveSessions.map((session) => session.id))
      const assistantThreads = Object.fromEntries(
        Object.entries(assistantThreadsRef.current).filter(([sessionId]) => liveSessionIds.has(sessionId))
      )
      const snapshot: SessionStateSnapshot = {
        version: 1,
        savedAt: new Date().toISOString(),
        activeSessionId: activeSessionIdRef.current,
        sessions: liveSessions.map((session): RestoredTerminalSession => ({
          id: session.id,
          kind: session.kind,
          label: session.label,
          localLabel: session.localLabel,
          cwd: session.cwd,
          shell: session.shell,
          remoteHost: session.remoteHost,
          remoteTarget: session.remoteTarget,
          reconnectCommand: session.reconnectCommand,
          command: session.command,
          createdAt: session.createdAt,
          status: session.kind === 'ssh' ? 'disconnected' : session.status,
          output: outputBuffers.current.get(session.id) ?? ''
        })),
        assistantThreads
      }
      void window.api.sessionState.save(snapshot).catch((error: unknown) => {
        console.error('Failed to save session state', error)
      })
    }, 400)
  }, [])

  const handleOutput = useCallback((sessionId: string, data: string) => {
    const prev = outputBuffers.current.get(sessionId) ?? ''
    const next = prev + data
    outputBuffers.current.set(sessionId, next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next)
    scheduleSessionStateSave()
  }, [scheduleSessionStateSave])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(sidebarVisible))
  }, [sidebarVisible])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(TEXT_SIZE_KEY, String(textSize))
  }, [textSize])

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, language)
  }, [language])

  useEffect(() => {
    maxOutputContextRef.current = maxOutputContext
    window.localStorage.setItem(MAX_OUTPUT_CONTEXT_KEY, String(maxOutputContext))
  }, [maxOutputContext])

  useEffect(() => {
    restoreSessionsRef.current = restoreSessions
    window.localStorage.setItem(RESTORE_SESSIONS_KEY, String(restoreSessions))
    if (!restoreSessions) {
      void window.api.sessionState.clear()
    } else {
      scheduleSessionStateSave()
    }
  }, [restoreSessions, scheduleSessionStateSave])

  useEffect(() => {
    sessionsRef.current = sessions
    scheduleSessionStateSave()
  }, [sessions, scheduleSessionStateSave])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
    scheduleSessionStateSave()
  }, [activeSessionId, scheduleSessionStateSave])

  useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    void window.api.config.load().then((config) => {
      if (config.hideShortcut) setHideShortcut(config.hideShortcut)
    })
  }, [])

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)

    const applyWidth = (clientX: number): void => {
      const max = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH))
      setSidebarWidth(clamp(window.innerWidth - clientX, MIN_SIDEBAR_WIDTH, max))
    }

    const onPointerMove = (moveEvent: PointerEvent): void => {
      applyWidth(moveEvent.clientX)
    }

    const onPointerUp = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      try {
        handle.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture can already be released if the window loses focus.
      }
    }

    applyWidth(event.clientX)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }, [])

  const updateTextSize = useCallback((value: number) => {
    if (Number.isFinite(value) && value > 0) {
      setTextSize(value)
    }
  }, [])

  const updateSidebarWidth = useCallback((value: number) => {
    if (!Number.isFinite(value)) return
    const max = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH))
    setSidebarWidth(clamp(value, MIN_SIDEBAR_WIDTH, max))
  }, [])

  const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), [])

  const handleHideShortcutChange = useCallback((shortcut: string) => {
    setHideShortcut(shortcut)
    void window.api.shortcuts.setHide(shortcut)
  }, [])

  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--app-text-size': `${textSize}px`
  } as CSSProperties

  const createLocalSession = useCallback(async (request?: { cwd?: string; fallbackNotice?: string }) => {
    const session = await window.api.terminal.create(request?.cwd ? { cwd: request.cwd } : undefined)
    setSessions((current) => [...current, { ...session, status: 'running' }])
    setActiveSessionId(session.id)
    if (request?.fallbackNotice) {
      outputBuffers.current.set(session.id, request.fallbackNotice)
    }
    return session
  }, [])

  useEffect(() => {
    let cancelled = false

    async function initializeSessions(): Promise<void> {
      if (!restoreSessionsOnLaunchRef.current) {
        restoreInitializedRef.current = true
        await createLocalSession()
        return
      }

      const snapshot = await window.api.sessionState.load()
      if (cancelled) return

      if (!snapshot?.sessions.length) {
        restoreInitializedRef.current = true
        await createLocalSession()
        return
      }

      const restoredSessions: SessionState[] = []
      const idMap = new Map<string, string>()
      const restoredOutputs = new Map<string, string>()

      for (const saved of snapshot.sessions) {
        if (saved.kind === 'local') {
          const session = await window.api.terminal.create(saved.cwd ? { cwd: saved.cwd } : undefined)
          if (cancelled) return
          const fallbackNotice = saved.cwd && session.cwd !== saved.cwd
            ? `\r\n[AI Terminal restored this tab in ${session.cwd ?? 'your home directory'} because ${saved.cwd} was unavailable.]\r\n`
            : ''
          restoredSessions.push({ ...session, status: 'running' })
          idMap.set(saved.id, session.id)
          restoredOutputs.set(session.id, `${saved.output ?? ''}${fallbackNotice}`)
        } else {
          const id = `restored-${crypto.randomUUID()}`
          restoredSessions.push({
            id,
            kind: 'ssh',
            label: saved.label,
            localLabel: saved.localLabel,
            cwd: saved.cwd,
            shell: saved.shell,
            remoteHost: saved.remoteHost,
            remoteTarget: saved.remoteTarget,
            reconnectCommand: saved.reconnectCommand || reconnectCommandFromTarget(saved.remoteTarget),
            command: saved.command,
            createdAt: saved.createdAt,
            status: 'disconnected'
          })
          idMap.set(saved.id, id)
          restoredOutputs.set(id, saved.output ?? '')
        }
      }

      outputBuffers.current = restoredOutputs
      setSessions(restoredSessions)
      const restoredActiveId = snapshot.activeSessionId ? idMap.get(snapshot.activeSessionId) : undefined
      setActiveSessionId(restoredActiveId ?? restoredSessions[0]?.id)

      const remappedThreads: RestorableAssistantThreads = {}
      for (const [oldId, thread] of Object.entries(snapshot.assistantThreads ?? {})) {
        const nextId = idMap.get(oldId)
        if (nextId) {
          remappedThreads[nextId] = {
            ...thread,
            session: thread.session ? { ...thread.session, id: nextId } : undefined
          }
        }
      }
      assistantThreadsRef.current = remappedThreads
      setRestoredAssistantThreads(remappedThreads)
      restoreInitializedRef.current = true
      scheduleSessionStateSave()
    }

    void initializeSessions().catch((error: unknown) => {
      console.error('Failed to restore sessions', error)
      restoreInitializedRef.current = true
      void createLocalSession()
    })

    return () => {
      cancelled = true
    }
  }, [createLocalSession, scheduleSessionStateSave])

  useEffect(() => {
    const offExit = window.api.terminal.onExit(({ sessionId }) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, status: 'exited' } : session
        )
      )
    })

    const offCwd = window.api.terminal.onCwd(({ sessionId, cwd }) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, cwd } : session
        )
      )
    })

    const offSession = window.api.terminal.onSession((updatedSession) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === updatedSession.id ? { ...updatedSession, status: session.status } : session
        )
      )
    })

    return () => {
      offExit()
      offCwd()
      offSession()
    }
  }, [])

  const closeSession = useCallback(async (sessionId: string) => {
    const closing = sessions.find((session) => session.id === sessionId)
    if (closing?.status !== 'disconnected') {
      await window.api.terminal.kill(sessionId)
    }
    outputBuffers.current.delete(sessionId)
    const remaining = sessions.filter((session) => session.id !== sessionId)
    setSessions(remaining)
    setActiveSessionId((current) => {
      if (current !== sessionId) return current
      return remaining.find((session) => session.id !== sessionId)?.id
    })
    if (remaining.length === 0) {
      void createLocalSession()
    }
  }, [sessions, createLocalSession])

  const reconnectSession = useCallback(async (sessionId: string) => {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session?.reconnectCommand) return

    const restoredOutput = outputBuffers.current.get(sessionId) ?? ''
    const next = await window.api.terminal.create(session.cwd ? { cwd: session.cwd } : undefined)
    const fallbackNotice = session.cwd && next.cwd !== session.cwd
      ? `\r\n[AI Terminal reconnected from ${next.cwd ?? 'your home directory'} because ${session.cwd} was unavailable.]\r\n`
      : ''
    outputBuffers.current.delete(sessionId)
    outputBuffers.current.set(next.id, `${restoredOutput}${fallbackNotice}`)
    assistantThreadsRef.current = remapAssistantThreadId(assistantThreadsRef.current, sessionId, next.id)
    setRestoredAssistantThreads(assistantThreadsRef.current)
    setSessions((current) =>
      current.map((candidate) =>
        candidate.id === sessionId
          ? {
              ...next,
              kind: 'ssh',
              label: session.label,
              localLabel: next.label,
              remoteHost: session.remoteHost,
              remoteTarget: session.remoteTarget,
              reconnectCommand: session.reconnectCommand,
              command: session.command,
              createdAt: session.createdAt,
              status: 'running'
            }
          : candidate
      )
    )
    setActiveSessionId(next.id)
    void window.api.command.runConfirmed(next.id, session.reconnectCommand)
  }, [sessions])

  const handleAssistantThreadsChange = useCallback((threads: RestorableAssistantThreads) => {
    assistantThreadsRef.current = threads
    scheduleSessionStateSave()
  }, [scheduleSessionStateSave])

  const clearSavedSessionState = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    await window.api.sessionState.clear()
  }, [])

  const clearActiveTerminal = useCallback(() => {
    if (!activeSessionId) return

    outputBuffers.current.set(activeSessionId, '')
    setTerminalClearVersion((version) => version + 1)
  }, [activeSessionId])

  const closeActiveSession = useCallback(() => {
    if (!activeSessionId) return

    void closeSession(activeSessionId)
  }, [activeSessionId, closeSession])

  const handleTabbarDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.session-tab')) return

    void createLocalSession()
  }, [createLocalSession])

  useEffect(() => {
    return window.api.shortcuts.onShortcut((shortcut) => {
      if (shortcut === 'clear-terminal') {
        clearActiveTerminal()
      } else if (shortcut === 'open-settings') {
        setSettingsOpen(true)
      } else if (shortcut === 'new-tab') {
        void createLocalSession()
      } else if (shortcut === 'close-tab') {
        closeActiveSession()
      } else if (shortcut === 'toggle-sidebar') {
        toggleSidebar()
      }
    })
  }, [clearActiveTerminal, closeActiveSession, createLocalSession, toggleSidebar])

  useEffect(() => {
    return window.api.shortcuts.onWindowShow(() => {
      const el = appShellRef.current
      if (!el) return
      el.classList.remove('window-entering')
      void el.offsetWidth
      el.classList.add('window-entering')
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  return (
    <LanguageProvider language={language}>
    <main ref={appShellRef} className={`app-shell${sidebarVisible ? '' : ' sidebar-hidden'}`} style={shellStyle}>
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-window-spacer" aria-hidden />
          <div className="topbar-title">AI Terminal</div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => void createLocalSession()} title="New local terminal (⌘T)">
              <Plus size={16} aria-hidden />
            </button>
            <button className="icon-button" type="button" onClick={toggleSidebar} title={`${sidebarVisible ? 'Hide' : 'Show'} assistant sidebar (⌘\\)`}>
              {sidebarVisible ? <PanelRightClose size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />}
            </button>
            <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} title="Settings (⌘,)">
              <Settings2 size={16} aria-hidden />
            </button>
          </div>
        </header>

        <div className="tabbar" role="tablist" aria-label="Terminal sessions" onDoubleClick={handleTabbarDoubleClick}>
          <div className="tab-list">
            {sessions.map((session) => {
              const tabLabel = getTabLabel(session)
              const tabClassName = [
                'session-tab',
                session.kind === 'ssh' ? 'ssh-session' : '',
                session.id === activeSessionId ? 'active' : ''
              ].filter(Boolean).join(' ')

              return (
                <button
                  className={tabClassName}
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={session.id === activeSessionId}
                  title={tabLabel}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span className={`status-dot ${session.status}`} />
                  <span className="tab-label">{tabLabel}</span>
                  {session.kind !== 'ssh' ? <span className="tab-kind">{session.kind}</span> : null}
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={0}
                    title="Close session (⌘W)"
                    onClick={(event) => {
                      event.stopPropagation()
                      void closeSession(session.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation()
                        void closeSession(session.id)
                      }
                    }}
                  >
                    <X size={9} aria-hidden />
                  </span>
                </button>
              )
            })}
          </div>
          {activeCwd ? <div className="tabbar-cwd" title={activeCwd}>{activeCwd}</div> : null}
        </div>

        <TerminalPane
          activeSession={activeSession}
          sessionIds={sessions.map((session) => session.id)}
          layoutKey={`${sidebarWidth}-${textSize}-${sidebarVisible}`}
          textSize={textSize}
          clearSignal={terminalClearVersion}
          onSelectionChange={setSelectedText}
          outputBuffers={outputBuffers}
          onOutput={handleOutput}
          onReconnect={(sessionId) => { void reconnectSession(sessionId) }}
        />
      </section>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize assistant sidebar"
        aria-orientation="vertical"
        aria-hidden={!sidebarVisible}
        onPointerDown={sidebarVisible ? startSidebarResize : undefined}
      />

      <LlmPanel
        activeSession={activeSession}
        sessionIds={sessions.map((session) => session.id)}
        selectedText={selectedText}
        getOutput={getOutput}
        getOutputForSession={getOutputForSession}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
        textSize={textSize}
        onTextSizeChange={updateTextSize}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
        language={language}
        onLanguageChange={setLanguage}
        hideShortcut={hideShortcut}
        onHideShortcutChange={handleHideShortcutChange}
        maxOutputContext={maxOutputContext}
        onMaxOutputContextChange={setMaxOutputContext}
        restoreSessions={restoreSessions}
        onRestoreSessionsChange={setRestoreSessions}
        restoredThreads={restoredAssistantThreads}
        onThreadsChange={handleAssistantThreadsChange}
        onClearSavedSessionState={clearSavedSessionState}
      />
    </main>
    </LanguageProvider>
  )
}

function reconnectCommandFromTarget(remoteTarget: string | undefined): string | undefined {
  return remoteTarget ? `ssh ${shellQuote(remoteTarget)}` : undefined
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`
}

function remapAssistantThreadId(
  threads: RestorableAssistantThreads,
  oldSessionId: string,
  nextSessionId: string
): RestorableAssistantThreads {
  const thread = threads[oldSessionId]
  if (!thread) return threads
  const next = { ...threads }
  delete next[oldSessionId]
  next[nextSessionId] = {
    ...thread,
    session: thread.session ? { ...thread.session, id: nextSessionId } : undefined
  }
  return next
}
