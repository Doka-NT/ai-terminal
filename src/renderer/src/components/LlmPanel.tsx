import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FocusEvent, type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  AlertTriangle, Bot, CheckCircle2, ChevronDown, Circle, KeyRound,
  RefreshCw, Send, Settings2, Square, Trash2, User, X, Zap
} from 'lucide-react'
import type {
  AppConfig, AssistMode, ChatMessage, ChatStreamEvent, LLMModel, LLMProviderConfig, TerminalContext, TerminalSessionInfo
} from '@shared/types'
import { MessageContent } from './MessageContent'
import { buildSuggestionChips, formatModelLabel, statusToInlineStatus } from '@renderer/utils/redesign'

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

interface LlmPanelProps {
  activeSession?: TerminalSessionInfo & { status: 'running' | 'exited' }
  selectedText: string
  getOutput: () => string
  settingsOpen: boolean
  onOpenSettings: () => void
  onCloseSettings: () => void
  textSize: number
  onTextSizeChange: (textSize: number) => void
}

export function LlmPanel({
  activeSession,
  selectedText,
  getOutput,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  textSize,
  onTextSizeChange
}: LlmPanelProps): JSX.Element {
  const [provider, setProvider] = useState<LLMProviderConfig>(defaultProvider)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<LLMModel[]>([])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [assistMode, setAssistMode] = useState<AssistMode>(DEFAULT_ASSIST_MODE)
  const [agenticRunning, setAgenticRunning] = useState(false)
  const [agenticStep, setAgenticStep] = useState(0)
  const [agenticCommand, setAgenticCommand] = useState('')
  const [textSizeDraft, setTextSizeDraft] = useState(String(textSize))
  const [commandConfirmation, setCommandConfirmation] = useState<CommandConfirmation | null>(null)

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

  // Keep refs in sync
  useEffect(() => { agenticRunningRef.current = agenticRunning }, [agenticRunning])
  useEffect(() => { assistModeRef.current = assistMode }, [assistMode])
  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])
  useEffect(() => { getOutputRef.current = getOutput }, [getOutput])
  useEffect(() => { providerRef.current = provider }, [provider])
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { selectedTextRef.current = selectedText }, [selectedText])
  useEffect(() => { agenticStepRef.current = agenticStep }, [agenticStep])
  useEffect(() => { setTextSizeDraft(String(textSize)) }, [textSize])

  // Load config on mount
  useEffect(() => {
    void window.api.config.load().then((config: AppConfig) => {
      const loaded =
        config.providers.find((p) => p.apiKeyRef === config.activeProviderRef) ??
        config.providers[0] ??
        defaultProvider
      setProvider(loaded)
    })
  }, [])

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
        setStatus(event.message)
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
        setStatus('')
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
    setStatus('')
  }, [stopAgentic])

  const buildTerminalContext = useCallback((): TerminalContext => {
    const session = activeSessionRef.current
    const terminalOutput = stripAnsi(getOutputRef.current()).slice(-3000)

    return {
      selectedText: selectedTextRef.current,
      assistMode: 'agent',
      terminalOutput: terminalOutput || undefined,
      session: session
        ? { id: session.id, kind: session.kind, label: session.label, cwd: session.cwd, shell: session.shell }
        : undefined
    }
  }, [])

  const confirmAgenticCommand = useCallback(async (command: string): Promise<boolean> => {
    setStatus('Checking command safety...')

    try {
      const assessment = await window.api.llm.assessCommandRisk({
        provider: providerRef.current,
        command,
        context: buildTerminalContext()
      })

      if (!assessment.dangerous) {
        setStatus('')
        return true
      }

      setStatus('')
      const confirmed = await requestCommandConfirmation({
        title: 'Review risky command',
        reason: assessment.reason,
        command,
        tone: 'danger',
        confirmLabel: 'Run command'
      })

      if (!confirmed) {
        setStatus('Agent stopped before running a risky command.')
        stopAgentic()
        return false
      }

      setStatus('Risky command confirmed by user.')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus('')
      const confirmed = await requestCommandConfirmation({
        title: 'Safety check unavailable',
        reason: message,
        command,
        tone: 'warning',
        confirmLabel: 'Run anyway'
      })

      if (!confirmed) {
        setStatus('Agent stopped because command safety could not be checked.')
        stopAgentic()
        return false
      }

      setStatus('Safety check failed; command confirmed by user.')
      return true
    }
  }, [buildTerminalContext, requestCommandConfirmation, stopAgentic])

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
      setStatus('Agent stopped after 10 steps.')
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
      setStatus(`Command failed: ${error instanceof Error ? error.message : String(error)}`)
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
  }, [confirmAgenticCommand, stopAgentic, startStream])

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
        setStatus('Open a terminal session before starting the agent.')
        return
      }

      agenticRunningRef.current = true
      agenticStepRef.current = 0
      promptResolveRef.current = null
      agenticPendingRef.current = null
      setAgenticRunning(true)
      setAgenticStep(0)
      setAgenticCommand('')
      setStatus('')
    }

    setDraft('')
    startStream(content, messagesRef.current)
  }, [commandConfirmation, draft, streaming, startStream])

  // Run command inline from MessageContent
  const runCommand = useCallback(async (command: string) => {
    const session = activeSessionRef.current
    if (!session) {
      setStatus('Open a terminal session before running a command.')
      return
    }

    const allowed = await confirmAgenticCommand(command)
    if (!allowed) return

    void window.api.command.runConfirmed(session.id, command)
  }, [confirmAgenticCommand])

  // Save provider
  const saveProvider = useCallback(async () => {
    setStatus('Saving...')
    try {
      await window.api.llm.saveProvider({ provider, apiKey })
      setApiKey('')
      setStatus('Saved')
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [apiKey, provider])

  // Load models
  const loadModels = useCallback(async () => {
    setStatus('Loading models...')
    try {
      const loaded = await window.api.llm.listModels({ provider, apiKey })
      setModels(loaded)
      setApiKey('')
      setStatus(`${loaded.length} models loaded`)
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [apiKey, provider])

  const updateProvider = useCallback((updated: LLMProviderConfig) => {
    setProvider(updated)
    void window.api.llm.saveProvider({ provider: updated }).catch((err: unknown) => {
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [])

  const handleTextSizeChange = useCallback((value: string) => {
    setTextSizeDraft(value)

    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      onTextSizeChange(parsed)
    }
  }, [onTextSizeChange])

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

  const providerReady = Boolean(provider.selectedModel && provider.commandRiskModel)
  const modelLabel = useMemo(() => formatModelLabel(provider.selectedModel), [provider.selectedModel])
  const strippedTerminalOutput = stripAnsi(getOutput()).slice(-2000)
  const suggestionChips = useMemo(() => buildSuggestionChips({
    terminalOutput: strippedTerminalOutput,
    cwd: activeSession?.cwd,
    selectedText,
    assistMode
  }), [activeSession?.cwd, assistMode, selectedText, strippedTerminalOutput])
  const inlineStatus = status ? statusToInlineStatus(status) : undefined
  const inputDisabled = Boolean(commandConfirmation)

  return (
    <aside className="llm-panel">
      <header className="panel-header">
        <div className="panel-header-row">
          <div className="panel-title">
            <span className="panel-icon">
              <Bot size={15} aria-hidden />
            </span>
            <div>
              <h1>{modelLabel.name}</h1>
              <p>{modelLabel.version || provider.name}</p>
            </div>
          </div>
          <div className="panel-header-right">
            <div className="agent-toggle-group">
              <span>Agent</span>
              <button
                className={`agent-toggle ${assistMode === 'agent' ? 'on' : ''}`}
                type="button"
                role="switch"
                aria-checked={assistMode === 'agent'}
                title={assistMode === 'agent' ? 'Switch to read-only context' : 'Enable agent execution'}
                onClick={toggleAgentMode}
              >
                <span />
              </button>
            </div>
            <button
              className="icon-button panel-action-button"
              type="button"
              onClick={onOpenSettings}
              title="Settings"
            >
              <Settings2 size={13} aria-hidden />
            </button>
            <button
              className="icon-button panel-action-button"
              type="button"
              onClick={clearHistory}
              disabled={messages.length === 0 && !streaming}
              title="Clear chat history"
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
            <span>Read</span>
          </span>
          <span className={`permission-chip ${assistMode === 'agent' ? 'execute' : ''} ${agenticRunning ? 'running' : ''} ${commandConfirmation ? 'pending' : ''}`}>
            <span>{commandConfirmation ? 'Pending' : 'Execute'}</span>
          </span>
        </div>
      </header>

      {settingsOpen ? (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <section className="settings-screen">
            <header className="settings-header">
              <div className="settings-title">
                <Settings2 size={17} aria-hidden />
                <div>
                  <h2 id="settings-title">Settings</h2>
                  <p>{provider.selectedModel || 'No model selected'}</p>
                </div>
              </div>
              <button className="icon-button" type="button" onClick={onCloseSettings} title="Close settings">
                <X size={16} aria-hidden />
              </button>
            </header>

            <div className="settings-body">
              <section className="settings-section">
                <div className="settings-section-heading">
                  <span>Text size</span>
                  <output>{textSize}px applied</output>
                </div>
                <input
                  className="text-size-input"
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  value={textSizeDraft}
                  onChange={(event) => handleTextSizeChange(event.target.value)}
                />
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <span>LLM provider</span>
                  <span className={`settings-model-state ${providerReady ? 'ready' : ''}`}>
                    {providerReady ? <CheckCircle2 size={13} aria-hidden /> : <Circle size={13} aria-hidden />}
                    {providerReady ? 'Ready' : 'Setup'}
                  </span>
                </div>

                <div className="provider-fields">
                  <label>
                    Provider
                    <input
                      value={provider.name}
                      onChange={(event) => setProvider((p) => ({ ...p, name: event.target.value }))}
                    />
                  </label>
                  <label>
                    Base URL
                    <input
                      value={provider.baseUrl}
                      onChange={(event) => setProvider((p) => ({ ...p, baseUrl: event.target.value }))}
                    />
                  </label>
                  <label>
                    API key
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="Stored in keychain"
                    />
                  </label>
                  <div className="provider-actions">
                    <button type="button" className="quiet-button" onClick={() => void saveProvider()}>
                      <KeyRound size={14} aria-hidden />
                      Save
                    </button>
                    <button type="button" className="quiet-button" onClick={() => void loadModels()}>
                      <RefreshCw size={14} aria-hidden />
                      Models
                    </button>
                  </div>
                  <div className="model-field">
                    <span>Chat model</span>
                    <ModelCombobox
                      value={provider.selectedModel ?? ''}
                      models={models}
                      placeholder="Search chat model"
                      onChange={(modelId) => {
                        const updated = { ...provider, selectedModel: modelId }
                        updateProvider(updated)
                      }}
                    />
                  </div>
                  <div className="model-field">
                    <span>Command safety model</span>
                    <ModelCombobox
                      value={provider.commandRiskModel ?? ''}
                      models={models}
                      placeholder="Search safety model"
                      onChange={(modelId) => {
                        const updated = { ...provider, commandRiskModel: modelId }
                        updateProvider(updated)
                      }}
                    />
                  </div>
                </div>
              </section>

              {status ? <p className="settings-status">{status}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      <section className="chat-log" aria-live="polite" ref={chatLogRef}>
        {messages.length === 0 ? (
          <div className="empty-chat">
            <strong>Ready to help</strong>
            <p>Ask about your terminal, commands, or selected text</p>
            <div className="suggestion-chips">
              {suggestionChips.map((suggestion) => (
                <button type="button" key={suggestion.id} onClick={() => setPromptDraft(suggestion.prompt)}>
                  {suggestion.label}
                </button>
              ))}
            </div>
            {!provider.selectedModel ? (
              <button className="quiet-button" type="button" onClick={onOpenSettings}>
                Connect provider
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
                  <span>output sent to assistant</span>
                  {message.command ? <code>{message.command}</code> : null}
                </div>
                <details>
                  <summary>Show output</summary>
                  <pre>{message.output?.trim() || '(no output)'}</pre>
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
                <span className="chat-role-label">{message.role}</span>
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
            <span>Step {agenticStep} — {commandConfirmation ? 'waiting for review' : 'running'} <code>{agenticCommand}</code></span>
          </div>
        ) : null}

        {inlineStatus ? (
          <div className={`inline-status ${inlineStatus.tone}`}>
            <span>{inlineStatus.label}</span>
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
            <span>{commandConfirmation.tone === 'danger' ? 'review' : 'warning'}</span>
          </div>
          <div className="command-confirmation-body">
            <div className="command-confirmation-command">
              <code>{commandConfirmation.command}</code>
            </div>
            <div className="command-confirmation-reason">
              <span>Reason</span>
              <p>{commandConfirmation.reason}</p>
            </div>
            <p className="command-confirmation-note">Agent is paused until you choose what to do.</p>
          </div>
          <footer>
            <button type="button" className="quiet-button" onClick={() => resolveCommandConfirmation(false)}>
              Cancel
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
          placeholder="Ask about this terminal…"
          rows={1}
        />
        <div className="chat-form-actions">
          {agenticRunning ? (
            <button
              className="stop-button"
              type="button"
              onClick={stopAgentic}
              title="Stop agent"
              aria-label="Stop agent"
            >
              <Square size={14} aria-hidden />
            </button>
          ) : null}
          <button
            className={`send-button ${streaming ? 'streaming' : ''}`}
            type="submit"
            disabled={streaming || inputDisabled || !draft.trim()}
            title="Send (Enter)"
            aria-label="Send message"
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
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setQuery(value)
  }, [value])

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
      const owner = model.ownedBy ?? ''
      return `${model.id} ${owner}`.toLowerCase().includes(normalizedQuery)
    })
  }, [availableModels, query])

  const visibleModels = matchingModels.slice(0, MAX_VISIBLE_MODELS)
  const activeModel = visibleModels[activeIndex]
  const activeOptionId = activeModel ? `${listboxId}-option-${activeIndex}` : undefined

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(visibleModels.length - 1, 0)))
  }, [visibleModels.length])

  const commitModel = useCallback((modelId: string) => {
    setQuery(modelId)
    setOpen(false)
    onChange(modelId)
  }, [onChange])

  const closeList = useCallback(() => {
    setOpen(false)
    setQuery(value)
  }, [value])

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
        value={query}
        placeholder={models.length > 0 || value ? placeholder : 'Load models first'}
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
            visibleModels.map((model, index) => (
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
                <span>{model.id}</span>
                {model.ownedBy ? <small>{model.ownedBy}</small> : null}
              </button>
            ))
          ) : (
            <div className="model-combobox-empty">
              {models.length > 0 ? 'No matching models' : 'Load models to search'}
            </div>
          )}
          {matchingModels.length > MAX_VISIBLE_MODELS ? (
            <div className="model-combobox-count">
              Showing {MAX_VISIBLE_MODELS} of {matchingModels.length}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
