// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronLeft, Command, Copy, Pencil, PlugZap, RotateCcw, Server, SquareTerminal, Terminal, Wifi, WifiOff, X, PanelRightClose, PanelRightOpen, Plus, Settings2, ShieldAlert } from 'lucide-react'
import type { AssistMode, CommandSnippet, PromptTemplate, RestorableAssistantThread, RestorableAssistantThreads, RestoredTerminalSession, SessionStateSnapshot, SSHProfileConfig, TerminalCursorStyle, TerminalSessionInfo } from '@shared/types'
import { remapRestored633ENonce, type BlockTrackerActivity, type CommandBlock } from './utils/blockTracker'
import { boundTerminalOutputForRequest, trimTerminalOutputBuffer } from '@shared/terminalText'
import { TerminalPane, type TerminalPaneHandle } from './components/TerminalPane'
import { LlmPanel } from './components/LlmPanel'
import { CommandPalette, type CommandPaletteAction, type CommandPaletteCategoryFilter } from './components/CommandPalette'
import { TelemetryConsent } from './components/TelemetryConsent'
import { UpdateNotice } from './components/UpdateNotice'
import { LanguageProvider } from './i18n/LanguageContext'
import { TRANSLATIONS, type Language, type Translations } from './i18n/translations'
import { themeMap, themes, DEFAULT_THEME_ID } from './themes/definitions'
import { applyThemeToDom } from './themes/applyTheme'
import type { TerminalColors } from './themes/types'
import { compactPath, getCwdBasename, getSessionStatusMeta, getSessionTooltip, getSshTabIndicatorTitle, getTabLabel, isLiveSessionStatus, mergeRestoredSessionOutput, sessionStatusAfterPrompt, type SessionTabStatus } from './utils/sessionTabs'

interface SessionState extends TerminalSessionInfo {
  status: SessionTabStatus
}

const MAX_OUTPUT_CHARS = 2 * 1024 * 1024
const DEFAULT_SIDEBAR_WIDTH = 425
const MIN_SIDEBAR_WIDTH = 300
const MAX_SIDEBAR_WIDTH = 720
const MIN_WORKSPACE_WIDTH = 520
const SIDEBAR_RESIZER_WIDTH = 6
const DEFAULT_TEXT_SIZE = 13.5
const STORAGE_PREFIX = 'taviraq'
const LEGACY_STORAGE_PREFIX = 'ai-terminal'
const SIDEBAR_WIDTH_KEY = `${STORAGE_PREFIX}.sidebarWidth`
const SIDEBAR_VISIBLE_KEY = `${STORAGE_PREFIX}.sidebarVisible`
const TEXT_SIZE_KEY = `${STORAGE_PREFIX}.textSize`
const TERMINAL_FONT_FAMILY_KEY = `${STORAGE_PREFIX}.terminalFontFamily`
const TERMINAL_CURSOR_STYLE_KEY = `${STORAGE_PREFIX}.terminalCursorStyle`
const TERMINAL_CURSOR_BLINK_KEY = `${STORAGE_PREFIX}.terminalCursorBlink`
const TERMINAL_LINE_HEIGHT_KEY = `${STORAGE_PREFIX}.terminalLineHeight`
const TERMINAL_SCROLLBACK_KEY = `${STORAGE_PREFIX}.terminalScrollback`
const WINDOW_OPACITY_KEY = `${STORAGE_PREFIX}.windowOpacity`
const LANGUAGE_KEY = `${STORAGE_PREFIX}.language`
const THEME_KEY = `${STORAGE_PREFIX}.theme`
const RESTORE_SESSIONS_KEY = `${STORAGE_PREFIX}.restoreSessions`
const MAX_OUTPUT_CONTEXT_KEY = `${STORAGE_PREFIX}.maxOutputContext`
const COMMAND_PALETTE_RECENT_KEY = `${STORAGE_PREFIX}.commandPaletteRecent`
const DEFAULT_HIDE_SHORTCUT = 'CommandOrControl+Shift+Space'
const DEFAULT_MAX_OUTPUT_CONTEXT = 20000
const MAX_RECENT_COMMAND_ACTIONS = 8
const DEFAULT_TERMINAL_FONT_FAMILY = 'Menlo, monospace'
const DEFAULT_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = 'block'
const DEFAULT_TERMINAL_LINE_HEIGHT = 1.25
const DEFAULT_TERMINAL_SCROLLBACK = 5000
const DEFAULT_WINDOW_OPACITY = 1
const SIDEBAR_TRANSITION_MS = 260
type SettingsTab = 'appearance' | 'providers' | 'mcp' | 'connections' | 'security' | 'chatTools' | 'prompts' | 'snippets' | 'data'
let storageMigrationComplete = false

interface BlockPromptRequest {
  id: string
  sessionId: string
  prompt: string
}

interface SnippetDraftRequest {
  id: string
  name?: string
  command?: string
}

interface PromptInsertRequest {
  id: string
  content: string
}

interface AssistModeRequest {
  id: string
  mode: AssistMode
}

interface ModelSwitchRequest {
  id: string
}

interface PendingBlockPrompt {
  id: string
  sessionId: string
  prompt: string
  blockCount: number
}

interface PendingBlockRerun {
  sessionId: string
  command: string
}

interface TabContextMenuState {
  sessionId: string
  x: number
  y: number
}

interface RenameSessionRequest {
  sessionId: string
  label: string
}

const TAB_CONTEXT_MENU_WIDTH = 180
const TAB_CONTEXT_MENU_HEIGHT = 154

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function maxSidebarWidthForViewport(): number {
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH - SIDEBAR_RESIZER_WIDTH)
  )
}

function clampStoredSidebarWidth(value: number): number {
  return clamp(value, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
}

function clampSidebarWidth(value: number): number {
  return clamp(value, MIN_SIDEBAR_WIDTH, maxSidebarWidthForViewport())
}

function storedSidebarWidth(): number {
  const rawValue = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
  if (rawValue === null) {
    return clampStoredSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  }

  const value = Number(rawValue)
  if (!Number.isFinite(value)) {
    return clampStoredSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  }

  return clampStoredSidebarWidth(value)
}

function storedPositiveNumber(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function storedRecentCommandActions(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(COMMAND_PALETTE_RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function storedClampedNumber(key: string, fallback: number, min: number, max: number): number {
  const rawValue = window.localStorage.getItem(key)
  if (rawValue === null) return fallback
  const value = Number(rawValue)
  return Number.isFinite(value) ? clamp(value, min, max) : fallback
}

function storedCursorStyle(): TerminalCursorStyle {
  const value = window.localStorage.getItem(TERMINAL_CURSOR_STYLE_KEY)
  return value === 'underline' || value === 'bar' || value === 'block'
    ? value
    : DEFAULT_TERMINAL_CURSOR_STYLE
}

function storedTerminalFontFamily(): string {
  return window.localStorage.getItem(TERMINAL_FONT_FAMILY_KEY) || DEFAULT_TERMINAL_FONT_FAMILY
}

function migrateLocalStorageKeys(): void {
  if (storageMigrationComplete) return
  storageMigrationComplete = true

  const keys = [
    'sidebarWidth',
    'sidebarVisible',
    'textSize',
    'terminalFontFamily',
    'terminalCursorStyle',
    'terminalCursorBlink',
    'terminalLineHeight',
    'terminalScrollback',
    'windowOpacity',
    'language',
    'theme',
    'restoreSessions',
    'maxOutputContext'
  ]

  for (const key of keys) {
    const nextKey = `${STORAGE_PREFIX}.${key}`
    const legacyKey = `${LEGACY_STORAGE_PREFIX}.${key}`
    if (window.localStorage.getItem(nextKey) !== null) continue

    const legacyValue = window.localStorage.getItem(legacyKey)
    if (legacyValue === null) continue

    window.localStorage.setItem(
      nextKey,
      legacyValue === 'ai-terminal-dark' ? 'taviraq-dark' : legacyValue
    )
  }
}



export function App(): JSX.Element {
  migrateLocalStorageKeys()

  const [sessions, setSessions] = useState<SessionState[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [selectedText, setSelectedText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [terminalClearVersion, setTerminalClearVersion] = useState(0)
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    window.localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== 'false'
  )
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedSidebarWidth()
  )
  const [textSize, setTextSize] = useState(() =>
    storedPositiveNumber(TEXT_SIZE_KEY, DEFAULT_TEXT_SIZE)
  )
  const [terminalFontFamily, setTerminalFontFamily] = useState(storedTerminalFontFamily)
  const [terminalCursorStyle, setTerminalCursorStyle] = useState<TerminalCursorStyle>(storedCursorStyle)
  const [terminalCursorBlink, setTerminalCursorBlink] = useState(() =>
    window.localStorage.getItem(TERMINAL_CURSOR_BLINK_KEY) !== 'false'
  )
  const [terminalLineHeight, setTerminalLineHeight] = useState(() =>
    storedClampedNumber(TERMINAL_LINE_HEIGHT_KEY, DEFAULT_TERMINAL_LINE_HEIGHT, 1, 2)
  )
  const [terminalScrollback, setTerminalScrollback] = useState(() =>
    Math.round(storedClampedNumber(TERMINAL_SCROLLBACK_KEY, DEFAULT_TERMINAL_SCROLLBACK, 100, 100000))
  )
  const [windowOpacity, setWindowOpacity] = useState(() =>
    storedClampedNumber(WINDOW_OPACITY_KEY, DEFAULT_WINDOW_OPACITY, 0.9, 1)
  )
  const [language, setLanguage] = useState<Language>(() =>
    (window.localStorage.getItem(LANGUAGE_KEY) as Language) ?? 'en'
  )
  const [themeId, setThemeId] = useState<string>(() =>
    window.localStorage.getItem(THEME_KEY) || DEFAULT_THEME_ID
  )
  const currentTheme = themeMap[themeId] ?? themeMap[DEFAULT_THEME_ID]
  const terminalTheme: TerminalColors = currentTheme.terminal
  const [restoreSessions, setRestoreSessions] = useState(() =>
    window.localStorage.getItem(RESTORE_SESSIONS_KEY) !== 'false'
  )
  const [restoredAssistantThreads, setRestoredAssistantThreads] = useState<RestorableAssistantThreads>({})
  const [hideShortcut, setHideShortcut] = useState(DEFAULT_HIDE_SHORTCUT)
  const [maxOutputContext, setMaxOutputContext] = useState(() =>
    storedPositiveNumber(MAX_OUTPUT_CONTEXT_KEY, DEFAULT_MAX_OUTPUT_CONTEXT)
  )
  const [newTabDropdownOpen, setNewTabDropdownOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteInitialCategory, setCommandPaletteInitialCategory] = useState<CommandPaletteCategoryFilter>('all')
  const [commandPaletteSnippets, setCommandPaletteSnippets] = useState<CommandSnippet[]>([])
  const [commandPalettePrompts, setCommandPalettePrompts] = useState<PromptTemplate[]>([])
  const [recentCommandActionIds, setRecentCommandActionIds] = useState(storedRecentCommandActions)
  const [settingsTabRequest, setSettingsTabRequest] = useState<SettingsTab>('providers')
  const [settingsTabRequestVersion, setSettingsTabRequestVersion] = useState(0)
  const [addSnippetRequestVersion, setAddSnippetRequestVersion] = useState(0)
  const [sshProfiles, setSshProfiles] = useState<SSHProfileConfig[]>([])
  const maxOutputContextRef = useRef(maxOutputContext)
  const windowOpacityRef = useRef(windowOpacity)
  const outputBuffers = useRef(new Map<string, string>())
  const commandBlocksRef = useRef(new Map<string, CommandBlock[]>())
  const appShellRef = useRef<HTMLElement>(null)
  const sidebarVisibleRef = useRef(sidebarVisible)
  const sidebarTransitionTimerRef = useRef<number>()
  const terminalPaneRef = useRef<TerminalPaneHandle | null>(null)
  const restoreInitializedRef = useRef(false)
  const restoreSessionsOnLaunchRef = useRef(restoreSessions)
  const restoreSessionsRef = useRef(restoreSessions)
  const saveTimerRef = useRef<number>()
  const sessionsRef = useRef<SessionState[]>([])
  const activeSessionIdRef = useRef<string>()
  const assistantThreadsRef = useRef<RestorableAssistantThreads>({})
  const cancelledReconnectsRef = useRef(new Set<string>())
  const reconnectReplacementRef = useRef(new Map<string, string>())
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([])
  const [blockPromptRequest, setBlockPromptRequest] = useState<BlockPromptRequest | null>(null)
  const [snippetDraftRequest, setSnippetDraftRequest] = useState<SnippetDraftRequest | null>(null)
  const [promptInsertRequest, setPromptInsertRequest] = useState<PromptInsertRequest | null>(null)
  const [assistModeRequest, setAssistModeRequest] = useState<AssistModeRequest | null>(null)
  const [modelSwitchRequest, setModelSwitchRequest] = useState<ModelSwitchRequest | null>(null)
  const [pendingBlockPrompt, setPendingBlockPrompt] = useState<PendingBlockPrompt | null>(null)
  const [pendingBlockRerun, setPendingBlockRerun] = useState<PendingBlockRerun | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)
  const [renameSessionRequest, setRenameSessionRequest] = useState<RenameSessionRequest | null>(null)

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  )

  const beginSidebarVisibilityTransition = useCallback((): void => {
    if (sidebarTransitionTimerRef.current !== undefined) {
      window.clearTimeout(sidebarTransitionTimerRef.current)
    }
    setSidebarTransitioning(true)
    sidebarTransitionTimerRef.current = window.setTimeout(() => {
      setSidebarTransitioning(false)
      sidebarTransitionTimerRef.current = undefined
    }, SIDEBAR_TRANSITION_MS)
  }, [])

  const showSidebar = useCallback((): void => {
    if (!sidebarVisibleRef.current) beginSidebarVisibilityTransition()
    setSidebarVisible(true)
  }, [beginSidebarVisibilityTransition])
  const activeCwd = activeSession?.cwd ?? activeSession?.command ?? ''
  const activeCwdDisplay = compactPath(activeCwd, 36)
  const activeCommandBlocks = activeSessionId ? commandBlocksRef.current.get(activeSessionId) ?? [] : []
  const appT = useCallback((key: keyof Translations, vars?: Record<string, string | number>): string => {
    let result = TRANSLATIONS[language][key]
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        result = result.replace(`{${k}}`, String(v))
      }
    }
    return result
  }, [language])

  const getOutputForSession = useCallback((sessionId: string): string => {
    const buf = outputBuffers.current.get(sessionId) ?? ''
    // Strip OSC before bounding by length: slicing the raw buffer first can
    // bisect an OSC 633;E marker, leaving a headless `633;E;...;<nonce>` tail
    // that no consumer's stripAnsi can recognize as an escape sequence.
    return boundTerminalOutputForRequest(buf, maxOutputContextRef.current) ?? ''
  }, [])

  const getOutput = useCallback((): string => {
    if (!activeSessionId) return ''
    return getOutputForSession(activeSessionId)
  }, [activeSessionId, getOutputForSession])


  const handleBlocksChange = useCallback((sessionId: string, blocks: CommandBlock[]): void => {
    commandBlocksRef.current.set(sessionId, blocks)
  }, [])

  const handleBlockActivityChange = useCallback((sessionId: string, activity: BlockTrackerActivity): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId && isLiveSessionStatus(session.status)
          ? { ...session, status: activity }
          : session
      )
    )
  }, [])

  const toggleBlockSelection = useCallback((blockId: string, additive: boolean): void => {
    setSelectedBlockIds((current) => {
      if (!additive) return [blockId]
      return current.includes(blockId)
        ? current.filter((id) => id !== blockId)
        : [...current, blockId]
    })
  }, [])

  const clearBlockSelection = useCallback(() => {
    setSelectedBlockIds([])
  }, [])

  const askAboutBlocks = useCallback((blocks: CommandBlock[]): void => {
    if (!activeSessionId || !blocks.length) return

    const selected = blocks
      .map((block, index) => {
        const text = terminalPaneRef.current?.blockFullText(block) ?? (block.command.trim() ? `$ ${block.command}` : '')
        return `${appT('terminal.blocks.label', { index: index + 1 })}\n\`\`\`text\n${text}\n\`\`\``
      })
      .join('\n\n')

    setPendingBlockPrompt({
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      blockCount: blocks.length,
      prompt: `${appT('terminal.blocks.askPrompt')}\n\n${selected}`
    })
  }, [activeSessionId, appT])

  const confirmBlockPromptSend = useCallback((): void => {
    if (!pendingBlockPrompt) return

    setBlockPromptRequest({
      id: crypto.randomUUID(),
      sessionId: pendingBlockPrompt.sessionId,
      prompt: pendingBlockPrompt.prompt
    })
    showSidebar()
    setPendingBlockPrompt(null)
  }, [pendingBlockPrompt, showSidebar])

  const requestBlockRerun = useCallback((block: CommandBlock): void => {
    if (!block.command.trim()) return
    setPendingBlockRerun({
      sessionId: block.sessionId,
      command: block.command
    })
  }, [])

  const confirmBlockRerun = useCallback((): void => {
    if (!pendingBlockRerun) return

    void window.api.command.runConfirmed(pendingBlockRerun.sessionId, pendingBlockRerun.command)
    setPendingBlockRerun(null)
  }, [pendingBlockRerun])

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
          shellIntegrationNonce: session.shellIntegrationNonce,
          status: session.kind === 'ssh' || session.status === 'reconnecting'
            ? 'disconnected'
            : session.status === 'exited' || session.status === 'disconnected' ? session.status : 'running',
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
    if (next.length > MAX_OUTPUT_CHARS) {
      outputBuffers.current.set(sessionId, trimTerminalOutputBuffer(next, MAX_OUTPUT_CHARS))
      commandBlocksRef.current.delete(sessionId)
      setSelectedBlockIds([])
    } else {
      outputBuffers.current.set(sessionId, next)
    }
    scheduleSessionStateSave()
  }, [scheduleSessionStateSave])

  useEffect(() => {
    sidebarVisibleRef.current = sidebarVisible
    window.localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(sidebarVisible))
  }, [sidebarVisible])

  useEffect(() => {
    return () => {
      if (sidebarTransitionTimerRef.current !== undefined) {
        window.clearTimeout(sidebarTransitionTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(TEXT_SIZE_KEY, String(textSize))
  }, [textSize])

  useEffect(() => {
    window.localStorage.setItem(TERMINAL_FONT_FAMILY_KEY, terminalFontFamily)
  }, [terminalFontFamily])

  useEffect(() => {
    window.localStorage.setItem(TERMINAL_CURSOR_STYLE_KEY, terminalCursorStyle)
  }, [terminalCursorStyle])

  useEffect(() => {
    window.localStorage.setItem(TERMINAL_CURSOR_BLINK_KEY, String(terminalCursorBlink))
  }, [terminalCursorBlink])

  useEffect(() => {
    window.localStorage.setItem(TERMINAL_LINE_HEIGHT_KEY, String(terminalLineHeight))
  }, [terminalLineHeight])

  useEffect(() => {
    window.localStorage.setItem(TERMINAL_SCROLLBACK_KEY, String(terminalScrollback))
  }, [terminalScrollback])

  useEffect(() => {
    window.localStorage.setItem(WINDOW_OPACITY_KEY, String(windowOpacity))
    windowOpacityRef.current = windowOpacity
    const timer = window.setTimeout(() => {
      void window.api.app.setWindowOpacity(windowOpacity)
    }, 50)
    return () => window.clearTimeout(timer)
  }, [windowOpacity])

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, language)
  }, [language])

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, themeId)
  }, [themeId])

  useLayoutEffect(() => {
    applyThemeToDom(currentTheme)
  }, [currentTheme])

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
    setSelectedBlockIds([])
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

  useEffect(() => {
    void window.api.ssh.listProfiles().then(setSshProfiles)
  }, [settingsOpen])

  useEffect(() => {
    if (!commandPaletteOpen) return
    void window.api.commandSnippet.list().then(setCommandPaletteSnippets).catch(() => setCommandPaletteSnippets([]))
    void window.api.prompt.list().then(setCommandPalettePrompts).catch(() => setCommandPalettePrompts([]))
    void window.api.ssh.listProfiles().then(setSshProfiles).catch(() => setSshProfiles([]))
  }, [commandPaletteOpen])

  useEffect(() => {
    if (!newTabDropdownOpen) return
    const onClick = () => setNewTabDropdownOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNewTabDropdownOpen(false) }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [newTabDropdownOpen])

  useEffect(() => {
    if (!tabContextMenu) return
    const onClick = () => setTabContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTabContextMenu(null) }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [tabContextMenu])

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setSidebarResizing(true)

    const applyWidth = (clientX: number): void => {
      setSidebarWidth(clampSidebarWidth(window.innerWidth - clientX))
    }

    const onPointerMove = (moveEvent: PointerEvent): void => {
      applyWidth(moveEvent.clientX)
    }

    const finishResize = (): void => {
      setSidebarResizing(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      try {
        handle.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture can already be released if the window loses focus.
      }
    }

    applyWidth(event.clientX)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishResize, { once: true })
    window.addEventListener('pointercancel', finishResize, { once: true })
  }, [])

  const updateTextSize = useCallback((value: number) => {
    if (Number.isFinite(value) && value > 0) {
      setTextSize(value)
    }
  }, [])

  const updateSidebarWidth = useCallback((value: number) => {
    if (!Number.isFinite(value)) return
    setSidebarWidth(clampSidebarWidth(value))
  }, [])

  const toggleSidebar = useCallback(() => {
    beginSidebarVisibilityTransition()
    setSidebarVisible((v) => !v)
  }, [beginSidebarVisibilityTransition])

  const openCommandPalette = useCallback((category: CommandPaletteCategoryFilter = 'all') => {
    setCommandPaletteInitialCategory(category)
    setNewTabDropdownOpen(false)
    setCommandPaletteOpen(true)
  }, [])

  const openSettingsTab = useCallback((tab: SettingsTab) => {
    setSettingsTabRequest(tab)
    setSettingsTabRequestVersion((version) => version + 1)
    setSettingsOpen(true)
    showSidebar()
  }, [showSidebar])

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

  const connectSshProfile = useCallback(async (profile: SSHProfileConfig) => {
    setNewTabDropdownOpen(false)
    const session = await window.api.ssh.connectProfile(profile)
    setSessions((current) => [...current, { ...session, status: 'running' }])
    setActiveSessionId(session.id)
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
            ? `\r\n[Taviraq restored this tab in ${session.cwd ?? 'your home directory'} because ${saved.cwd} was unavailable.]\r\n`
            : ''
          restoredSessions.push({
            ...session,
            label: saved.label || session.label,
            localLabel: saved.localLabel ?? session.localLabel,
            status: 'running'
          })
          idMap.set(saved.id, session.id)
          const restoredOutput = remapRestored633ENonce(
            saved.output ?? '',
            saved.shellIntegrationNonce,
            session.shellIntegrationNonce
          )
          restoredOutputs.set(session.id, `${restoredOutput}${fallbackNotice}`)
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
    const offPrompt = window.api.terminal.onPrompt(({ sessionId }) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, status: sessionStatusAfterPrompt(session.status) }
            : session
        )
      )
    })

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
        current.map((session) => {
          if (session.id !== updatedSession.id) return session
          const hasCustomLocalLabel = session.localLabel !== undefined && session.label !== session.localLabel
          return {
            ...updatedSession,
            label: hasCustomLocalLabel ? session.label : updatedSession.label,
            localLabel: hasCustomLocalLabel ? session.localLabel : updatedSession.localLabel,
            status: session.status
          }
        })
      )
    })

    return () => {
      offPrompt()
      offExit()
      offCwd()
      offSession()
    }
  }, [])



  const closeSession = useCallback(async (sessionId: string) => {
    const closing = sessions.find((session) => session.id === sessionId)
    if (closing?.status === 'reconnecting') {
      cancelledReconnectsRef.current.add(sessionId)
      const replacementId = reconnectReplacementRef.current.get(sessionId)
      if (replacementId) {
        reconnectReplacementRef.current.delete(sessionId)
        try {
          await window.api.terminal.kill(replacementId)
        } catch (error) {
          console.error('Failed to cancel reconnecting terminal session', error)
        }
      }
    }
    if (closing?.status !== 'disconnected' && closing?.status !== 'reconnecting') {
      await window.api.terminal.kill(sessionId)
    }
    outputBuffers.current.delete(sessionId)
    commandBlocksRef.current.delete(sessionId)
    setSelectedBlockIds([])
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
    if (session.status !== 'disconnected' && session.status !== 'exited') return
    cancelledReconnectsRef.current.delete(sessionId)

    setSessions((current) =>
      current.map((candidate) =>
        candidate.id === sessionId ? { ...candidate, status: 'reconnecting' } : candidate
      )
    )

    try {
      const restoredOutput = outputBuffers.current.get(sessionId) ?? ''
      const next = await window.api.ssh.connectCommand({
        command: session.reconnectCommand,
        cwd: session.cwd,
        label: session.label,
        remoteHost: session.remoteHost,
        remoteTarget: session.remoteTarget
      })
      reconnectReplacementRef.current.set(sessionId, next.id)
      if (cancelledReconnectsRef.current.delete(sessionId)) {
        reconnectReplacementRef.current.delete(sessionId)
        outputBuffers.current.delete(next.id)
        await window.api.terminal.kill(next.id)
        return
      }
      const earlyOutput = outputBuffers.current.get(next.id)
      outputBuffers.current.delete(sessionId)
      outputBuffers.current.set(next.id, mergeRestoredSessionOutput(restoredOutput, earlyOutput))
      commandBlocksRef.current.delete(sessionId)
      setSelectedBlockIds([])
      assistantThreadsRef.current = remapAssistantThreadId(assistantThreadsRef.current, sessionId, next.id)
      setRestoredAssistantThreads(assistantThreadsRef.current)
      setSessions((current) =>
        current.map((candidate) =>
          candidate.id === sessionId
            ? {
                ...next,
                kind: 'ssh',
                label: candidate.label,
                localLabel: next.label,
                remoteHost: candidate.remoteHost,
                remoteTarget: candidate.remoteTarget,
                reconnectCommand: candidate.reconnectCommand,
                command: candidate.command,
                createdAt: candidate.createdAt,
                status: 'running'
              }
            : candidate
        )
      )
      setActiveSessionId(next.id)
      window.setTimeout(() => reconnectReplacementRef.current.delete(sessionId), 0)
    } catch (error) {
      console.error('Failed to reconnect SSH session', error)
      reconnectReplacementRef.current.delete(sessionId)
      setSessions((current) =>
        current.map((candidate) =>
          candidate.id === sessionId ? { ...candidate, status: 'disconnected' } : candidate
        )
      )
    }
  }, [sessions])

  const duplicateSession = useCallback(async (sessionId: string) => {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return

    try {
      if (session.kind === 'ssh' && session.reconnectCommand) {
        const next = await window.api.ssh.connectCommand({
          command: session.reconnectCommand,
          cwd: session.cwd,
          label: session.label,
          remoteHost: session.remoteHost,
          remoteTarget: session.remoteTarget
        })
        const duplicate: SessionState = { ...next, status: 'running' }
        setSessions((current) => [...current, duplicate])
        setActiveSessionId(next.id)
        return
      }

      await createLocalSession(session.cwd ? { cwd: session.cwd } : undefined)
    } catch (error) {
      console.error('Failed to duplicate terminal session', error)
    }
  }, [createLocalSession, sessions])

  const openRenameSession = useCallback((sessionId: string) => {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return
    setRenameSessionRequest({ sessionId, label: session.label })
  }, [sessions])

  const confirmRenameSession = useCallback(() => {
    const label = renameSessionRequest?.label.trim()
    if (!renameSessionRequest || !label) return

    setSessions((current) =>
      current.map((session) =>
        session.id === renameSessionRequest.sessionId ? { ...session, label } : session
      )
    )
    setRenameSessionRequest(null)
  }, [renameSessionRequest])

  const handleAssistantThreadsChange = useCallback((threads: RestorableAssistantThreads) => {
    assistantThreadsRef.current = threads
    scheduleSessionStateSave()
  }, [scheduleSessionStateSave])

  const handleReopenChat = useCallback(async (chatId: string) => {
    if (!activeSessionId) return
    const chat = await window.api.chatHistory.get(chatId)
    if (!chat) return
    const thread: RestorableAssistantThread = {
      messages: chat.messages,
      draft: '',
      session: chat.sessionSnapshot ? { id: activeSessionId, ...chat.sessionSnapshot } : undefined,
      savedChatId: chatId
    }
    const next = { ...assistantThreadsRef.current, [activeSessionId]: thread }
    assistantThreadsRef.current = next
    setRestoredAssistantThreads(next)
    scheduleSessionStateSave()
  }, [activeSessionId, scheduleSessionStateSave])

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
    commandBlocksRef.current.delete(activeSessionId)
    setSelectedBlockIds([])
    setTerminalClearVersion((version) => version + 1)
  }, [activeSessionId])

  const insertCommandSnippet = useCallback((command: string, run: boolean) => {
    if (!activeSessionId || !isLiveSessionStatus(activeSession?.status)) return
    void window.api.terminal.write(activeSessionId, run ? `${command}\r` : command)
    requestAnimationFrame(() => {
      terminalPaneRef.current?.focus()
    })
  }, [activeSession?.status, activeSessionId])

  const openSnippetForm = useCallback((command?: string) => {
    const normalizedCommand = command?.trim() ?? ''
    setSettingsTabRequest('snippets')
    setSettingsTabRequestVersion((version) => version + 1)
    setAddSnippetRequestVersion(0)
    setSnippetDraftRequest({
      id: crypto.randomUUID(),
      name: normalizedCommand.split('\n')[0]?.trim().slice(0, 48) || undefined,
      command: normalizedCommand || undefined
    })
    setSettingsOpen(true)
  }, [])

  const closeActiveSession = useCallback(() => {
    if (!activeSessionId) return

    void closeSession(activeSessionId)
  }, [activeSessionId, closeSession])

  const activateNextSession = useCallback(() => {
    if (sessions.length === 0) return
    const activeIndex = sessions.findIndex((session) => session.id === activeSessionId)
    const nextIndex = activeIndex < 0 || activeIndex === sessions.length - 1 ? 0 : activeIndex + 1
    setActiveSessionId(sessions[nextIndex]?.id)
  }, [activeSessionId, sessions])

  const activateSessionByIndex = useCallback((index: number) => {
    const session = sessions[index]
    if (session) {
      setActiveSessionId(session.id)
    }
  }, [sessions])

  const commandPaletteActions = useMemo<CommandPaletteAction[]>(() => {
    const settingsTabs: Array<{ id: SettingsTab; label: string; keywords: string[] }> = [
      { id: 'appearance', label: appT('settings.tab.appearance'), keywords: ['theme', 'language', 'font', 'shortcut'] },
      { id: 'providers', label: appT('settings.tab.providers'), keywords: ['provider', 'model', 'api key', 'llm'] },
      { id: 'mcp', label: appT('settings.tab.mcp'), keywords: ['mcp', 'tools', 'model context protocol', 'claude', 'codex', 'opencode'] },
      { id: 'connections', label: appT('settings.tab.connections'), keywords: ['ssh', 'connection', 'host', 'key'] },
      { id: 'security', label: appT('settings.tab.security'), keywords: ['security', 'privacy', 'secret', 'masking'] },
      { id: 'chatTools', label: appT('settings.tab.chatTools'), keywords: ['chat tools', 'task list', 'planning', 'checklist', 'steps', 'agent'] },
      { id: 'prompts', label: appT('settings.tab.prompts'), keywords: ['prompt', 'library', 'template'] },
      { id: 'snippets', label: appT('settings.tab.snippets'), keywords: ['snippet', 'command', 'shell'] },
      { id: 'data', label: appT('settings.tab.data'), keywords: ['data', 'import', 'export', 'restore'] }
    ]

    return [
      {
        id: 'app:new-local-tab',
        title: appT('connections.tab.newLocal'),
        description: 'Open a fresh local shell tab.',
        category: 'Tabs',
        actionHint: appT('commandPalette.action.open'),
        shortcut: '⌘T',
        keywords: ['terminal', 'shell', 'tab']
      },
      {
        id: 'terminal:clear',
        title: 'Clear terminal',
        description: 'Clear the active terminal output and command blocks.',
        category: 'Terminal',
        actionHint: appT('commandPalette.action.run'),
        disabled: !activeSessionId,
        keywords: ['clear', 'terminal', 'output', 'screen', 'blocks']
      },
      ...sessions.map((session, index) => ({
        id: `tab:${session.id}`,
        title: `Switch to ${getTabLabel(session)}`,
        description: getSessionTooltip(session),
        category: 'Tabs',
        actionHint: appT('commandPalette.action.open'),
        shortcut: index < 9 ? `⌘${index + 1}` : undefined,
        keywords: [session.cwd ?? '', session.label ?? '', session.kind, session.status]
      })),
      ...sshProfiles.map((profile) => ({
        id: `ssh:${profile.id}`,
        title: `Connect to ${profile.name || profile.host || 'SSH host'}`,
        description: [profile.user, profile.host].filter(Boolean).join('@') || 'Open a saved SSH profile.',
        category: 'SSH',
        actionHint: appT('commandPalette.action.open'),
        keywords: ['ssh', 'remote', profile.host, profile.user, profile.name].filter(Boolean) as string[]
      })),
      ...settingsTabs.map((tab) => ({
        id: `settings:${tab.id}`,
        title: `Open ${tab.label}`,
        description: 'Jump to this settings section.',
        category: 'Settings',
        actionHint: appT('commandPalette.action.open'),
        keywords: tab.keywords
      })),
      ...commandPaletteSnippets.map((snippet) => ({
        id: `snippet:${snippet.id}:insert`,
        title: `Insert snippet: ${snippet.name}`,
        description: snippet.command,
        category: 'Snippets',
        paletteCategory: 'snippets',
        actionHint: appT('commandPalette.action.insert'),
        shortcut: 'Enter',
        metaEnterActionId: `snippet:${snippet.id}:run`,
        disabled: !activeSessionId || !isLiveSessionStatus(activeSession?.status),
        keywords: ['snippet', 'command', 'insert', snippet.name, snippet.command]
      })),
      ...commandPaletteSnippets.map((snippet) => ({
        id: `snippet:${snippet.id}:run`,
        title: `Run snippet: ${snippet.name}`,
        description: snippet.command,
        category: 'Snippets',
        paletteCategory: 'snippets',
        actionHint: appT('commandPalette.action.run'),
        shortcut: '⌘↵',
        disabled: !activeSessionId || !isLiveSessionStatus(activeSession?.status),
        keywords: ['snippet', 'command', 'run', snippet.name, snippet.command]
      })),
      ...commandPalettePrompts.map((prompt) => ({
        id: `prompt:${prompt.id}`,
        title: `Insert prompt: ${prompt.name}`,
        description: prompt.content,
        category: 'Prompts',
        paletteCategory: 'prompts',
        actionHint: appT('commandPalette.action.insert'),
        keywords: ['prompt', 'template', 'assistant', prompt.name, prompt.content]
      })),
      { id: 'assistant:agent', title: 'Enable agent mode', description: 'Allow the assistant to propose and run approved commands.', category: 'Agent Mode', actionHint: appT('commandPalette.action.select'), keywords: ['assistant', 'agent', 'execute', 'mode'] },
      { id: 'assistant:read', title: 'Use read-only assistant mode', description: 'Let the assistant read terminal context without executing commands.', category: 'Agent Mode', actionHint: appT('commandPalette.action.select'), keywords: ['assistant', 'read only', 'mode'] },
      { id: 'assistant:off', title: 'Turn assistant context off', description: 'Stop sharing terminal context with the assistant.', category: 'Agent Mode', actionHint: appT('commandPalette.action.select'), keywords: ['assistant', 'off', 'mode', 'privacy'] },
      { id: 'assistant:switch-model', title: 'Switch model', description: 'Choose a chat model for the current provider.', category: 'Assistant', actionHint: appT('commandPalette.action.open'), keywords: ['assistant', 'model', 'provider', 'llm', 'switch'] },
      ...themes.map((theme) => ({
        id: `theme:${theme.id}`,
        title: `Switch theme: ${theme.name}`,
        description: theme.id === themeId ? 'Current theme.' : 'Apply this app and terminal color scheme.',
        category: 'Theme',
        actionHint: appT('commandPalette.action.select'),
        keywords: ['theme', 'appearance', 'color', theme.name]
      }))
    ]
  }, [
    activeSession?.status,
    activeSessionId,
    appT,
    commandPalettePrompts,
    commandPaletteSnippets,
    sessions,
    sshProfiles,
    themeId
  ])

  const runCommandPaletteAction = useCallback((action: CommandPaletteAction) => {
    setCommandPaletteOpen(false)
    setRecentCommandActionIds((current) => {
      const next = [action.id, ...current.filter((id) => id !== action.id)].slice(0, MAX_RECENT_COMMAND_ACTIONS)
      window.localStorage.setItem(COMMAND_PALETTE_RECENT_KEY, JSON.stringify(next))
      return next
    })

    if (action.id === 'app:new-local-tab') {
      void createLocalSession()
      return
    }

    if (action.id === 'terminal:clear') {
      clearActiveTerminal()
      return
    }

    if (action.id.startsWith('tab:')) {
      setActiveSessionId(action.id.slice('tab:'.length))
      return
    }

    if (action.id.startsWith('ssh:')) {
      const profile = sshProfiles.find((candidate) => candidate.id === action.id.slice('ssh:'.length))
      if (profile) void connectSshProfile(profile)
      return
    }

    if (action.id.startsWith('settings:')) {
      openSettingsTab(action.id.slice('settings:'.length) as SettingsTab)
      return
    }

    if (action.id.startsWith('snippet:')) {
      const [, snippetId, mode] = action.id.split(':')
      const snippet = commandPaletteSnippets.find((candidate) => candidate.id === snippetId)
      if (snippet) insertCommandSnippet(snippet.command, mode === 'run')
      return
    }

    if (action.id.startsWith('prompt:')) {
      const prompt = commandPalettePrompts.find((candidate) => candidate.id === action.id.slice('prompt:'.length))
      if (prompt) {
        showSidebar()
        setPromptInsertRequest({ id: crypto.randomUUID(), content: prompt.content })
      }
      return
    }

    if (action.id.startsWith('assistant:')) {
      if (action.id === 'assistant:switch-model') {
        showSidebar()
        setModelSwitchRequest({ id: crypto.randomUUID() })
        return
      }

      const mode = action.id.slice('assistant:'.length) as AssistMode
      showSidebar()
      setAssistModeRequest({ id: crypto.randomUUID(), mode })
      return
    }

    if (action.id.startsWith('theme:')) {
      setThemeId(action.id.slice('theme:'.length))
    }
  }, [
    commandPalettePrompts,
    commandPaletteSnippets,
    clearActiveTerminal,
    connectSshProfile,
    createLocalSession,
    insertCommandSnippet,
    openSettingsTab,
    showSidebar,
    sshProfiles
  ])

  const handleTabbarDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.session-tab')) return

    void createLocalSession()
  }, [createLocalSession])

  useEffect(() => {
    return window.api.shortcuts.onShortcut((shortcut) => {
      if (shortcut === 'clear-terminal') {
        clearActiveTerminal()
      } else if (shortcut === 'open-command-palette') {
        openCommandPalette()
      } else if (shortcut === 'open-prompt-library') {
        openCommandPalette('prompts')
      } else if (shortcut === 'open-command-snippets') {
        openCommandPalette('snippets')
      } else if (shortcut === 'open-settings') {
        setSettingsOpen(true)
      } else if (shortcut === 'new-tab') {
        void createLocalSession()
      } else if (shortcut === 'close-tab') {
        closeActiveSession()
      } else if (shortcut === 'next-tab') {
        activateNextSession()
      } else if (shortcut.startsWith('switch-tab-')) {
        activateSessionByIndex(Number(shortcut.replace('switch-tab-', '')) - 1)
      } else if (shortcut === 'toggle-sidebar') {
        toggleSidebar()
      }
    })
  }, [activateNextSession, activateSessionByIndex, clearActiveTerminal, closeActiveSession, createLocalSession, openCommandPalette, toggleSidebar])

  useEffect(() => {
    return window.api.shortcuts.onWindowShow(() => {
      const el = appShellRef.current
      if (!el) return
      el.classList.remove('window-entering')
      void el.offsetWidth
      el.classList.add('window-entering')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.api.shortcuts.notifyWindowReady()
          void window.api.app.setWindowOpacity(windowOpacityRef.current)
        })
      })
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openCommandPalette('snippets')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        openCommandPalette('prompts')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openCommandPalette])

  const contextMenuSession = tabContextMenu
    ? sessions.find((session) => session.id === tabContextMenu.sessionId)
    : undefined

  return (
    <LanguageProvider language={language}>
    <UpdateNotice />
    <TelemetryConsent />
    <main
      ref={appShellRef}
      className={`app-shell${sidebarVisible ? '' : ' sidebar-hidden'}${sidebarTransitioning ? ' sidebar-transitioning' : ''}${sidebarResizing ? ' sidebar-resizing' : ''}`}
      style={shellStyle}
    >
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-window-spacer" aria-hidden />
          <div className="topbar-title">Taviraq</div>
          <div className="topbar-actions" role="toolbar" aria-label={appT('app.terminalToolbar')}>
            <div className="toolbar-group toolbar-group-primary">
              <div className="tabbar-new-dropdown-wrapper">
                <button
                  className="icon-button topbar-action topbar-action-primary"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void window.api.ssh.listProfiles().then(setSshProfiles); setNewTabDropdownOpen((v) => !v) }}
                  aria-label={appT('app.newTerminal')}
                  aria-expanded={newTabDropdownOpen}
                  data-tooltip={newTabDropdownOpen ? undefined : appT('app.newTerminal')}
                >
                  <Plus size={16} aria-hidden />
                </button>
                {newTabDropdownOpen ? (
                  <div className="tabbar-new-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="tabbar-new-dropdown-item"
                      onClick={() => { setNewTabDropdownOpen(false); void createLocalSession() }}
                    >
                      <Terminal size={14} aria-hidden />
                      New Local Terminal
                    </button>
                    {sshProfiles.length > 0 ? (
                      <>
                        <div className="tabbar-new-dropdown-sep" />
                        <div className="tabbar-new-dropdown-label">SSH</div>
                        {sshProfiles.map((profile) => (
                          <button
                            key={profile.id}
                            type="button"
                            className="tabbar-new-dropdown-item"
                            onClick={() => { void connectSshProfile(profile) }}
                          >
                            <Server size={14} aria-hidden />
                            {profile.name || profile.host || 'Unnamed'}
                          </button>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="toolbar-group toolbar-group-utility">
              <button
                className="icon-button topbar-action"
                type="button"
                onClick={() => openCommandPalette()}
                data-tooltip={`${appT('commandPalette.title')} (⌘⇧P)`}
                aria-label={`${appT('commandPalette.title')} (⌘⇧P)`}
              >
                <Command size={16} aria-hidden />
              </button>
              <button
                className="icon-button topbar-action"
                type="button"
                onClick={toggleSidebar}
                data-tooltip={sidebarVisible ? appT('app.hideSidebar') : appT('app.showSidebar')}
                aria-label={sidebarVisible ? appT('app.hideSidebar') : appT('app.showSidebar')}
              >
                {sidebarVisible ? <PanelRightClose size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />}
              </button>
              <button
                className="icon-button topbar-action"
                type="button"
                onClick={() => setSettingsOpen(true)}
                data-tooltip={appT('app.settings')}
                aria-label={appT('app.settings')}
              >
                <Settings2 size={16} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        <div className="tabbar" role="tablist" aria-label="Terminal sessions" onDoubleClick={handleTabbarDoubleClick}>
          <div className="tab-list">
            {sessions.map((session) => {
              const tabLabel = getTabLabel(session)
              const statusMeta = getSessionStatusMeta(session.status)
              const cwdBadge = session.kind === 'ssh' ? undefined : getCwdBasename(session.cwd)
              const sshIndicatorTitle = getSshTabIndicatorTitle(session)
              const tabClassName = [
                'session-tab',
                session.kind === 'ssh' ? 'ssh-session' : '',
                `status-${statusMeta.className}`,
                session.id === activeSessionId ? 'active' : ''
              ].filter(Boolean).join(' ')

              return (
                <button
                  className={tabClassName}
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={session.id === activeSessionId}
                  aria-label={getSessionTooltip(session)}
                  data-tooltip={getSessionTooltip(session)}
                  onClick={() => setActiveSessionId(session.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setActiveSessionId(session.id)
                    setTabContextMenu({
                      sessionId: session.id,
                      x: clamp(event.clientX, 8, Math.max(8, window.innerWidth - TAB_CONTEXT_MENU_WIDTH)),
                      y: clamp(event.clientY, 8, Math.max(8, window.innerHeight - TAB_CONTEXT_MENU_HEIGHT))
                    })
                  }}
                >
                  <span className={`status-dot ${statusMeta.className}`} title={statusMeta.label}>
                    {session.kind === 'ssh'
                      ? session.status === 'disconnected' || session.status === 'exited'
                        ? <WifiOff size={10} aria-hidden />
                        : session.status === 'reconnecting'
                          ? <RotateCcw size={10} aria-hidden />
                          : <Wifi size={10} aria-hidden />
                      : <SquareTerminal size={10} aria-hidden />}
                  </span>
                  <span className="tab-label">{tabLabel}</span>
                  {sshIndicatorTitle ? (
                    <span className="tab-remote-badge" title={sshIndicatorTitle}>
                      <Server size={10} aria-hidden />
                      SSH
                    </span>
                  ) : null}
                  {cwdBadge ? <span className="tab-cwd-badge" title={session.cwd}>{cwdBadge}</span> : null}
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={0}
                    title={appT('app.closeSession')}
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
          {activeCwdDisplay ? <div className="tabbar-cwd" title={activeCwd}>{activeCwdDisplay}</div> : null}
        </div>

        {tabContextMenu && contextMenuSession ? (
          <div
            className="tab-context-menu"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="tab-context-menu-item"
              disabled={
                !contextMenuSession.reconnectCommand ||
                (contextMenuSession.status !== 'disconnected' && contextMenuSession.status !== 'exited')
              }
              onClick={() => {
                setTabContextMenu(null)
                void reconnectSession(contextMenuSession.id)
              }}
            >
              <PlugZap size={13} aria-hidden />
              Reconnect
            </button>
            <button
              type="button"
              className="tab-context-menu-item"
              onClick={() => {
                setTabContextMenu(null)
                void duplicateSession(contextMenuSession.id)
              }}
            >
              <Copy size={13} aria-hidden />
              Duplicate
            </button>
            <button
              type="button"
              className="tab-context-menu-item"
              onClick={() => {
                setTabContextMenu(null)
                openRenameSession(contextMenuSession.id)
              }}
            >
              <Pencil size={13} aria-hidden />
              Rename
            </button>
            <div className="tab-context-menu-sep" />
            <button
              type="button"
              className="tab-context-menu-item danger"
              onClick={() => {
                setTabContextMenu(null)
                void closeSession(contextMenuSession.id)
              }}
            >
              <X size={13} aria-hidden />
              Close
            </button>
          </div>
        ) : null}

        <TerminalPane
          ref={terminalPaneRef}
          activeSession={activeSession}
          sessionIds={sessions.map((session) => session.id)}
          layoutKey={`${sidebarWidth}-${textSize}-${terminalFontFamily}-${terminalLineHeight}-${sidebarVisible}`}
          textSize={textSize}
          fontFamily={terminalFontFamily}
          cursorStyle={terminalCursorStyle}
          cursorBlink={terminalCursorBlink}
          lineHeight={terminalLineHeight}
          scrollback={terminalScrollback}
          clearSignal={terminalClearVersion}
          onSelectionChange={setSelectedText}
          outputBuffers={outputBuffers}
          onOutput={handleOutput}
          onReconnect={(sessionId) => { void reconnectSession(sessionId) }}
          commandBlocks={activeCommandBlocks}
          selectedBlockIds={selectedBlockIds}
          onToggleBlockSelection={toggleBlockSelection}
          onClearBlockSelection={clearBlockSelection}
          onBlocksChange={handleBlocksChange}
          onBlockActivityChange={handleBlockActivityChange}
          onAskBlocks={askAboutBlocks}
          onRerunBlock={requestBlockRerun}
          onSaveSnippet={openSnippetForm}
          terminalTheme={terminalTheme}
        />
        {!sidebarVisible && (
          <button
            type="button"
            className="sidebar-open-handle"
            onClick={toggleSidebar}
            title={appT('sidebar.openHandle')}
            aria-label={appT('sidebar.openHandle')}
          >
            <ChevronLeft size={14} aria-hidden />
          </button>
        )}
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
        settingsTabRequest={settingsTabRequest}
        settingsTabRequestVersion={settingsTabRequestVersion}
        addSnippetRequestVersion={addSnippetRequestVersion}
        onOpenPromptPalette={() => openCommandPalette('prompts')}
        textSize={textSize}
        onTextSizeChange={updateTextSize}
        terminalFontFamily={terminalFontFamily}
        onTerminalFontFamilyChange={setTerminalFontFamily}
        terminalCursorStyle={terminalCursorStyle}
        onTerminalCursorStyleChange={setTerminalCursorStyle}
        terminalCursorBlink={terminalCursorBlink}
        onTerminalCursorBlinkChange={setTerminalCursorBlink}
        terminalLineHeight={terminalLineHeight}
        onTerminalLineHeightChange={setTerminalLineHeight}
        terminalScrollback={terminalScrollback}
        onTerminalScrollbackChange={setTerminalScrollback}
        windowOpacity={windowOpacity}
        onWindowOpacityChange={setWindowOpacity}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
        language={language}
        onLanguageChange={setLanguage}
        themeId={themeId}
        onThemeChange={setThemeId}
        hideShortcut={hideShortcut}
        onHideShortcutChange={handleHideShortcutChange}
        maxOutputContext={maxOutputContext}
        onMaxOutputContextChange={setMaxOutputContext}
        restoreSessions={restoreSessions}
        onRestoreSessionsChange={setRestoreSessions}
        restoredThreads={restoredAssistantThreads}
        onThreadsChange={handleAssistantThreadsChange}
        onClearSavedSessionState={clearSavedSessionState}
        onReopenChat={(chatId) => { void handleReopenChat(chatId) }}
        onConnectSsh={(profile) => { void connectSshProfile(profile) }}
        blockPromptRequest={blockPromptRequest}
        snippetDraftRequest={snippetDraftRequest}
        promptInsertRequest={promptInsertRequest}
        assistModeRequest={assistModeRequest}
        modelSwitchRequest={modelSwitchRequest}
      />

      {pendingBlockPrompt ? (
        <div
          className="modal-overlay terminal-block-send-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terminal-block-send-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPendingBlockPrompt(null)
          }}
        >
          <div
            className="modal-panel terminal-block-send-panel"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setPendingBlockPrompt(null)
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                event.stopPropagation()
                confirmBlockPromptSend()
              }
            }}
          >
            <div className="modal-header">
              <ShieldAlert size={15} aria-hidden />
              <span id="terminal-block-send-title">{appT('terminal.blocks.sendTitle')}</span>
            </div>
            <p className="terminal-block-send-copy">{appT('terminal.blocks.sendBody')}</p>
            <div className="terminal-block-send-meta">
              {appT('terminal.blocks.selectedCount', { count: pendingBlockPrompt.blockCount })}
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setPendingBlockPrompt(null)} autoFocus>
                {appT('confirm.cancel')}
              </button>
              <button type="button" className="save-prompt-confirm" onClick={confirmBlockPromptSend}>
                {appT('terminal.blocks.send')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingBlockRerun ? (
        <div
          className="modal-overlay terminal-block-rerun-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terminal-block-rerun-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPendingBlockRerun(null)
          }}
        >
          <div
            className="modal-panel terminal-block-send-panel"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setPendingBlockRerun(null)
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                event.stopPropagation()
                confirmBlockRerun()
              }
            }}
          >
            <div className="modal-header">
              <ShieldAlert size={15} aria-hidden />
              <span id="terminal-block-rerun-title">{appT('terminal.blocks.rerunTitle')}</span>
            </div>
            <p className="terminal-block-send-copy">{appT('terminal.blocks.rerunBody')}</p>
            <div className="command-confirmation-command">
              <code>{pendingBlockRerun.command}</code>
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setPendingBlockRerun(null)} autoFocus>
                {appT('confirm.cancel')}
              </button>
              <button type="button" className="save-prompt-confirm" onClick={confirmBlockRerun}>
                {appT('terminal.blocks.rerunConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renameSessionRequest ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-session-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setRenameSessionRequest(null)
          }}
        >
          <div
            className="modal-panel rename-session-panel"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setRenameSessionRequest(null)
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                confirmRenameSession()
              }
            }}
          >
            <div className="modal-header">
              <Pencil size={15} aria-hidden />
              <span id="rename-session-title">Rename tab</span>
            </div>
            <input
              className="rename-session-input"
              aria-label="Tab name"
              autoFocus
              value={renameSessionRequest.label}
              onChange={(event) => setRenameSessionRequest((current) =>
                current ? { ...current, label: event.target.value } : current
              )}
            />
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setRenameSessionRequest(null)}>
                {appT('confirm.cancel')}
              </button>
              <button
                type="button"
                className="save-prompt-confirm"
                onClick={confirmRenameSession}
                disabled={!renameSessionRequest.label.trim()}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {commandPaletteOpen ? (
        <CommandPalette
          actions={commandPaletteActions}
          recentActionIds={recentCommandActionIds}
          initialCategory={commandPaletteInitialCategory}
          labels={{
            title: appT('commandPalette.title'),
            search: appT('commandPalette.search'),
            recent: appT('commandPalette.recent'),
            all: appT('commandPalette.all'),
            commands: appT('commandPalette.commands'),
            snippets: appT('commandPalette.snippets'),
            prompts: appT('commandPalette.prompts'),
            noMatch: appT('commandPalette.noMatch'),
            enterSelects: appT('commandPalette.enterSelects'),
            escapeCloses: appT('commandPalette.escapeCloses')
          }}
          onClose={() => setCommandPaletteOpen(false)}
          onRun={runCommandPaletteAction}
        />
      ) : null}
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
