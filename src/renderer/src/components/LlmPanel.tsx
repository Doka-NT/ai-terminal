// SPDX-License-Identifier: MPL-2.0
import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FocusEvent, type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  Activity, AlertTriangle, BookmarkPlus, Bot, Brain, Check, ChevronDown, Command, Copy, Database, Eye, GitFork, History, KeyRound,
  Hammer, ListChecks, Pencil, MessageSquarePlus, Plus, RefreshCw, ScrollText, Search, Send, Server, Settings2, ShieldAlert,
  ShieldCheck, ShieldOff, Square, SquareTerminal, Trash2, User, X, Zap
} from 'lucide-react'
import type {
  AppConfig, AssistMode, ChatMessage, ChatStreamEvent, ChatToolsSettings, CommandRiskAssessment, CommandSnippet, LLMModel, LLMProviderConfig, LLMProviderType,
  DataUsageStats, DiscoveredMcpServer, McpServerConfig,
  PrivacyMaskingNotice, PromptTemplate, RestorableAssistantThread, RestorableAssistantThreads, SSHProfileConfig, SavedChat, SavedChatSummary,
  SecretMaskingAuditEvent, SecretMaskingAuditSource, SecretMaskingCustomPattern, SecretMaskingMode, SecretMaskingSettings,
  TelemetrySettings,
  TerminalContext, TerminalCursorStyle, TerminalSessionInfo
} from '@shared/types'
import {
  createDefaultSecretMaskingSettings,
  isStrictTerminalContextActive,
  isSafeCustomSecretPatternSource,
  SECRET_MASKING_AUDIT_LIMIT
} from '@shared/secretMaskingConfig'
import { createDefaultChatToolsSettings } from '@shared/chatToolsConfig'
import { MessageContent } from './MessageContent'
import { CommandPalette, type CommandPaletteAction } from './CommandPalette'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { CommandConfirmationDialog, type CommandConfirmation } from './CommandConfirmationDialog'
import { ComposerConfigControl } from './ComposerConfigControl'
import { TaskListPanel } from './TaskListPanel'
import { BoundedScroll } from './BoundedScroll'
import { parseTaskListFromMessages } from '@shared/taskList'
import { buildSuggestionChips, formatModelLabel, statusToInlineStatus } from '@renderer/utils/redesign'
import { applyAuthoritativeAssistantContent, stripTrailingAssistantMessages } from '@renderer/utils/chatMessages'
import type { InlineStatus } from '@renderer/utils/redesign'
import { useT, type LanguageContextValue } from '@renderer/i18n/language'
import type { Language } from '@renderer/i18n/translations'
import { acceleratorToDisplay } from '@shared/accelerator'
import { buildAssistantPromptMessages, mergeAssistantPromptMessages } from '@shared/promptBuilder'
import { themes } from '@renderer/themes/definitions'
import { buildAgentContinuation, wasTerminalContextSentToProvider } from '@renderer/utils/agentContinuation'
import { estimateComposerContextTokens, formatComposerContextTokens } from '@renderer/utils/composerContext'
import { isChatScrolledToBottom } from '@renderer/utils/chatAutoscroll'
import { cleanCommandOutput, stripAnsi } from '@renderer/utils/commandOutput'
import { formatDataBytes } from '@renderer/utils/dataUsage'
import { findCurrentRequestPrivacyNoticeIndex, mergePrivacyNotices } from '@renderer/utils/privacyNotices'
import {
  activateSecretProtectionDefaults,
  hasActiveSecretProtection,
  hasSelectedSecretProtectionScope,
  updateSecretProtectionScope
} from '@renderer/utils/secretMaskingUi'
import {
  DISPLAY_SECRET_LABEL,
  SECRET_PLACEHOLDER_GLOBAL_RE,
  SECRET_PLACEHOLDER_RE
} from '@shared/secretPlaceholders'
import { isLiveSessionStatus, type SessionTabInfo } from '@renderer/utils/sessionTabs'
import { findFuzzySettingsSuggestions, matchesSearchQuery, type SettingsSearchItem } from '@renderer/utils/settingsSearch'

// ...existing code...

function containsSecretPlaceholder(text: string): boolean {
  return SECRET_PLACEHOLDER_RE.test(text)
}

function hideSecretPlaceholders(text: string, replacement: string): string {
  return text.replace(SECRET_PLACEHOLDER_GLOBAL_RE, replacement)
}

function hidePersistedSecretPlaceholders(text?: string): string | undefined {
  return text === undefined ? undefined : hideSecretPlaceholders(text, DISPLAY_SECRET_LABEL)
}

function localizeCommandRiskReason(assessment: CommandRiskAssessment, t: LanguageContextValue['t']): string {
  if (assessment.reasonCode !== 'local-secret') return assessment.reason

  return [
    t('commandRisk.localSecret'),
    assessment.reasonArgs?.sshLabel ? t('commandRisk.sshContext', { label: assessment.reasonArgs.sshLabel }) : '',
    t('commandRisk.requiresConfirmation')
  ].filter(Boolean).join(' ')
}

function getTerminalDelta(before: string, after: string): string {
  if (after.startsWith(before)) return after.slice(before.length)

  let prefixLength = 0
  const maxPrefixLength = Math.min(before.length, after.length)
  while (prefixLength < maxPrefixLength && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1
  }

  return after.slice(prefixLength)
}

function extractFirstCommand(content: string): string | undefined {
  const runnableBlock = /```aiterm[^\r\n]*\r?\n([\s\S]*?)```/i.exec(content)
  if (runnableBlock?.[1]?.trim()) return runnableBlock[1].trim()

  const shellBlockRe = /```(?:bash|sh|shell|zsh|cmd|fish|ksh)[^\r\n]*\r?\n([\s\S]*?)```/gi
  for (const match of content.matchAll(shellBlockRe)) {
    const before = content.slice(0, match.index).trimEnd()
    const previousLine = before.split(/\r?\n/).at(-1)?.trim() ?? ''
    if (isAutoRunMarker(previousLine)) {
      return match[1]?.trim() || undefined
    }
  }

  return undefined
}

function isAutoRunMarker(line: string): boolean {
  return /^(?:выполню|i will run)\s*:$/i.test(line)
}

const defaultProvider: LLMProviderConfig = {
  name: 'OpenAI Compatible',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKeyRef: 'openai-compatible-default',
  selectedModel: '',
  commandRiskModel: ''
}
const providerTypeDefaults: Record<LLMProviderType, Pick<LLMProviderConfig, 'name' | 'baseUrl'>> = {
  openai: { name: 'OpenAI Compatible', baseUrl: 'https://api.openai.com' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434' },
  lmstudio: { name: 'LM Studio', baseUrl: 'http://localhost:1234' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com' }
}
const providerTypeOptions: LLMProviderType[] = ['openai', 'ollama', 'lmstudio', 'anthropic']
const providerTypesWithApiKey: LLMProviderType[] = ['openai', 'anthropic']
const DEFAULT_ASSIST_MODE: AssistMode = 'agent'
const MAX_VISIBLE_MODELS = 80
const MIN_TEXT_SIZE = 8
const MAX_TEXT_SIZE = 32
const MIN_LINE_HEIGHT = 1
const MAX_LINE_HEIGHT = 2
const MIN_SCROLLBACK = 100
const MAX_SCROLLBACK = 100000
const MIN_WINDOW_OPACITY = 0.9
const MAX_WINDOW_OPACITY = 1
const TERMINAL_FONT_OPTIONS = [
  { value: 'Menlo, monospace', label: 'Menlo' },
  { value: 'Monaco, monospace', label: 'Monaco' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'Courier, monospace', label: 'Courier' },
  { value: '"Andale Mono", monospace', label: 'Andale Mono' }
]
const TERMINAL_CURSOR_STYLE_OPTIONS: TerminalCursorStyle[] = ['block', 'underline', 'bar']
const MIN_SSH_PORT = 1
const MAX_SSH_PORT = 65535
const MIN_OUTPUT_CONTEXT = 1000
const MCP_SOURCE_LABELS: Record<NonNullable<McpServerConfig['source']>, string> = {
  manual: 'Manual',
  claude: 'Claude',
  copilot: 'Copilot',
  codex: 'Codex',
  opencode: 'OpenCode',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  cursor: 'Cursor',
  windsurf: 'Windsurf'
}
const SECURITY_PATTERN_CATEGORIES = [
  {
    id: 'api-keys',
    labelKey: 'security.category.apiKeys',
    descKey: 'security.category.apiKeys.desc'
  },
  {
    id: 'tokens',
    labelKey: 'security.category.tokens',
    descKey: 'security.category.tokens.desc'
  },
  {
    id: 'passwords',
    labelKey: 'security.category.passwords',
    descKey: 'security.category.passwords.desc'
  },
  {
    id: 'aws',
    labelKey: 'security.category.aws',
    descKey: 'security.category.aws.desc'
  },
  {
    id: 'ssh-material',
    labelKey: 'security.category.sshMaterial',
    descKey: 'security.category.sshMaterial.desc'
  },
  {
    id: 'url-credentials',
    labelKey: 'security.category.urlCredentials',
    descKey: 'security.category.urlCredentials.desc'
  }
] as const

type ThreadMessage = ChatMessage & {
  display?: 'command-output' | 'system-status' | 'privacy-status' | 'tool-call'
  displayContent?: string
  command?: string
  output?: string
  toolCallId?: string
  terminalContextSent?: boolean
  maskedContent?: string
  privacy?: PrivacyMaskingNotice
  reasoningContent?: string
}

function formatToolCallOutput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

function isAssistantResponseMessage(message: ThreadMessage | undefined): message is ThreadMessage {
  return Boolean(message && message.role === 'assistant' && !message.display)
}

function isEmptyAssistantDraft(message: ThreadMessage | undefined): message is ThreadMessage {
  return isAssistantResponseMessage(message) && !message.content && !message.reasoningContent && !message.privacy
}

function findLastAssistantResponseIndex(messages: ThreadMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isAssistantResponseMessage(messages[index])) return index
  }
  return -1
}

type SettingsTab = 'appearance' | 'providers' | 'mcp' | 'connections' | 'security' | 'chatTools' | 'prompts' | 'snippets' | 'data'
type ProviderConnectionState = 'unknown' | 'checking' | 'ready' | 'error'
type ProviderListStatusTone = 'active' | 'active-ready' | 'active-local' | 'ready' | 'error' | 'no-key' | 'checking' | 'not-tested' | 'local'
type ComposerLiveStatus = 'running' | 'waiting'
type PermissionIndicatorVisualMode = AssistMode
type PermissionIndicatorTitleKey =
  | 'panel.permission.none'
  | 'panel.permission.readOnly'
  | 'panel.permission.execute'
  | 'panel.permission.readExecute'

interface PermissionIndicatorState {
  label: '—' | 'R' | 'X' | 'R+X'
  titleKey: PermissionIndicatorTitleKey
  visualMode: PermissionIndicatorVisualMode
}

interface ProviderTerminalContextInput {
  assistMode: AssistMode
  selectedText: string
  terminalOutput?: string
  session?: Pick<TerminalSessionInfo, 'id' | 'kind' | 'label' | 'cwd' | 'shell'>
  strictTerminalContextActive: boolean
}

type CommandConfirmationResult = string | false
type CommandConfirmationRequest = Omit<CommandConfirmation, 'sessionId'>

interface DeleteConfirmation {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => Promise<void> | void
}

// eslint-disable-next-line react-refresh/only-export-components -- scoped unit tests cover this pure UI state helper in this owned file.
export function getComposerLiveStatus({
  commandConfirmation,
  streaming,
  agenticRunning,
  agenticCommandRunning
}: {
  commandConfirmation: unknown
  streaming: boolean
  agenticRunning: boolean
  agenticCommandRunning: boolean
}): ComposerLiveStatus | null {
  if (commandConfirmation) return 'waiting'
  if (streaming || agenticRunning || agenticCommandRunning) return 'running'
  return null
}

// eslint-disable-next-line react-refresh/only-export-components -- scoped unit tests cover this pure UI state helper in this owned file.
export function getPermissionIndicatorState(
  assistMode: AssistMode,
  terminalContextAllowed: boolean
): PermissionIndicatorState {
  if (assistMode === 'agent') {
    return terminalContextAllowed
      ? { label: 'R+X', titleKey: 'panel.permission.readExecute', visualMode: 'agent' }
      : { label: 'X', titleKey: 'panel.permission.execute', visualMode: 'agent' }
  }

  if (assistMode === 'read' && terminalContextAllowed) {
    return { label: 'R', titleKey: 'panel.permission.readOnly', visualMode: 'read' }
  }

  return { label: '—', titleKey: 'panel.permission.none', visualMode: 'off' }
}

// eslint-disable-next-line react-refresh/only-export-components -- scoped unit tests cover this pure UI state helper in this owned file.
export function getProviderTerminalContext({
  assistMode,
  selectedText,
  terminalOutput,
  session,
  strictTerminalContextActive
}: ProviderTerminalContextInput): Pick<TerminalContext, 'selectedText' | 'terminalOutput' | 'session'> {
  if (assistMode === 'off' || strictTerminalContextActive) {
    return { selectedText: '', terminalOutput: undefined, session: undefined }
  }

  return { selectedText, terminalOutput: terminalOutput || undefined, session }
}

function withObjectName(title: string, name?: string): string {
  const cleaned = name?.trim()
  if (!cleaned) return title
  return title.replace(/\?$/, '') + ` "${cleaned}"?`
}

function isValidProviderBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidProviderProxyUrl(value: string | undefined): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return true
  try {
    const parsed = new URL(trimmed)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

function createEmptyMcpServer(): McpServerConfig {
  const now = new Date().toISOString()
  return {
    id: `mcp-${crypto.randomUUID()}`,
    name: '',
    command: '',
    args: [],
    env: {},
    enabled: true,
    source: 'manual',
    createdAt: now,
    updatedAt: now
  }
}

function parseMcpArgs(value: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaping = false

  for (const char of value) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char
      continue
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) current += '\\'
  if (current) args.push(current)
  return args
}

function parseMcpEnv(value: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue
    env[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1)
  }
  return env
}

function formatMcpArgs(args: string[] | undefined): string {
  return (args ?? []).map(formatMcpArg).join(' ')
}

function formatMcpEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

function formatMcpArg(arg: string): string {
  if (!arg) return '""'
  if (!/[\s"'\\]/.test(arg)) return arg
  return `"${arg.replace(/(["\\])/g, '\\$1')}"`
}

function getDiscoveredMcpKey(server: DiscoveredMcpServer): string {
  return [
    server.source,
    server.sourcePath,
    server.name.trim().toLowerCase(),
    server.command.trim(),
    ...(server.args ?? [])
  ].join('\u0000')
}

function isValidTextSize(value: string): boolean {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= MIN_TEXT_SIZE && parsed <= MAX_TEXT_SIZE
}

function clampTextSize(value: string, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, parsed))
}

function isValidLineHeight(value: string): boolean {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= MIN_LINE_HEIGHT && parsed <= MAX_LINE_HEIGHT
}

function clampLineHeight(value: string, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, parsed))
}

function isValidScrollback(value: string): boolean {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= MIN_SCROLLBACK && parsed <= MAX_SCROLLBACK
}

function clampScrollback(value: string, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_SCROLLBACK, Math.max(MIN_SCROLLBACK, Math.round(parsed)))
}

function isTerminalCursorStyle(value: unknown): value is TerminalCursorStyle {
  return value === 'block' || value === 'underline' || value === 'bar'
}

function isTerminalFontOption(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_FONT_OPTIONS.some((font) => font.value === value)
}

function clampWindowOpacity(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, parsed))
}

function isValidSshPort(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= MIN_SSH_PORT && value <= MAX_SSH_PORT)
}

function clampSshPort(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(MAX_SSH_PORT, Math.max(MIN_SSH_PORT, Math.round(value)))
}

function isValidOutputContext(value: string): boolean {
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= MIN_OUTPUT_CONTEXT
}

function clampOutputContext(value: string, fallback: number): number {
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(MIN_OUTPUT_CONTEXT, parsed)
}

function normalizeLibraryName(value: string): string {
  return value.trim().toLowerCase()
}

function providerNeedsApiKey(providerType: LLMProviderType): boolean {
  return providerTypesWithApiKey.includes(providerType)
}

function getProviderStatusKey(provider: LLMProviderConfig): string {
  return JSON.stringify([
    provider.apiKeyRef?.trim() ?? '',
    getProviderType(provider),
    provider.baseUrl?.trim() ?? '',
    provider.proxyUrl?.trim() ?? '',
    provider.proxyUsername?.trim() ?? '',
    provider.allowInsecureTls ? 'insecure-tls' : 'default-tls'
  ])
}

function formatSecretCategory(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function formatAuditTime(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(time))
}

function auditSourceLabel(source: SecretMaskingAuditSource, t: LanguageContextValue['t']): string {
  switch (source) {
    case 'chat-stream':
      return t('security.audit.source.chatStream')
    case 'chat-display':
      return t('security.audit.source.chatDisplay')
    case 'command-risk':
      return t('security.audit.source.commandRisk')
    case 'summary':
      return t('security.audit.source.summary')
    case 'terminal-display':
      return t('security.audit.source.terminalDisplay')
    case 'chat-storage':
      return t('security.audit.source.chatStorage')
    default:
      return source
  }
}

function scopeLabel(scope: SecretMaskingAuditEvent['scope'], t: LanguageContextValue['t']): string {
  return scope === 'provider-payload'
    ? t('security.audit.scope.provider')
    : t('security.audit.scope.display')
}

interface PrivacyTrustCardProps {
  content: string
  notice?: PrivacyMaskingNotice
  onOpenSecuritySettings: () => void
}

function PrivacyTrustCard({
  content,
  notice,
  onOpenSecuritySettings
}: PrivacyTrustCardProps): JSX.Element {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  const categories = Array.isArray(notice?.categories)
    ? [...new Set(notice.categories.filter((category): category is string => typeof category === 'string'))]
    : []
  const visibleCategories = categories.length > 0 ? categories : ['unknown']
  const source = notice ? auditSourceLabel(notice.source, t) : t('security.audit.source.chatStream')
  const scope = notice ? scopeLabel(notice.scope, t) : t('security.audit.scope.provider')

  return (
    <div className={`privacy-trust-card ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="privacy-trust-card-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="privacy-trust-card-icon" aria-hidden>
          <ShieldAlert size={12} />
        </span>
        <span className="privacy-trust-card-title">
          <strong>{t('privacy.trustCard.title')}</strong>
          <small>{content}</small>
        </span>
        <ChevronDown className="privacy-trust-card-chevron" size={12} aria-hidden />
      </button>

      {expanded ? (
        <div className="privacy-trust-card-details">
          <div className="privacy-trust-card-row">
            <span>{t('privacy.trustCard.categories')}</span>
            <div className="privacy-trust-card-tags">
              {visibleCategories.map((category, categoryIndex) => (
                <span key={`${category}-${categoryIndex}`}>{formatSecretCategory(category)}</span>
              ))}
            </div>
          </div>
          <div className="privacy-trust-card-row">
            <span>{t('privacy.trustCard.context')}</span>
            <small>
              {source} · {scope}
              {notice?.sessionLabel ? ` · ${notice.sessionLabel}` : ''}
            </small>
          </div>
          <p className="privacy-trust-card-note">
            {t('privacy.trustCard.note')}
          </p>
          <div className="privacy-trust-card-actions">
            <button type="button" className="quiet-button" onClick={onOpenSecuritySettings}>
              <Settings2 size={11} aria-hidden />
              {t('privacy.trustCard.openSettings')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightSearchText({ text, query }: { text: string; query: string }): JSX.Element {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return <>{text}</>

  const queryPattern = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig')
  const normalizedLowerQuery = normalizedQuery.toLowerCase()
  const words = text.split(/(\s+)/)

  return (
    <>
      {words.map((word, wordIndex) => {
        if (!word || /^\s+$/.test(word)) return word

        const parts = word.split(queryPattern)
        const hasMatch = parts.some((part) => part.toLowerCase() === normalizedLowerQuery)
        if (!hasMatch) return word

        return (
          <span key={`${word}-${wordIndex}`} className="settings-search-word">
            {parts.map((part, partIndex) => (
              part.toLowerCase() === normalizedLowerQuery
                ? <mark key={`${part}-${partIndex}`} className="settings-search-highlight">{part}</mark>
                : part
            ))}
          </span>
        )
      })}
    </>
  )
}

interface ThinkingBlockProps {
  content: string
  isStreaming: boolean
  title: string
}

function ThinkingBlock({ content, isStreaming, title }: ThinkingBlockProps): JSX.Element {
  const contentRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content])

  return (
    <details className="thinking-block">
      <summary>
        <span className="thinking-title">
          <Brain size={12} aria-hidden />
          {title}
        </span>
        {isStreaming ? <span className="thinking-live-dot" aria-hidden /> : null}
      </summary>
      <pre ref={contentRef}>{content.trim()}</pre>
    </details>
  )
}

interface AssistantThread {
  messages: ThreadMessage[]
  draft: string
  status: InlineStatus | null
  streaming: boolean
  activeRequestId?: string
  streamingContent: string
  agenticPending: string | null
  agenticRunning: boolean
  agenticCommandRunning: boolean
  agenticStep: number
  agenticCommand: string
  commandConfirmation: CommandConfirmation | null
  lastMaskedSecretCount: number
  session?: Pick<TerminalSessionInfo, 'id' | 'kind' | 'label' | 'cwd' | 'shell'>
  savedChatId?: string
}

type AssistantThreads = Record<string, AssistantThread>

function createThread(): AssistantThread {
  return {
    messages: [],
    draft: '',
    status: null,
    streaming: false,
    streamingContent: '',
    agenticPending: null,
    agenticRunning: false,
    agenticCommandRunning: false,
    agenticStep: 0,
    agenticCommand: '',
    commandConfirmation: null,
    lastMaskedSecretCount: 0
  }
}

function toRestorableThread(thread: AssistantThread): RestorableAssistantThread {
  return {
    messages: thread.messages.map((message) => ({
      role: message.role,
      content: message.displayContent ?? hideSecretPlaceholders(message.content, DISPLAY_SECRET_LABEL),
      display: message.display,
      command: hidePersistedSecretPlaceholders(message.command),
      output: hidePersistedSecretPlaceholders(message.output),
      privacy: message.privacy,
      reasoningContent: hidePersistedSecretPlaceholders(message.reasoningContent)
    })),
    draft: thread.draft,
    session: thread.session,
    savedChatId: thread.savedChatId
  }
}

function toRestorableThreads(threads: AssistantThreads): RestorableAssistantThreads {
  return Object.fromEntries(
    Object.entries(threads).map(([sessionId, thread]) => [sessionId, toRestorableThread(thread)])
  )
}

function fromRestorableThread(thread: RestorableAssistantThread): AssistantThread {
  return {
    ...createThread(),
    messages: thread.messages ?? [],
    draft: thread.draft ?? '',
    session: thread.session,
    savedChatId: thread.savedChatId
  }
}

function fromRestorableThreads(threads: RestorableAssistantThreads): AssistantThreads {
  return Object.fromEntries(
    Object.entries(threads).map(([sessionId, thread]) => [sessionId, fromRestorableThread(thread)])
  )
}

function toChatMessage(message: ThreadMessage, strictTerminalContext = false): ChatMessage {
  if (strictTerminalContext && (message.display === 'command-output' || message.command || message.output)) {
    return {
      role: message.role,
      content: buildAgentContinuation('', '', true)
    }
  }

  return {
    role: message.role,
    content: message.maskedContent ?? message.content
  }
}

function toConversationalChatMessages(messages: ThreadMessage[], strictTerminalContext = false): ChatMessage[] {
  return messages
    .filter((message) => message.display !== 'tool-call')
    .map((message) => toChatMessage(message, strictTerminalContext))
}

function estimateComposerPayloadChars({
  messages,
  draft,
  assistMode,
  language,
  selectedText,
  terminalOutput,
  session,
  maskedSecretCount
}: {
  messages: ChatMessage[]
  draft: string
  assistMode: AssistMode
  language: Language
  selectedText: string
  terminalOutput: string
  session?: Pick<TerminalSessionInfo, 'id' | 'kind' | 'label' | 'cwd' | 'shell'>
  maskedSecretCount: number
}): number {
  const promptMessages = buildAssistantPromptMessages({
    assistMode,
    language,
    selectedText,
    terminalOutput,
    session,
    maskedSecretCount
  })
  const draftMessage = draft.trim() ? [{ role: 'user' as const, content: draft }] : []

  return mergeAssistantPromptMessages(promptMessages, [...messages, ...draftMessage])
    .map((message) => message.content)
    .reduce((sum, content) => sum + content.length, 0)
}

function upsertProviderInOrder(providers: LLMProviderConfig[], provider: LLMProviderConfig): LLMProviderConfig[] {
  const existingIndex = providers.findIndex((candidate) => candidate.apiKeyRef === provider.apiKeyRef)
  if (existingIndex === -1) return [...providers, provider]
  return providers.map((candidate, index) => index === existingIndex ? provider : candidate)
}

function getProviderType(provider: LLMProviderConfig): LLMProviderType {
  return provider.providerType ?? 'openai'
}

function applyProviderTypeDefaults(provider: LLMProviderConfig, providerType: LLMProviderType): LLMProviderConfig {
  const previousDefaults = providerTypeDefaults[getProviderType(provider)]
  const nextDefaults = providerTypeDefaults[providerType]
  const shouldReplaceName = !provider.name.trim() || provider.name === previousDefaults.name
  const shouldReplaceBaseUrl = !provider.baseUrl.trim() || provider.baseUrl === previousDefaults.baseUrl

  return {
    ...provider,
    providerType,
    name: shouldReplaceName ? nextDefaults.name : provider.name,
    baseUrl: shouldReplaceBaseUrl ? nextDefaults.baseUrl : provider.baseUrl
  }
}

function progressPercent(progress: number): number {
  return Math.round(Math.min(Math.max(progress, 0), 1) * 100)
}

function formatModelDisplay(modelId: string | undefined): string {
  if (!modelId) return ''
  const label = formatModelLabel(modelId)
  return label.version ? `${label.name} — ${label.version}` : label.name
}

function electronToDisplay(shortcut: string): string {
  return acceleratorToDisplay(shortcut)
}

interface LlmPanelProps {
  activeSession?: SessionTabInfo
  sessionIds: string[]
  selectedText: string
  getOutput: () => string
  getOutputForSession: (sessionId: string) => string
  settingsOpen: boolean
  onOpenSettings: () => void
  onCloseSettings: () => void
  settingsTabRequest: SettingsTab
  settingsTabRequestVersion: number
  addSnippetRequestVersion: number
  onOpenPromptPalette: () => void
  textSize: number
  onTextSizeChange: (textSize: number) => void
  terminalFontFamily: string
  onTerminalFontFamilyChange: (fontFamily: string) => void
  terminalCursorStyle: TerminalCursorStyle
  onTerminalCursorStyleChange: (cursorStyle: TerminalCursorStyle) => void
  terminalCursorBlink: boolean
  onTerminalCursorBlinkChange: (cursorBlink: boolean) => void
  terminalLineHeight: number
  onTerminalLineHeightChange: (lineHeight: number) => void
  terminalScrollback: number
  onTerminalScrollbackChange: (scrollback: number) => void
  windowOpacity: number
  onWindowOpacityChange: (opacity: number) => void
  sidebarWidth: number
  onSidebarWidthChange: (sidebarWidth: number) => void
  language: Language
  onLanguageChange: (language: Language) => void
  hideShortcut: string
  onHideShortcutChange: (shortcut: string) => void
  maxOutputContext: number
  onMaxOutputContextChange: (value: number) => void
  restoreSessions: boolean
  onRestoreSessionsChange: (enabled: boolean) => void
  restoredThreads: RestorableAssistantThreads
  onThreadsChange: (threads: RestorableAssistantThreads) => void
  onClearSavedSessionState: () => Promise<void>
  onReopenChat: (chatId: string) => void
  themeId: string
  onThemeChange: (themeId: string) => void
  onConnectSsh: (profile: SSHProfileConfig) => void
  blockPromptRequest?: { id: string; sessionId: string; prompt: string } | null
  snippetDraftRequest?: { id: string; name?: string; command?: string } | null
  promptInsertRequest?: { id: string; content: string } | null
  assistModeRequest?: { id: string; mode: AssistMode } | null
  modelSwitchRequest?: { id: string } | null
}

export function LlmPanel({
  activeSession,
  sessionIds,
  selectedText,
  getOutput,
  getOutputForSession,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  settingsTabRequest,
  settingsTabRequestVersion,
  addSnippetRequestVersion,
  onOpenPromptPalette,
  textSize,
  onTextSizeChange,
  terminalFontFamily,
  onTerminalFontFamilyChange,
  terminalCursorStyle,
  onTerminalCursorStyleChange,
  terminalCursorBlink,
  onTerminalCursorBlinkChange,
  terminalLineHeight,
  onTerminalLineHeightChange,
  terminalScrollback,
  onTerminalScrollbackChange,
  windowOpacity,
  onWindowOpacityChange,
  sidebarWidth,
  onSidebarWidthChange,
  language,
  onLanguageChange,
  hideShortcut,
  onHideShortcutChange,
  maxOutputContext,
  onMaxOutputContextChange,
  restoreSessions,
  onRestoreSessionsChange,
  restoredThreads,
  onThreadsChange,
  onClearSavedSessionState,
  onReopenChat,
  themeId,
  onThemeChange,
  onConnectSsh,
  blockPromptRequest,
  snippetDraftRequest,
  promptInsertRequest,
  assistModeRequest,
  modelSwitchRequest,
}: LlmPanelProps): JSX.Element {
  const { t } = useT()
  const [provider, setProvider] = useState<LLMProviderConfig>(defaultProvider)
  const [allProviders, setAllProviders] = useState<LLMProviderConfig[]>([defaultProvider])
  const [activeProviderRef, setActiveProviderRef] = useState(defaultProvider.apiKeyRef)
  const [apiKey, setApiKey] = useState('')
  const [proxyPassword, setProxyPassword] = useState('')
  const [models, setModels] = useState<LLMModel[]>([])
  const [threadsBySessionId, setThreadsBySessionId] = useState<AssistantThreads>({})
  const [assistMode, setAssistMode] = useState<AssistMode>(DEFAULT_ASSIST_MODE)
  const [textSizeDraft, setTextSizeDraft] = useState(String(textSize))
  const [lineHeightDraft, setLineHeightDraft] = useState(String(terminalLineHeight))
  const [scrollbackDraft, setScrollbackDraft] = useState(String(terminalScrollback))
  const [maxOutputContextDraft, setMaxOutputContextDraft] = useState(String(maxOutputContext))
  const [secretMaskingSettings, setSecretMaskingSettings] = useState<SecretMaskingSettings>(createDefaultSecretMaskingSettings)
  const [chatToolsSettings, setChatToolsSettings] = useState<ChatToolsSettings>(createDefaultChatToolsSettings)
  const [telemetrySettings, setTelemetrySettings] = useState<TelemetrySettings | null>(null)
  const [telemetryActive, setTelemetryActive] = useState(false)
  const [secretAuditEvents, setSecretAuditEvents] = useState<SecretMaskingAuditEvent[]>([])
  const [customPatternName, setCustomPatternName] = useState('')
  const [customPatternRegex, setCustomPatternRegex] = useState('')
  const [customPatternError, setCustomPatternError] = useState('')
  const [securityStatus, setSecurityStatus] = useState('')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')
  const [settingsSearch, setSettingsSearch] = useState('')
  const lastAutoOpenedSettingsQueryRef = useRef('')
  const settingsSearchRef = useRef<HTMLInputElement | null>(null)
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null)
  const [editingApiKey, setEditingApiKey] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [checkedApiKeyRef, setCheckedApiKeyRef] = useState<string | undefined>(defaultProvider.apiKeyRef)
  const [providerSecretsLoaded, setProviderSecretsLoaded] = useState(false)
  const [editingProxyPassword, setEditingProxyPassword] = useState(false)
  const [hasProxyPassword, setHasProxyPassword] = useState(false)
  const [providerStatus, setProviderStatus] = useState('')
  const [isTestingProvider, setIsTestingProvider] = useState(false)
  const [providerKeyAvailability, setProviderKeyAvailability] = useState<Record<string, boolean>>({})
  const [providerConnectionStates, setProviderConnectionStates] = useState<Record<string, ProviderConnectionState>>({})
  const [draftProviderRef, setDraftProviderRef] = useState<string | null>(null)
  const [shouldFocusApiKeyInput, setShouldFocusApiKeyInput] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
  const [mcpDraft, setMcpDraft] = useState<McpServerConfig>(createEmptyMcpServer)
  const [mcpArgsDraft, setMcpArgsDraft] = useState('')
  const [mcpEnvDraft, setMcpEnvDraft] = useState('')
  const [mcpStatus, setMcpStatus] = useState('')
  const [mcpDiscovering, setMcpDiscovering] = useState(false)
  const [mcpRefreshingTools, setMcpRefreshingTools] = useState(false)
  const [discoveredMcpServers, setDiscoveredMcpServers] = useState<DiscoveredMcpServer[]>([])
  const [selectedDiscoveredMcpIds, setSelectedDiscoveredMcpIds] = useState<string[]>([])
  const [dataStatus, setDataStatus] = useState('')
  const [dataUsage, setDataUsage] = useState<DataUsageStats | null>(null)
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)
  const [savePromptDialog, setSavePromptDialog] = useState<{ content: string; name?: string } | null>(null)
  const [savePromptName, setSavePromptName] = useState('')
  const [savePromptStatus, setSavePromptStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savePromptDuplicateName, setSavePromptDuplicateName] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [composerConfigOpen, setComposerConfigOpen] = useState(false)
  const [historyChats, setHistoryChats] = useState<SavedChatSummary[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [sshProfiles, setSshProfiles] = useState<SSHProfileConfig[]>([])
  const [sshProfile, setSshProfile] = useState<SSHProfileConfig | null>(null)
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null)
  const [expandedToolResults, setExpandedToolResults] = useState<Set<string>>(() => new Set())
  const [toolResultOutputs, setToolResultOutputs] = useState<Map<string, string>>(() => new Map())
  const [modelSwitcherOpen, setModelSwitcherOpen] = useState(false)

  // Refs for use inside stable closures
  const chatLogRef = useRef<HTMLElement | null>(null)
  const chatAutoScrollPausedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const threadsRef = useRef<AssistantThreads>({})
  const liveSessionIdsRef = useRef(new Set<string>())
  const requestSessionRef = useRef(new Map<string, string>())
  const assistModeRef = useRef<AssistMode>(DEFAULT_ASSIST_MODE)
  const activeSessionRef = useRef(activeSession)
  const getOutputForSessionRef = useRef(getOutputForSession)
  const providerRef = useRef(provider)
  const selectedTextRef = useRef(selectedText)
  const promptResolversRef = useRef(new Map<string, () => void>())
  const commandConfirmationResolversRef = useRef(new Map<string, (result: CommandConfirmationResult) => void>())
  const handledBlockPromptRequestRef = useRef<string>()
  const handledPromptInsertRequestRef = useRef<string>()
  const handledAssistModeRequestRef = useRef<string>()
  const handledModelSwitchRequestRef = useRef<string>()
  const runningCommandsRef = useRef(new Set<string>())
  const pendingStreamStartsRef = useRef(new Set<string>())
  const savePromptGenerationRequestIdRef = useRef<string | null>(null)
  const providerSecretCheckVersionRef = useRef(0)
  const optimisticApiKeyRef = useRef<string | undefined>()
  const languageRef = useRef<Language>(language)
  const chatToolsSettingsRef = useRef<ChatToolsSettings>(chatToolsSettings)
  const maxOutputContextRef = useRef(maxOutputContext)
  const chatHistorySaveTimerRef = useRef<number>()
  const copiedMessageTimerRef = useRef<number>()
  const loadingModelsRef = useRef(false)
  const activeSessionId = activeSession?.id
  const sessionIdKey = sessionIds.join('\0')
  const activeThread = activeSessionId ? threadsBySessionId[activeSessionId] ?? createThread() : createThread()
  const {
    messages,
    draft,
    status,
    streaming,
    agenticRunning,
    agenticCommandRunning,
    agenticStep,
    agenticCommand,
    commandConfirmation,
    lastMaskedSecretCount
  } = activeThread
  const [confirmCountdown, setConfirmCountdown] = useState(0)

  const resizeComposerTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`
  }, [])

  useEffect(() => {
    resizeComposerTextarea()
  }, [draft, resizeComposerTextarea])

  useEffect(() => {
    return () => {
      if (copiedMessageTimerRef.current) {
        window.clearTimeout(copiedMessageTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    chatAutoScrollPausedRef.current = false
  }, [activeSessionId])

  const handleChatLogScroll = useCallback(() => {
    const log = chatLogRef.current
    if (!log) return
    chatAutoScrollPausedRef.current = !isChatScrolledToBottom(log)
  }, [])

  useEffect(() => {
    const textarea = textareaRef.current
    const composer = textarea?.parentElement
    if (!composer || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      resizeComposerTextarea()
    })
    observer.observe(composer)

    return () => observer.disconnect()
  }, [resizeComposerTextarea])

  const commandConfirmationTone = commandConfirmation?.tone
  const commandConfirmationCommandId = commandConfirmation?.commandId

  // Countdown timer for destructive (danger) command confirmations
  // Depend on tone + commandRequestId so editing the command textarea won't reset the timer
  useEffect(() => {
    if (commandConfirmationTone !== 'danger') {
      setConfirmCountdown(0)
      return
    }
    const COUNTDOWN_SECONDS = 3
    setConfirmCountdown(COUNTDOWN_SECONDS)
    const interval = setInterval(() => {
      setConfirmCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [commandConfirmationTone, commandConfirmationCommandId])

  const secretMaskingMode = secretMaskingSettings.mode
  const strictTerminalContextActive = isStrictTerminalContextActive(secretMaskingSettings)

  const liveStatus = getComposerLiveStatus({
    commandConfirmation,
    streaming,
    agenticRunning,
    agenticCommandRunning
  })

  // Keep refs in sync
  useEffect(() => { languageRef.current = language }, [language])
  useEffect(() => { chatToolsSettingsRef.current = chatToolsSettings }, [chatToolsSettings])
  useEffect(() => { maxOutputContextRef.current = maxOutputContext }, [maxOutputContext])
  useEffect(() => { threadsRef.current = threadsBySessionId }, [threadsBySessionId])
  useEffect(() => { onThreadsChange(toRestorableThreads(threadsBySessionId)) }, [threadsBySessionId, onThreadsChange])
  useEffect(() => {
    setThreadsBySessionId(fromRestorableThreads(restoredThreads))
    threadsRef.current = fromRestorableThreads(restoredThreads)
  }, [restoredThreads])
  useEffect(() => { assistModeRef.current = assistMode }, [assistMode])
  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])
  useEffect(() => { getOutputForSessionRef.current = getOutputForSession }, [getOutputForSession])
  useEffect(() => { providerRef.current = provider }, [provider])
  useEffect(() => { selectedTextRef.current = selectedText }, [selectedText])
  useEffect(() => { setTextSizeDraft(String(textSize)) }, [textSize])
  useEffect(() => { setLineHeightDraft(String(terminalLineHeight)) }, [terminalLineHeight])
  useEffect(() => { setScrollbackDraft(String(terminalScrollback)) }, [terminalScrollback])
  useEffect(() => { setMaxOutputContextDraft(String(maxOutputContext)) }, [maxOutputContext])
  useEffect(() => () => {
    if (chatHistorySaveTimerRef.current) {
      window.clearTimeout(chatHistorySaveTimerRef.current)
      chatHistorySaveTimerRef.current = undefined
    }
  }, [])

  // Shortcut recording via main process IPC
  useEffect(() => {
    if (!recordingShortcut) return
    const unsubscribe = window.api.shortcuts.onRecorded((accelerator) => {
      void (async () => {
        if (accelerator === 'Escape') {
          setRecordingShortcut(false)
          setShortcutError(null)
          return
        }
        setRecordingShortcut(false)
        setShortcutError(null)
        const success = await window.api.shortcuts.setHide(accelerator)
        if (success) {
          onHideShortcutChange(accelerator)
        } else {
          setShortcutError(accelerator)
        }
      })()
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setRecordingShortcut(false)
      setShortcutError(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    void window.api.shortcuts.startRecording()
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      unsubscribe()
      void window.api.shortcuts.stopRecording()
    }
  }, [recordingShortcut, onHideShortcutChange])

  const summarizeSession = useCallback((session: TerminalSessionInfo): Pick<TerminalSessionInfo, 'id' | 'kind' | 'label' | 'cwd' | 'shell'> => ({
    id: session.id,
    kind: session.kind,
    label: session.label,
    cwd: session.cwd,
    shell: session.shell
  }), [])

  const getThread = useCallback((sessionId: string): AssistantThread => {
    return threadsRef.current[sessionId] ?? createThread()
  }, [])

  const updateThread = useCallback((sessionId: string, updater: (thread: AssistantThread) => AssistantThread) => {
    if (liveSessionIdsRef.current.size > 0 && !liveSessionIdsRef.current.has(sessionId)) return
    const current = threadsRef.current
    const nextThread = updater(current[sessionId] ?? createThread())
    const next = { ...current, [sessionId]: nextThread }
    threadsRef.current = next
    setThreadsBySessionId(next)
  }, [])

  const getBoundedTerminalOutputForRequest = useCallback((sessionId: string, mode: AssistMode): string | undefined => {
    if (mode === 'off') return undefined
    const terminalOutput = getOutputForSessionRef.current(sessionId).slice(-maxOutputContextRef.current)
    return terminalOutput || undefined
  }, [])

  const saveThreadSnapshotToHistory = useCallback((thread: AssistantThread): string | undefined => {
    if (thread.messages.length === 0) return undefined
    const chatId = thread.savedChatId ?? crypto.randomUUID()
    const firstUserMsg = thread.messages.find((m) => m.role === 'user')
    const title = firstUserMsg?.content.slice(0, 60).replace(/\n/g, ' ') || 'Untitled chat'
    const savedChat: SavedChat = {
      id: chatId,
      title,
      messages: thread.messages.map((m) => ({
        role: m.role,
        content: m.displayContent ?? hideSecretPlaceholders(m.content, DISPLAY_SECRET_LABEL),
        display: m.display,
        command: hidePersistedSecretPlaceholders(m.command),
        output: hidePersistedSecretPlaceholders(m.output),
        privacy: m.privacy,
        reasoningContent: hidePersistedSecretPlaceholders(m.reasoningContent)
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      providerRef: providerRef.current.apiKeyRef,
      modelId: providerRef.current.selectedModel,
      sessionSnapshot: thread.session
        ? { kind: thread.session.kind, label: thread.session.label, cwd: thread.session.cwd, shell: thread.session.shell }
        : undefined
    }
    void window.api.chatHistory.save(savedChat).catch((err: unknown) => {
      console.error('Failed to save chat to history', err)
    })
    return chatId
  }, [])

  const autoSaveThreadToHistory = useCallback((sessionId: string) => {
    const thread = threadsRef.current[sessionId]
    if (!thread || thread.messages.length === 0) return
    if (chatHistorySaveTimerRef.current) window.clearTimeout(chatHistorySaveTimerRef.current)
    chatHistorySaveTimerRef.current = window.setTimeout(() => {
      chatHistorySaveTimerRef.current = undefined
      const chatId = thread.savedChatId ?? crypto.randomUUID()
      if (!thread.savedChatId) {
        const current = threadsRef.current[sessionId]
        if (current && !current.savedChatId) {
          const updated = { ...current, savedChatId: chatId }
          threadsRef.current = { ...threadsRef.current, [sessionId]: updated }
          setThreadsBySessionId(threadsRef.current)
        }
      }
      saveThreadSnapshotToHistory({ ...thread, savedChatId: chatId })
    }, 500)
  }, [saveThreadSnapshotToHistory])

  useEffect(() => {
    const liveSessionIds = new Set(sessionIdKey ? sessionIdKey.split('\0') : [])
    liveSessionIdsRef.current = liveSessionIds
    const next: AssistantThreads = {}
    let changed = false

    for (const [sessionId, thread] of Object.entries(threadsRef.current)) {
      if (liveSessionIds.has(sessionId)) {
        next[sessionId] = thread
      } else {
        changed = true
        promptResolversRef.current.get(sessionId)?.()
        promptResolversRef.current.delete(sessionId)
        runningCommandsRef.current.delete(sessionId)
        commandConfirmationResolversRef.current.get(sessionId)?.(false)
        commandConfirmationResolversRef.current.delete(sessionId)
        if (thread.activeRequestId) requestSessionRef.current.delete(thread.activeRequestId)
      }
    }

    if (changed) {
      threadsRef.current = next
      setThreadsBySessionId(next)
    }
  }, [sessionIdKey])

  useEffect(() => {
    if (!activeSession) return
    updateThread(activeSession.id, (thread) => ({ ...thread, session: summarizeSession(activeSession) }))
  }, [activeSession, summarizeSession, updateThread])

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
    setDraftProviderRef(null)
    setSecretMaskingSettings(config.secretMasking ?? createDefaultSecretMaskingSettings())
    setChatToolsSettings(config.chatTools ?? createDefaultChatToolsSettings())
    setTelemetrySettings(config.telemetry ?? null)
  }, [])

  // Load config on mount
  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  // Keep the telemetry row truthful: reflect whether sends are actually possible
  // in this build, and stay in sync with the first-run consent prompt.
  useEffect(() => {
    void window.api.config.getTelemetryRuntimeState().then((state) => {
      setTelemetryActive(state.possible)
    }).catch(() => undefined)
    const unsubscribe = window.api.config.onTelemetryChanged((settings) => {
      setTelemetrySettings(settings)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.secret.listAuditEvents().then((events) => {
      if (!cancelled) setSecretAuditEvents(events)
    }).catch(() => undefined)

    const unsubscribe = window.api.secret.onAuditEvent((event) => {
      setSecretAuditEvents((events) => [event, ...events].slice(0, SECRET_MASKING_AUDIT_LIMIT))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const secretCheckVersion = ++providerSecretCheckVersionRef.current
    const apiKeyRef = provider.apiKeyRef
    setCheckedApiKeyRef(apiKeyRef)

    if (apiKeyRef && optimisticApiKeyRef.current === apiKeyRef) {
      optimisticApiKeyRef.current = undefined
      setHasApiKey(true)
      setProviderSecretsLoaded(true)
      return
    }
    if (optimisticApiKeyRef.current && optimisticApiKeyRef.current !== apiKeyRef) {
      optimisticApiKeyRef.current = undefined
    }

    setHasApiKey(false)
    setProviderSecretsLoaded(false)

    if (!apiKeyRef) {
      setProviderSecretsLoaded(true)
      return
    }

    void window.api.llm.hasApiKey(apiKeyRef).then((hasKey) => {
      if (providerSecretCheckVersionRef.current === secretCheckVersion) {
        setHasApiKey(hasKey)
        setProviderKeyAvailability((current) => ({ ...current, [apiKeyRef]: hasKey }))
        setProviderSecretsLoaded(true)
      }
    }).catch(() => {
      if (providerSecretCheckVersionRef.current === secretCheckVersion) {
        setHasApiKey(false)
        setProviderKeyAvailability((current) => ({ ...current, [apiKeyRef]: false }))
        setProviderSecretsLoaded(true)
      }
    })
  }, [provider.apiKeyRef])

  useEffect(() => {
    let cancelled = false
    const refsToCheck = allProviders
      .filter((candidate) => providerNeedsApiKey(getProviderType(candidate)))
      .map((candidate) => candidate.apiKeyRef)
      .filter((apiKeyRef, index, refs) => Boolean(apiKeyRef) && refs.indexOf(apiKeyRef) === index)

    for (const apiKeyRef of refsToCheck) {
      void window.api.llm.hasApiKey(apiKeyRef).then((hasKey) => {
        if (!cancelled) {
          setProviderKeyAvailability((current) => ({ ...current, [apiKeyRef]: hasKey }))
        }
      }).catch(() => {
        if (!cancelled) {
          setProviderKeyAvailability((current) => ({ ...current, [apiKeyRef]: false }))
        }
      })
    }

    setProviderKeyAvailability((current) => {
      const next = { ...current }
      for (const candidate of allProviders) {
        if (candidate.apiKeyRef && !providerNeedsApiKey(getProviderType(candidate))) {
          next[candidate.apiKeyRef] = true
        }
      }
      return next
    })

    return () => {
      cancelled = true
    }
  }, [allProviders])

  useEffect(() => {
    setProviderConnectionStates((current) => {
      const validKeys = new Set(allProviders.map((candidate) => getProviderStatusKey(candidate)))
      validKeys.add(getProviderStatusKey(provider))
      return Object.fromEntries(
        Object.entries(current).filter(([statusKey]) => validKeys.has(statusKey))
      )
    })
  }, [allProviders, provider])

  useEffect(() => {
    setHasProxyPassword(Boolean(provider.proxyPasswordRef))
  }, [provider.proxyPasswordRef])

  useEffect(() => {
    if (!shouldFocusApiKeyInput) return

    const frameId = requestAnimationFrame(() => {
      apiKeyInputRef.current?.focus()
      apiKeyInputRef.current?.select()
      setShouldFocusApiKeyInput(false)
    })

    return () => cancelAnimationFrame(frameId)
  }, [provider.apiKeyRef, shouldFocusApiKeyInput])

  // Prompt listener for agentic mode
  useEffect(() => {
    return window.api.terminal.onPrompt(({ sessionId }) => {
      promptResolversRef.current.get(sessionId)?.()
      promptResolversRef.current.delete(sessionId)
    })
  }, [])

  const resolveCommandConfirmation = useCallback((sessionId: string, confirmed: boolean, commandOverride?: string) => {
    const resolve = commandConfirmationResolversRef.current.get(sessionId)
    const confirmedCommand = (commandOverride ?? threadsRef.current[sessionId]?.commandConfirmation?.command ?? '').trim()
    commandConfirmationResolversRef.current.delete(sessionId)
    updateThread(sessionId, (thread) => ({ ...thread, commandConfirmation: null }))
    resolve?.(confirmed && confirmedCommand ? confirmedCommand : false)
  }, [updateThread])

  const requestCommandConfirmation = useCallback((sessionId: string, confirmation: CommandConfirmationRequest): Promise<CommandConfirmationResult> => {
    commandConfirmationResolversRef.current.get(sessionId)?.(false)

    return new Promise((resolve) => {
      commandConfirmationResolversRef.current.set(sessionId, resolve)
      updateThread(sessionId, (thread) => ({ ...thread, commandConfirmation: { ...confirmation, sessionId, commandId: crypto.randomUUID() } }))
    })
  }, [updateThread])

  const updateCommandConfirmationCommand = useCallback((sessionId: string, command: string) => {
    updateThread(sessionId, (thread) => {
      if (!thread.commandConfirmation) return thread
      return {
        ...thread,
        commandConfirmation: { ...thread.commandConfirmation, command }
      }
    })
  }, [updateThread])

  useEffect(() => {
    if (!commandConfirmation) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        resolveCommandConfirmation(commandConfirmation.sessionId, false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandConfirmation, resolveCommandConfirmation])

  const appendCommandEditNotice = useCallback((sessionId: string, originalCommand: string, finalCommand: string) => {
    if (originalCommand.trim() === finalCommand.trim()) return
    updateThread(sessionId, (thread) => ({
      ...thread,
      messages: [
        ...thread.messages,
        {
          role: 'assistant',
          content: `Command edited before run.\nOriginal:\n${originalCommand.trim()}\nRun:\n${finalCommand.trim()}`,
          display: 'system-status',
          command: finalCommand.trim(),
          output: originalCommand.trim()
        }
      ]
    }))
  }, [updateThread])

  const appendSystemStatus = useCallback((sessionId: string, content: string) => {
    updateThread(sessionId, (thread) => ({
      ...thread,
      messages: [
        ...thread.messages,
        { role: 'assistant', content, display: 'system-status' as const }
      ]
    }))
  }, [updateThread])

  const maskChatDisplayContent = useCallback(async (sessionId: string, content: string): Promise<string | undefined> => {
    if (!content.trim()) return undefined
    if (secretMaskingSettings.mode === 'off' || !secretMaskingSettings.applyToChatDisplay) return undefined
    const masked = await window.api.secret.maskOutput(sessionId, content, 'chat-display').catch(() => content)
    return masked === content ? undefined : masked
  }, [secretMaskingSettings.applyToChatDisplay, secretMaskingSettings.mode])

  // Core chat stream: starts a new exchange given user message content
  const startStream = useCallback(async (
    sessionId: string,
    userContent: string,
    currentMessages: ThreadMessage[],
    userMeta?: Pick<ThreadMessage, 'display' | 'command' | 'output' | 'terminalContextSent'>
  ) => {
    let requestId: string | undefined
    try {
      requestId = crypto.randomUUID()
      const thread = getThread(sessionId)
      const session = thread.session ?? (activeSessionRef.current?.id === sessionId ? summarizeSession(activeSessionRef.current) : undefined)
      const displayContent = await maskChatDisplayContent(sessionId, userContent)
      const nextMessages: ThreadMessage[] = [
        ...currentMessages,
        { role: 'user', content: userContent, displayContent, ...userMeta },
        { role: 'assistant', content: '' }
      ]
      requestSessionRef.current.set(requestId, sessionId)
      updateThread(sessionId, (thread) => ({
        ...thread,
        messages: nextMessages,
        streaming: true,
        activeRequestId: requestId,
        streamingContent: '',
        lastMaskedSecretCount: 0,
        status: null,
        session
      }))

      const mode = assistModeRef.current
      const terminalOutput = getBoundedTerminalOutputForRequest(sessionId, mode)
      const providerTerminalContext = getProviderTerminalContext({
        assistMode: mode,
        selectedText: selectedTextRef.current,
        terminalOutput,
        session,
        strictTerminalContextActive
      })

      window.api.llm.chatStream({
        requestId,
        provider: providerRef.current,
        messages: toConversationalChatMessages(nextMessages.slice(0, -1), strictTerminalContextActive),
        context: {
          ...providerTerminalContext,
          assistMode: mode,
          language: languageRef.current,
          taskListPlanning: chatToolsSettingsRef.current.taskListPlanning
        }
      })
      autoSaveThreadToHistory(sessionId)
    } catch (error) {
      if (requestId) {
        requestSessionRef.current.delete(requestId)
      }
      updateThread(sessionId, (thread) => ({
        ...thread,
        streaming: requestId && thread.activeRequestId === requestId ? false : thread.streaming,
        activeRequestId: requestId && thread.activeRequestId === requestId ? undefined : thread.activeRequestId,
        streamingContent: requestId && thread.activeRequestId === requestId ? '' : thread.streamingContent,
        status: { tone: 'danger', label: error instanceof Error ? error.message : String(error) }
      }))
    }
  }, [autoSaveThreadToHistory, getBoundedTerminalOutputForRequest, getThread, maskChatDisplayContent, strictTerminalContextActive, summarizeSession, updateThread])

  const startGuardedStream = useCallback((
    sessionId: string,
    userContent: string,
    currentMessages: ThreadMessage[],
    userMeta?: Pick<ThreadMessage, 'display' | 'command' | 'output' | 'terminalContextSent'>
  ): boolean => {
    if (pendingStreamStartsRef.current.has(sessionId)) return false
    pendingStreamStartsRef.current.add(sessionId)
    void startStream(sessionId, userContent, currentMessages, userMeta).finally(() => {
      pendingStreamStartsRef.current.delete(sessionId)
    })
    return true
  }, [startStream])

  useEffect(() => {
    if (!blockPromptRequest || handledBlockPromptRequestRef.current === blockPromptRequest.id) return
    handledBlockPromptRequestRef.current = blockPromptRequest.id

    const thread = getThread(blockPromptRequest.sessionId)
    if (
      pendingStreamStartsRef.current.has(blockPromptRequest.sessionId) ||
      thread.streaming ||
      thread.agenticCommandRunning ||
      thread.commandConfirmation
    ) {
      updateThread(blockPromptRequest.sessionId, (thread) => ({
        ...thread,
        draft: blockPromptRequest.prompt,
        status: { tone: 'warning', label: t('status.blockPromptQueued') }
      }))
      return
    }

    startGuardedStream(blockPromptRequest.sessionId, blockPromptRequest.prompt, thread.messages)
  }, [blockPromptRequest, getThread, startGuardedStream, t, updateThread])

  const startAssistantStream = useCallback((sessionId: string, currentMessages: ThreadMessage[]) => {
    const requestMessages = stripTrailingAssistantMessages(currentMessages)
    if (requestMessages.length === 0) return

    const requestId = crypto.randomUUID()
    const thread = getThread(sessionId)
    const session = thread.session ?? (activeSessionRef.current?.id === sessionId ? summarizeSession(activeSessionRef.current) : undefined)
    const nextMessages: ThreadMessage[] = [
      ...requestMessages,
      { role: 'assistant', content: '' }
    ]
    requestSessionRef.current.set(requestId, sessionId)
    updateThread(sessionId, (thread) => ({
      ...thread,
      messages: nextMessages,
      streaming: true,
      activeRequestId: requestId,
      streamingContent: '',
      lastMaskedSecretCount: 0,
      status: null,
      agenticPending: null,
      session
    }))

    const mode = assistModeRef.current
    const terminalOutput = getBoundedTerminalOutputForRequest(sessionId, mode)
    const providerTerminalContext = getProviderTerminalContext({
      assistMode: mode,
      selectedText: selectedTextRef.current,
      terminalOutput,
      session,
      strictTerminalContextActive
    })

    window.api.llm.chatStream({
      requestId,
      provider: providerRef.current,
      messages: toConversationalChatMessages(requestMessages, strictTerminalContextActive),
      context: {
        ...providerTerminalContext,
        assistMode: mode,
        language: languageRef.current,
        taskListPlanning: chatToolsSettingsRef.current.taskListPlanning
      }
    })
    autoSaveThreadToHistory(sessionId)
  }, [autoSaveThreadToHistory, getBoundedTerminalOutputForRequest, getThread, strictTerminalContextActive, summarizeSession, updateThread])

  // Stream event handler
  const runAgenticStepRef = useRef<(sessionId: string, content: string) => Promise<void>>(async () => {})

  useEffect(() => {
    return window.api.llm.onChatStreamEvent((event: ChatStreamEvent) => {
      const sessionId = requestSessionRef.current.get(event.requestId)
      if (!sessionId) return

      if (event.type === 'chunk') {
        updateThread(sessionId, (thread) => {
          if (thread.activeRequestId !== event.requestId) return thread
          const next = [...thread.messages]
          const last = next.at(-1)
          if (isAssistantResponseMessage(last)) {
            next[next.length - 1] = { ...last, content: last.content + event.content }
          } else {
            next.push({ role: 'assistant', content: event.content ?? '' })
          }
          return {
            ...thread,
            messages: next,
            streamingContent: thread.streamingContent + event.content,
            status: null
          }
        })
      }

      if (event.type === 'reasoning') {
        updateThread(sessionId, (thread) => {
          if (thread.activeRequestId !== event.requestId) return thread
          const next = [...thread.messages]
          const last = next.at(-1)
          if (isAssistantResponseMessage(last)) {
            next[next.length - 1] = {
              ...last,
              reasoningContent: `${last.reasoningContent ?? ''}${event.content}`
            }
          } else {
            next.push({
              role: 'assistant',
              content: '',
              reasoningContent: event.content
            })
          }
          return {
            ...thread,
            messages: next,
            status: null
          }
        })
      }

      if (event.type === 'progress') {
        const percent = progressPercent(event.progress)
        updateThread(sessionId, (thread) => {
          if (thread.activeRequestId !== event.requestId) return thread
          return {
            ...thread,
            status: {
              tone: 'info',
              label: event.stage === 'model_load'
                ? t('status.modelLoading', { percent })
                : t('status.promptProcessing', { percent })
            }
          }
        })
      }

      if (event.type === 'privacy') {
        updateThread(sessionId, (thread) => {
          if (thread.activeRequestId !== event.requestId) return thread
          const messages = [...thread.messages]
          const last = messages.at(-1)
          const privacy: PrivacyMaskingNotice = {
            maskedSecretCount: event.maskedSecrets,
            categories: event.categories ?? [],
            source: event.source ?? 'chat-stream',
            scope: event.scope ?? 'provider-payload',
            sessionLabel: event.sessionLabel
          }

          if (last?.role === 'assistant' && !last.content && !last.reasoningContent && !last.display) {
            const mergedPrivacy = last.privacy ? mergePrivacyNotices(last.privacy, privacy) : privacy
            messages[messages.length - 1] = { ...last, privacy: mergedPrivacy }
          } else {
            const privacyMessageIndex = findCurrentRequestPrivacyNoticeIndex(messages)

            if (privacyMessageIndex >= 0) {
              const existing = messages[privacyMessageIndex]
              const mergedPrivacy = mergePrivacyNotices(existing.privacy!, privacy)
              messages[privacyMessageIndex] = {
                ...existing,
                content: existing.display === 'privacy-status'
                  ? t('status.privacyMasked', { count: mergedPrivacy.maskedSecretCount })
                  : existing.content,
                output: existing.display === 'privacy-status'
                  ? String(mergedPrivacy.maskedSecretCount)
                  : existing.output,
                privacy: mergedPrivacy
              }
            } else {
              messages.push({
                role: 'assistant',
                content: t('status.privacyMasked', { count: event.maskedSecrets }),
                display: 'privacy-status',
                output: String(event.maskedSecrets),
                privacy
              })
            }
          }

          return {
            ...thread,
            messages,
            lastMaskedSecretCount: event.maskedSecrets,
            status: null
          }
        })
        autoSaveThreadToHistory(sessionId)
      }

      if (event.type === 'tool') {
        const command = `${event.serverName}.${event.toolName}`
        const toolCallId = `${event.requestId}:${event.toolCallId ?? command}`
        if (event.status !== 'running') {
          const rawOutput = event.content ?? ''
          setToolResultOutputs((current) => {
            const next = new Map(current)
            if (rawOutput) next.set(toolCallId, rawOutput)
            else next.delete(toolCallId)
            return next
          })
        }
        updateThread(sessionId, (thread) => {
          if (thread.activeRequestId !== event.requestId) return thread
          const messages = [...thread.messages]
          const last = messages.at(-1)
          const content = event.status === 'running'
            ? `Calling MCP tool ${command}`
            : event.status === 'error'
              ? `MCP tool ${command} failed`
              : `MCP tool ${command} returned`
          const toolMessage: ThreadMessage = {
            role: 'assistant',
            content,
            display: 'tool-call',
            command,
            toolCallId
          }

          if (last?.display === 'tool-call' && last.toolCallId === toolCallId && event.status !== 'running') {
            messages[messages.length - 1] = toolMessage
          } else if (isEmptyAssistantDraft(last)) {
            messages[messages.length - 1] = toolMessage
          } else {
            messages.push(toolMessage)
          }

          if (event.status === 'done') {
            messages.push({ role: 'assistant', content: '' })
          }

          return {
            ...thread,
            messages,
            status: null
          }
        })
      }

      if (event.type === 'error') {
        requestSessionRef.current.delete(event.requestId)
        promptResolversRef.current.delete(sessionId)
        updateThread(sessionId, (thread) => ({
          ...thread,
          status: { tone: 'danger', label: event.message },
          streaming: false,
          activeRequestId: undefined,
          streamingContent: '',
          agenticPending: null,
          agenticRunning: false,
          agenticCommandRunning: false,
          agenticStep: 0,
          agenticCommand: ''
        }))
      }

      if (event.type === 'done') {
        const doneThread = getThread(sessionId)
        const agenticContent =
          doneThread.activeRequestId === event.requestId && doneThread.agenticRunning
            ? event.maskedContent ?? doneThread.streamingContent
            : null
        requestSessionRef.current.delete(event.requestId)
        updateThread(sessionId, (thread) => {
          if (thread.activeRequestId !== event.requestId) return thread
          const nextMessages = event.maskedContent !== undefined ? [...thread.messages] : thread.messages
          const assistantIndex = event.maskedContent !== undefined ? findLastAssistantResponseIndex(nextMessages) : -1
          const assistantMessage = assistantIndex >= 0 ? nextMessages[assistantIndex] : undefined
          if (event.maskedContent !== undefined && assistantMessage) {
            nextMessages[assistantIndex] = applyAuthoritativeAssistantContent(assistantMessage, event.maskedContent)
          } else if (event.maskedContent) {
            nextMessages.push({ role: 'assistant', content: event.maskedContent })
          }

          return {
            ...thread,
            messages: nextMessages,
            streaming: false,
            status: null,
            activeRequestId: undefined,
            agenticPending: agenticContent,
            streamingContent: ''
          }
        })
        if (agenticContent) {
          void runAgenticStepRef.current(sessionId, agenticContent)
        }
        autoSaveThreadToHistory(sessionId)
      }
    })
  }, [autoSaveThreadToHistory, getThread, t, updateThread])

  // Auto-scroll
  useEffect(() => {
    const log = chatLogRef.current
    if (log && !chatAutoScrollPausedRef.current) log.scrollTop = log.scrollHeight
  }, [agenticCommandRunning, agenticStep, commandConfirmation, messages, status, streaming])

  // Stop agentic
  const stopAgentic = useCallback((sessionId: string) => {
    commandConfirmationResolversRef.current.get(sessionId)?.(false)
    commandConfirmationResolversRef.current.delete(sessionId)
    promptResolversRef.current.get(sessionId)?.()
    promptResolversRef.current.delete(sessionId)
    runningCommandsRef.current.delete(sessionId)
    const thread = getThread(sessionId)
    const activeRequestId = thread.activeRequestId
    if (activeRequestId) requestSessionRef.current.delete(activeRequestId)
    updateThread(sessionId, (thread) => ({
      ...thread,
      commandConfirmation: null,
      streaming: false,
      activeRequestId: undefined,
      streamingContent: '',
      agenticPending: null,
      agenticRunning: false,
      agenticCommandRunning: false,
      agenticStep: 0,
      agenticCommand: ''
    }))
    if (activeRequestId) {
      const cancelChatStream = window.api.llm.cancelChatStream
      void cancelChatStream?.(activeRequestId).catch((error: unknown) => {
        console.error('Failed to cancel chat stream', error)
      })
    }
  }, [getThread, updateThread])

  const clearHistory = useCallback(() => {
    if (!activeSessionId) return
    stopAgentic(activeSessionId)
    updateThread(activeSessionId, (thread) => ({
      ...createThread(),
      draft: thread.draft,
      session: thread.session
    }))
  }, [activeSessionId, stopAgentic, updateThread])

  const loadHistoryChats = useCallback(async () => {
    const chats = await window.api.chatHistory.list()
    setHistoryChats(chats)
  }, [])

  const toggleHistory = useCallback(() => {
    if (historyOpen) {
      setHistoryOpen(false)
      setHistorySearch('')
    } else {
      void loadHistoryChats().then(() => setHistoryOpen(true))
    }
  }, [historyOpen, loadHistoryChats])

  const handleDeleteHistoryChat = useCallback((chatId: string) => {
    const chat = historyChats.find((candidate) => candidate.id === chatId)
    setDeleteConfirmation({
      title: withObjectName(t('chat.historyDeleteConfirmTitle'), chat?.title),
      message: t('chat.historyDeleteConfirmMessage'),
      confirmLabel: t('chat.historyDeleteConfirmBtn'),
      onConfirm: async () => {
        await window.api.chatHistory.delete(chatId)
        setHistoryChats((prev) => prev.filter((c) => c.id !== chatId))
      }
    })
  }, [historyChats, t])

  const handleReopenChat = useCallback((chatId: string) => {
    setHistoryOpen(false)
    setHistorySearch('')
    onReopenChat(chatId)
  }, [onReopenChat])

  const filteredHistoryChats = useMemo(() => {
    if (!historySearch.trim()) return historyChats
    const query = historySearch.toLowerCase()
    return historyChats.filter((chat) => chat.title.toLowerCase().includes(query))
  }, [historyChats, historySearch])

  const openSavePromptDialog = async (): Promise<void> => {
    const requestId = crypto.randomUUID()
    savePromptGenerationRequestIdRef.current = requestId
    setSavePromptDialog({ content: '' })
    setSavePromptName('')
    setSavePromptStatus('idle')
    setSavePromptDuplicateName(false)
    try {
      const prompt = await window.api.llm.summarizeConversation({
        requestId,
        provider: providerRef.current,
        messages: toConversationalChatMessages(messages, strictTerminalContextActive),
        language: languageRef.current
      })
      if (savePromptGenerationRequestIdRef.current !== requestId) return
      savePromptGenerationRequestIdRef.current = null
      setSavePromptName(prompt.name)
      setSavePromptDialog(prompt)
    } catch (err) {
      if (savePromptGenerationRequestIdRef.current !== requestId) return
      savePromptGenerationRequestIdRef.current = null
      setSavePromptDialog(null)
      if (activeSessionId) {
        updateThread(activeSessionId, (thread) => ({
          ...thread,
          status: statusToInlineStatus(err instanceof Error ? err.message : String(err))
        }))
      }
    }
  }

  const closeSavePromptDialog = useCallback((): void => {
    const requestId = savePromptGenerationRequestIdRef.current
    savePromptGenerationRequestIdRef.current = null
    if (requestId) void window.api.llm.cancelSummarizeConversation(requestId)
    setSavePromptDialog(null)
    setSavePromptDuplicateName(false)
  }, [])

  const handleSavePromptFromChat = async (): Promise<void> => {
    if (!savePromptName.trim() || savePromptDuplicateName) return
    setSavePromptStatus('saving')
    try {
      await window.api.prompt.save({ id: '', name: savePromptName.trim(), content: savePromptDialog!.content, createdAt: '' })
      setSavePromptStatus('saved')
      setTimeout(() => setSavePromptDialog(null), 800)
    } catch {
      setSavePromptStatus('error')
    }
  }

  useEffect(() => {
    if (!savePromptDialog || savePromptDialog.content === '') {
      setSavePromptDuplicateName(false)
      return
    }

    const name = normalizeLibraryName(savePromptName)
    if (!name) {
      setSavePromptDuplicateName(false)
      return
    }

    let cancelled = false
    void window.api.prompt.list().then((prompts) => {
      if (cancelled) return
      setSavePromptDuplicateName(prompts.some((prompt) => normalizeLibraryName(prompt.name) === name))
    }).catch(() => {
      if (!cancelled) setSavePromptDuplicateName(false)
    })

    return () => { cancelled = true }
  }, [savePromptDialog, savePromptName])

  const buildTerminalContext = useCallback((sessionId: string): TerminalContext => {
    const thread = getThread(sessionId)
    const session = thread.session ?? (activeSessionRef.current?.id === sessionId ? summarizeSession(activeSessionRef.current) : undefined)
    const terminalOutput = stripAnsi(getOutputForSessionRef.current(sessionId)).slice(-maxOutputContextRef.current)
    const providerTerminalContext = getProviderTerminalContext({
      assistMode: 'agent',
      selectedText: selectedTextRef.current,
      terminalOutput,
      session,
      strictTerminalContextActive
    })

    return {
      ...providerTerminalContext,
      assistMode: 'agent',
      language: languageRef.current,
    }
  }, [getThread, strictTerminalContextActive, summarizeSession])

  const confirmAgenticCommand = useCallback(async (sessionId: string, command: string): Promise<CommandConfirmationResult> => {
    updateThread(sessionId, (thread) => ({ ...thread, status: { tone: 'info', label: t('status.checkingSafety') } }))

    try {
      const assessment = await window.api.llm.assessCommandRisk({
        provider: providerRef.current,
        command,
        context: buildTerminalContext(sessionId)
      })

      if (!assessment.dangerous) {
        updateThread(sessionId, (thread) => ({ ...thread, status: null }))
        return command
      }

      const riskLevel = assessment.riskLevel ?? 'warning'
      updateThread(sessionId, (thread) => ({ ...thread, status: null }))
      const confirmed = await requestCommandConfirmation(sessionId, {
        title: t('confirm.reviewRisky'),
        reason: localizeCommandRiskReason(assessment, t),
        command,
        tone: riskLevel === 'danger' ? 'danger' : 'warning',
        confirmLabel: t('confirm.runAnyway'),
        riskLevel
      })

      if (!confirmed) {
        appendSystemStatus(sessionId, t('confirm.commandRejected', { command }))
        updateThread(sessionId, (thread) => ({ ...thread, status: { tone: 'warning', label: t('status.agentStopped.riskyCommand') } }))
        stopAgentic(sessionId)
        return false
      }

      appendSystemStatus(sessionId, t('confirm.commandApproved', { command: String(confirmed) }))
      updateThread(sessionId, (thread) => ({ ...thread, status: { tone: 'warning', label: t('status.riskyCommandConfirmed') } }))
      return confirmed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateThread(sessionId, (thread) => ({ ...thread, status: null }))
      const confirmed = await requestCommandConfirmation(sessionId, {
        title: t('confirm.safetyUnavailable'),
        reason: message,
        command,
        tone: 'warning',
        confirmLabel: t('confirm.runAnyway'),
        riskLevel: 'warning'
      })

      if (!confirmed) {
        appendSystemStatus(sessionId, t('confirm.commandRejected', { command }))
        updateThread(sessionId, (thread) => ({ ...thread, status: { tone: 'warning', label: t('status.agentStopped.safetyUnchecked') } }))
        stopAgentic(sessionId)
        return false
      }

      appendSystemStatus(sessionId, t('confirm.commandApproved', { command: String(confirmed) }))
      updateThread(sessionId, (thread) => ({ ...thread, status: { tone: 'warning', label: t('status.safetyFailedConfirmed') } }))
      return confirmed
    }
  }, [appendSystemStatus, buildTerminalContext, requestCommandConfirmation, stopAgentic, t, updateThread])

  // Agentic step runner (ref-based to avoid stale closures)
  const runAgenticStep = useCallback(async (sessionId: string, content: string) => {
    if (!getThread(sessionId).agenticRunning) return

    const proposedCommand = extractFirstCommand(content)
    if (!proposedCommand) {
      stopAgentic(sessionId)
      return
    }

    const session = getThread(sessionId).session
    if (!session) {
      stopAgentic(sessionId)
      return
    }

    if (runningCommandsRef.current.has(sessionId) || getThread(sessionId).agenticCommandRunning) {
      updateThread(sessionId, (thread) => ({
        ...thread,
        status: { tone: 'info', label: t('status.commandAlreadyRunning') }
      }))
      return
    }

    const nextStep = getThread(sessionId).agenticStep + 1
    if (nextStep > 10) {
      updateThread(sessionId, (thread) => ({ ...thread, status: { tone: 'info', label: t('status.agentStopped.tenSteps') } }))
      stopAgentic(sessionId)
      return
    }

    updateThread(sessionId, (thread) => ({
      ...thread,
      agenticPending: null,
      agenticCommandRunning: true,
      agenticStep: nextStep,
      agenticCommand: proposedCommand
    }))

    const command = await confirmAgenticCommand(sessionId, proposedCommand)
    if (!command || !getThread(sessionId).agenticRunning) return
    appendCommandEditNotice(sessionId, proposedCommand, command)
    updateThread(sessionId, (thread) => ({ ...thread, agenticCommand: command }))

    const beforeOutput = getOutputForSessionRef.current(sessionId)

    // Wait for the shell prompt that is emitted after the command finishes.
    let finishPromptWait = (): void => {}
    const promptPromise = new Promise<void>((resolve) => {
      const finish = (): void => {
        promptResolversRef.current.delete(sessionId)
        resolve()
      }
      finishPromptWait = finish
      promptResolversRef.current.set(sessionId, finish)
    })

    runningCommandsRef.current.add(sessionId)
    await window.api.command.approve(session.id, command)
    void window.api.command.runConfirmed(session.id, command).catch((error: unknown) => {
      updateThread(sessionId, (thread) => ({ ...thread, status: { tone: 'danger', label: `Command failed: ${error instanceof Error ? error.message : String(error)}` } }))
      stopAgentic(sessionId)
      finishPromptWait()
    })

    await promptPromise

    if (!getThread(sessionId).agenticRunning) return

    runningCommandsRef.current.delete(sessionId)
    const afterOutput = getOutputForSessionRef.current(sessionId)
    const cleanedOutput = cleanCommandOutput(command, getTerminalDelta(beforeOutput, afterOutput)).slice(-maxOutputContextRef.current)
    const output = await window.api.secret.maskOutput(session.id, cleanedOutput).catch(() => (
      '[command output hidden because secret masking failed]'
    ))
    updateThread(sessionId, (thread) => ({ ...thread, agenticCommandRunning: false }))
    const continuation = buildAgentContinuation(command, output, strictTerminalContextActive)

    void startStream(sessionId, continuation, getThread(sessionId).messages, {
      display: 'command-output',
      command,
      output,
      terminalContextSent: !strictTerminalContextActive
    })
  }, [appendCommandEditNotice, confirmAgenticCommand, getThread, strictTerminalContextActive, stopAgentic, startStream, t, updateThread])

  // Keep ref updated
  useEffect(() => { runAgenticStepRef.current = runAgenticStep }, [runAgenticStep])

  // Send user message
  const sendMessage = useCallback(() => {
    const session = activeSessionRef.current
    if (!session) return
    const sessionId = session.id
    const thread = getThread(sessionId)
    const content = draft.trim()
    if (!content || streaming || commandConfirmation) return
    if (pendingStreamStartsRef.current.has(sessionId)) return
    if (thread.agenticCommandRunning || runningCommandsRef.current.has(sessionId)) {
      updateThread(sessionId, (thread) => ({
        ...thread,
        status: { tone: 'info', label: t('status.commandAlreadyRunning') }
      }))
      return
    }

    const canExecute = isLiveSessionStatus(session.status)
    if (assistModeRef.current === 'agent' && canExecute) {
      promptResolversRef.current.delete(sessionId)
      updateThread(sessionId, (thread) => ({
        ...thread,
        agenticRunning: true,
        agenticCommandRunning: false,
        agenticStep: 0,
        agenticCommand: '',
        agenticPending: null,
        status: null,
        session: summarizeSession(session)
      }))
    }

    chatAutoScrollPausedRef.current = false
    updateThread(sessionId, (thread) => ({
      ...thread,
      draft: '',
      session: summarizeSession(session),
      status: assistModeRef.current === 'agent' && !canExecute
        ? { tone: 'info', label: t('status.disconnected.run') }
        : thread.status
    }))
    startGuardedStream(sessionId, content, thread.messages)
  }, [commandConfirmation, draft, getThread, streaming, startGuardedStream, summarizeSession, t, updateThread])

  const regenerateMessage = useCallback((messageIndex: number) => {
    const session = activeSessionRef.current
    if (!session || streaming || commandConfirmation) return
    const sessionId = session.id
    const thread = getThread(sessionId)
    if (thread.agenticCommandRunning || runningCommandsRef.current.has(sessionId)) return
    const message = thread.messages[messageIndex]
    if (!message || message.role !== 'assistant') return

    const baseMessages = stripTrailingAssistantMessages(thread.messages.slice(0, messageIndex))
    if (baseMessages.length === 0) return
    const canExecute = isLiveSessionStatus(session.status)
    const shouldRunAgentic = assistModeRef.current === 'agent' && canExecute
    if (shouldRunAgentic) {
      promptResolversRef.current.delete(sessionId)
    }

    updateThread(sessionId, (thread) => ({
      ...thread,
      messages: baseMessages,
      agenticRunning: shouldRunAgentic,
      agenticCommandRunning: false,
      agenticStep: 0,
      agenticCommand: '',
      agenticPending: null,
      status: assistModeRef.current === 'agent' && !canExecute
        ? { tone: 'info', label: t('status.disconnected.run') }
        : null,
      savedChatId: undefined,
      session: summarizeSession(session)
    }))
    startAssistantStream(sessionId, baseMessages)
  }, [commandConfirmation, getThread, startAssistantStream, streaming, summarizeSession, t, updateThread])

  const forkChatFromMessage = useCallback((messageIndex: number) => {
    const session = activeSessionRef.current
    if (!session || streaming || commandConfirmation) return
    const sessionId = session.id
    const thread = getThread(sessionId)
    if (thread.agenticCommandRunning || runningCommandsRef.current.has(sessionId)) return
    if (!thread.messages[messageIndex]) return

    saveThreadSnapshotToHistory(thread)
    const forkedMessages = thread.messages.slice(0, messageIndex + 1)
    updateThread(sessionId, (thread) => ({
      ...thread,
      messages: forkedMessages,
      activeRequestId: undefined,
      streaming: false,
      streamingContent: '',
      agenticPending: null,
      agenticRunning: false,
      agenticCommandRunning: false,
      agenticStep: 0,
      agenticCommand: '',
      commandConfirmation: null,
      savedChatId: undefined,
      status: { tone: 'info', label: t('chat.forked') },
      session: summarizeSession(session)
    }))
  }, [commandConfirmation, getThread, saveThreadSnapshotToHistory, streaming, summarizeSession, t, updateThread])

  // Run command inline from MessageContent
  const runCommand = useCallback(async (command: string) => {
    const session = activeSessionRef.current
    if (!session || !isLiveSessionStatus(session.status)) {
      if (activeSessionId) {
        updateThread(activeSessionId, (thread) => ({
          ...thread,
          status: { tone: 'info', label: session ? t('status.disconnected.run') : t('status.noSession.run') }
        }))
      }
      return
    }

    if (runningCommandsRef.current.has(session.id) || getThread(session.id).agenticCommandRunning) {
      updateThread(session.id, (thread) => ({
        ...thread,
        status: { tone: 'info', label: t('status.commandAlreadyRunning') }
      }))
      return
    }

    const confirmedCommand = await confirmAgenticCommand(session.id, command)
    if (!confirmedCommand) return
    appendCommandEditNotice(session.id, command, confirmedCommand)

    runningCommandsRef.current.add(session.id)
    updateThread(session.id, (thread) => ({
      ...thread,
      agenticCommandRunning: true,
      agenticCommand: confirmedCommand,
      status: null
    }))

    let finishPromptWait = (): void => {}
    const promptPromise = new Promise<void>((resolve) => {
      const finish = (): void => {
        promptResolversRef.current.delete(session.id)
        resolve()
      }
      finishPromptWait = finish
      promptResolversRef.current.set(session.id, finish)
    })

    await window.api.command.approve(session.id, confirmedCommand)
    void window.api.command.runConfirmed(session.id, confirmedCommand).catch((error: unknown) => {
      updateThread(session.id, (thread) => ({
        ...thread,
        status: { tone: 'danger', label: `Command failed: ${error instanceof Error ? error.message : String(error)}` }
      }))
      finishPromptWait()
    })

    await promptPromise
    runningCommandsRef.current.delete(session.id)
    updateThread(session.id, (thread) => ({
      ...thread,
      agenticCommandRunning: false,
      agenticCommand: ''
    }))
  }, [activeSessionId, appendCommandEditNotice, confirmAgenticCommand, getThread, t, updateThread])

  const applySavedProviderResult = useCallback((
    result: AppConfig,
    options: { savedApiKey?: string; savedSecretDraft?: boolean } = {}
  ): void => {
    const savedProvider = result.providers.find((candidate) => candidate.apiKeyRef === provider.apiKeyRef) ?? provider
    if (options.savedSecretDraft) {
      setProviderConnectionStates((current) => {
        const next = { ...current }
        delete next[getProviderStatusKey(provider)]
        delete next[getProviderStatusKey(savedProvider)]
        return next
      })
    }
    setProvider(savedProvider)
    setAllProviders(result.providers)
    setActiveProviderRef(result.activeProviderRef ?? provider.apiKeyRef)
    if (draftProviderRef === savedProvider.apiKeyRef) {
      setDraftProviderRef(null)
    }
    setApiKey('')
    setProxyPassword('')
    setEditingProxyPassword(false)
    if (options.savedApiKey?.trim()) {
      providerSecretCheckVersionRef.current += 1
      if (savedProvider.apiKeyRef !== provider.apiKeyRef) {
        optimisticApiKeyRef.current = savedProvider.apiKeyRef
      }
      setCheckedApiKeyRef(savedProvider.apiKeyRef)
      setHasApiKey(true)
      setProviderKeyAvailability((current) => ({ ...current, [savedProvider.apiKeyRef]: true }))
      setProviderSecretsLoaded(true)
    }
    setHasProxyPassword(Boolean(savedProvider.proxyPasswordRef))
  }, [draftProviderRef, provider])

  const saveProvider = useCallback(async () => {
    if (!isValidProviderBaseUrl(provider.baseUrl)) {
      setProviderStatus('Enter a valid http:// or https:// Base URL')
      return
    }
    if (!isValidProviderProxyUrl(provider.proxyUrl)) {
      setProviderStatus('Enter a valid http:// or https:// proxy URL without credentials')
      return
    }
    setProviderStatus('Saving...')
    try {
      const request = {
        provider,
        apiKey,
        ...(editingProxyPassword || proxyPassword ? { proxyPassword } : {})
      }
      const result = await window.api.llm.saveProvider(request)
      applySavedProviderResult(result, {
        savedApiKey: apiKey,
        savedSecretDraft: Boolean(apiKey.trim() || editingProxyPassword || proxyPassword)
      })
      setEditingApiKey(false)
      setProviderStatus(t('status.saved'))
    } catch (error) {
      setProviderStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [apiKey, applySavedProviderResult, editingProxyPassword, provider, proxyPassword, t])

  const saveProxySettings = useCallback(async (nextProxyPassword?: string) => {
    if (!isValidProviderProxyUrl(provider.proxyUrl)) {
      setProviderStatus('Enter a valid http:// or https:// proxy URL without credentials')
      return
    }
    setProviderStatus('Saving proxy...')
    try {
      const shouldSendProxyPassword = nextProxyPassword !== undefined || editingProxyPassword || proxyPassword
      const result = await window.api.llm.saveProvider({
        provider,
        apiKey,
        ...(shouldSendProxyPassword ? { proxyPassword: nextProxyPassword ?? proxyPassword } : {})
      })
      applySavedProviderResult(result, {
        savedApiKey: apiKey,
        savedSecretDraft: Boolean(apiKey.trim() || shouldSendProxyPassword)
      })
      setProviderStatus(t('status.saved'))
    } catch (error) {
      setProviderStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [apiKey, applySavedProviderResult, editingProxyPassword, provider, proxyPassword, t])

  const switchProvider = useCallback((target: LLMProviderConfig) => {
    if (draftProviderRef && target.apiKeyRef !== draftProviderRef) {
      setAllProviders((providers) => providers.filter((candidate) => candidate.apiKeyRef !== draftProviderRef))
      setDraftProviderRef(null)
    }
    setProvider(target)
    setModels([])
    setProxyPassword('')
    setEditingApiKey(false)
    setEditingProxyPassword(false)
    setHasApiKey(false)
    setProviderSecretsLoaded(false)
    setHasProxyPassword(Boolean(target.proxyPasswordRef))
    setProviderStatus('')
    if (target.apiKeyRef === draftProviderRef) return
    setActiveProviderRef(target.apiKeyRef)
    void window.api.llm.saveProvider({ provider: target }).then((result) => {
      setAllProviders(result.providers)
      setActiveProviderRef(result.activeProviderRef ?? target.apiKeyRef)
    }).catch((err: unknown) => {
      setProviderStatus(`Switch failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [draftProviderRef])

  const addProvider = useCallback(() => {
    const nextProvider: LLMProviderConfig = {
      name: providerTypeDefaults.openai.name,
      providerType: 'openai',
      baseUrl: providerTypeDefaults.openai.baseUrl,
      apiKeyRef: `provider-${crypto.randomUUID()}`,
      selectedModel: '',
      commandRiskModel: ''
    }
    setProvider(nextProvider)
    setAllProviders((providers) => {
      const withoutCurrentDraft = draftProviderRef
        ? providers.filter((candidate) => candidate.apiKeyRef !== draftProviderRef)
        : providers
      return upsertProviderInOrder(withoutCurrentDraft, nextProvider)
    })
    setDraftProviderRef(nextProvider.apiKeyRef)
    setModels([])
    setApiKey('')
    setProxyPassword('')
    setEditingApiKey(false)
    setEditingProxyPassword(false)
    setHasApiKey(false)
    setHasProxyPassword(false)
    setProviderStatus('')
  }, [draftProviderRef])

  const handleDeleteProvider = useCallback((apiKeyRef: string) => {
    if (apiKeyRef === draftProviderRef) {
      const nextProviders = allProviders.filter((candidate) => candidate.apiKeyRef !== apiKeyRef)
      const next = nextProviders.find((candidate) => candidate.apiKeyRef === activeProviderRef) ??
        nextProviders[0] ??
        defaultProvider
      setAllProviders(nextProviders.length > 0 ? nextProviders : [defaultProvider])
      setDraftProviderRef(null)
      setProvider(next)
      setModels([])
      setApiKey('')
      setProxyPassword('')
      setEditingApiKey(false)
      setEditingProxyPassword(false)
      setHasApiKey(false)
      setHasProxyPassword(Boolean(next.proxyPasswordRef))
      setProviderStatus('')
      return
    }
    const target = allProviders.find((candidate) => candidate.apiKeyRef === apiKeyRef)
    setDeleteConfirmation({
      title: withObjectName(t('providers.deleteConfirmTitle'), target?.name),
      message: t('providers.deleteConfirmMessage'),
      confirmLabel: t('providers.deleteConfirmBtn'),
      onConfirm: async () => {
        try {
          const result = await window.api.llm.deleteProvider(apiKeyRef)
          setAllProviders(result.providers)
          setActiveProviderRef(result.activeProviderRef ?? result.providers[0]?.apiKeyRef ?? defaultProvider.apiKeyRef)
          if (provider.apiKeyRef === apiKeyRef) {
            const next = result.providers[0] ?? defaultProvider
            setProvider(next)
            setModels([])
            setProxyPassword('')
            setEditingProxyPassword(false)
            setHasProxyPassword(Boolean(next.proxyPasswordRef))
          }
        } catch (error) {
          setProviderStatus(`Delete failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })
  }, [activeProviderRef, allProviders, draftProviderRef, provider.apiKeyRef, t])

  const loadSshProfiles = useCallback(async () => {
    const profiles = await window.api.ssh.listProfiles()
    setSshProfiles(profiles)
    if (profiles.length > 0 && !sshProfile) {
      setSshProfile(profiles[0])
    }
  }, [sshProfile])

  useEffect(() => {
    void loadSshProfiles()
  }, [loadSshProfiles])

  const loadMcpServers = useCallback(async () => {
    try {
      setMcpServers(await window.api.mcp.listServers())
    } catch (error) {
      setMcpStatus(`Load failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  useEffect(() => {
    void loadMcpServers()
  }, [loadMcpServers])

  const loadDataUsage = useCallback(async () => {
    try {
      setDataUsage(await window.api.data.usage())
    } catch {
      setDataUsage(null)
    }
  }, [])

  useEffect(() => {
    if (settingsOpen && settingsTab === 'data') {
      void loadDataUsage()
    }
  }, [loadDataUsage, settingsOpen, settingsTab])

  const editMcpServer = useCallback((server: McpServerConfig) => {
    setMcpDraft(server)
    setMcpArgsDraft(formatMcpArgs(server.args))
    setMcpEnvDraft(formatMcpEnv(server.env))
    setMcpStatus('')
  }, [])

  const addMcpServer = useCallback(() => {
    const next = createEmptyMcpServer()
    setMcpDraft(next)
    setMcpArgsDraft('')
    setMcpEnvDraft('')
    setMcpStatus('')
  }, [])

  const saveMcpServer = useCallback(async (enabledOverride?: boolean) => {
    const name = mcpDraft.name.trim()
    const command = mcpDraft.command.trim()
    if (!name || !command) {
      setMcpStatus(t('mcp.status.required'))
      return
    }
    if (mcpServers.some((server) => server.id !== mcpDraft.id && server.name.trim().toLowerCase() === name.toLowerCase())) {
      setMcpStatus(t('mcp.status.duplicateName'))
      return
    }

    setMcpStatus(t('mcp.status.saving'))
    try {
      const now = new Date().toISOString()
      const result = await window.api.mcp.saveServer({
        ...mcpDraft,
        enabled: enabledOverride ?? mcpDraft.enabled,
        name,
        command,
        args: parseMcpArgs(mcpArgsDraft),
        env: parseMcpEnv(mcpEnvDraft),
        source: mcpDraft.source ?? 'manual',
        updatedAt: now,
        createdAt: mcpDraft.createdAt || now
      })
      setMcpServers(result)
      setMcpStatus(t('status.saved'))
    } catch (error) {
      setMcpStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [mcpArgsDraft, mcpDraft, mcpEnvDraft, mcpServers, t])

  const setMcpServerEnabled = useCallback(async (enabled: boolean) => {
    setMcpDraft((draft) => ({ ...draft, enabled }))
    if (!mcpServers.some((server) => server.id === mcpDraft.id)) return
    await saveMcpServer(enabled)
  }, [mcpDraft.id, mcpServers, saveMcpServer])

  const refreshMcpTools = useCallback(async (server: McpServerConfig) => {
    setMcpRefreshingTools(true)
    setMcpStatus(t('mcp.tools.refreshing'))
    try {
      const result = await window.api.mcp.refreshTools(server.id)
      setMcpServers(result)
      const updated = result.find((candidate) => candidate.id === server.id)
      if (updated) setMcpDraft(updated)
      setMcpStatus(t('mcp.tools.refreshed', { count: updated?.tools?.length ?? 0 }))
    } catch (error) {
      setMcpStatus(`Tool refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setMcpRefreshingTools(false)
    }
  }, [t])

  const toggleMcpTool = useCallback(async (serverId: string, toolName: string, enabled: boolean) => {
    try {
      const result = await window.api.mcp.setToolEnabled(serverId, toolName, enabled)
      setMcpServers(result)
      const updated = result.find((server) => server.id === serverId)
      if (updated && mcpDraft.id === serverId) setMcpDraft(updated)
    } catch (error) {
      setMcpStatus(`Tool update failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [mcpDraft.id])

  const deleteMcpServer = useCallback((id: string) => {
    const target = mcpServers.find((server) => server.id === id)
    setDeleteConfirmation({
      title: withObjectName(t('mcp.deleteConfirmTitle'), target?.name),
      message: t('mcp.deleteConfirmMessage'),
      confirmLabel: t('mcp.deleteConfirmBtn'),
      onConfirm: async () => {
        const result = await window.api.mcp.deleteServer(id)
        setMcpServers(result)
        if (mcpDraft.id === id) {
          addMcpServer()
        }
      }
    })
  }, [addMcpServer, mcpDraft.id, mcpServers, t])

  const discoverMcpServers = useCallback(async () => {
    setMcpDiscovering(true)
    setMcpStatus(t('mcp.status.discovering'))
    try {
      const result = await window.api.mcp.discoverExternal()
      setDiscoveredMcpServers(result.servers)
      setSelectedDiscoveredMcpIds([])
      const warningSuffix = result.warnings.length > 0 ? ` ${result.warnings.length} warning(s).` : ''
      setMcpStatus(result.servers.length > 0
        ? `${result.servers.length} MCP server(s) found.${warningSuffix}`
        : `${t('mcp.status.noneFound')}${warningSuffix}`)
    } catch (error) {
      setMcpStatus(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setMcpDiscovering(false)
    }
  }, [t])

  const toggleDiscoveredMcp = useCallback((key: string) => {
    setSelectedDiscoveredMcpIds((current) => current.includes(key)
      ? current.filter((candidate) => candidate !== key)
      : [...current, key])
  }, [])

  const importSelectedMcpServers = useCallback(async () => {
    const selected = discoveredMcpServers.filter((server) => selectedDiscoveredMcpIds.includes(getDiscoveredMcpKey(server)))
    if (selected.length === 0) {
      setMcpStatus(t('mcp.status.selectImport'))
      return
    }

    setMcpStatus(t('mcp.status.importing'))
    try {
      const result = await window.api.mcp.importServers(selected)
      setMcpServers(result.servers)
      setDiscoveredMcpServers([])
      setSelectedDiscoveredMcpIds([])
      setMcpStatus(`Imported ${result.imported} server(s), skipped ${result.skipped}.`)
    } catch (error) {
      setMcpStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [discoveredMcpServers, selectedDiscoveredMcpIds, t])

  const addSshProfile = useCallback(() => {
    const newProfile: SSHProfileConfig = {
      id: `ssh-${crypto.randomUUID()}`,
      name: '',
      host: ''
    }
    setSshProfile(newProfile)
  }, [])

  const saveSshProfile = useCallback(async () => {
    if (!sshProfile) return
    if (!isValidSshPort(sshProfile.port)) return
    const result = await window.api.ssh.saveProfile(sshProfile)
    setSshProfiles(result.sshProfiles ?? [])
  }, [sshProfile])

  const commitSshPort = useCallback(() => {
    setSshProfile((profile) => profile ? { ...profile, port: clampSshPort(profile.port) } : profile)
  }, [])

  const chooseSshIdentityFile = useCallback(async () => {
    const filePath = await window.api.ssh.chooseIdentityFile()
    if (!filePath) return
    setSshProfile((profile) => profile ? { ...profile, identityFile: filePath } : profile)
  }, [])

  const deleteSshProfile = useCallback((id: string) => {
    const target = sshProfiles.find((candidate) => candidate.id === id)
    setDeleteConfirmation({
      title: withObjectName(t('connections.deleteConfirmTitle'), target?.name || target?.host),
      message: t('connections.deleteConfirmMessage'),
      confirmLabel: t('connections.deleteConfirmBtn'),
      onConfirm: async () => {
        await window.api.ssh.deleteProfile(id)
        setSshProfiles((prev) => prev.filter((p) => p.id !== id))
        if (sshProfile?.id === id) {
          setSshProfile(null)
        }
      }
    })
  }, [sshProfile, sshProfiles, t])

  const connectSshProfile = useCallback((profile: SSHProfileConfig) => {
    onConnectSsh(profile)
    onCloseSettings()
  }, [onConnectSsh, onCloseSettings])

  // Load models
  const loadModels = useCallback(async () => {
    if (loadingModelsRef.current) return
    const providerStatusKey = getProviderStatusKey(provider)
    if (!isValidProviderBaseUrl(provider.baseUrl)) {
      setProviderStatus('Enter a valid http:// or https:// Base URL')
      setProviderConnectionStates((current) => ({ ...current, [providerStatusKey]: 'error' }))
      return
    }
    if (!isValidProviderProxyUrl(provider.proxyUrl)) {
      setProviderStatus('Enter a valid http:// or https:// proxy URL without credentials')
      setProviderConnectionStates((current) => ({ ...current, [providerStatusKey]: 'error' }))
      return
    }
    loadingModelsRef.current = true
    setIsTestingProvider(true)
    setProviderConnectionStates((current) => ({ ...current, [providerStatusKey]: 'checking' }))
    setProviderStatus('Testing connection...')
    try {
      const result = await window.api.llm.listModels({
        provider,
        apiKey,
        ...(editingProxyPassword || proxyPassword ? { proxyPassword } : {})
      })
      setModels(result.models)
      setProvider(result.provider)
      setAllProviders((providers) => upsertProviderInOrder(providers, result.provider))
      if (!editingProxyPassword && !proxyPassword) {
        setHasProxyPassword(Boolean(result.provider.proxyPasswordRef))
      }
      setProviderConnectionStates((current) => {
        const nextStatusKey = getProviderStatusKey(result.provider)
        const next = { ...current, [nextStatusKey]: 'ready' as const }
        if (nextStatusKey !== providerStatusKey) {
          delete next[providerStatusKey]
        }
        return next
      })
      if (getProviderStatusKey(providerRef.current) === providerStatusKey) {
        setProviderStatus(`${result.models.length} models loaded`)
      }
    } catch (error) {
      setProviderConnectionStates((current) => ({ ...current, [providerStatusKey]: 'error' }))
      if (getProviderStatusKey(providerRef.current) === providerStatusKey) {
        setProviderStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      loadingModelsRef.current = false
      setIsTestingProvider(false)
    }
  }, [apiKey, editingProxyPassword, provider, proxyPassword])

  const updateProvider = useCallback((updated: LLMProviderConfig) => {
    setProvider(updated)
    setAllProviders((providers) => upsertProviderInOrder(providers, updated))
    if (updated.apiKeyRef === draftProviderRef) return
    void window.api.llm.saveProvider({ provider: updated }).then((result) => {
      setAllProviders(result.providers)
      setActiveProviderRef(result.activeProviderRef ?? updated.apiKeyRef)
    }).catch((err: unknown) => {
      setProviderStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [draftProviderRef])

  const availableModelOptions = useMemo(() => {
    if (!provider.selectedModel || models.some((model) => model.id === provider.selectedModel)) {
      return models
    }

    return [{ id: provider.selectedModel }, ...models]
  }, [models, provider.selectedModel])

  const openModelSwitcher = useCallback(() => {
    setModelSwitcherOpen(true)
    void loadModels()
  }, [loadModels])

  const selectChatModel = useCallback((modelId: string) => {
    setModelSwitcherOpen(false)
    updateProvider({ ...providerRef.current, selectedModel: modelId })
  }, [updateProvider])

  const modelSwitchActions = useMemo<CommandPaletteAction[]>(() => {
    if (availableModelOptions.length === 0) {
      return [{
        id: 'model:load',
        title: t('model.loadFirst'),
        description: providerStatus || t('model.switch.loadDescription'),
        category: t('model.switch.category'),
        disabled: true,
        keywords: ['model', 'provider', 'llm']
      }]
    }

    return availableModelOptions.map((model) => {
      const selected = model.id === provider.selectedModel
      return {
        id: `model:${model.id}`,
        title: formatModelDisplay(model.id),
        description: selected ? t('model.switch.current') : t('model.switch.choose'),
        category: t('model.switch.category'),
        keywords: ['model', 'switch', 'provider', model.id, model.ownedBy ?? '']
      }
    })
  }, [availableModelOptions, provider.selectedModel, providerStatus, t])

  const saveSecretMaskingSettings = useCallback((settings: SecretMaskingSettings) => {
    setSecretMaskingSettings(settings)
    setSecurityStatus('')
    void window.api.config.setSecretMaskingSettings(settings).then((result) => {
      setSecretMaskingSettings(result.secretMasking ?? settings)
    }).catch((err: unknown) => {
      setSecurityStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [])

  const toggleTelemetry = useCallback(() => {
    const nextEnabled = !(telemetrySettings?.enabled ?? false)
    void window.api.config.setTelemetrySettings({
      enabled: nextEnabled,
      consentDecision: nextEnabled ? 'granted' : 'denied'
    }).then((result) => {
      setTelemetrySettings(result.telemetry ?? null)
    }).catch((err: unknown) => {
      setSecurityStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [telemetrySettings])

  const saveChatToolsSettings = useCallback((settings: ChatToolsSettings) => {
    // Optimistic update; reconcile with the persisted value the main process returns.
    setChatToolsSettings(settings)
    void window.api.config.setChatToolsSettings(settings).then((result) => {
      setChatToolsSettings(result.chatTools ?? settings)
    }).catch(() => {
      // Keep the optimistic value if persistence failed; the next config load reconciles it.
    })
  }, [])

  const updateSecretMaskingMode = useCallback((mode: SecretMaskingMode) => {
    saveSecretMaskingSettings({
      ...secretMaskingSettings,
      mode
    })
  }, [saveSecretMaskingSettings, secretMaskingSettings])

  const updateSecretMaskingSetting = useCallback((
    updater: (settings: SecretMaskingSettings) => SecretMaskingSettings
  ) => {
    saveSecretMaskingSettings(updater(secretMaskingSettings))
  }, [saveSecretMaskingSettings, secretMaskingSettings])

  const toggleSecretProtection = useCallback(() => {
    if (hasActiveSecretProtection(secretMaskingSettings)) {
      updateSecretMaskingMode('off')
      return
    }

    updateSecretMaskingSetting(activateSecretProtectionDefaults)
  }, [secretMaskingSettings, updateSecretMaskingMode, updateSecretMaskingSetting])

  const addCustomSecretPattern = useCallback(() => {
    const name = customPatternName.trim()
    const pattern = customPatternRegex.trim()
    if (!name || !pattern) {
      setCustomPatternError(t('security.customPatterns.required'))
      return
    }

    try {
      new RegExp(pattern)
    } catch {
      setCustomPatternError(t('security.customPatterns.invalid'))
      return
    }
    if (!isSafeCustomSecretPatternSource(pattern)) {
      setCustomPatternError(t('security.customPatterns.unsafe'))
      return
    }

    const customPattern: SecretMaskingCustomPattern = {
      id: crypto.randomUUID(),
      name,
      pattern,
      enabled: true,
      createdAt: new Date().toISOString()
    }
    updateSecretMaskingSetting((settings) => ({
      ...settings,
      customPatterns: [...settings.customPatterns, customPattern]
    }))
    setCustomPatternName('')
    setCustomPatternRegex('')
    setCustomPatternError('')
    setSecurityStatus(t('status.saved'))
  }, [customPatternName, customPatternRegex, t, updateSecretMaskingSetting])

  const toggleCustomSecretPattern = useCallback((patternId: string) => {
    updateSecretMaskingSetting((settings) => ({
      ...settings,
      customPatterns: settings.customPatterns.map((pattern) => (
        pattern.id === patternId ? { ...pattern, enabled: !pattern.enabled } : pattern
      ))
    }))
  }, [updateSecretMaskingSetting])

  const deleteCustomSecretPattern = useCallback((patternId: string) => {
    updateSecretMaskingSetting((settings) => ({
      ...settings,
      customPatterns: settings.customPatterns.filter((pattern) => pattern.id !== patternId)
    }))
  }, [updateSecretMaskingSetting])

  const clearSecretAuditEvents = useCallback(() => {
    void window.api.secret.clearAuditEvents().then(() => {
      setSecretAuditEvents([])
    }).catch((err: unknown) => {
      setSecurityStatus(`Clear failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [])

  const handleTextSizeChange = useCallback((value: string) => {
    setTextSizeDraft(value)

    const parsed = Number(value)
    if (isValidTextSize(value)) {
      onTextSizeChange(parsed)
    }
  }, [onTextSizeChange])

  const commitTextSizeDraft = useCallback(() => {
    const nextTextSize = clampTextSize(textSizeDraft, textSize)
    setTextSizeDraft(String(nextTextSize))
    onTextSizeChange(nextTextSize)
  }, [onTextSizeChange, textSize, textSizeDraft])

  const handleLineHeightChange = useCallback((value: string) => {
    setLineHeightDraft(value)

    const parsed = Number(value)
    if (isValidLineHeight(value)) {
      onTerminalLineHeightChange(parsed)
    }
  }, [onTerminalLineHeightChange])

  const commitLineHeightDraft = useCallback(() => {
    const nextLineHeight = clampLineHeight(lineHeightDraft, terminalLineHeight)
    setLineHeightDraft(String(nextLineHeight))
    onTerminalLineHeightChange(nextLineHeight)
  }, [lineHeightDraft, onTerminalLineHeightChange, terminalLineHeight])

  const handleScrollbackChange = useCallback((value: string) => {
    setScrollbackDraft(value)

    const parsed = Number(value)
    if (isValidScrollback(value)) {
      onTerminalScrollbackChange(parsed)
    }
  }, [onTerminalScrollbackChange])

  const commitScrollbackDraft = useCallback(() => {
    const nextScrollback = clampScrollback(scrollbackDraft, terminalScrollback)
    setScrollbackDraft(String(nextScrollback))
    onTerminalScrollbackChange(nextScrollback)
  }, [onTerminalScrollbackChange, scrollbackDraft, terminalScrollback])

  const handleMaxOutputContextChange = useCallback((value: string) => {
    setMaxOutputContextDraft(value)

    const parsed = parseInt(value, 10)
    if (isValidOutputContext(value)) {
      onMaxOutputContextChange(parsed)
    }
  }, [onMaxOutputContextChange])

  const commitMaxOutputContextDraft = useCallback(() => {
    const nextMaxOutputContext = clampOutputContext(maxOutputContextDraft, maxOutputContext)
    setMaxOutputContextDraft(String(nextMaxOutputContext))
    onMaxOutputContextChange(nextMaxOutputContext)
  }, [maxOutputContext, maxOutputContextDraft, onMaxOutputContextChange])

  const handleExport = useCallback(async () => {
    setDataStatus('Exporting...')
    try {
      await window.api.data.export({
        textSize,
        sidebarWidth,
        language,
        themeId,
        terminalFontFamily,
        terminalCursorStyle,
        terminalCursorBlink,
        terminalLineHeight,
        terminalScrollback,
        windowOpacity
      })
      setDataStatus('Export complete')
      setTimeout(() => setDataStatus(''), 3000)
    } catch (error) {
      setDataStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [sidebarWidth, textSize, language, themeId, terminalFontFamily, terminalCursorStyle, terminalCursorBlink, terminalLineHeight, terminalScrollback, windowOpacity])

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
      if (result.preferences?.themeId) onThemeChange(result.preferences.themeId)
      if (isTerminalFontOption(result.preferences?.terminalFontFamily)) {
        onTerminalFontFamilyChange(result.preferences.terminalFontFamily)
      }
      if (isTerminalCursorStyle(result.preferences?.terminalCursorStyle)) {
        onTerminalCursorStyleChange(result.preferences.terminalCursorStyle)
      }
      if (typeof result.preferences?.terminalCursorBlink === 'boolean') onTerminalCursorBlinkChange(result.preferences.terminalCursorBlink)
      if (result.preferences?.terminalLineHeight != null) {
        onTerminalLineHeightChange(clampLineHeight(String(result.preferences.terminalLineHeight), terminalLineHeight))
      }
      if (result.preferences?.terminalScrollback != null) {
        onTerminalScrollbackChange(clampScrollback(String(result.preferences.terminalScrollback), terminalScrollback))
      }
      if (result.preferences?.windowOpacity != null) {
        onWindowOpacityChange(clampWindowOpacity(result.preferences.windowOpacity, windowOpacity))
      }

      await loadConfig()
      await loadMcpServers()
      await loadDataUsage()

      const parts: string[] = []
      if (result.providersAdded) parts.push(`${result.providersAdded} provider(s)`)
      if (result.promptsAdded) parts.push(`${result.promptsAdded} prompt(s)`)
      if (result.commandSnippetsAdded) parts.push(`${result.commandSnippetsAdded} command snippet(s)`)
      if (result.mcpServersAdded) parts.push(`${result.mcpServersAdded} MCP server(s)`)
      setDataStatus(parts.length ? `Added: ${parts.join(', ')}` : 'Nothing new to import')
      setTimeout(() => setDataStatus(''), 4000)
    } catch (error) {
      setDataStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [loadConfig, loadDataUsage, loadMcpServers, onSidebarWidthChange, onTerminalCursorBlinkChange, onTerminalCursorStyleChange, onTerminalFontFamilyChange, onTerminalLineHeightChange, onTerminalScrollbackChange, onTextSizeChange, onLanguageChange, onThemeChange, onWindowOpacityChange, terminalLineHeight, terminalScrollback, windowOpacity])

  const handleClearSavedSessionState = useCallback(() => {
    setDeleteConfirmation({
      title: t('data.clearSessionsConfirmTitle'),
      message: t('data.clearSessionsConfirmMessage'),
      confirmLabel: t('data.clearSessionsConfirmBtn'),
      onConfirm: async () => {
        setDataStatus('Clearing saved session...')
        try {
          await onClearSavedSessionState()
          await loadDataUsage()
          setDataStatus('Saved session cleared')
          setTimeout(() => setDataStatus(''), 3000)
        } catch (error) {
          setDataStatus(`Clear failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })
  }, [loadDataUsage, onClearSavedSessionState, t])

  const handleClearChatHistory = useCallback(() => {
    setDeleteConfirmation({
      title: t('data.clearChatHistoryConfirmTitle'),
      message: t('data.clearChatHistoryConfirmMessage'),
      confirmLabel: t('data.clearChatHistoryConfirmBtn'),
      onConfirm: async () => {
        await window.api.chatHistory.clear()
        setHistoryChats([])
        await loadDataUsage()
        setDataStatus(t('data.clearChatHistory.done'))
        setTimeout(() => setDataStatus(''), 2000)
      }
    })
  }, [loadDataUsage, t])

  const confirmDeleteAction = useCallback(async () => {
    const confirmation = deleteConfirmation
    if (!confirmation) return
    setDeleteConfirmation(null)
    await confirmation.onConfirm()
  }, [deleteConfirmation])

  const setPromptDraft = useCallback((prompt: string) => {
    if (activeSessionId) {
      updateThread(activeSessionId, (thread) => ({ ...thread, draft: prompt }))
    }
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [activeSessionId, updateThread])

  useEffect(() => {
    if (!promptInsertRequest || handledPromptInsertRequestRef.current === promptInsertRequest.id) return
    handledPromptInsertRequestRef.current = promptInsertRequest.id
    setPromptDraft(promptInsertRequest.content)
    setHistoryOpen(false)
  }, [promptInsertRequest, setPromptDraft])

  const setComposerAssistMode = useCallback((mode: AssistMode) => {
    setAssistMode((prev) => {
      if (prev === mode) return prev
      if (mode !== 'agent') {
        for (const [sessionId, thread] of Object.entries(threadsRef.current)) {
          if (thread.agenticRunning) stopAgentic(sessionId)
        }
      }
      return mode
    })
  }, [stopAgentic])

  const toggleAgentMode = useCallback(() => {
    setComposerAssistMode(assistModeRef.current === 'agent' ? 'read' : 'agent')
  }, [setComposerAssistMode])

  useEffect(() => {
    if (!assistModeRequest || handledAssistModeRequestRef.current === assistModeRequest.id) return
    handledAssistModeRequestRef.current = assistModeRequest.id
    if (assistModeRequest.mode !== 'agent') {
      for (const [sessionId, thread] of Object.entries(threadsRef.current)) {
        if (thread.agenticRunning) stopAgentic(sessionId)
      }
    }
    setAssistMode(assistModeRequest.mode)
  }, [assistModeRequest, stopAgentic])

  useEffect(() => {
    if (!modelSwitchRequest || handledModelSwitchRequestRef.current === modelSwitchRequest.id) return
    handledModelSwitchRequestRef.current = modelSwitchRequest.id
    openModelSwitcher()
  }, [modelSwitchRequest, openModelSwitcher])

  const modelLabel = useMemo(() => formatModelLabel(provider.selectedModel), [provider.selectedModel])
  const terminalOutputForComposer = stripAnsi(getOutput()).slice(-maxOutputContext)
  const strippedTerminalOutput = terminalOutputForComposer.slice(-2000)
  const terminalContextAllowed = assistMode !== 'off' && !strictTerminalContextActive
  const composerTerminalOutput = terminalContextAllowed ? terminalOutputForComposer : ''
  const composerSelectedText = terminalContextAllowed ? selectedText : ''
  const composerMaskedSecretCount = lastMaskedSecretCount
  const composerChatMessages = useMemo(
    () => toConversationalChatMessages(messages, strictTerminalContextActive),
    [messages, strictTerminalContextActive]
  )
  const composerSession = useMemo(
    () => terminalContextAllowed && activeSession ? summarizeSession(activeSession) : undefined,
    [activeSession, summarizeSession, terminalContextAllowed]
  )
  // Task list / plan (issue #71) are derived from the assistant's messages; only
  // surfaced when the user opted in via the Chat Tools toggle.
  const taskList = useMemo(
    () => chatToolsSettings.taskListPlanning ? parseTaskListFromMessages(messages) : null,
    [chatToolsSettings.taskListPlanning, messages]
  )
  // Identity key for the task list panel: the index of the last user message.
  // Stable for the whole agent request (the user doesn't post mid-run), so the
  // panel's local expand/collapse state survives token/turn updates; it changes
  // when the user starts a new request, which remounts TaskListPanel and resets
  // it back to collapsed-by-default instead of inheriting `expanded` from the
  // previous checklist.
  const taskListKey = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      // Skip command-output continuations injected by runAgenticStep — they are
      // pseudo-user messages that appear mid-run and would otherwise flip the key
      // on every step, resetting the expanded state between agent commands.
      if (messages[i].role === 'user' && messages[i].display !== 'command-output') return i
    }
    return 0
  }, [messages])
  const composerPayloadChars = useMemo(() => estimateComposerPayloadChars({
    messages: composerChatMessages,
    draft,
    assistMode,
    language,
    selectedText: composerSelectedText,
    terminalOutput: composerTerminalOutput,
    session: composerSession,
    maskedSecretCount: composerMaskedSecretCount
  }), [
    assistMode,
    composerChatMessages,
    composerMaskedSecretCount,
    composerSelectedText,
    composerSession,
    composerTerminalOutput,
    draft,
    language
  ])
  const composerPayloadTokens = estimateComposerContextTokens(composerPayloadChars)
  const composerContextLabel = t('chat.composer.context', { count: formatComposerContextTokens(composerPayloadTokens) })
  const composerMaskedSecretLabel = t('chat.composer.maskedSecrets', { count: composerMaskedSecretCount })
  const composerModeLabel = assistMode === 'agent'
    ? t('chat.composer.mode.agent')
    : assistMode === 'read'
      ? t('chat.composer.mode.read')
      : t('chat.composer.mode.off')
  const composerModelDisplay = modelLabel.version ? `${modelLabel.name} ${modelLabel.version}` : modelLabel.name
  const openComposerModelSwitcher = useCallback(() => {
    setComposerConfigOpen(false)
    openModelSwitcher()
  }, [openModelSwitcher])
  const openComposerPromptLibrary = useCallback(() => {
    setComposerConfigOpen(false)
    setHistoryOpen(false)
    onOpenPromptPalette()
  }, [onOpenPromptPalette])
  const permissionIndicator = getPermissionIndicatorState(assistMode, terminalContextAllowed)
  const permissionIndicatorTitle = t(permissionIndicator.titleKey)
  const shellLabel = activeSession?.label || 'zsh'
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
  const activeProviderType = getProviderType(provider)
  const activeProviderNeedsApiKey = providerNeedsApiKey(activeProviderType)
  const credentialStateMatchesProvider = checkedApiKeyRef === provider.apiKeyRef
  const activeHasApiKey = credentialStateMatchesProvider && hasApiKey
  const activeProviderSecretsLoaded = credentialStateMatchesProvider && providerSecretsLoaded
  const activationHasCredential = !activeProviderNeedsApiKey || activeHasApiKey || apiKey.trim().length > 0
  const providerReady = Boolean(provider.selectedModel?.trim()) && (!activeProviderNeedsApiKey || activeHasApiKey)
  const showActivationFlow = messages.length === 0 && activeProviderSecretsLoaded && !providerReady
  const canTestActivationProvider =
    isValidProviderBaseUrl(provider.baseUrl) &&
    isValidProviderProxyUrl(provider.proxyUrl) &&
    activationHasCredential
  const enabledCustomPatternCount = secretMaskingSettings.customPatterns.filter((pattern) => pattern.enabled).length
  const activePatternCategoryCount = SECURITY_PATTERN_CATEGORIES.length + (enabledCustomPatternCount > 0 ? 1 : 0)
  const selectedProtectionScopes = [
    secretMaskingSettings.applyToProviderPayloads ? t('security.scope.providerPayloads.short') : '',
    secretMaskingSettings.applyToChatDisplay ? t('security.scope.chatDisplay.short') : '',
    secretMaskingSettings.strictTerminalContext ? t('security.strictMode.short') : ''
  ].filter(Boolean)
  const enabledProtectionScopes = secretMaskingMode === 'on' ? selectedProtectionScopes : []
  const secretProtectionActive = hasActiveSecretProtection(secretMaskingSettings)
  const secretProtectionNeedsScope = secretMaskingMode === 'on' && !hasSelectedSecretProtectionScope(secretMaskingSettings)
  const activationStatus = providerStatus ? statusToInlineStatus(providerStatus) : null
  const handleActivationProviderTypeChange = useCallback((providerType: LLMProviderType) => {
    setProvider((current) => ({
      ...applyProviderTypeDefaults(current, providerType),
      selectedModel: '',
      commandRiskModel: ''
    }))
    setModels([])
    setApiKey('')
    setProviderStatus('')
    setEditingApiKey(false)
  }, [])
  const handleActivationTest = useCallback(async () => {
    if (activeProviderNeedsApiKey && !activeHasApiKey && !apiKey.trim()) {
      setProviderStatus(t('onboarding.apiKeyRequired'))
      return
    }

    await loadModels()
  }, [activeHasApiKey, activeProviderNeedsApiKey, apiKey, loadModels, t])
  const handleFirstQuestion = useCallback(() => {
    setPromptDraft(t('onboarding.firstQuestionPrompt'))
  }, [setPromptDraft, t])
  const openSecuritySettings = useCallback(() => {
    setSettingsTab('security')
    setSettingsSearch('')
    onOpenSettings()
  }, [onOpenSettings])
  const getProviderListStatus = useCallback((candidate: LLMProviderConfig): { tone: ProviderListStatusTone; label: string } => {
    const providerType = getProviderType(candidate)
    const needsApiKey = providerNeedsApiKey(providerType)
    const isCurrentProvider = candidate.apiKeyRef === provider.apiKeyRef
    const hasTypedKey = isCurrentProvider && apiKey.trim().length > 0
    const hasSavedKey = candidate.apiKeyRef
      ? isCurrentProvider ? activeHasApiKey : providerKeyAvailability[candidate.apiKeyRef]
      : false
    if (needsApiKey && !hasTypedKey && !hasSavedKey) {
      return { tone: 'no-key', label: t('providers.status.noKey') }
    }

    const connectionState = providerConnectionStates[getProviderStatusKey(candidate)]
    if (connectionState === 'checking') return { tone: 'checking', label: t('providers.status.checking') }
    if (connectionState === 'error') return { tone: 'error', label: t('providers.status.error') }
    const hasUntestedSecretDraft = isCurrentProvider && (
      editingApiKey ||
      apiKey.trim().length > 0 ||
      editingProxyPassword ||
      proxyPassword.length > 0
    )
    if (connectionState === 'ready' && !hasUntestedSecretDraft) {
      if (candidate.apiKeyRef === activeProviderRef) {
        return { tone: 'active-ready', label: t('providers.status.activeReady') }
      }
      return { tone: 'ready', label: t('providers.status.ready') }
    }
    if (!needsApiKey) {
      if (candidate.apiKeyRef === activeProviderRef) {
        return { tone: 'active-local', label: t('providers.status.activeLocal') }
      }
      return { tone: 'local', label: t('providers.status.local') }
    }
    if (candidate.apiKeyRef === activeProviderRef) return { tone: 'active', label: t('providers.status.active') }
    return { tone: 'not-tested', label: t('providers.status.notTested') }
  }, [
    activeHasApiKey,
    activeProviderRef,
    apiKey,
    editingApiKey,
    editingProxyPassword,
    provider.apiKeyRef,
    providerConnectionStates,
    providerKeyAvailability,
    proxyPassword,
    t
  ])
  const getProviderStatusActionLabel = useCallback((candidate: LLMProviderConfig, tone: ProviderListStatusTone): string => {
    if (tone === 'checking') return t('providers.status.action.checking')
    if (tone === 'no-key') return t('providers.status.action.noKey')
    if (candidate.apiKeyRef !== provider.apiKeyRef) return t('providers.status.action.select')
    if (tone === 'active-ready' || tone === 'ready') return t('providers.status.action.ready')
    return t('providers.status.action.test')
  }, [provider.apiKeyRef, t])
  const handleProviderStatusAction = useCallback((candidate: LLMProviderConfig, tone: ProviderListStatusTone) => {
    if (tone === 'checking') return

    if (tone === 'no-key') {
      if (candidate.apiKeyRef !== provider.apiKeyRef) {
        switchProvider(candidate)
      }
      setEditingApiKey(true)
      setShouldFocusApiKeyInput(true)
      return
    }

    if (candidate.apiKeyRef !== provider.apiKeyRef) {
      switchProvider(candidate)
      return
    }

    void loadModels()
  }, [loadModels, provider.apiKeyRef, switchProvider])
  const inputDisabled = Boolean(commandConfirmation)
  const maskedSecretLabel = t('security.maskedSecret.inline')
  const copyAssistantMessage = useCallback(async (index: number, copyContent: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyContent)
    } catch {
      return
    }
    setCopiedMessageIndex(index)
    if (copiedMessageTimerRef.current) {
      window.clearTimeout(copiedMessageTimerRef.current)
    }
    copiedMessageTimerRef.current = window.setTimeout(() => {
      setCopiedMessageIndex(null)
      copiedMessageTimerRef.current = undefined
    }, 1500)
  }, [])
  const visibleAgenticCommand = hideSecretPlaceholders(agenticCommand, maskedSecretLabel)
  const commandConfirmationUsesLocalSecret = commandConfirmation
    ? containsSecretPlaceholder(commandConfirmation.command)
    : false
  const visibleCommandConfirmationCommand = commandConfirmation
    ? hideSecretPlaceholders(commandConfirmation.command, maskedSecretLabel)
    : ''
  const settingsNavItems = useMemo<Array<SettingsSearchItem<SettingsTab>>>(() => [
    {
      id: 'appearance',
      label: t('settings.tab.appearance'),
      terms: [
        t('appearance.title'), t('appearance.theme.label'), t('appearance.theme.desc'),
        t('appearance.fontSize.label'), t('appearance.fontSize.desc'),
        t('appearance.fontFamily.label'), t('appearance.fontFamily.desc'), t('appearance.lineHeight.label'),
        t('appearance.cursorStyle.label'), t('appearance.cursorBlink.label'), t('appearance.scrollback.label'),
        t('appearance.windowOpacity.label'), t('appearance.preview.title'),
        t('appearance.language.label'), t('appearance.language.desc'),
        t('appearance.hideShortcut.label'), t('appearance.hideShortcut.desc'),
        'font family cursor blink line height scrollback opacity preview theme language shortcut hotkey appearance terminal'
      ]
    },
    {
      id: 'providers',
      label: t('settings.tab.providers'),
      terms: [
        t('providers.title'), t('providers.type'), t('providers.name'), t('providers.baseUrl'),
        t('providers.proxyUrl'), t('providers.proxyUsername'), t('providers.proxyPassword'),
        t('providers.apiKey'), t('providers.allowInsecureTls'), t('providers.apiKey.saved'),
        t('providers.chatModel'), t('providers.safetyModel'), t('providers.fetchModels'),
        t('providers.testConnection'), t('providers.status.ready'), t('providers.status.error'),
        'openai ollama lm studio anthropic claude model api key base url proxy http https tls provider safety test connection status'
      ]
    },
    {
      id: 'mcp',
      label: t('settings.tab.mcp'),
      terms: [
        t('mcp.title'), t('mcp.discovery.title'), t('mcp.addServer'), t('mcp.importSelected'),
        t('mcp.name'), t('mcp.command'), t('mcp.args'), t('mcp.env'),
        'mcp model context protocol tools servers claude copilot codex opencode import discovery mcp.json'
      ]
    },
    {
      id: 'connections',
      label: t('settings.tab.connections'),
      terms: [
        t('connections.title'), t('connections.name'), t('connections.host'), t('connections.user'),
        t('connections.port'), t('connections.identityFile'), t('connections.browseIdentityFile'),
        t('connections.extraArgs'), t('connections.connect'),
        'ssh connection host user port identity file key pem rsa args'
      ]
    },
    {
      id: 'security',
      label: t('settings.tab.security'),
      terms: [
        t('security.title'), t('security.secretMasking.label'), t('security.secretMasking.desc'),
        t('security.secretMasking.off'), t('security.secretMasking.on'),
        t('security.secretMasking.onState'), t('security.secretMasking.offState'), t('security.secretMasking.warning'),
        t('security.scopes.title'), t('security.patterns.title'), t('security.customPatterns.title'), t('security.audit.title'),
        'security privacy gitleaks secret masking token password regex audit strict provider display aws ssh'
      ]
    },
    {
      id: 'chatTools',
      label: t('settings.tab.chatTools'),
      terms: [
        t('chatTools.title'), t('chatTools.taskList.label'), t('chatTools.taskList.desc'),
        'chat tools task list planning checklist steps plan agent automation'
      ]
    },
    {
      id: 'prompts',
      label: t('settings.tab.prompts'),
      terms: [
        t('prompts.title'), t('prompts.importFromFile'), t('prompts.addPrompt'),
        t('prompts.savePrompt'), t('prompts.namePlaceholder'), t('prompts.contentPlaceholder'),
        'prompt prompts template markdown import library'
      ]
    },
    {
      id: 'snippets',
      label: t('settings.tab.snippets'),
      terms: [
        t('snippets.title'), t('snippets.quickHint'), t('snippets.addSnippet'),
        t('snippets.saveSnippet'), t('snippets.namePlaceholder'), t('snippets.commandPlaceholder'),
        'snippet command terminal shell quick open run insert'
      ]
    },
    {
      id: 'data',
      label: t('settings.tab.data'),
      terms: [
        t('data.title'), t('data.usage.title'), t('data.usage.desc'), t('data.usage.storage'),
        t('data.usage.chats'), t('data.usage.sessions'),
        t('appearance.outputContext.label'), t('appearance.outputContext.desc'),
        t('data.restoreSessions.label'), t('data.restoreSessions.desc'),
        t('data.exportImport.label'), t('data.exportImport.desc'),
        t('data.clearSessions.label'), t('data.clearSessions.desc'),
        t('data.clearChatHistory.label'), t('data.clearChatHistory.desc'),
        'data usage storage local stats export import backup restore session state output context chars chat history clear'
      ]
    }
  ], [t])
  const filteredSettingsNavItems = useMemo(() => {
    if (!settingsSearch.trim()) return settingsNavItems
    return settingsNavItems.filter((item) =>
      matchesSearchQuery(settingsSearch, [item.label, ...item.terms])
    )
  }, [settingsNavItems, settingsSearch])
  const settingsNoResults = settingsSearch.trim().length > 0 && filteredSettingsNavItems.length === 0
  const fuzzySettingsSuggestions = useMemo(() => (
    settingsNoResults ? findFuzzySettingsSuggestions(settingsSearch, settingsNavItems) : []
  ), [settingsNavItems, settingsNoResults, settingsSearch])
  const settingsMatchClass = useCallback((terms: Array<string | undefined>) => (
    matchesSearchQuery(settingsSearch, terms) ? 'settings-search-match' : ''
  ), [settingsSearch])
  const openSettingsSection = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab)
    setSettingsSearch('')
    lastAutoOpenedSettingsQueryRef.current = ''
  }, [])
  const handleSettingsNavKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, filteredSettingsNavItems.length - 1)
    else if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = filteredSettingsNavItems.length - 1
    else return

    event.preventDefault()
    const nextItem = filteredSettingsNavItems[nextIndex]
    if (!nextItem) return
    setSettingsTab(nextItem.id)
    const navItems = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.settings-nav-item')
    navItems?.[nextIndex]?.focus()
  }, [filteredSettingsNavItems])

  useEffect(() => {
    setSettingsTab(settingsTabRequest)
  }, [settingsTabRequest, settingsTabRequestVersion])

  useEffect(() => {
    if (settingsOpen && settingsTab === 'providers') {
      setProviderStatus('')
    }
  }, [settingsOpen, settingsTab])

  useEffect(() => {
    if (!settingsOpen) return

    const frameId = requestAnimationFrame(() => {
      settingsSearchRef.current?.focus()
    })

    return () => cancelAnimationFrame(frameId)
  }, [settingsOpen])

  useEffect(() => {
    const query = settingsSearch.trim().toLowerCase()
    if (!query) {
      lastAutoOpenedSettingsQueryRef.current = ''
      return
    }
    if (!settingsOpen || lastAutoOpenedSettingsQueryRef.current === query) return
    const firstMatch = filteredSettingsNavItems[0]
    if (firstMatch) {
      setSettingsTab(firstMatch.id)
      lastAutoOpenedSettingsQueryRef.current = query
    }
  }, [filteredSettingsNavItems, settingsOpen, settingsSearch])

  const dataUsageStorage = dataUsage ? formatDataBytes(dataUsage.storageBytes, language) : '--'
  const dataUsageChats = dataUsage ? new Intl.NumberFormat(language).format(dataUsage.chatCount) : '--'
  const dataUsageSessions = dataUsage ? new Intl.NumberFormat(language).format(dataUsage.sessionCount) : '--'

  return (
    <aside className="llm-panel">
      <header className="panel-header">
        <div className="panel-header-row">
          <div className="panel-title">
            <button
              className="panel-icon icon-button"
              type="button"
              onClick={() => { setSettingsTab('providers'); onOpenSettings() }}
              title={t('settings.tab.providers')}
              aria-label={t('settings.tab.providers')}
            >
              <Bot size={15} aria-hidden />
            </button>
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
              aria-label={t('panel.settings')}
            >
              <Settings2 size={16} aria-hidden />
            </button>
            <button
              className="icon-button panel-action-button"
              type="button"
              onClick={toggleHistory}
              title={t('chat.history')}
              aria-label={t('chat.history')}
            >
              <History size={16} aria-hidden />
            </button>
            <button
              className="icon-button panel-action-button"
              type="button"
              onClick={() => void openSavePromptDialog()}
              disabled={messages.length === 0}
              title={t('chat.saveAsPrompt')}
              aria-label={t('chat.saveAsPrompt')}
            >
              <BookmarkPlus size={16} aria-hidden />
            </button>
            <button
              className="icon-button panel-action-button"
              type="button"
              onClick={clearHistory}
              title={t('panel.newChat')}
              aria-label={t('panel.newChat')}
            >
              <MessageSquarePlus size={16} aria-hidden />
            </button>
          </div>
        </div>
        <div className="permission-summary" aria-label={t('panel.permission.summary')}>
          <span className={`shell-readout ${activeSession?.status ?? 'exited'}`} title={t('panel.shell.label', { shell: shellLabel })}>
            <span className="shell-state-dot" aria-hidden />
            <span className="shell-readout-label">{shellLabel}</span>
          </span>
          <span
            className={`permission-indicator ${permissionIndicator.visualMode}`}
            title={permissionIndicatorTitle}
            aria-label={permissionIndicatorTitle}
          >
            {permissionIndicator.visualMode === 'off' ? <ShieldOff size={12} aria-hidden /> : <ShieldCheck size={12} aria-hidden />}
            <span>{permissionIndicator.label}</span>
          </span>
        </div>
      </header>

      {settingsOpen ? createPortal(
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <section className="settings-screen">
            <header className="settings-header">
              <div className="settings-title">
                <Settings2 size={17} aria-hidden />
                <h2 id="settings-title">{t('settings.title')}</h2>
              </div>
              <button className="icon-button settings-close-button" type="button" onClick={onCloseSettings} title={t('settings.close')} aria-label={t('settings.close')}>
                <X size={18} aria-hidden />
              </button>
            </header>

            <div className="settings-body">
              <nav className="settings-nav" aria-label="Settings sections">
                <label className="settings-search">
                  <Search size={13} aria-hidden />
                  <input
                    ref={settingsSearchRef}
                    type="text"
                    value={settingsSearch}
                    onChange={(event) => setSettingsSearch(event.target.value)}
                    placeholder={t('settings.search')}
                  />
                </label>
                {filteredSettingsNavItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-nav-item ${settingsTab === item.id ? 'active' : ''}`}
                    onClick={() => setSettingsTab(item.id)}
                    onKeyDown={(event) => handleSettingsNavKeyDown(event, index)}
                  >
                    <HighlightSearchText text={item.label} query={settingsSearch} />
                  </button>
                ))}
              </nav>

              <div className="settings-content">
                {settingsNoResults ? (
                  <div className="settings-search-empty-state">
                    <h3>{t('settings.search.empty.title', { query: settingsSearch.trim() })}</h3>
                    <p>{t('settings.search.empty.hint')}</p>
                    {fuzzySettingsSuggestions.length > 0 ? (
                      <div className="settings-empty-group">
                        <span className="settings-empty-label">{t('settings.search.empty.didYouMean')}</span>
                        <div className="settings-empty-chips">
                          {fuzzySettingsSuggestions.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className="settings-empty-chip suggested"
                              onClick={() => openSettingsSection(item.id)}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="settings-empty-group">
                      <span className="settings-empty-label">{t('settings.search.empty.sections')}</span>
                      <div className="settings-empty-chips">
                        {settingsNavItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="settings-empty-chip"
                            onClick={() => openSettingsSection(item.id)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="settings-empty-examples">{t('settings.search.empty.examples')}</p>
                  </div>
                ) : settingsTab === 'appearance' ? (
                  <>
                    <h3 className="settings-content-title">{t('appearance.title')}</h3>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.language.label'), t('appearance.language.desc'), t('appearance.language.en'), t('appearance.language.ru'), t('appearance.language.cn'), 'language locale translation'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.language.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.language.desc')} query={settingsSearch} /></small>
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
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.theme.label'), t('appearance.theme.desc'), 'theme color scheme ui terminal'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.theme.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.theme.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <select
                          className="language-select"
                          value={themeId}
                          onChange={(event) => onThemeChange(event.target.value)}
                        >
                          {themes.map((theme) => (
                            <option key={theme.id} value={theme.id}>{theme.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="appearance-group-heading">{t('appearance.group.typography')}</div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.fontFamily.label'), t('appearance.fontFamily.desc'), 'font family typeface mono monospace terminal'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.fontFamily.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.fontFamily.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <select
                          className="language-select appearance-wide-select"
                          value={terminalFontFamily}
                          onChange={(event) => onTerminalFontFamilyChange(event.target.value)}
                        >
                          {TERMINAL_FONT_OPTIONS.map((font) => (
                            <option key={font.value} value={font.value}>{font.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.fontSize.label'), t('appearance.fontSize.desc'), 'font size text terminal'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.fontSize.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.fontSize.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <input
                          className={`numeric-input ${!isValidTextSize(textSizeDraft) ? 'invalid-input' : ''}`}
                          type="number"
                          step="0.5"
                          min={MIN_TEXT_SIZE}
                          max={MAX_TEXT_SIZE}
                          inputMode="decimal"
                          value={textSizeDraft}
                          onChange={(event) => handleTextSizeChange(event.target.value)}
                          onBlur={commitTextSizeDraft}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.lineHeight.label'), t('appearance.lineHeight.desc'), 'line height spacing terminal typography'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.lineHeight.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.lineHeight.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <input
                          className={`numeric-input ${!isValidLineHeight(lineHeightDraft) ? 'invalid-input' : ''}`}
                          type="number"
                          step="0.05"
                          min={MIN_LINE_HEIGHT}
                          max={MAX_LINE_HEIGHT}
                          inputMode="decimal"
                          value={lineHeightDraft}
                          onChange={(event) => handleLineHeightChange(event.target.value)}
                          onBlur={commitLineHeightDraft}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="appearance-group-heading">{t('appearance.group.cursor')}</div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.cursorStyle.label'), t('appearance.cursorStyle.desc'), t('appearance.cursorStyle.block'), t('appearance.cursorStyle.underline'), t('appearance.cursorStyle.bar'), 'cursor caret block underline bar'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.cursorStyle.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.cursorStyle.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <select
                          className="language-select"
                          value={terminalCursorStyle}
                          onChange={(event) => onTerminalCursorStyleChange(event.target.value as TerminalCursorStyle)}
                        >
                          {TERMINAL_CURSOR_STYLE_OPTIONS.map((style) => (
                            <option key={style} value={style}>
                              {style === 'block'
                                ? t('appearance.cursorStyle.block')
                                : style === 'underline'
                                  ? t('appearance.cursorStyle.underline')
                                  : t('appearance.cursorStyle.bar')}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.cursorBlink.label'), t('appearance.cursorBlink.desc'), 'cursor blink caret animation'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.cursorBlink.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.cursorBlink.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <label className="settings-switch">
                          <input
                            type="checkbox"
                            checked={terminalCursorBlink}
                            onChange={(event) => onTerminalCursorBlinkChange(event.target.checked)}
                          />
                          <span />
                        </label>
                      </div>
                    </div>
                    <div className="appearance-group-heading">{t('appearance.group.terminal')}</div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.scrollback.label'), t('appearance.scrollback.desc'), 'scrollback buffer history terminal'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.scrollback.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.scrollback.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <input
                          className={`numeric-input appearance-scrollback-input ${!isValidScrollback(scrollbackDraft) ? 'invalid-input' : ''}`}
                          type="number"
                          step="500"
                          min={MIN_SCROLLBACK}
                          max={MAX_SCROLLBACK}
                          inputMode="numeric"
                          value={scrollbackDraft}
                          onChange={(event) => handleScrollbackChange(event.target.value)}
                          onBlur={commitScrollbackDraft}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="appearance-group-heading">{t('appearance.group.window')}</div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.windowOpacity.label'), t('appearance.windowOpacity.desc'), 'macos window opacity transparency vibrancy'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.windowOpacity.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.windowOpacity.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right appearance-slider-control">
                        <input
                          type="range"
                          min={MIN_WINDOW_OPACITY}
                          max={MAX_WINDOW_OPACITY}
                          step="0.001"
                          value={windowOpacity}
                          onChange={(event) => onWindowOpacityChange(Number(event.target.value))}
                          aria-label={t('appearance.windowOpacity.label')}
                        />
                        <span>{(windowOpacity * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                    <div
                      className={`appearance-preview ${settingsMatchClass([t('appearance.preview.title'), t('appearance.preview.command'), 'preview terminal live font cursor'])}`}
                      style={{ fontFamily: terminalFontFamily, fontSize: textSize, lineHeight: terminalLineHeight }}
                    >
                      <div className="appearance-preview-title">{t('appearance.preview.title')}</div>
                      <div><span className="appearance-preview-prompt">$</span> {t('appearance.preview.command')}</div>
                      <div className="appearance-preview-output">taviraq --daily-driver</div>
                      <span className={`appearance-preview-cursor ${terminalCursorStyle} ${terminalCursorBlink ? 'blink' : ''}`} />
                    </div>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.hideShortcut.label'), t('appearance.hideShortcut.desc'), electronToDisplay(hideShortcut), 'shortcut hotkey hide show'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.hideShortcut.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.hideShortcut.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <button
                          type="button"
                          className={`shortcut-recorder ${recordingShortcut ? 'recording' : ''}`}
                          onClick={() => { setRecordingShortcut(true); setShortcutError(null) }}
                        >
                          {recordingShortcut ? t('appearance.hideShortcut.recording') : electronToDisplay(hideShortcut)}
                        </button>
                        {shortcutError && (
                          <small className="shortcut-error">
                            {t('appearance.hideShortcut.conflict', { shortcut: electronToDisplay(shortcutError) })}
                          </small>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'providers' ? (
                  <>
                    <h3 className="settings-content-title">{t('providers.title')}</h3>
                    <div className="providers-layout">
                      {/* Left column — provider list */}
                      <div>
                        <div className="providers-list-header">
                          <span>{t('providers.title')}</span>
                          <button type="button" className="quiet-button settings-add-button" title={t('providers.addProvider')} aria-label={t('providers.addProvider')} onClick={addProvider}>
                            <Plus size={15} aria-hidden />
                          </button>
                        </div>
                        <div className="provider-list">
                          {allProviders.map((p) => {
                            const isEditingProvider = p.apiKeyRef === provider.apiKeyRef
                            const isActiveProvider = p.apiKeyRef === activeProviderRef
                            const isDraftProvider = p.apiKeyRef === draftProviderRef
                            const listStatus = getProviderListStatus(p)
                            const providerListName = p.name || t('providers.unnamed')
                            const statusActionLabel = getProviderStatusActionLabel(p, listStatus.tone)
                            return (
                              <div
                                key={p.apiKeyRef}
                                className={`provider-list-item ${isEditingProvider ? 'active' : ''} ${isActiveProvider ? 'chat-active' : ''} ${isDraftProvider ? 'draft' : ''}`}
                                title={providerListName}
                                aria-label={providerListName}
                                onClick={() => switchProvider(p)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.target !== e.currentTarget) return
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    switchProvider(p)
                                  }
                                }}
                              >
                                <span className={`provider-active-dot ${isActiveProvider ? 'visible' : ''}`} />
                                <span className="provider-list-item-main">
                                  <span className="provider-list-item-name" title={providerListName}>
                                    {providerListName}
                                    {isDraftProvider ? <span className="provider-list-item-draft">{t('providers.draft')}</span> : null}
                                  </span>
                                  <button
                                    type="button"
                                    className={`provider-status-badge ${listStatus.tone}`}
                                    title={statusActionLabel}
                                    aria-label={`${listStatus.label}. ${statusActionLabel}`}
                                    disabled={listStatus.tone === 'checking'}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleProviderStatusAction(p, listStatus.tone)
                                    }}
                                  >
                                    {listStatus.label}
                                  </button>
                                </span>
                                {allProviders.length > 1 || isDraftProvider ? (
                                  <button
                                    type="button"
                                    className="provider-list-item-delete icon-button"
                                    title={t('providers.deleteProvider')}
                                    aria-label={t('providers.deleteProvider')}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); void handleDeleteProvider(p.apiKeyRef) }}
                                  >
                                    <Trash2 size={14} aria-hidden />
                                  </button>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Right column — provider form */}
                      <div className="provider-form">
                        <div className={`provider-field ${settingsMatchClass([t('providers.type'), t('providers.type.openai'), t('providers.type.ollama'), t('providers.type.lmstudio'), t('providers.type.anthropic'), 'provider type openai ollama lm studio anthropic claude'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('providers.type')} query={settingsSearch} /></span>
                          <select
                            value={getProviderType(provider)}
                            onChange={(event) => setProvider((p) => applyProviderTypeDefaults(p, event.target.value as LLMProviderType))}
                          >
                            {providerTypeOptions.map((providerType) => (
                              <option key={providerType} value={providerType}>
                                {t(`providers.type.${providerType}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className={`provider-field ${settingsMatchClass([t('providers.name'), provider.name, 'provider name label'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('providers.name')} query={settingsSearch} /></span>
                          <input
                            value={provider.name}
                            onChange={(event) => setProvider((p) => ({ ...p, name: event.target.value }))}
                          />
                        </div>
                        <div className={`provider-field ${settingsMatchClass([t('providers.baseUrl'), provider.baseUrl, 'base url endpoint api'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('providers.baseUrl')} query={settingsSearch} /></span>
                          <input
                            className={provider.baseUrl.trim() && !isValidProviderBaseUrl(provider.baseUrl) ? 'invalid-input' : undefined}
                            aria-invalid={Boolean(provider.baseUrl.trim() && !isValidProviderBaseUrl(provider.baseUrl))}
                            value={provider.baseUrl}
                            onChange={(event) => setProvider((p) => ({ ...p, baseUrl: event.target.value }))}
                          />
                        </div>
                        <label className={`provider-toggle-field ${settingsMatchClass([t('providers.allowInsecureTls'), t('providers.allowInsecureTls.desc'), 'tls ssl insecure certificate'])}`}>
                          <span>
                            <strong><HighlightSearchText text={t('providers.allowInsecureTls')} query={settingsSearch} /></strong>
                            <small><HighlightSearchText text={t('providers.allowInsecureTls.desc')} query={settingsSearch} /></small>
                          </span>
                          <input
                            type="checkbox"
                            checked={Boolean(provider.allowInsecureTls)}
                            onChange={(event) => setProvider((p) => ({ ...p, allowInsecureTls: event.target.checked }))}
                          />
                          <i aria-hidden />
                        </label>
                        <div className={`provider-field ${settingsMatchClass([t('providers.apiKey'), t('providers.apiKey.saved'), t('providers.apiKey.change'), 'api key secret token keychain'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('providers.apiKey')} query={settingsSearch} /></span>
                          {!editingApiKey && activeHasApiKey ? (
                            <div className="apikey-masked">
                              <span className="apikey-masked-text">●●●●●●●●</span>
                              <span className="apikey-masked-hint"><HighlightSearchText text={t('providers.apiKey.saved')} query={settingsSearch} /></span>
                              <button
                                type="button"
                                className="apikey-change-btn"
                                onClick={() => setEditingApiKey(true)}
                              >
                                <HighlightSearchText text={t('providers.apiKey.change')} query={settingsSearch} />
                              </button>
                            </div>
                          ) : (
                            <input
                              type="password"
                              ref={apiKeyInputRef}
                              value={apiKey}
                              onChange={(event) => setApiKey(event.target.value)}
                              placeholder={activeHasApiKey ? t('providers.apiKey.replacePlaceholder') : t('providers.apiKey.placeholder')}
                            />
                          )}
                        </div>
                        <div className="provider-actions">
                          <button type="button" className="primary-button provider-save-button" onClick={() => void saveProvider()}>
                            <KeyRound size={14} aria-hidden />
                            {t('providers.save')}
                          </button>
                          <button
                            type="button"
                            className="quiet-button provider-test-button"
                            disabled={isTestingProvider}
                            onClick={() => void loadModels()}
                          >
                            <RefreshCw size={14} aria-hidden />
                            {isTestingProvider ? t('providers.testing') : t('providers.testConnection')}
                          </button>
                        </div>
                        {providerStatus ? (
                          <div className={`provider-connection-status ${statusToInlineStatus(providerStatus).tone}`}>
                            <span>{statusToInlineStatus(providerStatus).tone === 'success' ? '●' : statusToInlineStatus(providerStatus).tone === 'danger' ? '✕' : statusToInlineStatus(providerStatus).tone === 'warning' ? '◐' : '◌'} {providerStatus}</span>
                          </div>
                        ) : null}
                        <div className="provider-model-selectors">
                          <div className={`model-field ${settingsMatchClass([t('providers.chatModel'), t('providers.searchChatModel'), provider.selectedModel, 'chat model completion'])}`}>
                            <span><HighlightSearchText text={t('providers.chatModel')} query={settingsSearch} /></span>
                            <ModelCombobox
                              value={provider.selectedModel ?? ''}
                              models={models}
                              placeholder={t('providers.searchChatModel')}
                              onOpen={() => void loadModels()}
                              onChange={(modelId) => {
                                const updated = { ...provider, selectedModel: modelId }
                                updateProvider(updated)
                              }}
                            />
                          </div>
                          <div className={`model-field ${settingsMatchClass([t('providers.safetyModel'), t('providers.searchSafetyModel'), provider.commandRiskModel, 'safety risk command model'])}`}>
                            <span><HighlightSearchText text={t('providers.safetyModel')} query={settingsSearch} /></span>
                            <ModelCombobox
                              value={provider.commandRiskModel ?? ''}
                              models={models}
                              placeholder={t('providers.searchSafetyModel')}
                              onOpen={() => void loadModels()}
                              onChange={(modelId) => {
                                const updated = { ...provider, commandRiskModel: modelId }
                                updateProvider(updated)
                              }}
                            />
                          </div>
                        </div>
                        <div className="provider-proxy-settings">
                          <div className={`provider-field ${settingsMatchClass([t('providers.proxyUrl'), provider.proxyUrl, 'proxy http https corporate network'])}`}>
                            <span className="provider-field-label"><HighlightSearchText text={t('providers.proxyUrl')} query={settingsSearch} /></span>
                            <input
                              className={provider.proxyUrl?.trim() && !isValidProviderProxyUrl(provider.proxyUrl) ? 'invalid-input' : undefined}
                              aria-invalid={Boolean(provider.proxyUrl?.trim() && !isValidProviderProxyUrl(provider.proxyUrl))}
                              value={provider.proxyUrl ?? ''}
                              placeholder="http://127.0.0.1:8080"
                              onChange={(event) => setProvider((p) => ({ ...p, proxyUrl: event.target.value }))}
                            />
                          </div>
                          <div className={`provider-field ${settingsMatchClass([t('providers.proxyUsername'), provider.proxyUsername, 'proxy username login auth'])}`}>
                            <span className="provider-field-label"><HighlightSearchText text={t('providers.proxyUsername')} query={settingsSearch} /></span>
                            <input
                              value={provider.proxyUsername ?? ''}
                              autoComplete="off"
                              onChange={(event) => setProvider((p) => ({ ...p, proxyUsername: event.target.value }))}
                            />
                          </div>
                          <div className={`provider-field ${settingsMatchClass([t('providers.proxyPassword'), t('providers.proxyPassword.saved'), t('providers.proxyPassword.change'), t('providers.proxyPassword.clear'), 'proxy password secret auth keychain'])}`}>
                            <span className="provider-field-label"><HighlightSearchText text={t('providers.proxyPassword')} query={settingsSearch} /></span>
                            {!editingProxyPassword && hasProxyPassword ? (
                              <div className="apikey-masked">
                                <span className="apikey-masked-text">●●●●●●●●</span>
                                <span className="apikey-masked-hint"><HighlightSearchText text={t('providers.proxyPassword.saved')} query={settingsSearch} /></span>
                                <button
                                  type="button"
                                  className="apikey-change-btn"
                                  onClick={() => setEditingProxyPassword(true)}
                                >
                                  <HighlightSearchText text={t('providers.proxyPassword.change')} query={settingsSearch} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button apikey-clear-btn"
                                  title={t('providers.proxyPassword.clear')}
                                  aria-label={t('providers.proxyPassword.clear')}
                                  onClick={() => void saveProxySettings('')}
                                >
                                  <Trash2 size={13} aria-hidden />
                                </button>
                              </div>
                            ) : (
                              <input
                                type="password"
                                value={proxyPassword}
                                autoComplete="off"
                                onChange={(event) => setProxyPassword(event.target.value)}
                                placeholder={hasProxyPassword ? t('providers.proxyPassword.replacePlaceholder') : t('providers.proxyPassword.placeholder')}
                              />
                            )}
                          </div>
                          <div className="provider-actions">
                            <button type="button" className="primary-button provider-save-button" onClick={() => void saveProxySettings()}>
                              <KeyRound size={14} aria-hidden />
                              {t('providers.proxy.save')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'mcp' ? (
                  <>
                    <h3 className="settings-content-title">{t('mcp.title')}</h3>
                    <section className="settings-section mcp-discovery">
                      <div className="settings-section-heading">
                        <span><HighlightSearchText text={t('mcp.discovery.title')} query={settingsSearch} /></span>
                      </div>
                      <p className="mcp-discovery-note">{t('mcp.discovery.desc')}</p>
                      <button type="button" className="quiet-button mcp-discovery-button" disabled={mcpDiscovering} onClick={() => void discoverMcpServers()}>
                        <Search size={14} aria-hidden />
                        {mcpDiscovering ? t('mcp.discovery.scanning') : t('mcp.discovery.scan')}
                      </button>
                      {mcpStatus ? <p className="settings-status mcp-discovery-status">{mcpStatus}</p> : null}
                      {discoveredMcpServers.length > 0 ? (
                        <div className="mcp-discovery-list">
                          {discoveredMcpServers.map((server) => (
                            <label key={getDiscoveredMcpKey(server)} className="mcp-discovery-item">
                              <span className="mcp-discovery-copy">
                                <strong>{server.name}</strong>
                                <small>{MCP_SOURCE_LABELS[server.source]} · {server.command}</small>
                              </span>
                              <input
                                type="checkbox"
                                checked={selectedDiscoveredMcpIds.includes(getDiscoveredMcpKey(server))}
                                onChange={() => toggleDiscoveredMcp(getDiscoveredMcpKey(server))}
                              />
                              <i aria-hidden />
                            </label>
                          ))}
                          <button type="button" className="primary-button mcp-import-button" onClick={() => void importSelectedMcpServers()}>
                            <Check size={14} aria-hidden />
                            {t('mcp.importSelected')}
                          </button>
                        </div>
                      ) : null}
                    </section>
                    <div className="mcp-layout">
                      <div>
                        <div className="providers-list-header">
                          <span>{t('mcp.servers')}</span>
                          <button type="button" className="quiet-button settings-add-button" title={t('mcp.addServer')} aria-label={t('mcp.addServer')} onClick={addMcpServer}>
                            <Plus size={15} aria-hidden />
                          </button>
                        </div>
                        <div className="provider-list">
                          {mcpServers.length === 0 ? (
                            <div className="mcp-empty">{t('mcp.empty')}</div>
                          ) : mcpServers.map((server) => {
                            const sourceLabel = MCP_SOURCE_LABELS[server.source ?? 'manual']
                            const statusLabel = server.enabled ? t('mcp.status.enabled') : t('mcp.status.disabled')
                            const serverTooltip = [
                              server.name,
                              `${sourceLabel} · ${statusLabel}`,
                              server.command
                            ].filter(Boolean).join('\n')
                            return (
                              <div
                                key={server.id}
                                className={`provider-list-item mcp-server-list-item ${mcpDraft.id === server.id ? 'active' : ''}`}
                                role="button"
                                tabIndex={0}
                                title={serverTooltip}
                                onClick={() => editMcpServer(server)}
                                onKeyDown={(event) => {
                                  if (event.target !== event.currentTarget) return
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    editMcpServer(server)
                                  }
                                }}
                              >
                                <span className={`provider-active-dot ${server.enabled ? 'visible' : ''}`} />
                                <span className="provider-list-item-main">
                                  <span className="provider-list-item-name">{server.name}</span>
                                  <span className="mcp-source-label">{sourceLabel} · {statusLabel}</span>
                                </span>
                                <button
                                  type="button"
                                  className="provider-list-item-delete icon-button"
                                  title={t('mcp.deleteServer')}
                                  aria-label={t('mcp.deleteServer')}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  onClick={(event) => { event.stopPropagation(); deleteMcpServer(server.id) }}
                                >
                                  <Trash2 size={14} aria-hidden />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="provider-form">
                        <label className={`provider-toggle-field ${settingsMatchClass([t('mcp.enabled'), 'mcp server enabled disabled tools'])}`}>
                          <span>
                            <strong><HighlightSearchText text={t('mcp.enabled')} query={settingsSearch} /></strong>
                            <small><HighlightSearchText text={t('mcp.enabled.desc')} query={settingsSearch} /></small>
                          </span>
                          <input
                            type="checkbox"
                            checked={mcpDraft.enabled}
                            onChange={(event) => { void setMcpServerEnabled(event.target.checked) }}
                          />
                          <i aria-hidden />
                        </label>
                        <div className={`provider-field ${settingsMatchClass([t('mcp.name'), mcpDraft.name, 'mcp server name'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('mcp.name')} query={settingsSearch} /></span>
                          <input value={mcpDraft.name} onChange={(event) => setMcpDraft((draft) => ({ ...draft, name: event.target.value }))} />
                        </div>
                        <div className={`provider-field ${settingsMatchClass([t('mcp.command'), mcpDraft.command, 'mcp command executable'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('mcp.command')} query={settingsSearch} /></span>
                          <input value={mcpDraft.command} placeholder="npx" onChange={(event) => setMcpDraft((draft) => ({ ...draft, command: event.target.value }))} />
                        </div>
                        <div className={`provider-field ${settingsMatchClass([t('mcp.args'), mcpArgsDraft, 'mcp args arguments'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('mcp.args')} query={settingsSearch} /></span>
                          <input value={mcpArgsDraft} placeholder="-y @modelcontextprotocol/server-filesystem ~/Projects" onChange={(event) => setMcpArgsDraft(event.target.value)} />
                        </div>
                        <div className={`provider-field ${settingsMatchClass([t('mcp.env'), mcpEnvDraft, 'mcp env environment secret token'])}`}>
                          <span className="provider-field-label"><HighlightSearchText text={t('mcp.env')} query={settingsSearch} /></span>
                          <textarea
                            className="mcp-env-input"
                            value={mcpEnvDraft}
                            placeholder="TOKEN=..."
                            onChange={(event) => setMcpEnvDraft(event.target.value)}
                          />
                        </div>
                        <div className="provider-actions">
                          <button type="button" className="primary-button provider-save-button" onClick={() => void saveMcpServer()}>
                            <Server size={14} aria-hidden />
                            {t('mcp.save')}
                          </button>
                        </div>

                        <section className="settings-section mcp-tools">
                          <div className="settings-section-heading">
                            <span>
                              <HighlightSearchText text={t('mcp.tools.title')} query={settingsSearch} />
                              {(mcpDraft.tools ?? []).length > 0 ? <small className="mcp-tools-count">{(mcpDraft.tools ?? []).filter((tool) => tool.enabled).length}/{(mcpDraft.tools ?? []).length}</small> : null}
                            </span>
                            <button
                              type="button"
                              className="icon-button mcp-refresh-button"
                              title={mcpRefreshingTools ? t('mcp.tools.refreshing') : t('mcp.tools.refresh')}
                              aria-label={mcpRefreshingTools ? t('mcp.tools.refreshing') : t('mcp.tools.refresh')}
                              disabled={mcpRefreshingTools || !mcpServers.some((server) => server.id === mcpDraft.id)}
                              onClick={() => void refreshMcpTools(mcpDraft)}
                            >
                              <RefreshCw size={14} aria-hidden />
                            </button>
                          </div>
                          {(mcpDraft.tools ?? []).length === 0 ? (
                            <p className="mcp-discovery-note">{t('mcp.tools.empty')}</p>
                          ) : (
                            <div className="mcp-tool-list">
                              {(mcpDraft.tools ?? []).map((tool) => (
                                <label key={tool.name} className="mcp-tool-item">
                                  <span className="mcp-tool-copy">
                                    <strong>{tool.name}</strong>
                                    {tool.description ? <small>{tool.description}</small> : null}
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={tool.enabled}
                                    onChange={(event) => void toggleMcpTool(mcpDraft.id, tool.name, event.target.checked)}
                                  />
                                  <i aria-hidden />
                                </label>
                              ))}
                            </div>
                          )}
                        </section>
                      </div>
                    </div>
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'security' ? (
                  <>
                    <h3 className="settings-content-title">{t('security.title')}</h3>
                    <div className={`security-trust-center ${settingsMatchClass([
                      t('security.secretMasking.label'),
                      t('security.patterns.title'),
                      t('security.customPatterns.title'),
                      t('security.audit.title'),
                      'security privacy gitleaks secret masking token password aws ssh regex audit strict provider payload display'
                    ])}`}>
                      <div className="security-summary-grid">
                        <div className="security-summary-item">
                          <ListChecks size={15} aria-hidden />
                          <span>{t('security.summary.categories')}</span>
                          <strong>{activePatternCategoryCount}</strong>
                        </div>
                        <div className="security-summary-item">
                          <Eye size={15} aria-hidden />
                          <span>{t('security.summary.scopes')}</span>
                          <strong>{enabledProtectionScopes.length > 0 ? enabledProtectionScopes.join(' + ') : t('security.summary.noScopes')}</strong>
                        </div>
                        <div className="security-summary-item">
                          <Activity size={15} aria-hidden />
                          <span>{t('security.summary.audit')}</span>
                          <strong>{secretAuditEvents.length}</strong>
                        </div>
                      </div>

                      <div className={`appearance-row security-row ${secretProtectionActive ? 'security-row--on' : 'security-row--off'}`}>
                        <div className="appearance-row-left security-row-left">
                          <div className="security-row-heading">
                            <span className="security-row-icon" aria-hidden>
                              {secretProtectionActive ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
                            </span>
                            <span className="appearance-row-label"><HighlightSearchText text={t('security.secretMasking.label')} query={settingsSearch} /></span>
                            <span className="security-row-state">
                              <HighlightSearchText
                                text={
                                  secretProtectionActive
                                    ? t('security.secretMasking.onState')
                                    : secretProtectionNeedsScope
                                      ? t('security.secretMasking.noScopesState')
                                      : t('security.secretMasking.offState')
                                }
                                query={settingsSearch}
                              />
                            </span>
                          </div>
                          <small className="appearance-row-desc">
                            <HighlightSearchText
                              text={
                                secretProtectionActive
                                  ? t('security.secretMasking.onDesc')
                                  : secretProtectionNeedsScope
                                    ? t('security.secretMasking.noScopesDesc')
                                    : t('security.secretMasking.offDesc')
                              }
                              query={settingsSearch}
                            />
                          </small>
                          <small className="security-row-footnote"><HighlightSearchText text={t('security.secretMasking.desc')} query={settingsSearch} /></small>
                          <small className={`security-row-warning ${secretProtectionActive ? 'security-row-warning--reserved' : ''}`}>
                            {!secretProtectionActive ? <AlertTriangle size={11} aria-hidden /> : null}
                            <span>
                              {!secretProtectionActive ? (
                                <HighlightSearchText
                                  text={secretProtectionNeedsScope ? t('security.secretMasking.noScopesWarning') : t('security.secretMasking.warning')}
                                  query={settingsSearch}
                                />
                              ) : null}
                            </span>
                          </small>
                        </div>
                        <div className="appearance-row-right">
                          <button
                            type="button"
                            className={`security-switch ${secretProtectionActive ? 'on' : ''}`}
                            role="switch"
                            aria-checked={secretProtectionActive}
                            aria-label={t('security.secretMasking.label')}
                            title={secretProtectionActive ? t('security.secretMasking.on') : t('security.secretMasking.off')}
                            onClick={toggleSecretProtection}
                          >
                            <span aria-hidden />
                          </button>
                        </div>
                      </div>

                      <div className={`appearance-row security-row ${telemetrySettings?.enabled && telemetryActive ? 'security-row--on' : 'security-row--off'} ${settingsMatchClass([
                        t('security.telemetry.label'),
                        t('security.telemetry.desc'),
                        'telemetry analytics activation usage anonymous opt-in privacy'
                      ])}`}>
                        <div className="appearance-row-left security-row-left">
                          <div className="security-row-heading">
                            <span className="appearance-row-label"><HighlightSearchText text={t('security.telemetry.label')} query={settingsSearch} /></span>
                            <span className="security-row-state">
                              <HighlightSearchText
                                text={
                                  telemetrySettings?.enabled
                                    ? telemetryActive
                                      ? t('security.telemetry.onState')
                                      : t('security.telemetry.inactiveState')
                                    : t('security.telemetry.offState')
                                }
                                query={settingsSearch}
                              />
                            </span>
                          </div>
                          <small className="appearance-row-desc">
                            <HighlightSearchText text={t('security.telemetry.desc')} query={settingsSearch} />
                          </small>
                        </div>
                        <div className="appearance-row-right">
                          <button
                            type="button"
                            className={`security-switch ${telemetrySettings?.enabled ? (telemetryActive ? 'on' : 'inactive') : ''}`}
                            role="switch"
                            aria-checked={telemetrySettings?.enabled ?? false}
                            aria-label={t('security.telemetry.label')}
                            title={telemetrySettings?.enabled ? t('security.telemetry.on') : t('security.telemetry.off')}
                            onClick={toggleTelemetry}
                          >
                            <span aria-hidden />
                          </button>
                        </div>
                      </div>

                      <section className="security-panel">
                        <div className="settings-section-heading">
                          <span><HighlightSearchText text={t('security.scopes.title')} query={settingsSearch} /></span>
                        </div>
                        <div className="security-controls-grid">
                          <label className="provider-toggle-field security-control">
                            <span>
                              <strong><HighlightSearchText text={t('security.scope.providerPayloads')} query={settingsSearch} /></strong>
                              <small><HighlightSearchText text={t('security.scope.providerPayloads.desc')} query={settingsSearch} /></small>
                            </span>
                            <input
                              type="checkbox"
                              checked={secretMaskingSettings.applyToProviderPayloads}
                              onChange={(event) => updateSecretMaskingSetting((settings) =>
                                updateSecretProtectionScope(settings, {
                                  applyToProviderPayloads: event.target.checked
                                })
                              )}
                            />
                            <i aria-hidden />
                          </label>
                          <label className="provider-toggle-field security-control">
                            <span>
                              <strong><HighlightSearchText text={t('security.scope.chatDisplay')} query={settingsSearch} /></strong>
                              <small><HighlightSearchText text={t('security.scope.chatDisplay.desc')} query={settingsSearch} /></small>
                            </span>
                            <input
                              type="checkbox"
                              checked={secretMaskingSettings.applyToChatDisplay}
                              onChange={(event) => updateSecretMaskingSetting((settings) =>
                                updateSecretProtectionScope(settings, {
                                  applyToChatDisplay: event.target.checked
                                })
                              )}
                            />
                            <i aria-hidden />
                          </label>
                          <label className="provider-toggle-field security-control">
                            <span>
                              <strong><HighlightSearchText text={t('security.strictMode')} query={settingsSearch} /></strong>
                              <small><HighlightSearchText text={t('security.strictMode.desc')} query={settingsSearch} /></small>
                            </span>
                            <input
                              type="checkbox"
                              checked={secretMaskingSettings.strictTerminalContext}
                              onChange={(event) => updateSecretMaskingSetting((settings) =>
                                updateSecretProtectionScope(settings, {
                                  strictTerminalContext: event.target.checked
                                })
                              )}
                            />
                            <i aria-hidden />
                          </label>
                        </div>
                      </section>

                      <section className="security-panel">
                        <div className="settings-section-heading">
                          <span><HighlightSearchText text={t('security.patterns.title')} query={settingsSearch} /></span>
                        </div>
                        <div className="security-pattern-grid">
                          {SECURITY_PATTERN_CATEGORIES.map((category) => (
                            <div key={category.id} className="security-pattern-item">
                              <span>{t(category.labelKey as Parameters<typeof t>[0])}</span>
                              <small>{t(category.descKey as Parameters<typeof t>[0])}</small>
                            </div>
                          ))}
                          <div className="security-pattern-item">
                            <span>{t('security.category.customRegex')}</span>
                            <small>{enabledCustomPatternCount > 0
                              ? t('security.category.customRegex.count', { count: enabledCustomPatternCount })
                              : t('security.category.customRegex.empty')}
                            </small>
                          </div>
                        </div>
                      </section>

                      <section className="security-panel">
                        <div className="settings-section-heading">
                          <span><HighlightSearchText text={t('security.customPatterns.title')} query={settingsSearch} /></span>
                        </div>
                        <div className="security-custom-pattern-form">
                          <input
                            value={customPatternName}
                            onChange={(event) => {
                              setCustomPatternName(event.target.value)
                              setCustomPatternError('')
                            }}
                            placeholder={t('security.customPatterns.name')}
                          />
                          <input
                            value={customPatternRegex}
                            onChange={(event) => {
                              setCustomPatternRegex(event.target.value)
                              setCustomPatternError('')
                            }}
                            placeholder={t('security.customPatterns.regex')}
                            spellCheck={false}
                          />
                          <button type="button" className="primary-button provider-save-button" onClick={addCustomSecretPattern}>
                            <Plus size={14} aria-hidden />
                            {t('security.customPatterns.add')}
                          </button>
                        </div>
                        {customPatternError ? <p className="settings-status security-error">{customPatternError}</p> : null}
                        <div className="security-custom-pattern-list">
                          {secretMaskingSettings.customPatterns.length === 0 ? (
                            <p className="security-empty">{t('security.customPatterns.empty')}</p>
                          ) : secretMaskingSettings.customPatterns.map((pattern) => (
                            <div key={pattern.id} className="security-custom-pattern-item">
                              <button
                                type="button"
                                className={`security-pattern-toggle ${pattern.enabled ? 'enabled' : ''}`}
                                onClick={() => toggleCustomSecretPattern(pattern.id)}
                                title={pattern.enabled ? t('security.customPatterns.disable') : t('security.customPatterns.enable')}
                                aria-label={pattern.enabled ? t('security.customPatterns.disable') : t('security.customPatterns.enable')}
                              >
                                {pattern.enabled ? <Check size={13} aria-hidden /> : <ShieldOff size={13} aria-hidden />}
                              </button>
                              <div>
                                <span>{pattern.name}</span>
                                <code>{pattern.pattern}</code>
                              </div>
                              <button
                                type="button"
                                className="icon-button provider-list-item-delete"
                                onClick={() => deleteCustomSecretPattern(pattern.id)}
                                title={t('prompts.delete')}
                                aria-label={t('prompts.delete')}
                              >
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="security-panel">
                        <div className="settings-section-heading">
                          <span><HighlightSearchText text={t('security.audit.title')} query={settingsSearch} /></span>
                          <button type="button" className="quiet-button security-audit-clear" onClick={clearSecretAuditEvents} disabled={secretAuditEvents.length === 0}>
                            <ScrollText size={13} aria-hidden />
                            {t('security.audit.clear')}
                          </button>
                        </div>
                        <div className="security-audit-list">
                          {secretAuditEvents.length === 0 ? (
                            <p className="security-empty">{t('security.audit.empty')}</p>
                          ) : secretAuditEvents.map((event) => (
                            <div key={event.id} className="security-audit-item">
                              <div className="security-audit-main">
                                <span>{auditSourceLabel(event.source, t)}</span>
                                <small>{formatAuditTime(event.createdAt)} · {scopeLabel(event.scope, t)}{event.sessionLabel ? ` · ${event.sessionLabel}` : ''}</small>
                              </div>
                              <div className="security-audit-meta">
                                <span className="security-audit-count">
                                  <ShieldAlert size={12} aria-hidden />
                                  {t('security.audit.maskedCount', { count: event.maskedSecretCount })}
                                </span>
                                <div className="security-audit-tags">
                                  {event.categories.map((category) => (
                                    <span key={category}>{formatSecretCategory(category)}</span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      {securityStatus ? <p className="settings-status">{securityStatus}</p> : null}
                    </div>
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'connections' ? (
                  <>
                    <h3 className="settings-content-title">{t('connections.title')}</h3>
                    <div className="connections-layout">
                      <div>
                        <div className="providers-list-header">
                          <span>{t('connections.title')}</span>
                          {sshProfiles.length > 0 ? (
                            <button type="button" className="quiet-button settings-add-button" title={t('connections.addConnection')} aria-label={t('connections.addConnection')} onClick={addSshProfile}>
                              <Plus size={15} aria-hidden />
                            </button>
                          ) : null}
                        </div>
                        <div className="provider-list">
                          {sshProfiles.length === 0 ? (
                            <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 12 }}>
                              {t('connections.noConnections')}
                            </div>
                          ) : null}
                          {sshProfiles.map((p) => {
                            const isEditing = p.id === sshProfile?.id
                            const sshProfileName = p.name || p.host || t('connections.unnamed')
                            return (
                              <div
                                key={p.id}
                                className={`provider-list-item ${isEditing ? 'active' : ''}`}
                                title={sshProfileName}
                                aria-label={sshProfileName}
                                onClick={() => setSshProfile(p)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.target !== e.currentTarget) return
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setSshProfile(p)
                                  }
                                }}
                              >
                                <Server size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} aria-hidden />
                                <span className="provider-list-item-main">
                                  <span className="provider-list-item-name" title={sshProfileName}>{sshProfileName}</span>
                                </span>
                                <button
                                  type="button"
                                  className="provider-list-item-delete icon-button"
                                  title={t('connections.deleteConnection')}
                                  aria-label={t('connections.deleteConnection')}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  onClick={(e) => { e.stopPropagation(); void deleteSshProfile(p.id) }}
                                >
                                  <Trash2 size={14} aria-hidden />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {sshProfile ? (
                        <div className="connections-form">
                          <div className={`provider-field ${settingsMatchClass([t('connections.name'), sshProfile.name, t('connections.newConnection'), 'connection name label'])}`}>
	                            <span className="provider-field-label"><HighlightSearchText text={t('connections.name')} query={settingsSearch} /></span>
                            <input
                              value={sshProfile.name ?? ''}
                              placeholder={t('connections.newConnection')}
                              onChange={(event) => setSshProfile((p) => p ? { ...p, name: event.target.value } : p)}
                            />
                          </div>
                          <div className={`provider-field ${settingsMatchClass([t('connections.host'), sshProfile.host, 'host hostname server domain ip'])}`}>
	                            <span className="provider-field-label"><HighlightSearchText text={t('connections.host')} query={settingsSearch} /></span>
                            <input
                              value={sshProfile.host}
                              placeholder="example.com"
                              onChange={(event) => setSshProfile((p) => p ? { ...p, host: event.target.value } : p)}
                            />
                          </div>
                          <div className={`provider-field ${settingsMatchClass([t('connections.user'), sshProfile.user, 'user username login'])}`}>
	                            <span className="provider-field-label"><HighlightSearchText text={t('connections.user')} query={settingsSearch} /></span>
                            <input
                              value={sshProfile.user ?? ''}
                              placeholder="root"
                              onChange={(event) => setSshProfile((p) => p ? { ...p, user: event.target.value } : p)}
                            />
                          </div>
                          <div className={`provider-field ${settingsMatchClass([t('connections.port'), String(sshProfile.port ?? ''), 'port ssh 22'])}`}>
	                            <span className="provider-field-label"><HighlightSearchText text={t('connections.port')} query={settingsSearch} /></span>
                            <input
                              type="number"
                              min={MIN_SSH_PORT}
                              max={MAX_SSH_PORT}
                              step="1"
                              className={`numeric-input ${!isValidSshPort(sshProfile.port) ? 'invalid-input' : ''}`}
                              aria-invalid={!isValidSshPort(sshProfile.port)}
                              value={sshProfile.port ?? ''}
                              placeholder="22"
                              onChange={(event) => {
                                const val = event.target.value
                                setSshProfile((p) => p ? { ...p, port: val ? Number(val) : undefined } : p)
                              }}
                              onBlur={commitSshPort}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.currentTarget.blur()
                                }
                              }}
                            />
                          </div>
                          <div className={`provider-field ${settingsMatchClass([t('connections.identityFile'), t('connections.browseIdentityFile'), sshProfile.identityFile, 'identity file key pem rsa private key'])}`}>
	                            <span className="provider-field-label"><HighlightSearchText text={t('connections.identityFile')} query={settingsSearch} /></span>
                            <div className="inline-field-action">
                              <input
                                value={sshProfile.identityFile ?? ''}
                                placeholder="~/.ssh/id_rsa"
                                onChange={(event) => setSshProfile((p) => p ? { ...p, identityFile: event.target.value } : p)}
                              />
                              <button type="button" className="quiet-button" onClick={() => void chooseSshIdentityFile()}>
	                                <HighlightSearchText text={t('connections.browseIdentityFile')} query={settingsSearch} />
                              </button>
                            </div>
                          </div>
                          <div className={`provider-field ${settingsMatchClass([t('connections.extraArgs'), sshProfile.extraArgs?.join(' '), 'extra args ssh options arguments'])}`}>
	                            <span className="provider-field-label"><HighlightSearchText text={t('connections.extraArgs')} query={settingsSearch} /></span>
                            <input
                              value={sshProfile.extraArgs?.join(' ') ?? ''}
                              placeholder="-o ServerAliveInterval=30"
                              onChange={(event) => {
                                const val = event.target.value.trim()
                                setSshProfile((p) => p ? { ...p, extraArgs: val ? val.split(/\s+/) : undefined } : p)
                              }}
                            />
                          </div>
                          <div className="connection-actions">
                            <button type="button" className="primary-button" disabled={!isValidSshPort(sshProfile.port)} onClick={() => void saveSshProfile()}>
                              {t('connections.save')}
                            </button>
                            {sshProfile.host ? (
                              <button type="button" className="primary-button connection-connect-button" disabled={!isValidSshPort(sshProfile.port)} onClick={() => connectSshProfile(sshProfile)}>
                                <Zap size={13} aria-hidden />
                                {t('connections.connect')}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="connections-empty-detail">
                          {sshProfiles.length === 0 ? (
                            <button type="button" className="quiet-button connection-connect-button" onClick={addSshProfile}>
                              <Plus size={13} aria-hidden />
                              {t('connections.emptyCta')}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'prompts' ? (
                  <>
                    <h3 className="settings-content-title">{t('prompts.title')}</h3>
                    <PromptLibrarySection settingsSearch={settingsSearch} />
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'snippets' ? (
                  <>
                    <h3 className="settings-content-title">{t('snippets.title')}</h3>
                    <CommandSnippetLibrarySection
                      addSnippetRequestVersion={addSnippetRequestVersion}
                      snippetDraftRequest={snippetDraftRequest}
                      settingsSearch={settingsSearch}
                    />
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'chatTools' ? (
                  <>
                    <h3 className="settings-content-title">{t('chatTools.title')}</h3>
                    <div className={`appearance-row ${settingsMatchClass([
                      t('chatTools.taskList.label'),
                      t('chatTools.taskList.desc'),
                      'chat tools task list planning checklist steps plan agent automation'
                    ])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('chatTools.taskList.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('chatTools.taskList.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <button
                          type="button"
                          className={`security-switch ${chatToolsSettings.taskListPlanning ? 'on' : ''}`}
                          role="switch"
                          aria-checked={chatToolsSettings.taskListPlanning}
                          aria-label={t('chatTools.taskList.label')}
                          title={chatToolsSettings.taskListPlanning ? t('chatTools.taskList.on') : t('chatTools.taskList.off')}
                          onClick={() => saveChatToolsSettings({ ...chatToolsSettings, taskListPlanning: !chatToolsSettings.taskListPlanning })}
                        >
                          <span aria-hidden />
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                {!settingsNoResults && settingsTab === 'data' ? (
                  <>
                    <h3 className="settings-content-title">{t('data.title')}</h3>
                    <section className={`data-usage-panel ${settingsMatchClass([
                      t('data.usage.title'),
                      t('data.usage.desc'),
                      t('data.usage.storage'),
                      t('data.usage.chats'),
                      t('data.usage.sessions'),
                      'usage storage local stats saved chats sessions history'
                    ])}`}>
                      <div className="settings-section-heading">
                        <span><HighlightSearchText text={t('data.usage.title')} query={settingsSearch} /></span>
                      </div>
                      <p className="data-usage-desc"><HighlightSearchText text={t('data.usage.desc')} query={settingsSearch} /></p>
                      <div className="data-usage-grid">
                        <div className="data-usage-card">
                          <Database size={15} aria-hidden />
                          <span>{dataUsageStorage}</span>
                          <small><HighlightSearchText text={t('data.usage.storage')} query={settingsSearch} /></small>
                        </div>
                        <div className="data-usage-card">
                          <History size={15} aria-hidden />
                          <span>{dataUsageChats}</span>
                          <small><HighlightSearchText text={t('data.usage.chats')} query={settingsSearch} /></small>
                        </div>
                        <div className="data-usage-card">
                          <SquareTerminal size={15} aria-hidden />
                          <span>{dataUsageSessions}</span>
                          <small><HighlightSearchText text={t('data.usage.sessions')} query={settingsSearch} /></small>
                        </div>
                      </div>
                    </section>
                    <div className={`appearance-row ${settingsMatchClass([t('appearance.outputContext.label'), t('appearance.outputContext.desc'), 'output context ai max characters chars terminal'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('appearance.outputContext.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc"><HighlightSearchText text={t('appearance.outputContext.desc')} query={settingsSearch} /></small>
                      </div>
                      <div className="appearance-row-right">
                        <input
                          className={`numeric-input ${!isValidOutputContext(maxOutputContextDraft) ? 'invalid-input' : ''}`}
                          type="number"
                          step="1000"
                          min={MIN_OUTPUT_CONTEXT}
                          value={maxOutputContextDraft}
                          onChange={(event) => handleMaxOutputContextChange(event.target.value)}
                          onBlur={commitMaxOutputContextDraft}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                          }}
                        />
                        <span className="input-suffix">chars</span>
                      </div>
                    </div>
                    <div className={`appearance-row ${settingsMatchClass([t('data.restoreSessions.label'), t('data.restoreSessions.desc'), 'restore sessions startup state'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('data.restoreSessions.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc">
                          <HighlightSearchText text={t('data.restoreSessions.desc')} query={settingsSearch} />
                        </small>
                      </div>
                      <div className="appearance-row-right">
                        <button
                          className={`agent-toggle ${restoreSessions ? 'on' : ''}`}
                          type="button"
                          role="switch"
                          aria-checked={restoreSessions}
                          title={t('data.restoreSessions.label')}
                          onClick={() => onRestoreSessionsChange(!restoreSessions)}
                        >
                          <span />
                        </button>
                      </div>
                    </div>
                    <div className={`appearance-row ${settingsMatchClass([t('data.exportImport.label'), t('data.exportImport.desc'), t('data.export'), t('data.import'), 'export import backup json settings'])}`}>
                      <div className="appearance-row-left">
                        <span className="appearance-row-label"><HighlightSearchText text={t('data.exportImport.label')} query={settingsSearch} /></span>
                        <small className="appearance-row-desc">
                          <HighlightSearchText text={t('data.exportImport.desc')} query={settingsSearch} />
                        </small>
                      </div>
                      <div className="appearance-row-right" style={{ gap: 8, display: 'flex' }}>
                        <button type="button" className="quiet-button" onClick={() => void handleExport()}>
                          <HighlightSearchText text={t('data.export')} query={settingsSearch} />
                        </button>
                        <button type="button" className="quiet-button" onClick={() => void handleImport()}>
                          <HighlightSearchText text={t('data.import')} query={settingsSearch} />
                        </button>
                      </div>
                    </div>
                    <div className="danger-zone">
                      <div className="danger-zone-header">
                        <span>{t('data.dangerZone')}</span>
                      </div>
                      <div className={`appearance-row ${settingsMatchClass([t('data.clearSessions.label'), t('data.clearSessions.desc'), t('data.clearSessions'), 'clear saved state session destructive'])}`}>
                        <div className="appearance-row-left">
                          <span className="appearance-row-label"><HighlightSearchText text={t('data.clearSessions.label')} query={settingsSearch} /></span>
                          <small className="appearance-row-desc">
                            <HighlightSearchText text={t('data.clearSessions.desc')} query={settingsSearch} />
                          </small>
                        </div>
                        <div className="appearance-row-right">
                          <button type="button" className="danger-outline-button" onClick={() => void handleClearSavedSessionState()}>
                            <HighlightSearchText text={t('data.clearSessions')} query={settingsSearch} />
                          </button>
                        </div>
                      </div>
                      <div className={`appearance-row ${settingsMatchClass([t('data.clearChatHistory.label'), t('data.clearChatHistory.desc'), t('data.clearChatHistory'), 'clear chat history destructive'])}`}>
                        <div className="appearance-row-left">
                          <span className="appearance-row-label"><HighlightSearchText text={t('data.clearChatHistory.label')} query={settingsSearch} /></span>
                          <small className="appearance-row-desc">
                            <HighlightSearchText text={t('data.clearChatHistory.desc')} query={settingsSearch} />
                          </small>
                        </div>
                        <div className="appearance-row-right">
                          <button type="button" className="danger-outline-button" onClick={handleClearChatHistory}>
                            <HighlightSearchText text={t('data.clearChatHistory')} query={settingsSearch} />
                          </button>
                        </div>
                      </div>
                    </div>
                    {dataStatus ? <p className="settings-status">{dataStatus}</p> : null}
                  </>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      , document.body) : null}

      {historyOpen ? (
        <div className="history-overlay">
          <div className="history-search">
            <Search size={14} aria-hidden />
            <input
              type="text"
              placeholder={t('chat.historySearch')}
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
          </div>
          <div className="history-list">
            {filteredHistoryChats.length === 0 ? (
              <div className="history-empty">
                <History size={28} aria-hidden />
                <p>{historyChats.length > 0 && historySearch.trim()
                  ? t('chat.historyNoMatch', { query: historySearch.trim() })
                  : t('chat.historyEmpty')}</p>
              </div>
            ) : (
              filteredHistoryChats.map((chat) => (
                <div key={chat.id} className="history-item" onClick={() => handleReopenChat(chat.id)}>
                  <div className="history-item-info">
                    <span className="history-item-title">{chat.title}</span>
                    <span className="history-item-meta">
                      {new Date(chat.createdAt).toLocaleDateString()} · {chat.messageCount} {t('chat.historyMessages')}
                      {chat.modelId ? ` · ${formatModelLabel(chat.modelId).name}` : ''}
                    </span>
                  </div>
                  <div className="history-item-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={(e) => { e.stopPropagation(); void handleDeleteHistoryChat(chat.id) }}
                      title={t('chat.historyDelete')}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
      <>
      <section className="chat-log" aria-live="polite" ref={chatLogRef} onScroll={handleChatLogScroll}>
        {taskList ? (
          <TaskListPanel
            key={taskListKey}
            taskList={taskList}
            t={t}
          />
        ) : null}
        {showActivationFlow ? (
          <div className="activation-empty-state">
            <div className="activation-heading">
              <span className="activation-icon" aria-hidden><Zap size={17} /></span>
              <div>
                <strong>{t('onboarding.title')}</strong>
                <p>{t('onboarding.body')}</p>
              </div>
            </div>

            <div className="activation-step">
              <div className="activation-step-label">
                <span>1</span>
                <strong>{t('onboarding.provider')}</strong>
              </div>
              <div className="activation-provider-grid" role="group" aria-label={t('onboarding.provider')}>
                {providerTypeOptions.map((providerType) => (
                  <button
                    key={providerType}
                    type="button"
                    className={providerType === activeProviderType ? 'active' : ''}
                    onClick={() => handleActivationProviderTypeChange(providerType)}
                  >
                    {t(`providers.type.${providerType}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="activation-step">
              <div className="activation-step-label">
                <span>2</span>
                <strong>{activeProviderNeedsApiKey ? t('onboarding.apiKey') : t('onboarding.endpoint')}</strong>
              </div>
              <div className="activation-fields">
                <input
                  value={provider.baseUrl}
                  className={provider.baseUrl.trim() && !isValidProviderBaseUrl(provider.baseUrl) ? 'invalid-input' : undefined}
                  aria-invalid={Boolean(provider.baseUrl.trim() && !isValidProviderBaseUrl(provider.baseUrl))}
                  placeholder={t('providers.baseUrl')}
                  onChange={(event) => setProvider((current) => ({ ...current, baseUrl: event.target.value }))}
                />
                {activeProviderNeedsApiKey ? (
                  !editingApiKey && activeHasApiKey ? (
                    <div className="apikey-masked activation-key-saved">
                      <span className="apikey-masked-text">●●●●●●●●</span>
                      <span className="apikey-masked-hint">{t('providers.apiKey.saved')}</span>
                      <button type="button" className="apikey-change-btn" onClick={() => setEditingApiKey(true)}>
                        {t('providers.apiKey.change')}
                      </button>
                    </div>
                  ) : (
                    <input
                      type="password"
                      value={apiKey}
                      className={activeProviderNeedsApiKey && !activeHasApiKey && !apiKey.trim() && providerStatus === t('onboarding.apiKeyRequired') ? 'invalid-input' : undefined}
                      placeholder={t('onboarding.apiKeyPlaceholder')}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                  )
                ) : (
                  <p className="activation-field-note">{t('onboarding.localProviderNote')}</p>
                )}
              </div>
            </div>

            <div className="activation-step">
              <div className="activation-step-label">
                <span>3</span>
                <strong>{t('onboarding.test')}</strong>
              </div>
              <div className="activation-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canTestActivationProvider}
                  onClick={() => void handleActivationTest()}
                >
                  <RefreshCw size={13} aria-hidden />
                  {t('onboarding.testConnection')}
                </button>
                {activationStatus ? (
                  <div className={`inline-status ${activationStatus.tone}`}>
                    <span>{activationStatus.label}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="activation-step">
              <div className="activation-step-label">
                <span>4</span>
                <strong>{t('onboarding.model')}</strong>
              </div>
              <ModelCombobox
                value={provider.selectedModel ?? ''}
                models={models}
                placeholder={t('providers.searchChatModel')}
                onOpen={() => void handleActivationTest()}
                onChange={(modelId) => {
                  const updated = {
                    ...provider,
                    selectedModel: modelId,
                    commandRiskModel: provider.commandRiskModel || modelId
                  }
                  updateProvider(updated)
                }}
              />
            </div>

          </div>
        ) : messages.length === 0 ? (
          <div className="empty-chat">
            <strong>{t('chat.empty.title')}</strong>
            <p>{t('chat.empty.body')}</p>
            {providerReady ? (
              <button type="button" className="primary-button empty-chat-primary" onClick={handleFirstQuestion}>
                <Send size={13} aria-hidden />
                {t('onboarding.firstQuestion')}
              </button>
            ) : null}
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
          const boundLastAssistant = isLastAssistant && (streaming || agenticRunning)
          const showDots = isLastAssistant && streaming && !message.content && !message.reasoningContent
          const reasoningIsStreaming = isLastAssistant && streaming && Boolean(message.reasoningContent) && !message.content
          const messageActionsDisabled = streaming || agenticRunning || agenticCommandRunning || Boolean(commandConfirmation)
          const canRegenerate = message.role === 'assistant' && index > 0
          const canFork = message.role === 'assistant'
          const assistantCopyContent = message.role === 'assistant'
            ? message.displayContent ?? hideSecretPlaceholders(message.maskedContent ?? message.content, maskedSecretLabel)
            : ''
          const canCopyMessage = Boolean(assistantCopyContent)

          if (message.display === 'command-output') {
            const visibleCommand = message.command ? hideSecretPlaceholders(message.command, maskedSecretLabel) : ''
            const visibleOutput = hideSecretPlaceholders(message.output?.trim() ?? '', maskedSecretLabel)
            const terminalContextSent = wasTerminalContextSentToProvider(message.content, message.terminalContextSent)
            return (
              <div className="command-output-message" key={`command-output-${index}`}>
                <div>
                  <span className="system-prefix">&gt;</span>
                  <span>{t(terminalContextSent ? 'chat.commandOutput.label' : 'chat.commandOutput.hiddenLabel')}</span>
                  {visibleCommand ? <code>{visibleCommand}</code> : null}
                </div>
                <details>
                  <summary>{t('chat.commandOutput.show')}</summary>
                  <pre>{visibleOutput || t('chat.commandOutput.noOutput')}</pre>
                </details>
              </div>
            )
          }

          if (message.display === 'privacy-status') {
            return (
              <PrivacyTrustCard
                key={`privacy-status-${index}`}
                content={message.content}
                notice={message.privacy}
                onOpenSecuritySettings={openSecuritySettings}
              />
            )
          }

          if (message.display === 'tool-call') {
            const toolName = hideSecretPlaceholders(message.command ?? '', maskedSecretLabel)
            const toolResultKey = message.toolCallId ?? `${index}:${message.command ?? ''}`
            const rawToolOutput = toolResultOutputs.get(toolResultKey) ?? ''
            const hasOutput = Boolean(rawToolOutput.trim())
            const expandedResult = expandedToolResults.has(toolResultKey)
            const output = expandedResult ? hideSecretPlaceholders(formatToolCallOutput(rawToolOutput), maskedSecretLabel) : ''
            const failed = /failed$/i.test(message.content)
            const running = /^Calling MCP tool/i.test(message.content)
            return (
              <div className={`tool-call-message ${running ? 'running' : ''} ${failed ? 'failed' : ''}`} key={`tool-call-${index}`}>
                <div>
                  <span className="tool-call-icon">
                    {running ? <RefreshCw size={12} aria-hidden /> : <Hammer size={12} aria-hidden />}
                  </span>
                  <span className="tool-call-label">{failed ? 'MCP failed' : running ? 'MCP running' : 'MCP used'}</span>
                  {toolName ? <code>{toolName}</code> : null}
                  {hasOutput ? (
                    <button
                      type="button"
                      className="tool-call-result-toggle"
                      onClick={() => {
                        setExpandedToolResults((current) => {
                          const next = new Set(current)
                          if (next.has(toolResultKey)) next.delete(toolResultKey)
                          else next.add(toolResultKey)
                          return next
                        })
                      }}
                      aria-expanded={expandedResult}
                    >
                      <ChevronDown size={11} aria-hidden />
                      <span>{failed ? 'Error' : 'Result'}</span>
                    </button>
                  ) : null}
                </div>
                {expandedResult && output ? <pre>{output}</pre> : null}
              </div>
            )
          }

          if (message.display === 'system-status') {
            if (message.command && message.output) {
              const visibleOriginalCommand = hideSecretPlaceholders(message.output, maskedSecretLabel)
              const visibleFinalCommand = hideSecretPlaceholders(message.command, maskedSecretLabel)
              return (
                <div className="command-output-message command-edit-message" key={`system-status-${index}`}>
                  <div>
                    <span className="system-prefix">&gt;</span>
                    <span>{t('chat.commandEdited.label')}</span>
                  </div>
                  <div className="command-edit-details">
                    <div>
                      <span>{t('chat.commandEdited.original')}</span>
                      <pre>{visibleOriginalCommand}</pre>
                    </div>
                    <div>
                      <span>{t('chat.commandEdited.final')}</span>
                      <pre>{visibleFinalCommand}</pre>
                    </div>
                  </div>
                </div>
              )
            }
            return (
              <div className="command-output-message command-edit-message" key={`system-status-${index}`}>
                <div>
                  <span className="system-prefix">&gt;</span>
                  <span>{hideSecretPlaceholders(message.content, maskedSecretLabel)}</span>
                </div>
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
              {message.role === 'assistant' && message.reasoningContent ? (
                <ThinkingBlock
                  content={hideSecretPlaceholders(message.reasoningContent, maskedSecretLabel)}
                  isStreaming={reasoningIsStreaming}
                  title={t('chat.thinking')}
                />
              ) : null}
              {message.role === 'assistant' && message.privacy ? (
                <PrivacyTrustCard
                  content={t('status.privacyMasked', { count: message.privacy.maskedSecretCount })}
                  notice={message.privacy}
                  onOpenSecuritySettings={openSecuritySettings}
                />
              ) : null}
              {showDots ? (
                <div className="streaming-dots">
                  <span /><span /><span />
                </div>
              ) : message.role === 'assistant' && message.content ? (
                <BoundedScroll
                  bounded={boundLastAssistant}
                  streaming={streaming || agenticRunning}
                  scrollToken={(message.displayContent ?? message.maskedContent ?? message.content).length}
                  showMoreLabel={t('taskList.showMore')}
                  showLessLabel={t('taskList.showLess')}
                  ariaLabel={t('taskList.currentStep')}
                >
                  <MessageContent
                    content={message.displayContent ?? message.maskedContent ?? message.content}
                    redactContent={(value) => hideSecretPlaceholders(value, maskedSecretLabel)}
                    hidePlanningFences={Boolean(taskList)}
                    onRun={runCommand}
                    onPrompt={setPromptDraft}
                    disabled={!activeSession || agenticCommandRunning}
                    runLabel={t('chat.runInTerminal')}
                    expandCommandLabel={t('chat.showFullCommand')}
                    collapseCommandLabel={t('chat.collapseCommand')}
                    copyCodeLabel={t('chat.copyCode')}
                    copiedLabel={t('chat.copied')}
                  />
                </BoundedScroll>
              ) : message.role === 'assistant' ? null : (
                <p>{message.displayContent ?? hideSecretPlaceholders(message.content, maskedSecretLabel)}</p>
              )}
              {canCopyMessage || canRegenerate || canFork ? (
                <div className="chat-message-actions">
                  {canCopyMessage ? (
                    <button
                      type="button"
                      className="chat-message-action"
                      onClick={() => { void copyAssistantMessage(index, assistantCopyContent) }}
                      disabled={messageActionsDisabled}
                      title={copiedMessageIndex === index ? t('chat.copied') : t('chat.copyMessage')}
                      aria-label={copiedMessageIndex === index ? t('chat.copied') : t('chat.copyMessage')}
                    >
                      {copiedMessageIndex === index ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
                    </button>
                  ) : null}
                  {canRegenerate ? (
                    <button
                      type="button"
                      className="chat-message-action"
                      onClick={() => regenerateMessage(index)}
                      disabled={messageActionsDisabled}
                      title={t('chat.regenerate')}
                      aria-label={t('chat.regenerate')}
                    >
                      <RefreshCw size={11} aria-hidden />
                    </button>
                  ) : null}
                  {canFork ? (
                    <button
                      type="button"
                      className="chat-message-action"
                      onClick={() => forkChatFromMessage(index)}
                      disabled={messageActionsDisabled}
                      title={t('chat.forkFromMessage')}
                      aria-label={t('chat.forkFromMessage')}
                    >
                      <GitFork className="chat-message-action-icon-fork" size={11} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          )
        })}

        {agenticRunning && agenticStep > 0 ? (
          <div className="agentic-status">
            <Zap size={12} aria-hidden />
            <span>{t('agent.step', { step: agenticStep, state: commandConfirmation ? t('agent.waiting') : t('agent.running') })} <code>{visibleAgenticCommand}</code></span>
          </div>
        ) : null}

        {status ? (
          <div className={`inline-status ${status.tone}`}>
            <span>{status.label}</span>
          </div>
        ) : null}
      </section>

      {commandConfirmation ? (
        <CommandConfirmationDialog
          commandConfirmation={commandConfirmation}
          confirmCountdown={confirmCountdown}
          commandUsesLocalSecret={commandConfirmationUsesLocalSecret}
          visibleCommand={visibleCommandConfirmationCommand}
          t={t}
          onCancel={(sessionId) => resolveCommandConfirmation(sessionId, false)}
          onConfirm={(sessionId, command) => resolveCommandConfirmation(sessionId, true, command)}
          onCommandChange={updateCommandConfirmationCommand}
        />
      ) : null}

      <form
        className={`chat-form ${inputDisabled ? 'disabled' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage()
        }}
      >
        <div className="chat-composer-shell">
          <textarea
            ref={textareaRef}
            value={draft}
            disabled={inputDisabled}
            onChange={(event) => {
              if (activeSessionId) {
                updateThread(activeSessionId, (thread) => ({ ...thread, draft: event.target.value }))
              }
            }}
            onKeyDown={(event) => {
              const wantsSend = event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
              const wantsMetaSend = event.key === 'Enter' && event.metaKey && !event.nativeEvent.isComposing
              if (wantsSend || wantsMetaSend) {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder={t('chat.input.placeholder')}
            title={t('chat.input.tooltip')}
            rows={1}
          />
          <div className="chat-composer-footer">
            <div className="chat-form-actions">
              {liveStatus && assistMode !== 'off' && isLiveSessionStatus(activeSession?.status) ? (
                <span className={`composer-status-chip ${liveStatus}`} aria-live="polite" aria-label={t(`panel.status.${liveStatus}`)}>
                  <span className="composer-status-dot" aria-hidden />
                  <span>{t(`panel.status.${liveStatus}`)}</span>
                </span>
              ) : null}
              <ComposerConfigControl
                open={composerConfigOpen}
                assistMode={assistMode}
                modeLabel={composerModeLabel}
                modelLabel={composerModelDisplay}
                contextLabel={composerContextLabel}
                maskedSecretLabel={composerMaskedSecretLabel}
                maskedSecretCount={composerMaskedSecretCount}
                t={t}
                onOpenChange={setComposerConfigOpen}
                onAssistModeChange={setComposerAssistMode}
                onOpenModelSwitcher={openComposerModelSwitcher}
                onOpenPromptLibrary={openComposerPromptLibrary}
              />
              {streaming || agenticRunning ? (
                <button
                  className="stop-button"
                  type="button"
                  onClick={() => {
                    if (activeSessionId) stopAgentic(activeSessionId)
                  }}
                  title={t('chat.stopAgent')}
                  aria-label={t('chat.stopAgent')}
                >
                  <Square size={14} aria-hidden />
                </button>
              ) : null}
              <button
                className={`send-button ${streaming ? 'streaming' : ''}`}
                type="submit"
                disabled={streaming || agenticCommandRunning || inputDisabled || !draft.trim()}
                title={t('chat.send')}
                aria-label={t('chat.send')}
              >
                <Send size={15} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </form>
      </>
      )}

      {savePromptDialog ? createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) closeSavePromptDialog() }}
        >
          <div className="modal-panel">
            <div className="modal-header">
              <BookmarkPlus size={15} aria-hidden />
              <span>{t('chat.saveAsPrompt')}</span>
            </div>
            {savePromptDialog.content === '' ? (
              <>
                <div className="save-prompt-generating">
                  <span className="save-prompt-spinner" />
                  <span>{t('chat.savePrompt.generating')}</span>
                </div>
                <div className="modal-actions">
                  <button type="button" className="quiet-button" onClick={closeSavePromptDialog}>
                    {t('prompts.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  className="save-prompt-name-input"
                  value={savePromptName}
                  onChange={(e) => setSavePromptName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSavePromptFromChat()
                    if (e.key === 'Escape') closeSavePromptDialog()
                  }}
                  placeholder={t('prompts.namePlaceholder')}
                  autoFocus
                />
                {savePromptDuplicateName ? (
                  <p className="form-warning">{t('prompts.duplicateName')}</p>
                ) : null}
                <textarea
                  className="save-prompt-content-editor"
                  value={savePromptDialog.content}
                  onChange={(e) => setSavePromptDialog({ ...savePromptDialog, content: e.target.value })}
                  rows={6}
                />
                <div className="modal-actions">
                  <button type="button" className="quiet-button" onClick={closeSavePromptDialog}>
                    {t('prompts.cancel')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleSavePromptFromChat()}
                    disabled={savePromptStatus === 'saving' || savePromptDuplicateName || !savePromptName.trim() || !savePromptDialog.content.trim()}
                  >
                    {savePromptStatus === 'saved'
                      ? t('chat.savePrompt.saved')
                      : savePromptStatus === 'saving'
                        ? t('chat.savePrompt.saving')
                        : t('chat.savePrompt.save')}
                  </button>
                </div>
                {savePromptStatus === 'error' ? (
                  <p className="save-prompt-error">{t('chat.savePrompt.error')}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      , document.body) : null}

      {deleteConfirmation ? (
        <ConfirmDialog
          title={deleteConfirmation.title}
          message={deleteConfirmation.message}
          confirmLabel={deleteConfirmation.confirmLabel}
          onConfirm={() => void confirmDeleteAction()}
          onCancel={() => setDeleteConfirmation(null)}
        />
      ) : null}

      {modelSwitcherOpen ? createPortal(
        <CommandPalette
          actions={modelSwitchActions}
          recentActionIds={[]}
          labels={{
            title: t('model.switch.title'),
            search: t('model.switch.search'),
            recent: t('commandPalette.recent'),
            all: t('model.switch.all'),
            commands: t('commandPalette.commands'),
            snippets: t('commandPalette.snippets'),
            prompts: t('commandPalette.prompts'),
            noMatch: t('model.noMatch'),
            enterSelects: t('commandPalette.enterSelects'),
            escapeCloses: t('commandPalette.escapeCloses')
          }}
          showCategoryFilters={false}
          onClose={() => setModelSwitcherOpen(false)}
          onRun={(action) => {
            if (action.id.startsWith('model:') && action.id !== 'model:load') {
              selectChatModel(action.id.slice('model:'.length))
            }
          }}
        />
      , document.body) : null}
    </aside>
  )
}

interface ModelComboboxProps {
  value: string
  models: LLMModel[]
  placeholder: string
  onOpen?: () => void
  onChange: (modelId: string) => void
}

function ModelCombobox({ value, models, placeholder, onOpen, onChange }: ModelComboboxProps): JSX.Element {
  const { t } = useT()
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [listPos, setListPos] = useState<DOMRect | null>(null)

  const formattedValue = useMemo(() => {
    return formatModelDisplay(value)
  }, [value])

  // When dropdown closes, reset query so input shows formatted value
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  // Track input position for portal-positioned dropdown
  useEffect(() => {
    if (!open) { setListPos(null); return }
    const update = () => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      setListPos(rect ?? null)
    }
    update()
    const ro = new ResizeObserver(update)
    if (wrapperRef.current) ro.observe(wrapperRef.current)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
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

  const openList = useCallback(() => {
    if (!open) onOpen?.()
    setOpen(true)
  }, [onOpen, open])

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
      openList()
      setActiveIndex((index) => Math.min(index + 1, Math.max(visibleModels.length - 1, 0)))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      openList()
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
  }, [activeModel, closeList, commitModel, open, openList, visibleModels.length])

  const listContent = open ? (
    <div
      className="model-combobox-list"
      id={listboxId}
      role="listbox"
      style={listPos ? (() => {
        const gap = 6
        const spaceBelow = window.innerHeight - listPos.bottom - 16
        const spaceAbove = listPos.top - 16
        const opensUp = spaceBelow < 180 && listPos.top > spaceBelow
        const availableSpace = opensUp ? spaceAbove : spaceBelow
        const maxHeight = Math.min(220, Math.max(120, availableSpace - gap))
        return {
          position: 'fixed',
          top: opensUp ? Math.max(16, listPos.top - maxHeight - gap) : listPos.bottom + gap,
          left: listPos.left,
          width: listPos.width,
          maxHeight
        }
      })() : undefined}
    >
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
              <span className="model-combobox-option-name">
                {model.supportsMcp ? <Hammer className="model-mcp-icon" size={12} aria-label={t('model.supportsMcp')} /> : null}
                <span>{modelDisplay}</span>
              </span>
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
  ) : null

  return (
    <div ref={wrapperRef} className={`model-combobox ${open ? 'open' : ''}`} onBlur={handleBlur}>
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
          openList()
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          openList()
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
          if (open) {
            closeList()
            return
          }
          openList()
          inputRef.current?.focus()
        }}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
      {listContent ? createPortal(listContent, document.body) : null}
    </div>
  )
}

function SettingsStatus({ label }: { label: string }): JSX.Element {
  const { t } = useT()

  if (label === t('status.saved')) {
    return (
      <div className="inline-status success settings-inline-status">
        <Check size={13} aria-hidden />
        <span>{label}</span>
      </div>
    )
  }

  return <p className="settings-status">{label}</p>
}

interface PromptLibrarySectionProps {
  settingsSearch: string
}

function PromptLibrarySection({ settingsSearch }: PromptLibrarySectionProps): JSX.Element {
  const { t } = useT()
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [editing, setEditing] = useState<PromptTemplate | null>(null)
  const [addingPrompt, setAddingPrompt] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [promptStatus, setPromptStatus] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const promptNameInputRef = useRef<HTMLInputElement | null>(null)
  const promptFormRef = useRef<HTMLDivElement | null>(null)
  const duplicateName = useMemo(() => {
    const name = normalizeLibraryName(newName)
    if (!name) return false
    return prompts.some((prompt) => prompt.id !== editing?.id && normalizeLibraryName(prompt.name) === name)
  }, [editing?.id, newName, prompts])
  const settingsMatchClass = useCallback((terms: Array<string | undefined>) => (
    matchesSearchQuery(settingsSearch, terms) ? 'settings-search-match' : ''
  ), [settingsSearch])

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
    if (!newName.trim() || !newContent.trim() || duplicateName) return
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
      setPromptStatus(t('status.saved'))
      await reload()
    } catch (err) {
      setPromptStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [duplicateName, editing, newContent, newName, reload, t])

  const handleEdit = useCallback((prompt: PromptTemplate) => {
    setEditing(prompt)
    setAddingPrompt(false)
    setNewName(prompt.name)
    setNewContent(prompt.content)
  }, [])

  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await window.api.prompt.delete(id)
      await reload()
    } catch {
      // ignore
    }
  }, [pendingDeleteId, reload])

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

  useEffect(() => {
    if (!editing && !addingPrompt) return
    requestAnimationFrame(() => {
      promptNameInputRef.current?.focus()
      promptFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [editing, addingPrompt])

  return (
    <section className="settings-section">
      <div className={`settings-section-heading ${settingsMatchClass([t('prompts.title'), t('prompts.importFromFile'), t('prompts.addPrompt'), 'prompt prompts template markdown import library'])}`}>
        <span><HighlightSearchText text={t('prompts.title')} query={settingsSearch} /></span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="quiet-button prompt-import-btn" onClick={() => void handleImport()}>
            <HighlightSearchText text={t('prompts.importFromFile')} query={settingsSearch} />
          </button>
          {!editing && !addingPrompt ? (
            <button type="button" className="quiet-button" style={{ fontSize: 11 }} onClick={handleAddPrompt}>
              <Plus size={12} aria-hidden />
              {' '}<HighlightSearchText text={t('prompts.addPrompt')} query={settingsSearch} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="prompt-list">
        {prompts.length > 0 ? (
          prompts.map((prompt) => (
            <div key={prompt.id} className={`prompt-list-item ${settingsMatchClass([prompt.name, prompt.content])}`}>
              <div className="prompt-list-item-info">
                <span className="prompt-list-item-name"><HighlightSearchText text={prompt.name} query={settingsSearch} /></span>
                <span className="prompt-list-item-preview">
                  <HighlightSearchText text={`${prompt.content.slice(0, 80)}${prompt.content.length > 80 ? '…' : ''}`} query={settingsSearch} />
                </span>
              </div>
              <div className="prompt-list-item-actions">
                <button
                  type="button"
                  className="icon-button"
                  title={t('prompts.edit')}
                  onClick={() => handleEdit(prompt)}
                >
                  <Pencil size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={t('prompts.delete')}
                  onClick={() => void handleDelete(prompt.id)}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="prompt-list-empty">
            <p>{t('prompts.noPrompts')}</p>
            <button type="button" className="quiet-button" onClick={handleAddPrompt}>
              <Plus size={12} aria-hidden />
              {t('prompts.addPrompt')}
            </button>
          </div>
        )}
      </div>

      {(editing || addingPrompt) ? (
        <div ref={promptFormRef} className={`prompt-form ${settingsMatchClass([t('prompts.namePlaceholder'), t('prompts.contentPlaceholder'), t('prompts.savePrompt'), t('prompts.addPrompt'), newName, newContent, 'prompt name content'])}`}>
          <input
            ref={promptNameInputRef}
            type="text"
            placeholder={t('prompts.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          {duplicateName ? (
            <p className="form-warning">{t('prompts.duplicateName')}</p>
          ) : null}
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
              className="primary-button"
              disabled={!newName.trim() || !newContent.trim() || duplicateName}
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

      {promptStatus ? <SettingsStatus label={promptStatus} /> : null}

      {pendingDeleteId !== null ? (
        <ConfirmDialog
          title={withObjectName(t('prompts.deleteConfirmTitle'), prompts.find((prompt) => prompt.id === pendingDeleteId)?.name)}
          message={t('prompts.deleteConfirmMessage')}
          confirmLabel={t('prompts.deleteConfirmBtn')}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDeleteId(null)}
        />
      ) : null}
    </section>
  )
}

interface CommandSnippetLibrarySectionProps {
  addSnippetRequestVersion: number
  snippetDraftRequest?: { id: string; name?: string; command?: string } | null
  settingsSearch: string
}

function snippetNameFromCommand(command: string): string {
  return command.split('\n')[0]?.trim().slice(0, 48) || ''
}

function CommandSnippetLibrarySection({ addSnippetRequestVersion, snippetDraftRequest, settingsSearch }: CommandSnippetLibrarySectionProps): JSX.Element {
  const { t } = useT()
  const [snippets, setSnippets] = useState<CommandSnippet[]>([])
  const [editing, setEditing] = useState<CommandSnippet | null>(null)
  const [addingSnippet, setAddingSnippet] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [status, setStatus] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const handledSnippetDraftRequestRef = useRef<string>()
  const snippetNameInputRef = useRef<HTMLInputElement | null>(null)
  const snippetFormRef = useRef<HTMLDivElement | null>(null)
  const duplicateName = useMemo(() => {
    const normalizedName = normalizeLibraryName(name)
    if (!normalizedName) return false
    return snippets.some((snippet) => snippet.id !== editing?.id && normalizeLibraryName(snippet.name) === normalizedName)
  }, [editing?.id, name, snippets])
  const settingsMatchClass = useCallback((terms: Array<string | undefined>) => (
    matchesSearchQuery(settingsSearch, terms) ? 'settings-search-match' : ''
  ), [settingsSearch])

  const reload = useCallback(async () => {
    try {
      const list = await window.api.commandSnippet.list()
      setSnippets(list)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleSave = useCallback(async () => {
    if (!name.trim() || !command.trim() || duplicateName) return
    setStatus('Saving...')
    try {
      await window.api.commandSnippet.save({
        id: editing?.id ?? '',
        name: name.trim(),
        command: command.trim(),
        createdAt: editing?.createdAt ?? new Date().toISOString(),
        updatedAt: editing?.updatedAt ?? new Date().toISOString()
      })
      setName('')
      setCommand('')
      setEditing(null)
      setAddingSnippet(false)
      setStatus(t('status.saved'))
      await reload()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [command, duplicateName, editing, name, reload, t])

  const handleEdit = useCallback((snippet: CommandSnippet) => {
    setEditing(snippet)
    setAddingSnippet(false)
    setName(snippet.name)
    setCommand(snippet.command)
  }, [])

  const handleCancel = useCallback(() => {
    setEditing(null)
    setAddingSnippet(false)
    setName('')
    setCommand('')
  }, [])

  const handleAddSnippet = useCallback(() => {
    setEditing(null)
    setAddingSnippet(true)
    setName('')
    setCommand('')
  }, [])

  const handleAddSnippetDraft = useCallback((draftCommand: string, draftName?: string) => {
    setEditing(null)
    setAddingSnippet(true)
    setName(draftName?.trim() || snippetNameFromCommand(draftCommand))
    setCommand(draftCommand)
  }, [])

  useEffect(() => {
    if (addSnippetRequestVersion > 0) {
      handleAddSnippet()
    }
  }, [addSnippetRequestVersion, handleAddSnippet])

  useEffect(() => {
    if (!snippetDraftRequest || handledSnippetDraftRequestRef.current === snippetDraftRequest.id) return
    handledSnippetDraftRequestRef.current = snippetDraftRequest.id
    if (snippetDraftRequest.command?.trim()) {
      handleAddSnippetDraft(snippetDraftRequest.command.trim(), snippetDraftRequest.name)
    } else {
      handleAddSnippet()
    }
  }, [handleAddSnippet, handleAddSnippetDraft, snippetDraftRequest])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await window.api.commandSnippet.delete(id)
      await reload()
    } catch {
      // ignore
    }
  }, [pendingDeleteId, reload])

  useEffect(() => {
    if (!editing && !addingSnippet) return
    requestAnimationFrame(() => {
      snippetNameInputRef.current?.focus()
      snippetFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [editing, addingSnippet])

  return (
    <section className="settings-section">
      <div className={`settings-section-heading ${settingsMatchClass([t('snippets.title'), t('snippets.quickHint'), t('snippets.addSnippet'), 'snippet snippets command terminal shell quick open run insert'])}`}>
        <span><HighlightSearchText text={t('snippets.quickHint')} query={settingsSearch} /></span>
        {!editing && !addingSnippet ? (
          <button type="button" className="quiet-button" style={{ fontSize: 11 }} onClick={handleAddSnippet}>
            <Plus size={12} aria-hidden />
            {' '}<HighlightSearchText text={t('snippets.addSnippet')} query={settingsSearch} />
          </button>
        ) : null}
      </div>

      <div className="prompt-list">
        {snippets.length > 0 ? snippets.map((snippet) => (
          <div key={snippet.id} className={`prompt-list-item command-snippet-list-item ${settingsMatchClass([snippet.name, snippet.command])}`}>
            <Command size={13} aria-hidden />
            <div className="prompt-list-item-info">
              <span className="prompt-list-item-name"><HighlightSearchText text={snippet.name} query={settingsSearch} /></span>
              <span className="prompt-list-item-preview command-snippet-command"><HighlightSearchText text={snippet.command} query={settingsSearch} /></span>
            </div>
            <div className="prompt-list-item-actions">
              <button
                type="button"
                className="icon-button"
                title={t('snippets.edit')}
                onClick={() => handleEdit(snippet)}
              >
                <Pencil size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t('snippets.delete')}
                onClick={() => setPendingDeleteId(snippet.id)}
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          </div>
        )) : (
          <div className="prompt-list-empty">
            <p>{t('snippets.noSnippets')}</p>
            <button type="button" className="quiet-button" onClick={handleAddSnippet}>
              <Plus size={12} aria-hidden />
              {t('snippets.addSnippet')}
            </button>
          </div>
        )}
      </div>

      {(editing || addingSnippet) ? (
        <div ref={snippetFormRef} className={`prompt-form ${settingsMatchClass([t('snippets.namePlaceholder'), t('snippets.commandPlaceholder'), t('snippets.saveSnippet'), t('snippets.addSnippet'), name, command, 'snippet command shell terminal'])}`}>
          <input
            ref={snippetNameInputRef}
            type="text"
            placeholder={t('snippets.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {duplicateName ? (
            <p className="form-warning">{t('snippets.duplicateName')}</p>
          ) : null}
          <textarea
            className="prompt-form-content command-snippet-form-command"
            placeholder={t('snippets.commandPlaceholder')}
            rows={4}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
          <div className="prompt-form-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!name.trim() || !command.trim() || duplicateName}
              onClick={() => void handleSave()}
            >
              {editing ? t('snippets.saveSnippet') : t('snippets.addSnippet')}
            </button>
            {(editing || addingSnippet) ? (
              <button type="button" className="quiet-button" onClick={handleCancel}>
                {t('prompts.cancel')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {status ? <SettingsStatus label={status} /> : null}

      {pendingDeleteId !== null ? (
        <ConfirmDialog
          title={withObjectName(t('snippets.deleteConfirmTitle'), snippets.find((snippet) => snippet.id === pendingDeleteId)?.name)}
          message={t('snippets.deleteConfirmMessage')}
          confirmLabel={t('snippets.deleteConfirmBtn')}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDeleteId(null)}
        />
      ) : null}
    </section>
  )
}
