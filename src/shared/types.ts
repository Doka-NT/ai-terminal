// SPDX-License-Identifier: MPL-2.0
export type TerminalSessionKind = 'local' | 'ssh'
export type AssistMode = 'off' | 'read' | 'agent'
export type SecretMaskingMode = 'off' | 'on'
export type TerminalCursorStyle = 'block' | 'underline' | 'bar'
export type SecretMaskingAuditScope = 'chat-display' | 'provider-payload'
export type SecretMaskingAuditSource = 'chat-stream' | 'chat-display' | 'command-risk' | 'summary' | 'terminal-display' | 'chat-storage'
export type AppShortcutAction =
  | 'clear-terminal'
  | 'open-command-palette'
  | 'open-prompt-library'
  | 'open-command-snippets'
  | 'open-settings'
  | 'new-tab'
  | 'close-tab'
  | 'toggle-sidebar'
  | 'next-tab'
  | `switch-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

export interface TerminalSessionInfo {
  id: string
  kind: TerminalSessionKind
  label: string
  localLabel?: string
  cwd?: string
  shell?: string
  remoteHost?: string
  remoteTarget?: string
  reconnectCommand?: string
  command: string
  createdAt: number
  shellIntegrationNonce?: string
}

export interface CreateTerminalRequest {
  cwd?: string
  cols?: number
  rows?: number
}

export interface CreateSshCommandRequest extends CreateTerminalRequest {
  command: string
  label?: string
  remoteHost?: string
  remoteTarget?: string
}

export interface TerminalCommandEvent {
  sessionId: string
  command: string
  echoed: boolean
}

export interface TerminalPromptEvent {
  sessionId: string
}

export interface TerminalBlock {
  id: string
  sessionId: string
  command: string
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
  complete: boolean
}

export interface SSHProfile {
  name?: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  extraArgs?: string[]
}

export interface SSHProfileConfig extends SSHProfile {
  id: string
}

export interface LLMProviderConfig {
  name: string
  providerType?: LLMProviderType
  baseUrl: string
  apiKeyRef: string
  selectedModel?: string
  commandRiskModel?: string
  defaultHeaders?: Record<string, string>
  allowInsecureTls?: boolean
  proxyUrl?: string
  proxyUsername?: string
  proxyPasswordRef?: string
}

export interface SecretMaskingCustomPattern {
  id: string
  name: string
  pattern: string
  enabled: boolean
  createdAt: string
}

export interface SecretMaskingSettings {
  mode: SecretMaskingMode
  applyToChatDisplay: boolean
  applyToProviderPayloads: boolean
  strictTerminalContext: boolean
  customPatterns: SecretMaskingCustomPattern[]
}

export interface ChatToolsSettings {
  /**
   * When enabled, the assistant first drafts a task list for complex multi-step
   * requests and tracks progress through it. Off by default so agent mode keeps
   * its current behaviour until the user opts in.
   */
  taskListPlanning: boolean
}

export interface SecretMaskingAuditEvent {
  id: string
  createdAt: string
  source: SecretMaskingAuditSource
  scope: SecretMaskingAuditScope
  sessionLabel?: string
  maskedSecretCount: number
  categories: string[]
}

export interface PrivacyMaskingNotice {
  maskedSecretCount: number
  categories: string[]
  source: SecretMaskingAuditSource
  scope: SecretMaskingAuditScope
  sessionLabel?: string
}

export type LLMProviderType = 'openai' | 'ollama' | 'lmstudio' | 'anthropic'

export interface SaveLLMProviderRequest {
  provider: LLMProviderConfig
  apiKey?: string
  /** Empty string clears the saved proxy password; omitted keeps it unchanged. */
  proxyPassword?: string
}

export interface ListModelsResult {
  models: LLMModel[]
  provider: LLMProviderConfig
}

export interface LLMModel {
  id: string
  ownedBy?: string
  supportsMcp?: boolean
}

export type McpServerSource =
  | 'manual'
  | 'claude'
  | 'copilot'
  | 'codex'
  | 'opencode'
  | 'lmstudio'
  | 'ollama'
  | 'cursor'
  | 'windsurf'

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  tools?: McpToolConfig[]
  enabled: boolean
  source?: McpServerSource
  importedFrom?: string
  createdAt: string
  updatedAt: string
}

export interface McpToolConfig {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  enabled: boolean
}

export interface DiscoveredMcpServer extends McpServerConfig {
  source: Exclude<McpServerSource, 'manual'>
  sourcePath: string
}

export interface McpDiscoveryResult {
  servers: DiscoveredMcpServer[]
  warnings: string[]
}

export interface McpImportResult {
  servers: McpServerConfig[]
  imported: number
  skipped: number
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export type RestorableThreadMessage = ChatMessage & {
  display?: 'command-output' | 'system-status' | 'privacy-status' | 'tool-call'
  command?: string
  output?: string
  privacy?: PrivacyMaskingNotice
  reasoningContent?: string
}

export interface RestorableAssistantThread {
  messages: RestorableThreadMessage[]
  draft: string
  session?: Pick<TerminalSessionInfo, 'id' | 'kind' | 'label' | 'cwd' | 'shell'>
  savedChatId?: string
}

export type RestorableAssistantThreads = Record<string, RestorableAssistantThread>

export interface RestoredTerminalSession {
  id: string
  kind: TerminalSessionKind
  label: string
  localLabel?: string
  cwd?: string
  shell?: string
  remoteHost?: string
  remoteTarget?: string
  reconnectCommand?: string
  command: string
  createdAt: number
  shellIntegrationNonce?: string
  status: 'running' | 'exited' | 'disconnected'
  output: string
}

export interface SessionStateSnapshot {
  version: number
  savedAt: string
  activeSessionId?: string
  sessions: RestoredTerminalSession[]
  assistantThreads: RestorableAssistantThreads
}

export type SaveSessionStateRequest = SessionStateSnapshot

export interface TerminalContext {
  selectedText: string
  assistMode?: AssistMode
  terminalOutput?: string
  language?: string
  maskedSecretCount?: number
  taskListPlanning?: boolean
  session?: Pick<TerminalSessionInfo, 'id' | 'kind' | 'label' | 'cwd' | 'shell'>
}

export interface ChatStreamRequest {
  requestId: string
  provider: LLMProviderConfig
  messages: ChatMessage[]
  context: TerminalContext
}

export interface CommandRiskAssessmentRequest {
  provider: LLMProviderConfig
  command: string
  context: TerminalContext
}

export type CommandRiskLevel = 'warning' | 'danger'

export interface CommandRiskAssessment {
  dangerous: boolean
  reason: string
  reasonCode?: 'local-secret'
  reasonArgs?: Record<string, string>
  riskLevel?: CommandRiskLevel
}

export interface SummarizeConversationRequest {
  requestId?: string
  provider: LLMProviderConfig
  messages: ChatMessage[]
  language?: string
}

export interface GeneratedPrompt {
  name: string
  content: string
}

export type ChatStreamEvent =
  | { requestId: string; type: 'chunk'; content: string }
  | { requestId: string; type: 'reasoning'; content: string }
  | { requestId: string; type: 'tool'; status: 'running' | 'done' | 'error'; serverName: string; toolName: string; toolCallId?: string; content?: string }
  | {
      requestId: string
      type: 'privacy'
      maskedSecrets: number
      categories?: string[]
      source?: SecretMaskingAuditSource
      scope?: SecretMaskingAuditScope
      sessionLabel?: string
    }
  | { requestId: string; type: 'progress'; stage: 'model_load' | 'prompt_processing'; progress: number }
  | { requestId: string; type: 'error'; message: string }
  | { requestId: string; type: 'done'; maskedContent?: string }

export interface CommandProposal {
  id: string
  command: string
  explanation: string
}

export interface PromptTemplate {
  id: string
  name: string
  content: string
  createdAt: string
}

export interface CommandSnippet {
  id: string
  name: string
  command: string
  createdAt: string
  updatedAt: string
}

export interface SavedChat {
  id: string
  title: string
  messages: RestorableThreadMessage[]
  createdAt: string
  updatedAt: string
  providerRef?: string
  modelId?: string
  sessionSnapshot?: Pick<TerminalSessionInfo, 'kind' | 'label' | 'cwd' | 'shell'>
}

export interface SavedChatSummary {
  id: string
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
  providerRef?: string
  modelId?: string
  sessionSnapshot?: Pick<TerminalSessionInfo, 'kind' | 'label' | 'cwd' | 'shell'>
}

/** Aggregate activation-funnel events. They never carry payload content. */
export type TelemetryEvent =
  | 'app_first_run'
  | 'app_opened'
  | 'session_started'
  | 'ai_request_sent'
  | 'provider_configured'
  | 'ai_response_received'
  | 'ai_request_failed'

/** Whether the user has been asked for telemetry consent and what they chose. */
export type TelemetryConsentDecision = 'pending' | 'granted' | 'denied'

/**
 * Opt-in, privacy-respecting activation telemetry. Default off: nothing is sent
 * unless `enabled` is true, which only happens after an explicit `granted`
 * consent. `installId` is an anonymous, locally generated identifier used only
 * to de-duplicate funnel steps — never tied to an account, email, IP identity,
 * or any terminal content.
 */
export interface TelemetrySettings {
  enabled: boolean
  consentDecision: TelemetryConsentDecision
  installId: string
  consentedAt?: string
}

export interface AppConfig {
  providers: LLMProviderConfig[]
  activeProviderRef?: string
  hideShortcut?: string
  sshProfiles?: SSHProfileConfig[]
  secretMasking?: SecretMaskingSettings
  chatTools?: ChatToolsSettings
  telemetry?: TelemetrySettings
  windowBounds?: {
    x?: number
    y?: number
    width: number
    height: number
    isMaximized?: boolean
  }
}

export interface ExportData {
  version: number
  exportedAt: string
  config: AppConfig
  apiKeys?: Record<string, string>
  proxyPasswords?: Record<string, string>
  prompts: PromptTemplate[]
  commandSnippets?: CommandSnippet[]
  sshProfiles?: SSHProfileConfig[]
  mcpServers?: McpServerConfig[]
  preferences: {
    textSize?: number
    sidebarWidth?: number
    language?: string
    themeId?: string
    terminalFontFamily?: string
    terminalCursorStyle?: TerminalCursorStyle
    terminalCursorBlink?: boolean
    terminalLineHeight?: number
    terminalScrollback?: number
    windowOpacity?: number
  }
}

export interface DataUsageStats {
  chatCount: number
  sessionCount: number
  storageBytes: number
}

export interface ImportResult {
  providersAdded: number
  promptsAdded: number
  commandSnippetsAdded: number
  sshProfilesAdded: number
  mcpServersAdded: number
  preferences?: ExportData['preferences']
}

export type UpdateStatusState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface UpdateStatus {
  state: UpdateStatusState
  /** Version offered by the feed, when known. */
  version?: string
  /** Download progress percentage (0-100) while state is 'downloading'. */
  percent?: number
  /** Human-readable error message when state is 'error'. */
  error?: string
}
