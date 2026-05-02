import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, Settings2, X } from 'lucide-react'
import type { TerminalSessionInfo } from '@shared/types'
import { TerminalPane } from './components/TerminalPane'
import { LlmPanel } from './components/LlmPanel'
import { LanguageProvider } from './i18n/LanguageContext'
import type { Language } from './i18n/translations'

interface SessionState extends TerminalSessionInfo {
  status: 'running' | 'exited'
}

const MAX_OUTPUT_CHARS = 160_000
const DEFAULT_SIDEBAR_WIDTH = 380
const MIN_SIDEBAR_WIDTH = 300
const MAX_SIDEBAR_WIDTH = 720
const MIN_WORKSPACE_WIDTH = 520
const DEFAULT_TEXT_SIZE = 13.5
const SIDEBAR_WIDTH_KEY = 'ai-terminal.sidebarWidth'
const TEXT_SIZE_KEY = 'ai-terminal.textSize'
const LANGUAGE_KEY = 'ai-terminal.language'

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

export function App(): JSX.Element {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [selectedText, setSelectedText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [terminalClearVersion, setTerminalClearVersion] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
  )
  const [textSize, setTextSize] = useState(() =>
    storedPositiveNumber(TEXT_SIZE_KEY, DEFAULT_TEXT_SIZE)
  )
  const [language, setLanguage] = useState<Language>(() =>
    (window.localStorage.getItem(LANGUAGE_KEY) as Language) ?? 'en'
  )
  const outputBuffers = useRef(new Map<string, string>())

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  )
  const activeCwd = activeSession?.cwd ?? activeSession?.command ?? ''

  const getOutput = useCallback((): string => {
    if (!activeSessionId) return ''
    const buf = outputBuffers.current.get(activeSessionId) ?? ''
    return buf.slice(-4000)
  }, [activeSessionId])

  const handleOutput = useCallback((sessionId: string, data: string) => {
    const prev = outputBuffers.current.get(sessionId) ?? ''
    const next = prev + data
    outputBuffers.current.set(sessionId, next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(TEXT_SIZE_KEY, String(textSize))
  }, [textSize])

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, language)
  }, [language])

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

  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--app-text-size': `${textSize}px`
  } as CSSProperties

  const createLocalSession = useCallback(async () => {
    const session = await window.api.terminal.create()
    setSessions((current) => [...current, { ...session, status: 'running' }])
    setActiveSessionId(session.id)
  }, [])

  useEffect(() => {
    void createLocalSession()
  }, [createLocalSession])

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

    return () => {
      offExit()
      offCwd()
    }
  }, [])

  const closeSession = useCallback(async (sessionId: string) => {
    await window.api.terminal.kill(sessionId)
    outputBuffers.current.delete(sessionId)
    setSessions((current) => current.filter((session) => session.id !== sessionId))
    setActiveSessionId((current) => {
      if (current !== sessionId) return current
      return sessions.find((session) => session.id !== sessionId)?.id
    })
  }, [sessions])

  const clearActiveTerminal = useCallback(() => {
    if (!activeSessionId) return

    outputBuffers.current.set(activeSessionId, '')
    setTerminalClearVersion((version) => version + 1)
  }, [activeSessionId])

  const closeActiveSession = useCallback(() => {
    if (!activeSessionId) return

    void closeSession(activeSessionId)
  }, [activeSessionId, closeSession])

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
      }
    })
  }, [clearActiveTerminal, closeActiveSession, createLocalSession])

  return (
    <LanguageProvider language={language}>
    <main className="app-shell" style={shellStyle}>
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-window-spacer" aria-hidden />
          <div className="topbar-title">AI Terminal</div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => void createLocalSession()} title="New local terminal (⌘T)">
              <Plus size={16} aria-hidden />
            </button>
            <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} title="Settings (⌘,)">
              <Settings2 size={16} aria-hidden />
            </button>
          </div>
        </header>

        <div className="tabbar" role="tablist" aria-label="Terminal sessions">
          <div className="tab-list">
            {sessions.map((session) => (
              <button
                className={`session-tab ${session.id === activeSessionId ? 'active' : ''}`}
                key={session.id}
                type="button"
                role="tab"
                aria-selected={session.id === activeSessionId}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className={`status-dot ${session.status}`} />
                <span className="tab-label">{session.label}</span>
                <span className="tab-kind">{session.kind}</span>
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
            ))}
          </div>
          {activeCwd ? <div className="tabbar-cwd" title={activeCwd}>{activeCwd}</div> : null}
        </div>

        <TerminalPane
          activeSession={activeSession}
          sessionIds={sessions.map((session) => session.id)}
          layoutKey={`${sidebarWidth}-${textSize}`}
          textSize={textSize}
          clearSignal={terminalClearVersion}
          onSelectionChange={setSelectedText}
          outputBuffers={outputBuffers}
          onOutput={handleOutput}
        />
      </section>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize assistant sidebar"
        aria-orientation="vertical"
        onPointerDown={startSidebarResize}
      />

      <LlmPanel
        activeSession={activeSession}
        selectedText={selectedText}
        getOutput={getOutput}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
        textSize={textSize}
        onTextSizeChange={updateTextSize}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
        language={language}
        onLanguageChange={setLanguage}
      />
    </main>
    </LanguageProvider>
  )
}
