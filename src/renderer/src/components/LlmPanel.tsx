import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FocusEvent, type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  AlertTriangle, Bot, ChevronDown, KeyRound,
  Plus, RefreshCw, Send, Settings2, Square, Trash2, User, X, Zap
} from 'lucide-react'
import type {
  AssistMode, ChatMessage, ChatStreamEvent, LLMModel, LLMProviderConfig, PromptTemplate, TerminalContext, TerminalSessionInfo
} from '@shared/types'
import { MessageContent } from './MessageContent'
import { PromptPicker } from './PromptPicker'
import { buildSuggestionChips, formatModelLabel, statusToInlineStatus } from '@renderer/utils/redesign'
import type { InlineStatus } from '@renderer/utils/redesign'
import { useT } from '@renderer/i18n/LanguageContext'
import type { Language } from '@renderer/i18n/translations'

// ...existing code...

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_RE = new RegExp(
  `${ANSI_ESCAPE}\\[[0-9;]*[mGKHFABCDJMPXZ]|${ANSI_ESCAPE}[@-_]|${ANSI_ESCAPE}\\[[0-9;]*[Rn]|\\r(?!\\n)`,
  'g'
)
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

function extractFirstCommand(content: string): string | undefined {
  const m = /```(?:bash|sh|shell|zsh|cmd|fish|ksh)\n([\s\S]*?)```/.exec(content)
  return m?.[1]?.trim() || undefined
}

const defaultProvider: LLMProviderConfig = {
  name: 'OpenAI Compatible',
  baseUrl: 'https://api.openai.com',
  apiKeyRef: 'openai-compatible-default',
  selectedModel: '',
  commandRiskModel: ''
}
const DEFAULT_ASSIST_MODE: AssistMode = 'agent'
const MAX_VISIBLE_MODELS = 80

type ThreadMessage = ChatMessage & {
  display?: 'command-output' | 'system-status'
  command?: string
  output?: string
}

interface CommandConfirmation {
  title: string
  reason: string
  command: string
  tone: 'danger' | 'warning'
  confirmLabel: string
}

function toChatMessage(message: ThreadMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content
  }
}

function upsertProviderInOrder(providers: LLMProviderConfig[], provider: LLMProviderConfig): LLMProviderConfig[] {
  const existingIndex = providers.findIndex((candidate) => candidate.apiKeyRef === provider.apiKeyRef)
  if (existingIndex === -1) return [...providers, provider]
  return providers.map((candidate, index) => index === existingIndex ? provider : candidate)
}

function formatModelDisplay(modelId: string | undefined): string {
  if (!modelId) return ''
  const label = formatModelLabel(modelId)
  return label.version ? `${label.name} — ${label.version}` : label.name
}

interface LlmPanelProps {
  activeSession?: TerminalSessionInfo & { status: 'running' | 'exited' }
  selectedText: string
  getOutput: () => string
  settingsOpen: boolean
  onOpenSettings: () => void
  onCloseSettings: () => void
  textSize: number
  onTextSizeChange: (textSize: number) => void
  sidebarWidth: number
  onSidebarWidthChange: (sidebarWidth: number) => void
  language: Language
  onLanguageChange: (language: Language) => void
}

export function LlmPanel({
  activeSession,
  selectedText,
  getOutput,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  textSize,
  onTextSizeChange,
  sidebarWidth,
  onSidebarWidthChange,
  language,
  onLanguageChange
}: LlmPanelProps): JSX.Element {
  const { t } = useT()
  const [provider, setProvider] = useState<LLMProviderConfig>(defaultProvider)
  const [allProviders, setAllProviders] = useState<LLMProviderConfig[]>([defaultProvider])
  const [activeProviderRef, setActiveProviderRef] = useState(defaultProvider.apiKeyRef)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<LLMModel[]>([])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<InlineStatus | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [assistMode, setAssistMode] = useState<AssistMode>(DEFAULT_ASSIST_MODE)
  const [agenticRunning, setAgenticRunning] = useState(false)
  const [agenticStep, setAgenticStep] = useState(0)
  const [agenticCommand, setAgenticCommand] = useState('')
  const [textSizeDraft, setTextSizeDraft] = useState(String(textSize))
  const [commandConfirmation, setCommandConfirmation] = useState<CommandConfirmation | null>(null)
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'providers' | 'prompts' | 'data'>('providers')
  const [editingApiKey, setEditingApiKey] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [providerStatus, setProviderStatus] = useState('')
  const [dataStatus, setDataStatus] = useState('')

  // Refs for use inside stable closures
  const activeRequestIdRef = useRef<string>()
  const chatLogRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const streamingContentRef = useRef('')       // accumulates current assistant chunk
  const agenticPendingRef = useRef<string | null>(null) // triggers agentic step
  const agenticRunningRef = useRef(false)
  const assistModeRef = useRef<AssistMode>(DEFAULT_ASSIST_MODE)
  const activeSessionRef = useRef(activeSession)
  const getOutputRef = useRef(getOutput)
  const providerRef = useRef(provider)
  const messagesRef = useRef<ThreadMessage[]>([])
  const selectedTextRef = useRef(selectedText)
  const promptResolveRef = useRef<(() => void) | null>(null)
  const commandConfirmationResolveRef = useRef<((confirmed: boolean) => void) | null>(null)
  const agenticStepRef = useRef(0)
  const [agenticTick, setAgenticTick] = useState(0)
  const languageRef = useRef<Language>(language)

  // Keep refs in sync
  useEffect(() => { languageRef.current = language }, [language])
  useEffect(() => { agenticRunningRef.current = agenticRunning }, [agenticRunning])
  useEffect(() => { assistModeRef.current = assistMode }, [assistMode])
  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])
  useEffect(() => { getOutputRef.current = getOutput }, [getOutput])
  useEffect(() => { providerRef.current = provider }, [provider])
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { selectedTextRef.current = selectedText }, [selectedText])
  useEffect(() => { agenticStepRef.current = agenticStep }, [agenticStep])
  useEffect(() => { setTextSizeDraft(String(textSize)) }, [textSize])

  const loadConfig = useCallback(async () => {
    const config = await window.api.config.load()
    const providers = config.providers.length > 0 ? config.providers : [defaultProvider]
    const loadedActiveProviderRef = config.activeProviderRef ?? providers[0]?.apiKeyRef ?? defaultProvider.apiKeyRef
    const loaded =
      providers.find((p) => p.apiKeyRef === loadedActiveProviderRef) ??
      providers[0] ??
      defaultProvider
    setProvider(loaded)
    setAllProviders(providers)
    setActiveProviderRef(loadedActiveProviderRef)
    setHasApiKey(Boolean(loaded.apiKeyRef && loadedActiveProviderRef))
  }, [])

  // Load config on mount
  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  // Prompt listener for agentic mode
  useEffect(() => {
    return window.api.terminal.onPrompt(({ sessionId }) => {
      if (activeSessionRef.current?.id === sessionId && promptResolveRef.current) {
        promptResolveRef.current()
        promptResolveRef.current = null
      }
    })
  }, [])

  const resolveCommandConfirmation = useCallback((confirmed: boolean) => {
    const resolve = commandConfirmationResolveRef.current
    commandConfirmationResolveRef.current = null
    setCommandConfirmation(null)
    resolve?.(confirmed)
  }, [])

  const requestCommandConfirmation = useCallback((confirmation: CommandConfirmation): Promise<boolean> => {
    commandConfirmationResolveRef.current?.(false)

    return new Promise((resolve) => {
      commandConfirmationResolveRef.current = resolve
      setCommandConfirmation(confirmation)
    })
  }, [])

  useEffect(() => {
    if (!commandConfirmation) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        resolveCommandConfirmation(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandConfirmation, resolveCommandConfirmation])

  // Core chat stream: starts a new exchange given user message content
  const startStream = useCallback((
    userContent: string,
    currentMessages: ThreadMessage[],
    userMeta?: Pick<ThreadMessage, 'display' | 'command' | 'output'>
  ) => {
    const requestId = crypto.randomUUID()
    const nextMessages: ThreadMessage[] = [
      ...currentMessages,
      { role: 'user', content: userContent, ...userMeta },
      { role: 'assistant', content: '' }
    ]
    setMessages(nextMessages)
    messagesRef.current = nextMessages
    setStreaming(true)
    streamingContentRef.current = ''
    activeRequestIdRef.current = requestId

    const mode = assistModeRef.current
    const terminalOutput = mode !== 'off' ? getOutputRef.current() : undefined
    const session = activeSessionRef.current

    window.api.llm.chatStream({
      requestId,
      provider: providerRef.current,
      messages: nextMessages.slice(0, -1).map(toChatMessage),
      context: {
        selectedText: selectedTextRef.current,
        assistMode: mode,
        terminalOutput: terminalOutput || undefined,
        language: languageRef.current,
        session: session
          ? { id: session.id, kind: session.kind, label: session.label, cwd: session.cwd, shell: session.shell }
          : undefined
      }
    })
  }, [])

  // Stream event handler
  useEffect(() => {
    return window.api.llm.onChatStreamEvent((event: ChatStreamEvent) => {
      if (event.requestId !== activeRequestIdRef.current) return

      if (event.type === 'chunk') {
        streamingContentRef.current += event.content
        setMessages((prev) => {
          const next = [...prev]
          const last = next.at(-1)
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, content: last.content + event.content }
          }
          return next
        })
      }

      if (event.type === 'error') {
        setStatus({ tone: 'danger', label: event.message })
        setStreaming(false)
        agenticRunningRef.current = false
        promptResolveRef.current = null
        agenticPendingRef.current = null
        agenticStepRef.current = 0
        setAgenticRunning(false)
        setAgenticStep(0)
        setAgenticCommand('')
      }

      if (event.type === 'done') {
        setStreaming(false)
        setStatus(null)
        activeRequestIdRef.current = undefined
        if (agenticRunningRef.current) {
          agenticPendingRef.current = streamingContentRef.current
          setAgenticTick((t) => t + 1)
        }
        streamingContentRef.current = ''
      }
    })
  }, [])

  // Auto-scroll
  useEffect(() => {
    const log = chatLogRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [agenticStep, commandConfirmation, messages, status, streaming])

  // Stop agentic
  const stopAgentic = useCallback(() => {
    commandConfirmationResolveRef.current?.(false)
    commandConfirmationResolveRef.current = null
    setCommandConfirmation(null)
    agenticRunningRef.current = false
    promptResolveRef.current = null
    agenticPendingRef.current = null
    agenticStepRef.current = 0
    setAgenticRunning(false)
    setAgenticStep(0)
    setAgenticCommand('')
  }, [])

  const clearHistory = useCallback(() => {
    stopAgentic()
    activeRequestIdRef.current = undefined
    streamingContentRef.current = ''
    setStreaming(false)
    setMessages([])
    messagesRef.current = []
    setStatus(null)
  }, [stopAgentic])

  const buildTerminalContext = useCallback((): TerminalContext => {
    const session = activeSessionRef.current
    const terminalOutput = stripAnsi(getOutputRef.current()).slice(-3000)

    return {
      selectedText: selectedTextRef.current,
      assistMode: 'agent',
      terminalOutput: terminalOutput || undefined,
      language: languageRef.current,
      session: session
        ? { id: session.id, kind: session.kind, label: session.label, cwd: session.cwd, shell: session.shell }
        : undefined
    }
  }, [])

  const confirmAgenticCommand = useCallback(async (command: string): Promise<boolean> => {
    setStatus({ tone: 'info', label: t('status.checkingSafety') })

    try {
      const assessment = await window.api.llm.assessCommandRisk({
        provider: providerRef.current,
        command,
        context: buildTerminalContext()
      })

      if (!assessment.dangerous) {
        setStatus(null)
        return true
      }

      setStatus(null)
      const confirmed = await requestCommandConfirmation({
        title: t('confirm.reviewRisky'),
        reason: assessment.reason,
        command,
        tone: 'danger',
        confirmLabel: t('confirm.runCommand')
      })

      if (!confirmed) {
        setStatus({ tone: 'warning', label: t('status.agentStopped.riskyCommand') })
        stopAgentic()
        return false
      }

      setStatus({ tone: 'warning', label: t('status.riskyCommandConfirmed') })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(null)
      const confirmed = await requestCommandConfirmation({
        title: t('confirm.safetyUnavailable'),
        reason: message,
        command,
        tone: 'warning',
        confirmLabel: t('confirm.runAnyway')
      })

      if (!confirmed) {
        setStatus({ tone: 'warning', label: t('status.agentStopped.safetyUnchecked') })
        stopAgentic()
        return false
      }

      setStatus({ tone: 'warning', label: t('status.safetyFailedConfirmed') })
      return true
    }
  }, [buildTerminalContext, requestCommandConfirmation, stopAgentic, t])

  // Agentic step runner (ref-based to avoid stale closures)
  const runAgenticStepRef = useRef<(content: string) => Promise<void>>(async () => {})
  const runAgenticStep = useCallback(async (content: string) => {
    if (!agenticRunningRef.current) return

    const command = extractFirstCommand(content)
    if (!command) {
      stopAgentic()
      return
    }

    const session = activeSessionRef.current
    if (!session) {
      stopAgentic()
      return
    }

    const nextStep = agenticStepRef.current + 1
    if (nextStep > 10) {
      setStatus({ tone: 'info', label: t('status.agentStopped.tenSteps') })
      stopAgentic()
      return
    }

    agenticStepRef.current = nextStep
    setAgenticStep(nextStep)
    setAgenticCommand(command)

    const allowed = await confirmAgenticCommand(command)
    if (!allowed || !agenticRunningRef.current) return

    // Wait for shell prompt (or timeout after 10s)
    let finishPromptWait = (): void => {}
    const promptPromise = new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        promptResolveRef.current = null
        resolve()
      }
      const timer = setTimeout(finish, 10_000)
      finishPromptWait = finish
      promptResolveRef.current = finish
    })

    void window.api.command.runConfirmed(session.id, command).catch((error: unknown) => {
      setStatus({ tone: 'danger', label: `Command failed: ${error instanceof Error ? error.message : String(error)}` })
      stopAgentic()
      finishPromptWait()
    })

    await promptPromise

    if (!agenticRunningRef.current) return

    const output = stripAnsi(getOutputRef.current()).slice(-3000)
    const continuation =
      `Command \`${command}\` finished.\nOutput:\n\`\`\`\n${output}\n\`\`\`\nContinue.`

    startStream(continuation, messagesRef.current, {
      display: 'command-output',
      command,
      output
    })
  }, [confirmAgenticCommand, stopAgentic, startStream, t])

  // Keep ref updated
  useEffect(() => { runAgenticStepRef.current = runAgenticStep }, [runAgenticStep])

  // Trigger agentic step when tick changes (after streaming done)
  useEffect(() => {
    if (agenticTick === 0) return
    const content = agenticPendingRef.current
    if (!content) return
    agenticPendingRef.current = null
    void runAgenticStepRef.current(content)
  }, [agenticTick])

  // Send user message
  const sendMessage = useCallback(() => {
    const content = draft.trim()
    if (!content || streaming || commandConfirmation) return

    if (assistModeRef.current === 'agent') {
      if (!activeSessionRef.current) {
        setStatus({ tone: 'info', label: t('status.noSession.agent') })
        return
      }

      agenticRunningRef.current = true
      agenticStepRef.current = 0
      promptResolveRef.current = null
      agenticPendingRef.current = null
      setAgenticRunning(true)
      setAgenticStep(0)
      setAgenticCommand('')
      setStatus(null)
    }

    setDraft('')
    startStream(content, messagesRef.current)
  }, [commandConfirmation, draft, streaming, startStream, t])

  // Run command inline from MessageContent
  const runCommand = useCallback(async (command: string) => {
    const session = activeSessionRef.current
    if (!session) {
      setStatus({ tone: 'info', label: t('status.noSession.run') })
      return
    }

    const allowed = await confirmAgenticCommand(command)
    if (!allowed) return

    void window.api.command.runConfirmed(session.id, command)
  }, [confirmAgenticCommand, t])

  // Save provider
  const saveProvider = useCallback(async () => {
    setProviderStatus('Saving...')
    try {
      const result = await window.api.llm.saveProvider({ provider, apiKey })
      setAllProviders(result.providers)
      setActiveProviderRef(result.activeProviderRef ?? provider.apiKeyRef)
      setApiKey('')
      setEditingApiKey(false)
      if (apiKey) setHasApiKey(true)
      setProviderStatus('Saved')
    } catch (error) {
      setProviderStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [apiKey, provider])

  const switchProvider = useCallback((target: LLMProviderConfig) => {
    setProvider(target)
    setModels([])
    setEditingApiKey(false)
    setHasApiKey(Boolean(target.apiKeyRef))
    setProviderStatus('')
    setActiveProviderRef(target.apiKeyRef)
    void window.api.llm.saveProvider({ provider: target }).then((result) => {
      setAllProviders(result.providers)
      setActiveProviderRef(result.activeProviderRef ?? target.apiKeyRef)
    }).catch((err: unknown) => {
      setProviderStatus(`Switch failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [])

  const addProvider = useCallback(() => {
    setProvider({
      name: 'New Provider',
      baseUrl: '',
      apiKeyRef: `provider-${crypto.randomUUID()}`,
      selectedModel: '',
      commandRiskModel: ''
    })
    setModels([])
    setApiKey('')
    setEditingApiKey(false)
    setHasApiKey(false)
  }, [])

  const handleDeleteProvider = useCallback(async (apiKeyRef: string) => {
    try {
      const result = await window.api.llm.deleteProvider(apiKeyRef)
      setAllProviders(result.providers)
      setActiveProviderRef(result.activeProviderRef ?? result.providers[0]?.apiKeyRef ?? defaultProvider.apiKeyRef)
      if (provider.apiKeyRef === apiKeyRef) {
        const next = result.providers[0] ?? defaultProvider
        setProvider(next)
        setModels([])
      }
    } catch (error) {
      setProviderStatus(`Delete failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [provider.apiKeyRef])

  // Load models
  const loadModels = useCallback(async () => {
    setProviderStatus('Loading models...')
    try {
      const loaded = await window.api.llm.listModels({ provider, apiKey })
      setModels(loaded)
      setApiKey('')
      setProviderStatus(`${loaded.length} models loaded`)
    } catch (error) {
      setProviderStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [apiKey, provider])

  const updateProvider = useCallback((updated: LLMProviderConfig) => {
    setProvider(updated)
    setAllProviders((providers) => upsertProviderInOrder(providers, updated))
    void window.api.llm.saveProvider({ provider: updated }).then((result) => {
      setAllProviders(result.providers)
      setActiveProviderRef(result.activeProviderRef ?? updated.apiKeyRef)
    }).catch((err: unknown) => {
      setProviderStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [])

  const handleTextSizeChange = useCallback((value: string) => {
    setTextSizeDraft(value)

    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      onTextSizeChange(parsed)
    }
  }, [onTextSizeChange])

  const handleExport = useCallback(async () => {
    setDataStatus('Exporting...')
    try {
      await window.api.data.export({ textSize, sidebarWidth, language })
      setDataStatus('Export complete')
      setTimeout(() => setDataStatus(''), 3000)
    } catch (error) {
      setDataStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [sidebarWidth, textSize, language])

  const handleImport = useCallback(async () => {
    setDataStatus('Importing...')
    try {
      const result = await window.api.data.import()
      if (!result) {
        setDataStatus('')
        return
      }

      if (result.preferences?.textSize) onTextSizeChange(result.preferences.textSize)
      if (result.preferences?.sidebarWidth) onSidebarWidthChange(result.preferences.sidebarWidth)
      if (result.preferences?.language) onLanguageChange(result.preferences.language as Language)

      await loadConfig()

      const parts: string[] = []
      if (result.providersAdded) parts.push(`${result.providersAdded} provider(s)`)
      if (result.promptsAdded) parts.push(`${result.promptsAdded} prompt(s)`)
      setDataStatus(parts.length ? `Added: ${parts.join(', ')}` : 'Nothing new to import')
      setTimeout(() => setDataStatus(''), 4000)
    } catch (error) {
      setDataStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [loadConfig, onSidebarWidthChange, onTextSizeChange, onLanguageChange])

  const setPromptDraft = useCallback((prompt: string) => {
    setDraft(prompt)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const toggleAgentMode = useCallback(() => {
    setAssistMode((prev) => {
      const next: AssistMode = prev === 'agent' ? 'read' : 'agent'
      if (next !== 'agent' && agenticRunningRef.current) {
        stopAgentic()
      }
      return next
    })
  }, [stopAgentic])

  const modelLabel = useMemo(() => formatModelLabel(provider.selectedModel), [provider.selectedModel])
  const strippedTerminalOutput = stripAnsi(getOutput()).slice(-2000)
  const suggestionChips = useMemo(() => buildSuggestionChips({
    terminalOutput: strippedTerminalOutput,
    cwd: activeSession?.cwd,
    selectedText,
    assistMode
  }).map((chip) => ({
    ...chip,
    label: t(`chip.${chip.id}` as Parameters<typeof t>[0]),
    prompt: t(`chip.${chip.id}Prompt` as Parameters<typeof t>[0])
  })), [activeSession?.cwd, assistMode, selectedText, strippedTerminalOutput, t])
  const inputDisabled = Boolean(commandConfirmation)

  return (
    <aside className="llm-panel">
      <header className="panel-header">
        <div className="panel-header-row">
          <div className="panel-title">
            <span className="panel-icon">
              <Bot size={15} aria-hidden />
            </span>
            <div className="panel-title-text">
              <h1 title={modelLabel.name}>{modelLabel.name}</h1>
              <p title={modelLabel.version || provider.name}>{modelLabel.version || provider.name}</p>
            </div>
          </div>
          <div className="panel-header-right">
            <div className="agent-toggle-group">
              <span>{t('panel.agent')}</span>
              <button
                className={`agent-toggle ${assistMode === 'agent' ? 'on' : ''}`}
                type="button"
                role="switch"
                aria-checked={assistMode === 'agent'}
                title={assistMode === 'agent' ? t('panel.agentToggle.disable') : t('panel.agentToggle.enable')}
                onClick={toggleAgentMode}
              >
                <span />
              </button>
            </div>
            <button
              className="icon-button panel-action-button"
              type="button"
              onClick={onOpenSettings}
              title={t('panel.settings')}
            >
              <Settings2 size={13} aria-hidden />
            </button>
            <button
              className="icon-button panel-action-button"
              type="button"
              onClick={clearHistory}
              disabled={messages.length === 0 && !streaming}
              title={t('panel.clearHistory')}
            >
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        </div>
        <div className="permission-badges" aria-label="Assistant permissions">
          <span className={`permission-chip shell ${activeSession?.status ?? 'exited'}`}>
            <span className="permission-dot" />
            <span>{activeSession?.label ?? 'zsh'}</span>
          </span>
          <span className={`permission-chip ${assistMode !== 'off' ? 'read' : ''}`}>
            <span>{t('panel.permission.read')}</span>
          </span>
          <span className={`permission-chip ${assistMode === 'agent' ? 'execute' : ''} ${agenticRunning ? 'running' : ''} ${commandConfirmation ? 'pending' : ''}`}>
            <span>{commandConfirmation ? t('panel.permission.pending') : t('panel.permission.execute')}</span>
          </span>
        </div>
      </header>

      {settingsOpen ? (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <section className="settings-screen">
            <header className="settings-header">
              <div className="settings-title">
                <Settings2 size={17} aria-hidden />
                <h2 id="settings-title">{t('settings.title')}</h2>
              </div>
              <button className="icon-button" type="button" onClick={onCloseSettings} title="Close settings">
                <X size={16} aria-hidden />
              </button>
            </header>

            <div className="settings-body">
              <nav className="settings-nav" aria-label="Settings sections">
                <button
                  type="button"
                  className={`settings-nav-item ${settingsTab === 'appearance' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('appearance')}
                >
                  {t('settings.tab.appearance')}
                </button>
                <button
                  type="button"
                  className={`settings-nav-item ${settingsTab === 'providers' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('providers')}
                >
                  {t('settings.tab.providers')}
                </button>
                <button
                  type="button"
                  className={`settings-nav-item ${settingsTab === 'prompts' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('prompts')}
                >
                  {t('settings.tab.prompts')}
                </button>
                <button
                  type="button"
                  className={`settings-nav-item ${settingsTab === 'data' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('data')}
                >
                  {t('settings.tab.data')}
                </button>
              </nav>

              <div className="settings-content">
                {settingsTab === 'appearance' ? (
                  <>
                    <h3 className="settings-content-title">{t('appearance.title')}</h3>
                    <div className="appearance-row">
                      <div className="appearance-row-left">
                        <span className="appearance-row-label">{t('appearance.fontSize.label')}</span>
                        <small className="appearance-row-desc">{t('appearance.fontSize.desc')}</small>
                      </div>
                      <div className="appearance-row-right">
                        <input
                          className="text-size-input"
                          type="number"
                          step="0.5"
                          inputMode="decimal"
                          value={textSizeDraft}
                          onChange={(event) => handleTextSizeChange(event.target.value)}
                        />
                        <output className="text-size-applied">{t('appearance.fontSize.applied', { value: textSize })}</output>
                      </div>
                    </div>
                    <div className="appearance-row">
                      <div className="appearance-row-left">
                        <span className="appearance-row-label">{t('appearance.language.label')}</span>
                        <small className="appearance-row-desc">{t('appearance.language.desc')}</small>
                      </div>
                      <div className="appearance-row-right">
                        <select
                          className="language-select"
                          value={language}
                          onChange={(event) => onLanguageChange(event.target.value as Language)}
                        >
                          <option value="en">{t('appearance.language.en')}</option>
                          <option value="ru">{t('appearance.language.ru')}</option>
                          <option value="cn">{t('appearance.language.cn')}</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : null}

                {settingsTab === 'providers' ? (
                  <>
                    <h3 className="settings-content-title">{t('providers.title')}</h3>
                    <div className="providers-layout">
                      {/* Left column — provider list */}
                      <div>
                        <div className="providers-list-header">
                          <span>{t('providers.title')}</span>
                          <button type="button" className="quiet-button" style={{ height: 28, fontSize: 11, padding: '0 7px' }} title={t('providers.addProvider')} onClick={addProvider}>
                            <Plus size={12} aria-hidden />
                          </button>
                        </div>
                        <div className="provider-list">
                          {allProviders.map((p) => {
                            const isEditingProvider = p.apiKeyRef === provider.apiKeyRef
                            const isActiveProvider = p.apiKeyRef === activeProviderRef
                            return (
                              <div
                                key={p.apiKeyRef}
                                className={`provider-list-item ${isEditingProvider ? 'active' : ''} ${isActiveProvider ? 'chat-active' : ''}`}
                                onClick={() => switchProvider(p)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter') switchProvider(p) }}
                              >
                                <span className={`provider-active-dot ${isActiveProvider ? 'visible' : ''}`} />
                                <span className="provider-list-item-name">{p.name || t('providers.unnamed')}</span>
                                {isActiveProvider ? <span className="provider-active-label">{t('providers.active')}</span> : null}
                                {allProviders.length > 1 ? (
                                  <button
                                    type="button"
                                    className="provider-list-item-delete icon-button"
                                    title={t('providers.deleteProvider')}
                                    onClick={(e) => { e.stopPropagation(); void handleDeleteProvider(p.apiKeyRef) }}
                                  >
                                    <Trash2 size={12} aria-hidden />
                                  </button>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Right column — provider form */}
                      <div className="provider-form">
                        <div className="provider-field">
                          <span className="provider-field-label">{t('providers.name')}</span>
                          <input
                            value={provider.name}
                            onChange={(event) => setProvider((p) => ({ ...p, name: event.target.value }))}
                          />
                        </div>
                        <div className="provider-field">
                          <span className="provider-field-label">{t('providers.baseUrl')}</span>
                          <input
                            value={provider.baseUrl}
                            onChange={(event) => setProvider((p) => ({ ...p, baseUrl: event.target.value }))}
                          />
                        </div>
                        <div className="provider-field">
                          <span className="provider-field-label">{t('providers.apiKey')}</span>
                          {!editingApiKey && hasApiKey ? (
                            <div className="apikey-masked">
                              <span className="apikey-masked-text">●●●●●●●●</span>
                              <span className="apikey-masked-hint">{t('providers.apiKey.saved')}</span>
                              <button
                                type="button"
                                className="apikey-change-btn"
                                onClick={() => setEditingApiKey(true)}
                              >
                                {t('providers.apiKey.change')}
                              </button>
                            </div>
                          ) : (
                            <input
                              type="password"
                              value={apiKey}
                              onChange={(event) => setApiKey(event.target.value)}
                              placeholder={hasApiKey ? t('providers.apiKey.replacePlaceholder') : t('providers.apiKey.placeholder')}
                            />
                          )}
                        </div>
                        <div className="provider-actions">
                          <button type="button" className="quiet-button" onClick={() => void saveProvider()}>
                            <KeyRound size={14} aria-hidden />
                            {t('providers.save')}
                          </button>
                          <button type="button" className="quiet-button" onClick={() => void loadModels()}>
                            <RefreshCw size={13} aria-hidden />
                            {t('providers.fetchModels')}
                          </button>
                        </div>
                        {providerStatus ? (
                          <div className={`provider-connection-status ${statusToInlineStatus(providerStatus).tone}`}>
                            <span>{statusToInlineStatus(providerStatus).tone === 'success' ? '●' : statusToInlineStatus(providerStatus).tone === 'danger' ? '✕' : statusToInlineStatus(providerStatus).tone === 'warning' ? '◐' : '◌'} {providerStatus}</span>
                          </div>
                        ) : null}
                        <div className="provider-model-selectors">
                          <div className="model-field">
                            <span>{t('providers.chatModel')}</span>
                            <ModelCombobox
                              value={provider.selectedModel ?? ''}
                              models={models}
                              placeholder={t('providers.searchChatModel')}
                              onChange={(modelId) => {
                                const updated = { ...provider, selectedModel: modelId }
                                updateProvider(updated)
                              }}
                            />
                          </div>
                          <div className="model-field">
                            <span>{t('providers.safetyModel')}</span>
                            <ModelCombobox
                              value={provider.commandRiskModel ?? ''}
                              models={models}
                              placeholder={t('providers.searchSafetyModel')}
                              onChange={(modelId) => {
                                const updated = { ...provider, commandRiskModel: modelId }
                                updateProvider(updated)
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {settingsTab === 'prompts' ? (
                  <>
                    <h3 className="settings-content-title">{t('prompts.title')}</h3>
                    <PromptLibrarySection />
                  </>
                ) : null}

                {settingsTab === 'data' ? (
                  <>
                    <h3 className="settings-content-title">{t('data.title')}</h3>
                    <div className="appearance-row">
                      <div className="appearance-row-left">
                        <span className="appearance-row-label">{t('data.exportImport.label')}</span>
                        <small className="appearance-row-desc">
                          {t('data.exportImport.desc')}
                        </small>
                      </div>
                      <div className="appearance-row-right" style={{ gap: 8, display: 'flex' }}>
                        <button type="button" className="quiet-button" onClick={() => void handleExport()}>
                          {t('data.export')}
                        </button>
                        <button type="button" className="quiet-button" onClick={() => void handleImport()}>
                          {t('data.import')}
                        </button>
                      </div>
                    </div>
                    {dataStatus ? <p className="settings-status">{dataStatus}</p> : null}
                  </>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <section className="chat-log" aria-live="polite" ref={chatLogRef}>
        {messages.length === 0 ? (
          <div className="empty-chat">
            <strong>{t('chat.empty.title')}</strong>
            <p>{t('chat.empty.body')}</p>
            <div className="suggestion-chips">
              {suggestionChips.map((suggestion) => (
                <button type="button" key={suggestion.id} onClick={() => setPromptDraft(suggestion.prompt)}>
                  {suggestion.label}
                </button>
              ))}
            </div>
            {!provider.selectedModel ? (
              <button className="quiet-button" type="button" onClick={onOpenSettings}>
                {t('chat.connectProvider')}
              </button>
            ) : null}
          </div>
        ) : null}

        {messages.map((message, index) => {
          const isLastAssistant = message.role === 'assistant' && index === messages.length - 1
          const showDots = isLastAssistant && streaming && !message.content

          if (message.display === 'command-output') {
            return (
              <div className="command-output-message" key={`command-output-${index}`}>
                <div>
                  <span className="system-prefix">&gt;</span>
                  <span>{t('chat.commandOutput.label')}</span>
                  {message.command ? <code>{message.command}</code> : null}
                </div>
                <details>
                  <summary>{t('chat.commandOutput.show')}</summary>
                  <pre>{message.output?.trim() || t('chat.commandOutput.noOutput')}</pre>
                </details>
              </div>
            )
          }

          return (
            <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="chat-message-meta">
                <span className="chat-avatar">
                  {message.role === 'assistant'
                    ? <Bot size={10} aria-hidden />
                    : <User size={10} aria-hidden />}
                </span>
                <span className="chat-role-label">{message.role === 'assistant' ? t('chat.role.assistant') : t('chat.role.user')}</span>
              </div>
              {showDots ? (
                <div className="streaming-dots">
                  <span /><span /><span />
                </div>
              ) : message.role === 'assistant' ? (
                <MessageContent
                  content={message.content}
                  onRun={runCommand}
                  onPrompt={setPromptDraft}
                  disabled={!activeSession}
                />
              ) : (
                <p>{message.content}</p>
              )}
            </article>
          )
        })}

        {agenticRunning && agenticStep > 0 ? (
          <div className="agentic-status">
            <Zap size={12} aria-hidden />
            <span>{t('agent.step', { step: agenticStep, state: commandConfirmation ? t('agent.waiting') : t('agent.running') })} <code>{agenticCommand}</code></span>
          </div>
        ) : null}

        {status ? (
          <div className={`inline-status ${status.tone}`}>
            <span>{status.label}</span>
          </div>
        ) : null}
      </section>

      {commandConfirmation ? (
        <section
          className={`command-confirmation-card ${commandConfirmation.tone}`}
          role="dialog"
          aria-labelledby="command-confirmation-title"
        >
          <div className="command-confirmation-head">
            <div>
              <AlertTriangle size={12} aria-hidden />
              <h2 id="command-confirmation-title">{commandConfirmation.title}</h2>
            </div>
            <span>{commandConfirmation.tone === 'danger' ? t('confirm.review') : t('confirm.warning')}</span>
          </div>
          <div className="command-confirmation-body">
            <div className="command-confirmation-command">
              <code>{commandConfirmation.command}</code>
            </div>
            <div className="command-confirmation-reason">
              <span>{t('confirm.reason')}</span>
              <p>{commandConfirmation.reason}</p>
            </div>
            <p className="command-confirmation-note">{t('confirm.agentPaused')}</p>
          </div>
          <footer>
            <button type="button" className="quiet-button" onClick={() => resolveCommandConfirmation(false)}>
              {t('confirm.cancel')}
            </button>
            <button
              type="button"
              className={`danger-button ${commandConfirmation.tone}`}
              onClick={() => resolveCommandConfirmation(true)}
            >
              {commandConfirmation.confirmLabel}
            </button>
          </footer>
        </section>
      ) : null}

      <form
        className={`chat-form ${inputDisabled ? 'disabled' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage()
        }}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={inputDisabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const wantsSend = event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
            const wantsMetaSend = event.key === 'Enter' && event.metaKey && !event.nativeEvent.isComposing
            if (wantsSend || wantsMetaSend) {
              event.preventDefault()
              sendMessage()
            }
          }}
          placeholder={t('chat.input.placeholder')}
          rows={1}
        />
        <div className="chat-form-actions">
          <PromptPicker onSelect={setPromptDraft} />
          {agenticRunning ? (
            <button
              className="stop-button"
              type="button"
              onClick={stopAgentic}
              title={t('chat.stopAgent')}
              aria-label={t('chat.stopAgent')}
            >
              <Square size={14} aria-hidden />
            </button>
          ) : null}
          <button
            className={`send-button ${streaming ? 'streaming' : ''}`}
            type="submit"
            disabled={streaming || inputDisabled || !draft.trim()}
            title={t('chat.send')}
            aria-label={t('chat.send')}
          >
            <Send size={15} aria-hidden />
          </button>
        </div>
      </form>
    </aside>
  )
}

interface ModelComboboxProps {
  value: string
  models: LLMModel[]
  placeholder: string
  onChange: (modelId: string) => void
}

function ModelCombobox({ value, models, placeholder, onChange }: ModelComboboxProps): JSX.Element {
  const { t } = useT()
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const formattedValue = useMemo(() => {
    return formatModelDisplay(value)
  }, [value])

  // When dropdown closes, reset query so input shows formatted value
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const availableModels = useMemo(() => {
    if (!value || models.some((model) => model.id === value)) {
      return models
    }

    return [{ id: value }, ...models]
  }, [models, value])

  const matchingModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return availableModels

    return availableModels.filter((model) => {
      const display = formatModelDisplay(model.id)
      const owner = model.ownedBy ?? ''
      return `${model.id} ${display} ${owner}`.toLowerCase().includes(normalizedQuery)
    })
  }, [availableModels, query])

  const visibleModels = matchingModels.slice(0, MAX_VISIBLE_MODELS)
  const activeModel = visibleModels[activeIndex]
  const activeOptionId = activeModel ? `${listboxId}-option-${activeIndex}` : undefined

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(visibleModels.length - 1, 0)))
  }, [visibleModels.length])

  const commitModel = useCallback((modelId: string) => {
    setQuery('')
    setOpen(false)
    onChange(modelId)
  }, [onChange])

  const closeList = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      closeList()
    }
  }, [closeList])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, Math.max(visibleModels.length - 1, 0)))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }

    if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (activeModel) {
        commitModel(activeModel.id)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeList()
    }
  }, [activeModel, closeList, commitModel, open, visibleModels.length])

  return (
    <div className={`model-combobox ${open ? 'open' : ''}`} onBlur={handleBlur}>
      <input
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        value={open ? query : formattedValue}
        placeholder={models.length > 0 || value ? placeholder : t('model.loadModelsFirst')}
        onFocus={(event) => {
          setOpen(true)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="model-combobox-toggle"
        aria-label="Open model list"
        tabIndex={-1}
        onMouseDown={(event) => {
          event.preventDefault()
          setOpen((current) => !current)
          inputRef.current?.focus()
        }}
      >
        <ChevronDown size={14} aria-hidden />
      </button>

      {open ? (
        <div className="model-combobox-list" id={listboxId} role="listbox">
          {visibleModels.length > 0 ? (
            visibleModels.map((model, index) => {
              const modelDisplay = formatModelDisplay(model.id)
              return (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={`${model.id}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  className={`model-combobox-option ${index === activeIndex ? 'active' : ''} ${model.id === value ? 'selected' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitModel(model.id)}
                >
                  <span>{modelDisplay}</span>
                  {model.ownedBy ? <small>{model.ownedBy}</small> : null}
                </button>
              )
            })
          ) : (
            <div className="model-combobox-empty">
              {models.length > 0 ? t('model.noMatch') : t('model.loadFirst')}
            </div>
          )}
          {matchingModels.length > MAX_VISIBLE_MODELS ? (
            <div className="model-combobox-count">
              {t('model.showing', { visible: MAX_VISIBLE_MODELS, total: matchingModels.length })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PromptLibrarySection(): JSX.Element {
  const { t } = useT()
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [editing, setEditing] = useState<PromptTemplate | null>(null)
  const [addingPrompt, setAddingPrompt] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [promptStatus, setPromptStatus] = useState('')

  const reload = useCallback(async () => {
    try {
      const list = await window.api.prompt.list()
      setPrompts(list)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleSave = useCallback(async () => {
    if (!newName.trim() || !newContent.trim()) return
    setPromptStatus('Saving...')
    try {
      await window.api.prompt.save({
        id: editing?.id ?? '',
        name: newName.trim(),
        content: newContent.trim(),
        createdAt: editing?.createdAt ?? new Date().toISOString()
      })
      setNewName('')
      setNewContent('')
      setEditing(null)
      setAddingPrompt(false)
      setPromptStatus('Saved')
      await reload()
    } catch (err) {
      setPromptStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [editing, newContent, newName, reload])

  const handleEdit = useCallback((prompt: PromptTemplate) => {
    setEditing(prompt)
    setAddingPrompt(false)
    setNewName(prompt.name)
    setNewContent(prompt.content)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.api.prompt.delete(id)
      await reload()
    } catch {
      // ignore
    }
  }, [reload])

  const handleImport = useCallback(async () => {
    setPromptStatus('Importing...')
    try {
      const imported = await window.api.prompt.importFiles()
      setPromptStatus(`Imported ${imported.length} prompt(s)`)
      await reload()
    } catch (err) {
      setPromptStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [reload])

  const handleCancel = useCallback(() => {
    setEditing(null)
    setAddingPrompt(false)
    setNewName('')
    setNewContent('')
  }, [])

  const handleAddPrompt = useCallback(() => {
    setEditing(null)
    setAddingPrompt(true)
    setNewName('')
    setNewContent('')
  }, [])

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <span>{t('prompts.title')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="quiet-button prompt-import-btn" onClick={() => void handleImport()}>
            {t('prompts.importFromFile')}
          </button>
          {!editing && !addingPrompt ? (
            <button type="button" className="quiet-button" style={{ fontSize: 11 }} onClick={handleAddPrompt}>
              <Plus size={12} aria-hidden />
              {' '}{t('prompts.addPrompt')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="prompt-list">
        {prompts.length > 0 ? (
          prompts.map((prompt) => (
            <div key={prompt.id} className="prompt-list-item">
              <div className="prompt-list-item-info">
                <span className="prompt-list-item-name">{prompt.name}</span>
                <span className="prompt-list-item-preview">
                  {prompt.content.slice(0, 80)}{prompt.content.length > 80 ? '…' : ''}
                </span>
              </div>
              <div className="prompt-list-item-actions">
                <button
                  type="button"
                  className="icon-button"
                  title={t('prompts.edit')}
                  onClick={() => handleEdit(prompt)}
                >
                  <Settings2 size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={t('prompts.delete')}
                  onClick={() => void handleDelete(prompt.id)}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="prompt-list-empty">
            {t('prompts.noPrompts')}
          </p>
        )}
      </div>

      {(editing || addingPrompt || !prompts.length) ? (
        <div className="prompt-form">
          <input
            type="text"
            placeholder={t('prompts.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <textarea
            className="prompt-form-content"
            placeholder={t('prompts.contentPlaceholder')}
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
          <div className="prompt-form-actions">
            <button
              type="button"
              className="quiet-button"
              disabled={!newName.trim() || !newContent.trim()}
              onClick={() => void handleSave()}
            >
              {editing ? t('prompts.savePrompt') : t('prompts.addPrompt')}
            </button>
            {(editing || addingPrompt) ? (
              <button type="button" className="quiet-button" onClick={handleCancel}>
                {t('prompts.cancel')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {promptStatus ? <p className="settings-status">{promptStatus}</p> : null}
    </section>
  )
}
